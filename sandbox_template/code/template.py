import json
from pathlib import Path

from ucloud_sandbox import Template


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_GATEWAY_SOURCE = Path("runtime") / "workspace-gateway"
WORKSPACE_GATEWAY_TARGET = "/opt/astraflow/workspace-gateway"
ASTRAFLOW_ACP_SOURCE = Path("runtime") / "astraflow-acp"
ASTRAFLOW_ACP_TARGET = "/opt/astraflow/astraflow-acp"
NODE_DOCUMENT_RUNTIME_SOURCE = Path("runtime") / "node-document-runtime"
NODE_DOCUMENT_RUNTIME_ROOT = "/opt/astraflow/node-document-runtime"
PYTHON_REQUIREMENTS_SOURCE = Path("runtime") / "python" / "requirements.lock"
PYTHON_RUNTIME_MANIFEST_SOURCE = (
    Path("runtime") / "python" / "runtime-manifest.json"
)
PYTHON_RUNTIME_MANIFEST = json.loads(
    (REPOSITORY_ROOT / PYTHON_RUNTIME_MANIFEST_SOURCE).read_text(encoding="utf-8")
)
PYTHON_RUNTIME_TARGET = "linux-x64"
PYTHON_RUNTIME_TARGET_CONFIG = PYTHON_RUNTIME_MANIFEST["targets"][
    PYTHON_RUNTIME_TARGET
]
PYTHON_BOOTSTRAP_ROOT = "/opt/astraflow/python-bootstrap"
PYTHON_ENVIRONMENT_ROOT = "/opt/astraflow/python"
NODE_VERSION = "26.5.0"
NODE_ROOT = "/usr/local"
NPM_VERSION = "11.13.0"
NPM_ARCHIVE_SHA256 = (
    "a4ffa1de3bf1c7f9d5e3dd24fe2921970bdb1589d647f4083eaaaab3be974b7e"
)
NPM_CACHE_ROOT = "/tmp/astraflow-npm-cache"
AGENT_CLI_ROOT = "/opt/astraflow/agent-cli"
BUILD_NPM_COMMAND = (
    f"env PATH={NODE_ROOT}/bin:/usr/bin:/bin "
    f"npm_config_cache={NPM_CACHE_ROOT} "
    f"{NODE_ROOT}/bin/node "
    f"{NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js"
)
AGENT_CLI_PACKAGES = [
    "@anthropic-ai/claude-code@2.1.209",
    "@openai/codex@0.144.4",
    "opencode-ai@1.17.20",
]

CODE_SERVER_EXTENSIONS = [
    "Anthropic.claude-code",
    "openai.chatgpt",
    "sst-dev.opencode",
    "ms-python.python",
    "ms-python.debugpy",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "GitHub.vscode-pull-request-github",
]


def install_extensions_command() -> str:
    return " && ".join(
        f"code-server --install-extension {extension} --force"
        for extension in CODE_SERVER_EXTENSIONS
    )


def install_starship_command() -> str:
    starship_init = (
        "if command -v starship >/dev/null 2>&1; then\\n"
        '  eval "$(starship init bash)"\\n'
        "fi\\n"
    )

    return (
        "curl -fsSL https://starship.rs/install.sh | sh -s -- -y && "
        "starship --version && "
        f"printf '%b' '{starship_init}' > /etc/profile.d/starship.sh && "
        "chmod 644 /etc/profile.d/starship.sh && "
        "(grep -q 'starship init bash' /etc/bash.bashrc || "
        f"printf '\\n# Starship prompt\\n%b' '{starship_init}' >> /etc/bash.bashrc"
        ")"
    )


template = (
    # Keep COPY sources relative to the repository build context. Passing
    # absolute paths makes the SDK archive them as ../../runtime/... entries,
    # which the remote builder correctly refuses to extract.
    Template(file_context_path=REPOSITORY_ROOT)
    .from_image("uhub.service.ucloud.cn/clientfzzf/sandbox-vscode:v0.5")
    .set_user("root")
    .run_cmd(
        "apt-get update && "
        "apt-get install -y --no-install-recommends "
        "build-essential ca-certificates curl docker.io fonts-noto-cjk git "
        "gnupg jq libreoffice-impress openssh-server poppler-utils tmux "
        "tesseract-ocr xz-utils && "
        "rm -rf /var/lib/apt/lists/*"
    )
    .run_cmd("mkdir -p /opt/astraflow")
    .copy(
        PYTHON_REQUIREMENTS_SOURCE,
        "/opt/astraflow/python-requirements.lock",
        user="root:root",
        mode=0o644,
    )
    .run_cmd(
        f"mkdir -p {PYTHON_BOOTSTRAP_ROOT} && "
        f"curl -fsSL -o /tmp/astraflow-python.tar.gz "
        f"{PYTHON_RUNTIME_MANIFEST['assetUrlPrefix']}/"
        f"{PYTHON_RUNTIME_TARGET_CONFIG['archive']} && "
        f"echo '{PYTHON_RUNTIME_TARGET_CONFIG['sha256']}  "
        "/tmp/astraflow-python.tar.gz' | sha256sum -c - && "
        f"tar -xzf /tmp/astraflow-python.tar.gz "
        f"-C {PYTHON_BOOTSTRAP_ROOT} --strip-components=1 && "
        "rm -f /tmp/astraflow-python.tar.gz && "
        f"PYTHONHOME={PYTHON_BOOTSTRAP_ROOT} "
        f"{PYTHON_BOOTSTRAP_ROOT}/bin/python3 -m venv --copies "
        f"{PYTHON_ENVIRONMENT_ROOT} && "
        f"{PYTHON_ENVIRONMENT_ROOT}/bin/python -m pip install "
        "--disable-pip-version-check --no-cache-dir --only-binary=:all: "
        "--requirement /opt/astraflow/python-requirements.lock && "
        f"{PYTHON_ENVIRONMENT_ROOT}/bin/python -m pip check && "
        "rm -f /usr/local/bin/python /usr/local/bin/python3 /usr/local/bin/pip && "
        f"printf '#!/bin/sh\\nexec {PYTHON_ENVIRONMENT_ROOT}/bin/python \"$@\"\\n' "
        "> /usr/local/bin/python && "
        f"printf '#!/bin/sh\\nexec {PYTHON_ENVIRONMENT_ROOT}/bin/python3 \"$@\"\\n' "
        "> /usr/local/bin/python3 && "
        f"printf '#!/bin/sh\\nexec {PYTHON_ENVIRONMENT_ROOT}/bin/python -m pip \"$@\"\\n' "
        "> /usr/local/bin/pip && "
        "chmod 755 /usr/local/bin/python /usr/local/bin/python3 /usr/local/bin/pip && "
        "python -c \"import defusedxml, distutils.version, docx, lxml, markitdown, openpyxl, "
        "pandas, pdf2image, pdfplumber, PIL, pptx, pypdf, pypdfium2, "
        "pytesseract, reportlab, sys, xlsxwriter; "
        f"assert sys.version.split()[0] == '{PYTHON_RUNTIME_MANIFEST['pythonVersion']}'; "
        "print('python-document-runtime-ok')\""
    )
    .run_cmd(
        "curl -fsSL -o /usr/local/bin/websocat "
        "https://github.com/vi/websocat/releases/latest/download/websocat.x86_64-unknown-linux-musl && "
        "chmod a+x /usr/local/bin/websocat && "
        "websocat --version"
    )
    .run_cmd(
        "mkdir -p -m 755 /etc/apt/keyrings && "
        "curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg "
        "-o /etc/apt/keyrings/githubcli-archive-keyring.gpg && "
        "chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg && "
        "echo \"deb [arch=$(dpkg --print-architecture) "
        "signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] "
        "https://cli.github.com/packages stable main\" "
        "> /etc/apt/sources.list.d/github-cli.list && "
        "apt-get update && "
        "apt-get install -y --no-install-recommends gh && "
        "rm -rf /var/lib/apt/lists/*"
    )
    .run_cmd(
        "node_arch=$(dpkg --print-architecture) && "
        'case "$node_arch" in amd64) node_arch=x64 ;; arm64) node_arch=arm64 ;; '
        '*) echo "Unsupported Node.js architecture: $node_arch" >&2; exit 1 ;; esac && '
        f"node_archive=node-v{NODE_VERSION}-linux-$node_arch.tar.xz && "
        f"node_dist=https://nodejs.org/dist/v{NODE_VERSION} && "
        'curl -fsSLO "$node_dist/$node_archive" && '
        'curl -fsSLO "$node_dist/SHASUMS256.txt" && '
        'grep "  $node_archive$" SHASUMS256.txt | sha256sum -c - && '
        'tar -xJf "$node_archive" -C /usr/local --strip-components=1 && '
        'rm -f "$node_archive" SHASUMS256.txt && '
        f'test "$(/usr/local/bin/node -p process.versions.node)" = "{NODE_VERSION}" && '
        f"curl -fsSL -o /tmp/npm.tgz "
        f"https://registry.npmjs.org/npm/-/npm-{NPM_VERSION}.tgz && "
        f"echo '{NPM_ARCHIVE_SHA256}  /tmp/npm.tgz' | sha256sum -c - && "
        f"rm -rf {NODE_ROOT}/lib/node_modules/npm && "
        f"mkdir -p {NODE_ROOT}/lib/node_modules/npm && "
        f"tar -xzf /tmp/npm.tgz -C {NODE_ROOT}/lib/node_modules/npm "
        "--strip-components=1 && "
        "rm -f /tmp/npm.tgz && "
        "/usr/local/bin/node --version && "
        f'test "$(env PATH=/usr/local/bin:$PATH /usr/local/bin/npm --version)" '
        f'= "{NPM_VERSION}" && '
        "printf '%s\\n' 'export PATH=/usr/local/bin:$PATH' "
        "> /etc/profile.d/astraflow-node.sh && "
        "chmod 644 /etc/profile.d/astraflow-node.sh"
    )
    .run_cmd(f"rm -rf {NODE_DOCUMENT_RUNTIME_ROOT} && mkdir -p {NODE_DOCUMENT_RUNTIME_ROOT}")
    .copy(
        [
            NODE_DOCUMENT_RUNTIME_SOURCE / "package.json",
            NODE_DOCUMENT_RUNTIME_SOURCE / "package-lock.json",
        ],
        f"{NODE_DOCUMENT_RUNTIME_ROOT}/",
        user="root:root",
        mode=0o644,
    )
    .run_cmd(
        f"cd {NODE_DOCUMENT_RUNTIME_ROOT} && "
        f"rm -rf node_modules /root/.npm {NPM_CACHE_ROOT} && "
        f"if ! {BUILD_NPM_COMMAND} ci --omit=dev --no-audit --no-fund; "
        f"then cat {NPM_CACHE_ROOT}/_logs/*-debug-0.log; "
        "exit 1; fi && "
        f"ln -sfn {NODE_DOCUMENT_RUNTIME_ROOT}/node_modules /node_modules && "
        "cd / && /usr/local/bin/node -e \""
        "require('pptxgenjs'); require('react-icons/fa'); require('react'); "
        "require('react-dom/server'); require('sharp'); "
        "console.log('node-document-runtime-ok')\""
    )
    .run_cmd(f"mkdir -p {WORKSPACE_GATEWAY_TARGET}/src")
    .copy(
        [
            WORKSPACE_GATEWAY_SOURCE / "package.json",
            WORKSPACE_GATEWAY_SOURCE / "package-lock.json",
        ],
        f"{WORKSPACE_GATEWAY_TARGET}/",
        user="root:root",
        mode=0o644,
    )
    .copy(
        WORKSPACE_GATEWAY_SOURCE / "src",
        f"{WORKSPACE_GATEWAY_TARGET}/src/",
        user="root:root",
        mode=0o755,
    )
    .run_cmd(
        f"cd {WORKSPACE_GATEWAY_TARGET} && "
        "rm -rf node_modules /root/.npm/_logs && "
        f"env npm_config_target={NODE_VERSION} npm_config_runtime=node "
        f"npm_config_nodedir=/usr/local {BUILD_NPM_COMMAND} "
        "ci --omit=dev --no-audit --no-fund && "
        "/usr/local/bin/node -e \"require('node-pty')\" && "
        f"{BUILD_NPM_COMMAND} cache clean --force"
    )
    .run_cmd(f"mkdir -p {ASTRAFLOW_ACP_TARGET}/src")
    .copy(
        [
            ASTRAFLOW_ACP_SOURCE / "package.json",
            ASTRAFLOW_ACP_SOURCE / "package-lock.json",
        ],
        f"{ASTRAFLOW_ACP_TARGET}/",
        user="root:root",
        mode=0o644,
    )
    .copy(
        ASTRAFLOW_ACP_SOURCE / "src",
        f"{ASTRAFLOW_ACP_TARGET}/src/",
        user="root:root",
        mode=0o755,
    )
    .run_cmd(
        f"cd {ASTRAFLOW_ACP_TARGET} && "
        "rm -rf node_modules /root/.npm/_logs && "
        f"{BUILD_NPM_COMMAND} ci --omit=dev --no-audit --no-fund && "
        "/usr/local/bin/node -e \""
        "Promise.all([import('@agentclientprotocol/sdk'), "
        "import('deepagents'), import('@langchain/openai'), "
        "import('@langchain/anthropic')]).then(() => "
        "console.log('astraflow-acp-runtime-ok'))\" && "
        f"{BUILD_NPM_COMMAND} cache clean --force"
    )
    .run_cmd(
        f"{BUILD_NPM_COMMAND} install -g --prefix {AGENT_CLI_ROOT} "
        f"{' '.join(AGENT_CLI_PACKAGES)} && "
        f"ln -sf {AGENT_CLI_ROOT}/bin/claude /usr/local/bin/claude && "
        f"ln -sf {AGENT_CLI_ROOT}/bin/codex /usr/local/bin/codex && "
        f"ln -sf {AGENT_CLI_ROOT}/bin/opencode /usr/local/bin/opencode"
    )
    .run_cmd("command -v code-server && code-server --version")
    .run_cmd(
        "python --version && pip --version && "
        "libreoffice --headless --version && pdftoppm -v && "
        "tesseract --version"
    )
    .run_cmd(
        f"test -f {WORKSPACE_GATEWAY_TARGET}/src/server.mjs && "
        f"test -d {WORKSPACE_GATEWAY_TARGET}/node_modules/ws && "
        f"test -d {WORKSPACE_GATEWAY_TARGET}/node_modules/node-pty && "
        f"test -x {WORKSPACE_GATEWAY_TARGET}/node_modules/.bin/claude-agent-acp && "
        f"test -x {WORKSPACE_GATEWAY_TARGET}/node_modules/.bin/codex-acp && "
        f"test -f {ASTRAFLOW_ACP_TARGET}/src/index.mjs && "
        f"test -d {ASTRAFLOW_ACP_TARGET}/node_modules/deepagents"
    )
    .run_cmd("mkdir -p /workspace && chmod 700 /workspace")
    .run_cmd(install_extensions_command())
    .run_cmd(
        "rm -rf "
        "/root/.claude/history.jsonl "
        "/root/.codex/history.jsonl "
        "/root/.codex/sessions"
    )
    .run_cmd(install_starship_command())
    .run_cmd(
        "export PATH=/usr/local/bin:/usr/bin:/bin && "
        f'test "$(node -p process.versions.node)" = "{NODE_VERSION}" && '
        "claude --version && codex --version && opencode --version && "
        f"{WORKSPACE_GATEWAY_TARGET}/node_modules/.bin/claude-agent-acp --version && "
        f"{WORKSPACE_GATEWAY_TARGET}/node_modules/.bin/codex-acp --version && "
        f"cd {ASTRAFLOW_ACP_TARGET} && "
        "/usr/local/bin/node -e \""
        "import('./src/constants.mjs').then(({ ASTRAFLOW_ACP_RUNTIME_VERSION }) => "
        "{ if (ASTRAFLOW_ACP_RUNTIME_VERSION !== '0.1.0') process.exit(1); "
        "console.log('astraflow-acp', ASTRAFLOW_ACP_RUNTIME_VERSION) })\""
    )
)
