# Landing page deployment

The image is built from the repository root because the Vite app consumes the
shared `public/` directory.

```bash
docker build \
  -f landing-page/Dockerfile \
  -t uhub.service.ucloud.cn/astraflow-desktop/landing-page:latest \
  .

docker push uhub.service.ucloud.cn/astraflow-desktop/landing-page:latest
```

The workload attaches to the existing Envoy Gateway defined in
`lib/kubernetes/gatewayapi/gateway-infra.yaml`. Install that infrastructure
first when the cluster does not already have `gateway-infra/public-gateway`.

Create the UHub pull secret in the workload namespace without committing its
credentials:

```bash
kubectl create namespace astraflow-landing --dry-run=client -o yaml | kubectl apply -f -
kubectl create secret docker-registry uhub-secret \
  --namespace astraflow-landing \
  --docker-server=uhub.service.ucloud.cn \
  --docker-username='<username>' \
  --docker-password='<password>'
```

Deploy the application and its Gateway API route:

```bash
kubectl apply -f lib/kubernetes/landing-page.yaml
kubectl get deployment,service,httproute -n astraflow-landing
```

`HTTPRoute` serves `astraflow-desktop.modelverse.cn/download/` through the
`http` listener. Requests to `/download` are redirected to the canonical path
with a trailing slash. Envoy Gateway strips the `/download/` prefix before
forwarding requests to Nginx; the production Vite build prefixes scripts,
styles, images, and other public assets with `/download/`.
