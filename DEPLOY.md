## 1. 数据库迁移

如果线上已经有 Feedback 功能并且执行过 `0004～0006`，这次只需要执行 `0007`。

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
  --file "astraflow-schema-before-0007.sql"
```

执行迁移：

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -f backend/astraflow-api/migration/0007_channel_management.up.sql
```

验证结果：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
SELECT
  to_regclass('public.feedbacks') AS feedbacks,
  to_regclass('public.distribution_channels') AS distribution_channels,
  to_regclass('public.channel_oauth_flows') AS channel_oauth_flows;

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
- 不会自动创建渠道，需要部署后在管理台添加。

如果是全新数据库，需要按照 [Migration README](/Users/zzf/code/astraflow-desktop/astraflow-desktop/backend/astraflow-api/migration/README.md) 的顺序执行：

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0001_expert_system.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0003_expert_list_sort_indexes.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0004_feedback.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0005_feedback_optional_session.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0006_feedback_messages_text.up.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/astraflow-api/migration/0007_channel_management.up.sql
```

不要轻易执行 `0007_channel_management.down.sql`，它会删除渠道表以及新增的 Feedback 管理字段和数据。

## 2. 重新生成生产密钥

正式使用前运行：

```bash
openssl rand -base64 48
openssl rand -base64 32
openssl rand -base64 48
```

分别替换 [`.env.admin-console.local`](/Users/zzf/code/astraflow-desktop/astraflow-desktop/.env.admin-console.local) 中的：

```text
ASTRAFLOW_ADMIN_API_KEY
ASTRAFLOW_CHANNEL_SECRET_KEY
ASTRAFLOW_ADMIN_UI_PASSWORD
```

然后加载：

```bash
set -a
. ./.env.admin-console.local
set +a
```

`ASTRAFLOW_CHANNEL_SECRET_KEY` 必须是第二条命令生成的、Base64 编码的 32 字节密钥。

## 3. 构建并推送后端镜像

从仓库根目录执行：

```bash
export IMAGE_TAG=latest

docker build \
  --file backend/astraflow-api/Dockerfile \
  --tag "uhub.service.ucloud.cn/uminfer-proxy/astraflow-api:$IMAGE_TAG" \
  backend/astraflow-api

docker push "uhub.service.ucloud.cn/uminfer-proxy/astraflow-api:$IMAGE_TAG"
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

验证管理 API 鉴权：

```bash
curl --fail \
  -H "Authorization: Bearer $ASTRAFLOW_ADMIN_API_KEY" \
  https://astraflow-desktop.modelverse.cn/astraflow-desktop/api/v1/admin/channels
```

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