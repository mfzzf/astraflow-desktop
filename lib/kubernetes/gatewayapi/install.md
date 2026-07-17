## CRD
kubectl apply --server-side -f https://github.com/kubernetes-sigs/gateway-api/releases/download/v1.6.0/standard-install.yaml
## Envoy Gateway
helm install eg \
  oci://docker.io/envoyproxy/gateway-helm \
  --version v1.8.2 \
  -n envoy-gateway-system \
  --create-namespace

## skopeo install 
sudo pacman -S skopeo

## skopeo sync images 

skopeo login uhub.service.ucloud.cn

skopeo copy --all \
    docker://docker.io/envoyproxy/gateway:v1.8.2 \
    docker://uhub.service.ucloud.cn/astraflow-desktop/envoy-gateway:v1.8.2

skopeo copy --all \
    docker://docker.io/envoyproxy/envoy:distroless-v1.38.0 \
    docker://uhub.service.ucloud.cn/astraflow-desktop/envoy:distroless-v1.38.0

skopeo copy --all \
    docker://docker.io/envoyproxy/ratelimit:fe26676d \
    docker://uhub.service.ucloud.cn/astraflow-desktop/ratelimit:fe26676d

helm upgrade eg \
    oci://docker.io/envoyproxy/gateway-helm \
    --version v1.8.2 \
    -n envoy-gateway-system \
    -f values-uhub.yaml \
    --set deployment.replicas=3 \
    --timeout 5m

