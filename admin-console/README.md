# AstraFlow Admin Console

独立的 Next.js + shadcn/ui 管理平台，基于官方 `dashboard-01` block
改造，用于：

- 查看和处理客户端 feedback，包括会话快照与截图；
- 管理分发渠道、发布状态和 OAuth client；
- 配置每个渠道可见的侧边栏功能；
- 配置跨 Chat、Models、图像、视频和音频的模型白名单。

## 本地配置

复制环境变量模板并填入与 Go 后端一致的管理密钥：

```bash
cp .env.example .env.local
```

管理台使用 HTTP Basic Auth 保护所有页面、Route Handler 和 Server Action；
`ASTRAFLOW_ADMIN_UI_PASSWORD` 应与后端 API key 使用不同的长随机值。生产环境必须使用 HTTPS。

Go 后端还需要稳定的 32-byte base64 加密密钥来保存 OAuth client secret：

```bash
export ASTRAFLOW_ADMIN_API_KEY='replace-with-a-long-random-admin-key'
export ASTRAFLOW_CHANNEL_SECRET_KEY="$(openssl rand -base64 32)"
```

不要把真实密钥提交到仓库。

## 开发

```bash
bun install
bun run codegen:astraflow-api
bun run dev
```

后端 OpenAPI 变化后，必须重新执行 `bun run codegen:astraflow-api`。生成代码位于
`lib/generated/astraflow-api/`，不要手动修改。

## 校验

```bash
bun run typecheck
bun run lint
```

## Docker 与 Kubernetes

镜像从仓库根目录构建，生产镜像固定使用 `/astraflow-admin` base path：

```bash
docker build \
  --file admin-console/Dockerfile \
  --tag uhub.service.ucloud.cn/astraflow-desktop/admin-console:latest \
  .
docker push uhub.service.ucloud.cn/astraflow-desktop/admin-console:latest
```

根目录下的 `.env.admin-console.local` 是本地生成且被 Git 忽略的密钥文件。
先在两个 namespace 中创建 Secret，再应用部署清单：

```bash
set -a
. ./.env.admin-console.local
set +a

kubectl create namespace astraflow --dry-run=client -o yaml | kubectl apply -f -
kubectl create namespace astraflow-admin --dry-run=client -o yaml | kubectl apply -f -

kubectl --namespace astraflow create secret generic astraflow-api-admin \
  --from-literal=ASTRAFLOW_ADMIN_API_KEY="$ASTRAFLOW_ADMIN_API_KEY" \
  --from-literal=ASTRAFLOW_CHANNEL_SECRET_KEY="$ASTRAFLOW_CHANNEL_SECRET_KEY" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl --namespace astraflow-admin create secret generic astraflow-admin-secrets \
  --from-literal=ASTRAFLOW_ADMIN_API_KEY="$ASTRAFLOW_ADMIN_API_KEY" \
  --from-literal=ASTRAFLOW_ADMIN_UI_USERNAME="$ASTRAFLOW_ADMIN_UI_USERNAME" \
  --from-literal=ASTRAFLOW_ADMIN_UI_PASSWORD="$ASTRAFLOW_ADMIN_UI_PASSWORD" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl apply -f kubernetes/admin-console.yaml
```

管理台地址为
`https://astraflow-desktop.modelverse.cn/astraflow-admin/dashboard`。
`uhub-secret` 需要同时存在于 `astraflow-admin` namespace 中。
