# Local Agent process sandbox and bundled runtime

## Scope

AstraFlow local Default mode starts the entire built-in ACP + Pi Agent process
tree through `@anthropic-ai/sandbox-runtime@0.0.65`. The boundary therefore
covers Pi file tools, search, shell commands, subagents, and child processes,
not only individual `bash` calls.

The user-facing modes are:

- `Default`: process sandbox enabled, fail closed, no per-tool approval cards
  for work that remains inside the workspace policy.
- `Full Access`: explicit host execution without the local process sandbox.
  Desktop records a scoped grant and requires a one-time confirmation when the
  user selects it.

Legacy `ask`, `auto`, and `readonly` rows are normalized during database reads.
An old readonly session remains fail-closed until the user selects one of the
two current modes.

The design follows the public architecture of
[`anthropic-experimental/sandbox-runtime`](https://github.com/anthropic-experimental/sandbox-runtime)
and the process boundary used by Claude Code. The source snapshot under
`examples/claude-code` is used only as an architectural reference; no exposed
or non-open-source Claude Code implementation is copied.

## Command path

1. `resolveAstraflowAcpLocalCommand()` creates a parent-owned checkpoint
   broker and resolves the runtime state root, read-only attachment root,
   Desktop provider-proxy endpoint, and public permission mode before a process
   is created.
2. `AcpRuntime` passes one long-lived stdio launch request to
   `electron/sandbox-command-runner.mjs` over trusted Node IPC. ACP protocol
   bytes retain stdin/stdout; command text is never interpolated through a host
   shell by Desktop.
3. The runner initializes Sandbox Runtime once for the ACP process tree and
   spawns the wrapped argv with `shell: false`.
4. Desktop keeps the real provider credential in its own process and gives the
   child a 43-character, session-scoped proxy token. The child can reach only
   the exact loopback host and port of that proxy; neither the real key nor a
   provider-domain wildcard enters child env or argv.
5. ACP tools enforce the same canonical workspace/read-only-root policy inside
   the process. This is defense in depth; the OS sandbox remains the security
   boundary.
   Default is represented inside the ACP process as `workspace_auto`: it
   suppresses per-tool approval cards without disabling those path checks.
   Only the public Full Access mode maps to the internal `full_access` policy.
6. Checkpoint keys, migration metadata, and private state paths are never added
   to the local ACP child environment. Direct Full Access processes still use
   the Desktop provider proxy and inherit only a small explicit environment
   allowlist rather than Desktop's complete environment. Pi command tools
   remove the proxy token before starting bash.
7. Initialization, dependency, or policy failure is fatal. Default never falls
   back to an unsandboxed process. Cancellation terminates the complete child
   tree and resets Sandbox Runtime.

Each ACP process receives a session-specific private HOME, cache, temp, and
runtime directory. Concurrent sessions do not share mutable Sandbox Runtime
configuration.

Managed OpenCode uses a stricter credential handoff than a normal environment
variable. Its inline provider config references `/dev/fd/3`; Desktop writes the
session-scoped provider-proxy bearer to an anonymous descriptor after spawn.
On Linux, where Bubblewrap closes inherited descriptors, the trusted runner
creates a mode-`0600` FIFO under a random mode-`0700` directory inside the
session-private `TMPDIR`; the bootstrap shell opens it as fd 3 and unlinks it
before `exec` starts OpenCode. No transient credential node is created under
the user's `~/AstraFlow` workspace. The bearer is therefore absent from the
OpenCode environment, argv, config file, and shell children. The remote
Workspace Gateway uses the same consumed anonymous-descriptor contract after
replacing the real key with a per-run loopback-proxy token.
Managed local OpenCode fails closed on Windows until an equivalent anonymous
transport is available; remote Sandbox OpenCode remains supported.

Default uses only static network policy. Known provider and package endpoints
are admitted before launch; every unmatched destination is denied without a
runtime approval request. Full Access remains the sole explicit bypass.

Claude Code sets `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1`, so its scoped parent
credential is unavailable to Bash, hook, and stdio MCP subprocesses. The
Gateway also replaces the real ModelVerse key with per-run loopback-proxy
credentials before starting remote AstraFlow, Codex, Claude Code, or OpenCode.

CodeBox does not write ModelVerse or GitHub credentials to shell profiles,
agent config/auth files, `gh` config, or Git credential stores. Create, resume,
and credential-sync paths remove material written by older releases. A
connected GitHub token is used only as an in-memory `GIT_ASKPASS` value during
an initial `https://github.com/...` clone before code-server or the Agent
Gateway starts; it is not retained in the sandbox.

## Managed workspaces and private state

An unbound local Agent task uses a stable directory under:

```text
~/AstraFlow/<timestamp>-<short-id>/
```

That directory contains user task files only. Existing projects stay at their
selected paths. The following remain under Electron `userData`:

- `acp-state/`: encrypted Pi checkpoints;
- `acp-workspaces/` and `sandbox-workspaces/`: runtime support and isolated
  HOME/cache/tmp;
- `acp-attachments/`: session attachments exposed to Pi as a read-only root;
- `studio-files/`, `studio-skills/`, database files, and notification state.

Deleting a chat does not delete its managed task directory. Legacy safe
workspaces are adopted without silent file moves; unsafe broad roots and
symlink escapes are rejected.

## Default policy

- Read access: the selected workspace, packaged runtimes, active skill roots,
  and the current session's private attachment directory.
- Denied reads: the canonical user home is denied first, then only the selected
  workspace and exact trusted runtime/current-session roots are carved back.
  This also protects sibling managed workspaces, sibling attachment sessions,
  SSH/GPG/cloud credentials, browser credential stores, keychains, `.env*`,
  AstraFlow's complete `userData` tree, database sidecars, uploaded-file store,
  and installed skill store.
- Writes: only the selected project or managed `~/AstraFlow/<task>` directory,
  plus the session's disposable private runtime root. Durable checkpoint writes
  happen only in the Desktop parent.
- Protected writes: `.git/config`, `.git/hooks`, shell startup files,
  `.env*`, bundled runtimes, installed skills, and the session's copied skill
  scripts.
- Network: exact host-and-port entries for the Desktop provider proxy and
  managed package registries (`pypi.org:443`,
  `files.pythonhosted.org:443`, and `registry.npmjs.org:443` when the
  corresponding managed environment is writable). Unknown destinations are
  denied instead of prompting. Local binding, arbitrary Unix sockets, and
  macOS Apple Events remain disabled.
- Environment: secrets are removed before the runner starts. Agent commands
  receive a session HOME/TEMP/cache, the bundled Python runtime, and a `node`
  launcher backed by Electron's embedded Node runtime. Bundled document modules
  are exposed through a read-only `NODE_PATH`.

The user's home directory is never an implicit workspace. Project-folder
selection or creation of a managed task directory is the write grant for normal
local work. macOS TCC remains authoritative for protected user folders; an OS
denial is surfaced rather than bypassed.

### Residual boundaries and release gates

- Local Pi checkpoint persistence is Desktop-owned. The ACP child sends
  bounded, session-scoped load/save/list/delete requests over its existing ACP
  connection; `acp-state/<stateOwnerId>` and the AES-GCM key never enter child
  env, argv, HOME, or sandbox write roots. The parent validates the Desktop
  owner scope, record identity and quota before authenticated atomic storage.
  Remote AstraFlow Agent uses the same Desktop broker over its ACP WebSocket.
  Checkpoints are therefore encrypted and stored under Desktop `userData`; the
  remote VM receives neither a checkpoint directory nor an encryption key.
- Remote Default/legacy-readonly AstraFlow runs the whole Pi process tree
  through Gateway-owned Bubblewrap confinement. The selected `/workspace` is
  the only writable host path; Gateway code/state, `/root`, `/home`, `/run`,
  common container state, private TLS/SSH paths, host `/proc`, and host temp are
  not visible. The network namespace has no general egress; a per-run Unix
  bridge exposes only the Gateway loopback model proxy, where the real
  ModelVerse key remains.
  The Gateway advertises `agent.astraflow.workspace-confinement.v1` only when
  Bubblewrap and socat are available. Desktop requires that capability for
  Remote Default/legacy-readonly and fails closed for older templates. Remote
  Full Access does not require it and explicitly uses direct VM execution.
  This boundary isolates a process within the selected single-tenant VM; it is
  not a claim that remote code can access Desktop or a general content-DLP
  guarantee.
- npm/PyPI access is an exact port-443 endpoint allowlist enforced for the
  complete ACP process tree. It is not yet an install-only content broker, so
  the product must not describe Local Default as a general
  data-loss-prevention boundary.
- User-installed HTTP/SSE/stdio MCP connectors remain Desktop-owned. Their
  headers, credentials, commands, and environment are not serialized into an
  ACP child. An ACP runtime without `mcpCapabilities.acp` gets a structured
  unavailable diagnostic and no credential-bearing direct fallback.
- Windows Default intentionally fails closed until stable-CA credential masking
  ships. It never falls back to Full Access.

## Platform implementation

| Platform | Isolation | AstraFlow adaptation |
| --- | --- | --- |
| macOS x64/arm64 | Seatbelt via `sandbox-exec` | Apple Events, IPC, network, sensitive reads, and out-of-workspace writes are denied. No extra installation is required. |
| Linux x64/arm64 | Bubblewrap, network namespace, PID namespace, seccomp | `bubblewrap-bin` and `ripgrep-bin` are packaged in the Python runtime. A small in-tree relay implements only the two `socat` bridge forms Sandbox Runtime emits. System `bwrap` may still be required on distributions whose AppArmor policy rejects non-system bubblewrap paths. Failure is closed and explicit. |
| Windows x64/arm64 | Dedicated `srt-sandbox` user, WFP egress fence, per-session ACLs | The filesystem/network sandbox can be provisioned on both architectures, but local Default ACP startup remains fail-closed until Desktop ships a stable CA for provider credential masking. AstraFlow rejects startup before command serialization, so a real provider key is never copied into argv. Full Access remains an explicit user choice. |

The runtime metadata and sandbox policy cover Windows x64 and arm64. Release
availability for each architecture is controlled independently by the Electron
packaging matrix; neither architecture may silently downgrade Default to
unmasked or unsandboxed execution.

## Bundled Python

`scripts/prepare-bundled-python.mjs` downloads a target-specific, relocatable
CPython 3.12.13 archive from `astral-sh/python-build-standalone`, verifies its
SHA-256, and installs only the bootstrap tools from
`bootstrap-requirements.txt`. Generated bootstrap runtimes are ignored by Git
and are published as managed runtime artifacts rather than embedding the
document stack in the application bundle.

After launch, Electron creates a writable managed environment under
`userData`, installs the exact universal `requirements.lock`, and records its
active executable and writable package roots in the managed Python state.
That environment contains pandas, openpyxl, Pillow, MarkItDown's DOCX/PPTX
extras, defusedxml, lxml, python-pptx, python-docx, XlsxWriter, pypdf,
pdf2image, pdfplumber, pypdfium2, pytesseract, ReportLab, and their locked
transitive dependencies. The downloaded bootstrap remains read-only. Linux
bootstrap artifacts additionally carry bubblewrap and ripgrep.

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
On local macOS, the PPTX skill must not probe or invoke `soffice`, `pdftoppm`,
or `qlmanage`; it uses MarkItDown plus the bundled non-rendering
`structural_qa.py` check. Rendered slide QA is a remote-sandbox capability.

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
bun test tests/local-sandbox-policy.test.ts tests/acp-state-key.test.ts \
  tests/studio-default-workspace.test.ts
node --test tests/astraflow-acp-local-sandbox.node.test.mjs
node --test runtime/astraflow-acp/test/agent.test.mjs \
  runtime/astraflow-acp/test/session-store-security.test.mjs
ASTRAFLOW_RUN_SANDBOX_INTEGRATION=1 \
  bun test tests/local-sandbox-integration.test.ts
ASTRAFLOW_RUN_SANDBOX_INTEGRATION=1 \
  bun test tests/opencode-local-sandbox.test.ts
ASTRAFLOW_RUN_BUNDLED_SKILL_INTEGRATION=1 \
  bun test tests/bundled-document-skills.test.ts
bun run typecheck
bun run lint
git diff --check
```

The OS integration test verifies process-level workspace writes,
out-of-workspace and secret denial, read-only skill/attachment roots, strict
network behavior, blocked Unix sockets, and availability of the managed
Python/Node launchers. The separately gated bundled-skill integration verifies
the installed document package stack.
