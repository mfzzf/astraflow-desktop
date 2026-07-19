## 1. 数据库迁移

如果线上已经执行过 `0009`，本次还需要依次执行 `0010`、`0011`、`0012`；尚未执行 `0009` 时，请按编号依次补齐迁移。

先连接数据库并确认现状：

```bash
export DATABASE_URL='postgres://astraflow_app:真实密码@数据库地址:5432/astraflow?sslmode=require'

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c \
  "SELECT current_database(), current_user, to_regclass('public.feedbacks');"
```

建议先备份：

```bash
pg_dump "$DATABASE_URL" \
  --schema-only \
  --file "astraflow-schema-before-0009.sql"
```

执行迁移：

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f backend/astraflow-api/migration/0007_channel_management.up.sql

psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f backend/astraflow-api/migration/0008_click_analytics.up.sql

psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f backend/astraflow-api/migration/0009_cross_device_core.up.sql

psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f backend/astraflow-api/migration/0010_cross_device_runtime_and_files.up.sql

psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f backend/astraflow-api/migration/0011_cloud_automations.up.sql

psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f backend/astraflow-api/migration/0012_desktop_return_artifacts.up.sql
```

验证结果：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  to_regclass('public.feedbacks') AS feedbacks,
  to_regclass('public.distribution_channels') AS distribution_channels,
  to_regclass('public.channel_oauth_flows') AS channel_oauth_flows,
  to_regclass('public.analytics_events') AS analytics_events,
  to_regclass('public.devices') AS devices,
  to_regclass('public.sync_events') AS sync_events,
  to_regclass('public.agent_runs') AS agent_runs,
  to_regclass('public.device_commands') AS device_commands,
  to_regclass('public.artifact_uploads') AS artifact_uploads,
  to_regclass('public.artifact_shares') AS artifact_shares,
  to_regclass('public.push_notifications') AS push_notifications,
  to_regclass('public.cloud_automations') AS cloud_automations,
  to_regclass('public.cloud_automation_runs') AS cloud_automation_runs;

SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'agent_runs'
  AND column_name = 'return_artifacts';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'feedbacks'
  AND column_name IN (
    'channel_slug',
    'status',
    'assignee',
    'admin_note',
    'updated_at'
  )
ORDER BY column_name;
SQL
```

这次迁移会：

- 给 `feedbacks` 增加渠道、状态、负责人、管理备注和更新时间。
- 现有 Feedback 自动设置为 `channel_slug=default`、`status=new`。
- 创建 `distribution_channels`。
- 创建 `channel_oauth_flows`。
- 创建相应索引。
- 创建 `analytics_events` 点击事件表以及时间、渠道、事件和会话索引。
- 埋点表不保存输入内容；已登录用户只保存 SHA-256 标识，不保存邮箱明文。
- 创建账号、设备、工作区、会话、消息、Agent Run、产物元数据和追加式同步事件表。
- 创建可靠的桌面端设备命令队列、一次性连接令牌、幂等客户端变更记录和 Push 端点表。
- `0010` 增加云端 Worker lease、对象存储直传、可撤销分享和 durable Push 投递队列。
- `0011` 增加账号隔离的云端 Automation 计划与普通 Session/Run 触发记录。
- `0012` 增加桌面 Run 的显式产物回传开关；默认关闭，不会上传既有项目文件。
- 不会自动创建渠道，需要部署后在管理台添加。

如果是全新数据库，需要按照 [Migration README](/Users/zzf/code/astraflow-desktop/astraflow-desktop/backend/astraflow-api/migration/README.md) 的顺序执行：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0001_expert_system.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0003_expert_list_sort_indexes.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0004_feedback.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0005_feedback_optional_session.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0006_feedback_messages_text.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0007_channel_management.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0008_click_analytics.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0009_cross_device_core.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0010_cross_device_runtime_and_files.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0011_cloud_automations.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0012_desktop_return_artifacts.up.sql
```

不要轻易执行 `0011_cloud_automations.down.sql` 或 `0009_cross_device_core.down.sql`，它们会删除 Automation 或全部跨端设备、同步、会话和 Run 数据。`0012_desktop_return_artifacts.down.sql` 只删除回传开关，但回滚前仍应先停止使用新 contract 的 API/客户端。

## 2. 重新生成生产密钥

正式使用前按名称生成独立密钥：

```bash
export ASTRAFLOW_ADMIN_API_KEY="$(openssl rand -base64 48)"
export ASTRAFLOW_CHANNEL_SECRET_KEY="$(openssl rand -base64 32)"
export ASTRAFLOW_PUSH_TOKEN_SECRET_KEY="$(openssl rand -base64 32)"
export ASTRAFLOW_CLOUD_WORKER_TOKEN="$(openssl rand -base64 48)"
export ASTRAFLOW_ADMIN_UI_PASSWORD="$(openssl rand -base64 32)"
```

把这些值写入部署平台 Secret；管理台本地调试时再写入 [`.env.admin-console.local`](/Users/zzf/code/astraflow-desktop/astraflow-desktop/.env.admin-console.local)。以下 OAuth 值不能随机生成，必须来自为 AstraFlow 原生 App 创建的 UCloud OAuth 应用：

```text
ASTRAFLOW_UCLOUD_OAUTH_CLIENT_ID
ASTRAFLOW_UCLOUD_OAUTH_CLIENT_SECRET
```

然后加载：

```bash
set -a
. ./.env.admin-console.local
set +a
```

`ASTRAFLOW_CHANNEL_SECRET_KEY` 和 `ASTRAFLOW_PUSH_TOKEN_SECRET_KEY` 必须是不同的 Base64 编码 32 字节密钥。Push 密钥用于加密 Expo 设备令牌，Expo 再投递到 Android FCM 或 iOS APNs；密钥必须只保存在服务端并跨发布保持稳定。`ASTRAFLOW_CLOUD_WORKER_TOKEN` 由 API 与 Worker 共享，但不能发给用户客户端。OAuth client secret 只进入后端 Secret，不能进入 Expo 配置、App 包或日志。

完整的云端执行和文件能力还需要从对应服务取得以下服务端凭证：

```text
ASTRAFLOW_OBJECT_STORAGE_ACCESS_KEY
ASTRAFLOW_OBJECT_STORAGE_SECRET_KEY
ASTRAFLOW_OBJECT_STORAGE_SESSION_TOKEN   # 仅临时凭证需要
ASTRAFLOW_CLOUD_SANDBOX_API_KEY
ASTRAFLOW_CLOUD_MODELVERSE_API_KEY
```

对象存储凭证只用于 S3-compatible 对象读写，不用于 UCloud 产品 OpenAPI。产品 OpenAPI 继续使用用户 OAuth Bearer token。

## 3. 构建并推送后端镜像

从仓库根目录执行：

```bash
export IMAGE_TAG=latest

docker build \
  --file backend/astraflow-api/Dockerfile \
  --tag "uhub.service.ucloud.cn/uminfer-proxy/astraflow-api:$IMAGE_TAG" \
  backend/astraflow-api

docker push "uhub.service.ucloud.cn/uminfer-proxy/astraflow-api:$IMAGE_TAG"

docker build \
  --file worker/Dockerfile.cloud \
  --tag "uhub.service.ucloud.cn/uminfer-proxy/astraflow-cloud-worker:$IMAGE_TAG" \
  .

docker push "uhub.service.ucloud.cn/uminfer-proxy/astraflow-cloud-worker:$IMAGE_TAG"
```

确保已经登录 UHub：

```bash
docker login uhub.service.ucloud.cn
```

## 4. 创建后端 Secret

```bash
kubectl create namespace astraflow \
  --dry-run=client -o yaml |
kubectl apply -f -
```

创建或更新 Secret：

```bash
kubectl --namespace astraflow create secret generic astraflow-api-admin \
  --from-literal=ASTRAFLOW_ADMIN_API_KEY="$ASTRAFLOW_ADMIN_API_KEY" \
  --from-literal=ASTRAFLOW_CHANNEL_SECRET_KEY="$ASTRAFLOW_CHANNEL_SECRET_KEY" \
  --from-literal=ASTRAFLOW_PUSH_TOKEN_SECRET_KEY="$ASTRAFLOW_PUSH_TOKEN_SECRET_KEY" \
  --from-literal=ASTRAFLOW_UCLOUD_OAUTH_CLIENT_ID="$ASTRAFLOW_UCLOUD_OAUTH_CLIENT_ID" \
  --from-literal=ASTRAFLOW_UCLOUD_OAUTH_CLIENT_SECRET="$ASTRAFLOW_UCLOUD_OAUTH_CLIENT_SECRET" \
  --from-literal=ASTRAFLOW_OBJECT_STORAGE_ACCESS_KEY="$ASTRAFLOW_OBJECT_STORAGE_ACCESS_KEY" \
  --from-literal=ASTRAFLOW_OBJECT_STORAGE_SECRET_KEY="$ASTRAFLOW_OBJECT_STORAGE_SECRET_KEY" \
  --from-literal=ASTRAFLOW_OBJECT_STORAGE_SESSION_TOKEN="${ASTRAFLOW_OBJECT_STORAGE_SESSION_TOKEN:-}" \
  --from-literal=ASTRAFLOW_CLOUD_WORKER_TOKEN="$ASTRAFLOW_CLOUD_WORKER_TOKEN" \
  --from-literal=ASTRAFLOW_CLOUD_SANDBOX_API_KEY="$ASTRAFLOW_CLOUD_SANDBOX_API_KEY" \
  --from-literal=ASTRAFLOW_CLOUD_MODELVERSE_API_KEY="$ASTRAFLOW_CLOUD_MODELVERSE_API_KEY" \
  --dry-run=client -o yaml |
kubectl apply -f -
```

确认 Secret 存在，但不要输出内容：

```bash
kubectl --namespace astraflow get secret astraflow-api-admin
```

## 5. 升级后端 Helm Release

如果现在线上已经有 `astraflow-api` Release：

```bash
helm upgrade astraflow-api \
  backend/astraflow-api/helm/astraflow-api \
  --namespace astraflow \
  --reuse-values \
  --set-string image.tag="$IMAGE_TAG" \
  --set-string cloudWorker.image.tag="$IMAGE_TAG" \
  --set cloudWorker.enabled=true \
  --set-string objectStorage.endpoint="$ASTRAFLOW_OBJECT_STORAGE_ENDPOINT" \
  --set-string objectStorage.bucket="$ASTRAFLOW_OBJECT_STORAGE_BUCKET" \
  --set-string objectStorage.region="$ASTRAFLOW_OBJECT_STORAGE_REGION" \
  --set-string admin.existingSecret=astraflow-api-admin
```

确保 Service 和 Gateway Route 已安装：

```bash
helm upgrade --install astraflow-api-service \
  backend/astraflow-api/helm/astraflow-api-service \
  --namespace astraflow \
  --create-namespace
```

等待发布完成：

```bash
kubectl --namespace astraflow rollout status \
  deployment/astraflow-api \
  --timeout=5m

kubectl --namespace astraflow rollout status \
  deployment/astraflow-api-cloud-worker \
  --timeout=5m
```

检查：

```bash
kubectl --namespace astraflow get pods,svc
kubectl --namespace astraflow logs deployment/astraflow-api --tail=100
```

验证后端：

```bash
curl --fail \
  https://astraflow-desktop.modelverse.cn/astraflow-desktop/api/v1/health
```

跨端桌面设备使用同一 HTTPS Route 的 `/v1/device-relay` WebSocket 端点。确认外层 Gateway/负载均衡器允许 WebSocket Upgrade，且空闲超时高于客户端心跳周期（当前为 20 秒）；不要在日志或监控标签中记录 `Authorization: Device ...` 请求头。

对象存储端点采用 path-style S3 URL（`<endpoint>/<bucket>/<object-key>`），正式环境必须使用 HTTPS。API 只返回短期签名 URL；公开分享仍通过可撤销的 `/v1/public/artifacts/{share_token}` 入口。云端 Worker Deployment 仅持有专用 Worker token、Sandbox key 与 ModelVerse key，不持有用户 OAuth token。

验证管理 API 鉴权：

```bash
curl --fail \
  -H "Authorization: Bearer $ASTRAFLOW_ADMIN_API_KEY" \
  https://astraflow-desktop.modelverse.cn/astraflow-desktop/api/v1/admin/channels

curl --fail \
  -H "Authorization: Bearer $ASTRAFLOW_ADMIN_API_KEY" \
  'https://astraflow-desktop.modelverse.cn/astraflow-desktop/api/v1/admin/analytics/overview?days=7'
```

### 5.1 Android App（Expo EAS）

首次把 `mobile-app/` 绑定到正式 Expo 项目；`eas init` 会把真实 `extra.eas.projectId` 写入 Expo 配置，Push 注册依赖它：

```bash
cd mobile-app
npx eas-cli@latest init
cd ..
```

UCloud OAuth 应用必须精确允许 `astraflow://oauth/callback`。后端 `ucloud.oauthRedirectUris` 也必须包含同一个 URI。API 地址在生产构建环境中显式设置：

```bash
cd mobile-app
npx eas-cli@latest env:create production \
  --name EXPO_PUBLIC_ASTRAFLOW_API_BASE_URL \
  --value 'https://astraflow-desktop.modelverse.cn/astraflow-desktop/api' \
  --visibility plaintext
cd ..
```

Android HTTPS App Link 还需要在站点发布 `/.well-known/assetlinks.json`，其中 package name 为 `com.ucloud.astraflow`，证书 SHA-256 fingerprint 必须与 EAS production keystore 一致。完成后构建 AAB：

```bash
bun run mobile:typecheck
bun run mobile:lint

cd mobile-app
npx eas-cli@latest build --platform android --profile production
cd ..
```

真机首次登录后，在“设置 → Agent 通知”确认状态为已启用。模拟器、拒绝通知权限或缺少 EAS projectId 都会显示明确诊断，不会假装 Push 已注册。

## 6. 构建管理台镜像

```bash
docker build \
  --file admin-console/Dockerfile \
  --tag uhub.service.ucloud.cn/astraflow-desktop/admin-console:latest \
  .

docker push \
  uhub.service.ucloud.cn/astraflow-desktop/admin-console:latest
```

## 7. 创建管理台 Secret

```bash
kubectl create namespace astraflow-admin \
  --dry-run=client -o yaml |
kubectl apply -f -
```

```bash
kubectl --namespace astraflow-admin create secret generic astraflow-admin-secrets \
  --from-literal=ASTRAFLOW_ADMIN_API_KEY="$ASTRAFLOW_ADMIN_API_KEY" \
  --from-literal=ASTRAFLOW_ADMIN_UI_USERNAME="$ASTRAFLOW_ADMIN_UI_USERNAME" \
  --from-literal=ASTRAFLOW_ADMIN_UI_PASSWORD="$ASTRAFLOW_ADMIN_UI_PASSWORD" \
  --dry-run=client -o yaml |
kubectl apply -f -
```

还要确保 UHub 镜像拉取 Secret 存在于这个 namespace：

```bash
kubectl --namespace astraflow-admin get secret uhub-secret
```

如果不存在，需要使用你们的 UHub 账号创建：

```bash
kubectl --namespace astraflow-admin create secret docker-registry uhub-secret \
  --docker-server=uhub.service.ucloud.cn \
  --docker-username='你的UHub用户名' \
  --docker-password='你的UHub密码'
```

## 8. 部署管理台

应用 [Kubernetes 清单](/Users/zzf/code/astraflow-desktop/astraflow-desktop/kubernetes/admin-console.yaml)：

```bash
kubectl apply -f kubernetes/admin-console.yaml
```

等待：

```bash
kubectl --namespace astraflow-admin rollout status \
  deployment/astraflow-admin-console \
  --timeout=5m
```

检查资源：

```bash
kubectl --namespace astraflow-admin get pods,svc,httproute
kubectl --namespace astraflow-admin logs \
  deployment/astraflow-admin-console \
  --tail=100
```

管理台通过集群内部地址访问后端：

```text
http://astraflow-api.astraflow.svc.cluster.local:8000
```

因此需要确认后端 Service 名称确实是：

```bash
kubectl --namespace astraflow get service astraflow-api
```

## 9. 最终验证

健康检查：

```bash
curl --fail \
  https://astraflow-desktop.modelverse.cn/astraflow-admin/api/health
```

浏览器访问：

```text
https://astraflow-desktop.modelverse.cn/astraflow-admin/dashboard
```

浏览器会弹出 Basic Auth：

- 用户名：`.env.admin-console.local` 中的 `ASTRAFLOW_ADMIN_UI_USERNAME`
- 密码：`.env.admin-console.local` 中的 `ASTRAFLOW_ADMIN_UI_PASSWORD`

登录后先创建一个 Draft 渠道，配置：

- 渠道 slug
- OAuth Client ID
- OAuth Client Secret
- 可见功能
- 是否限制模型
- 模型白名单

确认无误后再将渠道状态切换为 `active`。
