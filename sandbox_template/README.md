# AstraFlow Desktop Sandbox Template

Builds the `astraflow-desktop` sandbox template from `code-interpreter-v1`
with `tmux` installed.

The default template resources are explicit:

- 2 vCPU
- 4096 MiB RAM

## Python SDK

Recommended for UCloud Sandbox.

```bash
cd sandbox_template/python
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
UCLOUD_SANDBOX_API_KEY=... \
UCLOUD_SANDBOX_DOMAIN=cn-wlcb.sandbox.ucloudai.com \
UCLOUD_SANDBOX_TEMPLATE_CPU_COUNT=2 \
UCLOUD_SANDBOX_TEMPLATE_MEMORY_MB=4096 \
.venv/bin/python build_template.py
```

## JS SDK

Kept as a fallback implementation under `sandbox_template/js`.

```bash
cd sandbox_template/js
bun install
E2B_API_KEY=... \
E2B_DOMAIN=cn-wlcb.sandbox.ucloudai.com \
E2B_VALIDATE_API_KEY=false \
E2B_TEMPLATE_CPU_COUNT=2 \
E2B_TEMPLATE_MEMORY_MB=4096 \
bun run build
```

Do not include the wildcard prefix in the domain; use
`cn-wlcb.sandbox.ucloudai.com`, not `*.cn-wlcb.sandbox.ucloudai.com`.
