GOHOSTOS:=$(shell go env GOHOSTOS)
GOPATH:=$(shell go env GOPATH)
VERSION=$(shell git describe --tags --always)
DOCKER ?= docker
IMAGE_REPOSITORY ?= uhub.service.ucloud.cn/uminfer-proxy/astraflow-api
IMAGE_TAG ?= latest
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
	mkdir -p bin/ && go build -ldflags "-X main.Version=$(VERSION)" -o ./bin/ ./...

.PHONY: docker-build
# build docker image
docker-build:
	$(DOCKER) build $(DOCKER_PLATFORM) $(BUILD_ARGS) -t $(IMAGE_REPOSITORY):$(IMAGE_TAG) .

.PHONY: docker-push
# push docker image
docker-push:
	$(DOCKER) push $(IMAGE_REPOSITORY):$(IMAGE_TAG)

.PHONY: docker-push-latest
# build and push latest docker image
docker-push-latest:
	$(MAKE) docker-build IMAGE_TAG=latest
	$(MAKE) docker-push IMAGE_TAG=latest

.PHONY: build-push
# build and push docker image
build-push: docker-build docker-push

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
