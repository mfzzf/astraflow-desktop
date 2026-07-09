# AstraFlow API Helm Chart

This chart deploys the AstraFlow backend API and exposes it through a UCloud
external NLB by default.

The default Service settings are:

- `type: LoadBalancer`
- UCloud load balancer network type: `outer`
- UCloud load balancer listener type: `network` (NLB)
- VServer protocol: `tcp`
- EIP billing mode: `traffic`
- EIP bandwidth cap: `300` Mbps
- Load balancer and EIP charge type: `dynamic`

Preview locally without deploying:

```bash
helm template astraflow-api backend/astraflow-api/helm/astraflow-api \
  --namespace astraflow \
  --set-string image.tag=b35f58cd \
  --set-string database.source="$DATABASE_URL"
```

Deploy when ready:

```bash
helm upgrade --install astraflow-api backend/astraflow-api/helm/astraflow-api \
  --namespace astraflow \
  --create-namespace \
  --set-string image.tag=b35f58cd \
  --set-string database.source="$DATABASE_URL"
```

Do not commit production database URLs or passwords. Pass `DATABASE_URL` from
your shell or deployment secret manager.
