# AstraFlow Desktop Sandbox Template

Builds the `astraflow-desktop` sandbox template with the workspace gateway,
Agent CLIs, and the document-production environment used by bundled skills.

The Code sandbox template preinstalls:

- The same pinned Python from `runtime/python/runtime-manifest.json`, plus a
  shared virtual environment at `/opt/astraflow/python` from
  `runtime/python/requirements.lock`.
- `python`, `python3`, and `pip` launchers in `/usr/local/bin` so Agent commands
  use that shared environment.
- LibreOffice Impress, Poppler, Tesseract OCR, and Noto CJK fonts for render
  and visual QA.
- `pptxgenjs`, `react-icons`, `react`, `react-dom`, and `sharp` under the
  root-visible `/node_modules` path.
- The pinned `astraflow-acp` Pi Agent runtime so AstraFlow Agent's model,
  planner, subagents, filesystem, and terminal execute in the Sandbox rather
  than the Desktop process.

The default Code template resources are explicit:

- 8 vCPU
- 8192 MiB RAM

## Python SDK

Recommended for UCloud Sandbox.

```bash
cd sandbox_template/python
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
UCLOUD_SANDBOX_API_KEY=... \
UCLOUD_SANDBOX_DOMAIN=cn-wlcb.sandbox.ucloudai.com \
UCLOUD_SANDBOX_TEMPLATE_NAME=astraflow-desktop-custom \
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
