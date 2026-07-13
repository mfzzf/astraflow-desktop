from pathlib import Path

from ucloud_sandbox import Template


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WORKSPACE_GATEWAY_SOURCE = Path("runtime") / "workspace-gateway"
WORKSPACE_GATEWAY_TARGET = "/opt/astraflow/workspace-gateway"
NODE_VERSION = "22.23.1"
BUILD_NODE_ROOT = "/root/.nvm/versions/node/v20.9.0"
BUILD_NPM_COMMAND = (
    f"{BUILD_NODE_ROOT}/bin/node "
    f"{BUILD_NODE_ROOT}/lib/node_modules/npm/bin/npm-cli.js"
)
AGENT_CLI_PACKAGES = [
    "@anthropic-ai/claude-code@2.1.205",
    "@openai/codex@0.144.1",
    "opencode-ai@1.17.18",
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
        "build-essential ca-certificates curl docker.io git gnupg jq "
        "openssh-server python3 tmux xz-utils && "
        "rm -rf /var/lib/apt/lists/*"
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
        "/usr/local/bin/node --version && "
        "env PATH=/usr/local/bin:$PATH /usr/local/bin/npm --version && "
        "printf '%s\\n' 'export PATH=/usr/local/bin:$PATH' "
        "> /etc/profile.d/astraflow-node.sh && "
        "chmod 644 /etc/profile.d/astraflow-node.sh"
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
        f"{BUILD_NPM_COMMAND} ci --omit=dev --no-audit --no-fund && "
        "/usr/local/bin/node -e \"require('node-pty')\" && "
        f"{BUILD_NPM_COMMAND} cache clean --force"
    )
    .run_cmd(
        f"{BUILD_NPM_COMMAND} install -g --prefix {BUILD_NODE_ROOT} "
        f"{' '.join(AGENT_CLI_PACKAGES)} && "
        f"ln -sf {BUILD_NODE_ROOT}/bin/claude /usr/local/bin/claude && "
        f"ln -sf {BUILD_NODE_ROOT}/bin/codex /usr/local/bin/codex && "
        f"ln -sf {BUILD_NODE_ROOT}/bin/opencode /usr/local/bin/opencode"
    )
    .run_cmd("command -v code-server && code-server --version")
    .run_cmd(
        f"test -f {WORKSPACE_GATEWAY_TARGET}/src/server.mjs && "
        f"test -d {WORKSPACE_GATEWAY_TARGET}/node_modules/ws && "
        f"test -d {WORKSPACE_GATEWAY_TARGET}/node_modules/node-pty"
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
        "claude --version && codex --version && opencode --version"
    )
)
