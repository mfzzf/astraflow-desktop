GOHOSTOS:=$(shell go env GOHOSTOS)
GOPATH:=$(shell go env GOPATH)
VERSION=$(shell git describe --tags --always)
DOCKER ?= docker
HELM ?= helm
KUBECTL ?= kubectl
IMAGE_REPOSITORY ?= uhub.service.ucloud.cn/uminfer-proxy/astraflow-api
IMAGE_TAG ?= latest
MODELS_IMAGE_REPOSITORY ?= uhub.service.ucloud.cn/uminfer-proxy/astraflow-models
MODELS_IMAGE_TAG ?= qwen3-asr-1.7b-qwen3-8b-awq-audio-v1
HELM_RELEASE ?= astraflow-api
KUBE_NAMESPACE ?= astraflow
US3_SECRET_NAME ?= astraflow-models-us3-secret
US3_ENDPOINT ?= http://internal.s3-cn-wlcb.ufileos.com
PLATFORM ?=
BUILD_ARGS ?=

ifneq ($(strip $(PLATFORM)),)
DOCKER_PLATFORM := --platform $(PLATFORM)
endif

.PHONY: init
# init env
init:
	go install github.com/google/wire/cmd/wire@latest
	go install github.com/bufbuild/buf/cmd/buf@latest

.PHONY: config
# generate internal proto
config:
	buf generate --template buf.gen.config.yaml

.PHONY: api
# generate api proto
api:
	buf generate --template buf.gen.yaml

.PHONY: build
# build
build:
	mkdir -p bin/
	go build -ldflags "-X main.Version=$(VERSION)" -o ./bin/astraflow-api ./cmd/astraflow-api
	go build -o ./bin/inference-gateway ./cmd/inference-gateway

.PHONY: docker-build
# build docker image
docker-build:
	$(DOCKER) build $(DOCKER_PLATFORM) $(BUILD_ARGS) -t $(IMAGE_REPOSITORY):$(IMAGE_TAG) .

.PHONY: docker-push
# push docker image
docker-push:
	$(DOCKER) push $(IMAGE_REPOSITORY):$(IMAGE_TAG)

.PHONY: docker-build-models
# build ASR and title inference image
docker-build-models:
	$(DOCKER) build $(DOCKER_PLATFORM) $(BUILD_ARGS) -f deploy/gpu-inference/Dockerfile.models -t $(MODELS_IMAGE_REPOSITORY):$(MODELS_IMAGE_TAG) .

.PHONY: docker-push-models
# push ASR and title inference image
docker-push-models:
	$(DOCKER) push $(MODELS_IMAGE_REPOSITORY):$(MODELS_IMAGE_TAG)

.PHONY: docker-push-latest
# build and push latest docker image
docker-push-latest:
	$(MAKE) docker-build IMAGE_TAG=latest
	$(MAKE) docker-push IMAGE_TAG=latest

.PHONY: build-push
# build and push API/gRPC gateway and inference images
build-push: docker-build docker-build-models docker-push docker-push-models

.PHONY: helm-deploy-gpu
# create US3 Secret from environment and deploy API plus GPU inference with Helm
helm-deploy-gpu:
	@test -n "$$US3_TOKEN_PUBLIC_KEY" || (echo "US3_TOKEN_PUBLIC_KEY is required" >&2; exit 1)
	@test -n "$$US3_TOKEN_PRIVATE_KEY" || (echo "US3_TOKEN_PRIVATE_KEY is required" >&2; exit 1)
	@$(KUBECTL) -n kube-system create secret generic $(US3_SECRET_NAME) \
		--from-literal=accessKeyID="$$US3_TOKEN_PUBLIC_KEY" \
		--from-literal=secretAccessKey="$$US3_TOKEN_PRIVATE_KEY" \
		--from-literal=endpoint="$(US3_ENDPOINT)" \
		--dry-run=client -o yaml | $(KUBECTL) apply -f -
	$(HELM) upgrade --install $(HELM_RELEASE) ./helm/astraflow-api \
		--namespace $(KUBE_NAMESPACE) \
		--reset-then-reuse-values \
		--take-ownership \
		-f ./helm/astraflow-api/values.uk8s-4090-us3.yaml

.PHONY: generate
# generate
generate:
	go generate ./...
	go mod tidy

.PHONY: all
# generate all
all:
	make api
	make config
	make generate

# show help
help:
	@echo ''
	@echo 'Usage:'
	@echo ' make [target]'
	@echo ''
	@echo 'Targets:'
	@awk '/^[a-zA-Z0-9_-]+:/ { \
	helpMessage = match(lastLine, /^# (.*)/); \
		if (helpMessage) { \
			helpCommand = substr($$1, 0, index($$1, ":")); \
			helpMessage = substr(lastLine, RSTART + 2, RLENGTH); \
			printf "\033[36m%-22s\033[0m %s\n", helpCommand,helpMessage; \
		} \
	} \
	{ lastLine = $$0 }' $(MAKEFILE_LIST)

.DEFAULT_GOAL := help
