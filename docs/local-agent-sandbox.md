# Local Agent sandbox and bundled runtime

## Scope

AstraFlow local mode executes every Deep Agents shell command through
`@anthropic-ai/sandbox-runtime@0.0.65`. Permission approval and OS isolation
remain separate controls: a user approval allows the requested tool call, but
never disables the sandbox policy.

The design follows the public architecture of
[`anthropic-experimental/sandbox-runtime`](https://github.com/anthropic-experimental/sandbox-runtime)
and the process boundary used by Claude Code. The source snapshot under
`examples/claude-code` is used only as an architectural reference; no exposed
or non-open-source Claude Code implementation is copied.

## Command path

1. `DeepAgentsLocalBackend.execute()` performs the normal AstraFlow permission
   check.
2. The command and a trusted policy are sent over stdin to
   `electron/sandbox-command-runner.mjs`. Command bytes never pass through the
   host shell.
3. The runner initializes Sandbox Runtime for that one command, calls
   `wrapWithSandboxArgv()`, and spawns the returned argv with `shell: false`.
4. Stdout and stderr stream back to Chat. Initialization or dependency failure
   exits with code 126; there is no unsandboxed fallback.
5. Cancellation and timeout use a dedicated parent/runner control channel so
   Windows ACLs can be restored before exit. A forced process-tree kill remains
   as a five-second fallback. The runner resets Sandbox Runtime on every exit.

Using a separate runner per command also isolates Sandbox Runtime's global
configuration between concurrent AstraFlow sessions. On Windows it prevents
one session's ACL grants from becoming another session's policy.

## Default policy

- Read access: ordinary local files are readable, including files selected by
  the user. Uploaded session files are copied out of AstraFlow's private data
  store into the session workspace first.
- Denied reads: SSH/GPG/cloud credentials, browser credential stores,
  keychains, `.env*`, AstraFlow's database, uploaded-file store, and installed
  skill store.
- Writes: only the selected project and
  `sandbox-workspaces/<session-id>`.
- Protected writes: `.git/config`, `.git/hooks`, shell startup files,
  `.env*`, bundled runtimes, installed skills, and the session's copied skill
  scripts.
- Network: deny all domains. Local binding, arbitrary Unix sockets, and macOS
  Apple Events are disabled.
- Environment: secrets are removed before the runner starts. Agent commands
  receive a session HOME/TEMP/cache, the bundled Python runtime, and a `node`
  launcher backed by Electron's embedded Node runtime. Bundled document modules
  are exposed through a read-only `NODE_PATH`.

When no project is selected, local mode uses a per-session workspace instead
of the user's home directory. Project-folder selection is the write grant for
normal local work. macOS TCC remains authoritative for protected user folders;
an OS denial is surfaced as an error rather than bypassed.

## Platform implementation

| Platform | Isolation | AstraFlow adaptation |
| --- | --- | --- |
| macOS x64/arm64 | Seatbelt via `sandbox-exec` | Apple Events, IPC, network, sensitive reads, and out-of-workspace writes are denied. No extra installation is required. |
| Linux x64/arm64 | Bubblewrap, network namespace, PID namespace, seccomp | `bubblewrap-bin` and `ripgrep-bin` are packaged in the Python runtime. A small in-tree relay implements only the two `socat` bridge forms Sandbox Runtime emits. System `bwrap` may still be required on distributions whose AppArmor policy rejects non-system bubblewrap paths. Failure is closed and explicit. |
| Windows x64 | Dedicated `srt-sandbox` user, WFP egress fence, per-session ACLs | `srt-win.exe` ships inside Sandbox Runtime. Settings → Profile exposes a one-time UAC setup action. Commands remain blocked until provisioning and WFP verification succeed. |

Windows arm64 metadata is present for the Python runtime, but the current
Electron release matrix packages Windows x64 only.

## Bundled Python

`scripts/prepare-bundled-python.mjs` downloads a target-specific, relocatable
CPython 3.12.13 archive from `astral-sh/python-build-standalone`, checks its
SHA-256, installs the exact universal lock, runs `pip check`, and imports the
document stack. Generated platform runtimes are ignored by Git and copied into
the Electron application during packaging.

The package set includes pandas, openpyxl, Pillow, MarkItDown's PPTX extra,
defusedxml, lxml, python-pptx, python-docx, XlsxWriter, pypdf, pdf2image,
pdfplumber, pypdfium2, pytesseract, ReportLab, and their locked transitive
dependencies. Linux additionally carries bubblewrap and ripgrep.

The packaged Node document stack includes PptxGenJS, docx, react-icons, sharp,
pdf-lib, pdfjs-dist, and the native canvas bridge used by PDF.js. A
target-specific launcher runs these modules with the Node runtime embedded in
Electron, so users do not need a separately installed Node.js.

LibreOffice and Poppler are intentionally not downloaded or packaged. XLSX
formulas are preserved and marked for recalculation on the next Excel open;
PPTX validation is structural rather than pixel-rendered. The Python wrappers
for `pdf2image` and `pytesseract` are present because the supplied skills import
them, but conversion/OCR paths that need Poppler or the Tesseract executable
remain unavailable until those native tools are bundled later. Pandoc is not
bundled either; MarkItDown covers the supported DOCX/PPTX text-extraction path.

## Bundled skills

`bundled-skills/manifest.json` pins every file by SHA-256. On first use, the
PPTX, XLSX, DOCX, and PDF skills are verified, copied into AstraFlow's managed
skill store, registered as enabled, and shown with a Bundled badge. Users can
disable them but cannot replace or remove them. Executable files are copied
again into the session workspace, where the command sandbox mounts the skill
directory read-only. Their source is supplied directly by the AstraFlow project
owner; the build does not download skill code from a third-party repository.
The four source directories are treated as immutable inputs: manifest
generation only reads them, and all platform adaptation lives outside them.

## Verification

```bash
bun run runtime:prepare
bun test tests/local-sandbox-policy.test.ts tests/bundled-skills.test.ts
ASTRAFLOW_RUN_SANDBOX_INTEGRATION=1 \
  bun test tests/local-sandbox-integration.test.ts
ASTRAFLOW_RUN_BUNDLED_SKILL_INTEGRATION=1 \
  bun test tests/bundled-document-skills.test.ts
bun run typecheck
bun run lint
git diff --check
```

The OS integration test verifies project writes, out-of-project denial,
`.env` denial, read-only skill scripts, no direct network, blocked Unix sockets,
and imports from the bundled Python runtime.
