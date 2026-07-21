# 单张 RTX 4090：ASR 与标题生成部署指南

## 结论

推荐组合：

| 任务 | 模型 | 推理精度 | 选择理由 |
|---|---|---|---|
| 语音识别 | `Qwen/Qwen3-ASR-1.7B` | BF16 | 支持 30 种语言、22 种中文方言、流式与离线识别；Qwen 官方公开评测将 1.7B 版本定位为开源 ASR 的 SOTA 档位 |
| 标题生成 | `Qwen/Qwen3-8B-AWQ` | AWQ INT4 | 官方 4-bit 权重，中文与多语能力强；原生上下文 32,768 token，标题任务关闭 thinking 后延迟较低 |

RTX 4090 有 24 GB GDDR6X 显存。建议让 ASR 进程最多使用 28%，标题模型进程最多使用 55%，合计约 19.9 GB 的 vLLM 显存预算，给 CUDA context、音频预处理和波动留下约 4.1 GB。这里的比例是部署起点，不是模型官方显存承诺；上线前需要用真实音频压测。

`Qwen3.5-9B` 的 BF16 权重文件约 19.3 GB，和 ASR、KV cache、CUDA 运行时一起放入 24 GB 显存过于紧张；当前场景优先采用 Qwen 官方发布的 `Qwen3-8B-AWQ`。若 ASR 并发量比精度更重要，将 ASR 换为 `Qwen/Qwen3-ASR-0.6B`，gRPC 契约无需变化。

## 调用链

```text
AstraFlow Desktop
        │ HTTP 或 gRPC
        ▼
astraflow-api :8000/:9000
        │ cluster-internal gRPC :9100
        ▼
inference-gateway（CPU sidecar）
        ├── HTTP localhost:8001 ── Qwen3-ASR-1.7B
        └── HTTP localhost:8002 ── Qwen3-8B-AWQ
                                      ▲
                         同一容器、同一张 RTX 4090
```

模型进程使用 vLLM 原生接口；`astraflow-api` 与推理网关之间只使用仓库内的 gRPC 契约。这样模型服务框架以后可以替换为 Triton 或 SGLang，而产品 API 不需要改变。

相关代码：

- 产品 API：`api/astraflow/v1/speech.proto`
- 集群内部推理契约：`api/astraflow/inference/v1/inference.proto`
- gRPC 客户端：`internal/data/speech.go`
- CPU 推理网关：`cmd/inference-gateway/main.go`
- 双模型启动脚本：`deploy/gpu-inference/start-models.sh`

## 一、准备 GPU 节点

1. 安装支持当前 CUDA 容器的 NVIDIA 驱动、NVIDIA Container Toolkit 和 Kubernetes NVIDIA device plugin。
2. 确认节点能看到 24 GB 显存：

   ```bash
   nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv
   ```

3. 确认 UK8S 已有的 4090 Pro 节点标签能够选中目标节点：

   ```bash
   kubectl get nodes -l accelerator=nvidia-tesla-4090pro -o wide
   ```

4. 模型缓存至少预留 40 GB 磁盘。模型权重持久保存到 US3，Pod 启动时从只读 US3 PVC 暂存到节点本地 `emptyDir`，再由 vLLM 加载。

### 使用 UK8S CSI 挂载 US3

US3 是对象存储，不是本地文件系统。UCloud 官方将其定位为静态文件上传、下载场景；对文件系统读写性能要求高时建议使用 UDisk、UFS 或 UPFS。模型权重属于只读静态数据，适合放在 US3，但不建议 vLLM 在服务期间直接通过 FUSE mmap 和随机读取权重。因此采用“US3 持久源 → initContainer 复制到节点本地 → vLLM 加载”的方式。

1. 在 UK8S 控制台的「插件 → 存储插件」查看 CSI 版本，建议升级到 `26.06.03` 或更新版本。该版本新增 US3FS mounter，并能在 s3fs 因 segfault 退出时自动重新挂载。不要直接修改 CSI DaemonSet 的镜像；UCloud 官方要求通过控制台执行升级。
2. US3 Bucket 与 UK8S GPU 节点放在同一地域，使用该地域的 S3 内网 endpoint。US3 内网 endpoint 不支持 HTTPS，Secret 中配置 `http://internal...` 是正常用法。
3. Bucket 使用标准存储类型，不要使用归档类型；US3FS 官方说明不支持读取归档文件。
4. 创建两个 US3 Token：上传端 Token 拥有上传、文件列表权限；UK8S 运行时 Token 对 `astraflow-models` Bucket 仅授予下载、文件列表权限。不要把 Token 写入 Git、Helm values 或本文档。

下载并上传实际模型文件，不要上传 Hugging Face cache 中指向其他目录的软链接；US3FS 不支持软链接。可使用 ModelScope 的 `--local_dir`：

```bash
modelscope download --model Qwen/Qwen3-ASR-1.7B --local_dir ./models/Qwen3-ASR-1.7B
modelscope download --model Qwen/Qwen3-8B-AWQ --local_dir ./models/Qwen3-8B-AWQ

us3cli sync ./models/Qwen3-ASR-1.7B us3://astraflow-models/Qwen3-ASR-1.7B/ --parallel 10 --ruler etag
us3cli sync ./models/Qwen3-8B-AWQ us3://astraflow-models/Qwen3-8B-AWQ/ --parallel 10 --ruler etag
```

仓库内的完整清单已经写入 Bucket、乌兰察布内网 endpoint、4090 节点标签和镜像地址。只需替换 Secret 中的 US3 Token 公钥、私钥：

```bash
${EDITOR:-vi} deploy/gpu-inference/uk8s-4090-us3.yaml
kubectl apply -f deploy/gpu-inference/uk8s-4090-us3.yaml
kubectl -n astraflow get pvc astraflow-models-us3 -w
```

清单把 `astraflow-models` Bucket 根目录挂载到 PVC。跨项目挂载所需的 provisioner Secret 参数已经保留；CSI 版本必须不低于 `24.10.08`。同一个 Bucket 不要在同一个 Pod 中通过多个 PVC 重复挂载，这是 UCloud 官方列出的启动失败场景。

## 二、构建镜像

在 `backend/astraflow-api` 目录执行：

```bash
make build-push
```

`astraflow-api` 镜像同时包含 `/app/astraflow-api` 和 `/app/inference-gateway` 两个二进制。

## 三、部署一个 GPU Pod

同一张 4090 上不要创建两个各自申请 `nvidia.com/gpu: 1` 的模型 Pod。默认 device plugin 会独占分配设备，第二个 Pod 无法调度。使用一个 Pod：

- `models` 容器申请一次 `nvidia.com/gpu: 1`，在容器内启动两个 vLLM 进程。
- `gateway` sidecar 不申请 GPU，命令设置为 `/app/inference-gateway`。
- 两个容器共享 Pod 网络，因此网关默认访问 `127.0.0.1:8001` 和 `127.0.0.1:8002`。
- US3 PVC 以只读方式挂载；initContainer 将权重暂存到节点本地卷，避免推理期间依赖 FUSE 随机读取。

仓库提供了 UK8S 示例：

- `deploy/gpu-inference/uk8s-4090-us3.yaml`：当前集群可直接填写两个 US3 Token 字段并应用的完整清单。
- `deploy/gpu-inference/uk8s-us3-storage.yaml.example`：US3 StorageClass 与 PVC。
- `deploy/gpu-inference/uk8s-gpu-inference.yaml.example`：模型 initContainer、双 vLLM 进程、gRPC sidecar 和 ClusterIP Service。

模型上传完成且两个镜像推送完成后，部署完整清单：

```bash
kubectl apply -f deploy/gpu-inference/uk8s-4090-us3.yaml
kubectl -n astraflow rollout status deployment/astraflow-inference --timeout=30m
```

initContainer 会检查两个 `config.json`，把 US3 的两个模型目录复制到 30 GiB `emptyDir`，模型容器分别从 `/models-local/Qwen3-ASR-1.7B` 和 `/models-local/Qwen3-8B-AWQ` 加载。Pod 被删除或漂移到其他节点时会重新复制；普通模型容器重启会复用同一 Pod 的本地副本。

关键环境变量：

```yaml
# models 容器
- name: ASR_GPU_MEMORY_UTILIZATION
  value: "0.28"
- name: TITLE_GPU_MEMORY_UTILIZATION
  value: "0.55"
- name: TITLE_MAX_MODEL_LEN
  value: "8192"

# gateway sidecar
- name: ASR_BASE_URL
  value: http://127.0.0.1:8001
- name: TITLE_BASE_URL
  value: http://127.0.0.1:8002
- name: AUDIO_URI_ALLOWED_HOST_SUFFIXES
  value: example.com,ucloud.cn
```

`AUDIO_URI_ALLOWED_HOST_SUFFIXES` 必须替换为实际对象存储域名。为空时网关拒绝所有 `audio_uri`，但仍接受直接上传的音频字节，避免服务端请求伪造访问集群内网。

标题模型固定使用官方 `Qwen/Qwen3-8B-AWQ` 的 INT4 权重，不要换成 BF16 版本。长转写会先按 6,000 个 Unicode 字符分段摘要，再汇总成标题，避免超过 8,192 token 的服务上限。标题默认不设字符数限制；只有调用方显式传入大于零的 `maxCharacters` 或 `maxTitleCharacters` 时才按该值截断。

为 Pod 建立仅集群内可见的 Service，把 TCP 9100 指向 `gateway` sidecar。不要把 8001、8002 或 9100 暴露到公网。

## 四、配置 astraflow-api

Helm values 已增加推理配置：

```yaml
server:
  http:
    timeout: 300s
  grpc:
    timeout: 300s

inference:
  addr: astraflow-inference-gateway:9100
  timeout: 300s
  maxMessageBytes: 67108864
```

部署或升级 `astraflow-api`。服务对外提供：

- `POST /v1/speech:transcribe`
- `POST /v1/speech:generateTitle`
- `POST /v1/speech:process`：依次完成识别和标题生成

直接上传最多 48 MiB；长音频应先上传对象存储，再传短期有效的签名 HTTPS URL。网关会把下载后的音频限制在 48 MiB 内。

## 五、验收

先验证集群内部 gRPC 标题接口：

```bash
grpcurl -plaintext \
  -import-path api \
  -proto astraflow/inference/v1/inference.proto \
  -d '{"transcript":"讨论了在单张4090上部署语音识别和标题总结模型","language":"zh"}' \
  astraflow-inference-gateway:9100 \
  astraflow.inference.v1.InferenceService/GenerateTitle
```

再验证产品组合接口：

```bash
curl -X POST http://<ASTRAFLOW_API>/v1/speech:process \
  -H 'Content-Type: application/json' \
  -d '{
    "audioUri": "https://<ALLOWED_HOST>/<SIGNED_AUDIO_URL>",
    "mimeType": "audio/mpeg",
    "languageHint": "zh"
  }'
```

验收指标至少包括：

- 10 秒、5 分钟、30 分钟三档真实音频均能完成。
- 中文普通话、口音/方言、中文夹英文和嘈杂录音各准备样本。
- 标题不出现转写中没有的人名、数字或结论。
- 压测时 `nvidia-smi` 不发生 OOM；显存持续超过 23 GB 时，先把标题模型利用率降至 `0.50`，再降低 `TITLE_MAX_MODEL_LEN` 或并发。
- ASR 高峰到来时给标题请求设置较低并发；两个进程共享计算资源，显存预算不会提供算力隔离。

## 参考资料

- [Qwen3-ASR-1.7B 官方模型卡](https://huggingface.co/Qwen/Qwen3-ASR-1.7B)
- [Qwen3-ASR 官方仓库](https://github.com/QwenLM/Qwen3-ASR)
- [Qwen3-8B-AWQ 官方模型卡](https://huggingface.co/Qwen/Qwen3-8B-AWQ)
- [vLLM 支持的模型与 Qwen3-ASR 说明](https://docs.vllm.ai/en/v0.21.0/models/supported_models/)
- [NVIDIA RTX 4090 官方规格](https://www.nvidia.com/en-me/geforce/graphics-cards/40-series/rtx-4090/)
- [UCloud：在 UK8S 中使用 US3](https://docs.ucloud.cn/uk8s/volume/ufile)
- [UCloud：UK8S CSI 更新与版本记录](https://docs.ucloud.cn/uk8s/volume/CSI_update)
- [UCloud：US3 地域和内外网 Endpoint](https://docs.ucloud.cn/ufile/introduction/region)
- [UCloud：US3 Token 权限与文件前缀](https://docs.ucloud.cn/ufile/guide/token)
- [UCloud：US3CLI 上传与同步](https://docs.ucloud.cn/ufile/tools/us3cli/quickaccess)
- [UCloud：US3FS 使用限制](https://docs.ucloud.cn/ufile/tools/tools/us3fs)
