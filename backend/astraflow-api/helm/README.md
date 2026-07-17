# Helm Commands

```bash
export NS=astraflow
export APP_RELEASE=astraflow-api
export SVC_RELEASE=astraflow-api-service
export DATABASE_URL='postgresql://astraflow_app:AstraFlow123@10.100.17.196/astraflow'
export IMAGE_TAG=latest
```

## Create

```bash
helm upgrade --install "$SVC_RELEASE" backend/astraflow-api/helm/astraflow-api-service \
  --namespace "$NS" \
  --create-namespace

helm upgrade --install "$APP_RELEASE" backend/astraflow-api/helm/astraflow-api \
  --namespace "$NS" \
  --create-namespace \
  --set-string image.tag="$IMAGE_TAG" \
  --set-string database.source="$DATABASE_URL"
```

## Upgrade

```bash
helm upgrade "$APP_RELEASE" backend/astraflow-api/helm/astraflow-api \
  --namespace "$NS" \
  --set-string image.tag="$IMAGE_TAG" \
  --set-string database.source="$DATABASE_URL"
```

```bash
helm upgrade "$SVC_RELEASE" backend/astraflow-api/helm/astraflow-api-service \
  --namespace "$NS"
```

The service chart also publishes the HTTP API at
`https://astraflow-desktop.modelverse.cn/astraflow-desktop/api/` through
`gateway-infra/public-gateway`. The Gateway strips the
`/astraflow-desktop/api` prefix before forwarding requests to the
`astraflow-api` Service on port `8000`. Native gRPC is available through the
same hostname on port `443` and is forwarded to Service port `9000`.

## Migrate Existing Service

```bash
helm upgrade "$APP_RELEASE" backend/astraflow-api/helm/astraflow-api \
  --namespace "$NS" \
  --reuse-values \
  --set service.create=true \
  --set service.resourcePolicy=keep

helm upgrade --install "$SVC_RELEASE" backend/astraflow-api/helm/astraflow-api-service \
  --namespace "$NS" \
  --take-ownership \
  --set-string target.instance="$APP_RELEASE"

helm upgrade "$APP_RELEASE" backend/astraflow-api/helm/astraflow-api \
  --namespace "$NS" \
  --reuse-values \
  --set service.create=false
```

## Uninstall

```bash
helm uninstall "$APP_RELEASE" --namespace "$NS"
```

```bash
helm uninstall "$SVC_RELEASE" --namespace "$NS"
```
