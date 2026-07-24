export const WINDOWS_SANDBOX_PROFILE_ID_PATTERN = /^[0-9a-f]{32}$/

const WINDOWS_SANDBOX_PROFILE_BOOTSTRAP_SOURCE = String.raw`
const { spawnSync } = require("node:child_process")
const { mkdirSync } = require("node:fs")
const path = require("node:path")

const request = JSON.parse(
  Buffer.from(process.argv[2], "base64url").toString("utf8")
)
if (
  !request ||
  typeof request.command !== "string" ||
  !request.command.trim() ||
  !/^[0-9a-f]{32}$/.test(request.profileId)
) {
  throw new Error("Windows sandbox profile payload is invalid.")
}

const originalProfile = process.env.USERPROFILE
if (
  typeof originalProfile !== "string" ||
  !path.win32.isAbsolute(originalProfile) ||
  !/^[A-Za-z]:[\\/]/.test(originalProfile)
) {
  throw new Error("The dedicated Windows sandbox profile is unavailable.")
}

const root = path.win32.join(
  originalProfile,
  ".astraflow",
  "sandbox-profiles",
  request.profileId
)
const directories = [
  path.win32.join(root, ".claude"),
  path.win32.join(root, ".codex"),
  path.win32.join(root, ".config", "opencode"),
  path.win32.join(root, "AppData", "Local"),
  path.win32.join(root, "AppData", "Roaming"),
  path.win32.join(root, "cache", "python"),
  path.win32.join(root, "data"),
  path.win32.join(root, "state"),
  path.win32.join(root, "tmp"),
]
for (const directory of directories) {
  mkdirSync(directory, { recursive: true })
}

const parsedRoot = path.win32.parse(root)
const env = {
  ...process.env,
  ANTHROPIC_CONFIG_DIR: path.win32.join(root, ".claude"),
  APPDATA: path.win32.join(root, "AppData", "Roaming"),
  CLAUDE_CONFIG_DIR: path.win32.join(root, ".claude"),
  CODEX_HOME: path.win32.join(root, ".codex"),
  HOME: root,
  HOMEDRIVE: parsedRoot.root.slice(0, 2),
  HOMEPATH: root.slice(parsedRoot.root.length - 1),
  LOCALAPPDATA: path.win32.join(root, "AppData", "Local"),
  NPM_CONFIG_USERCONFIG: path.win32.join(root, ".npmrc"),
  OPENCODE_CONFIG_DIR: path.win32.join(root, ".config", "opencode"),
  PYTHONPYCACHEPREFIX: path.win32.join(root, "cache", "python"),
  TEMP: path.win32.join(root, "tmp"),
  TMP: path.win32.join(root, "tmp"),
  USERPROFILE: root,
  XDG_CACHE_HOME: path.win32.join(root, "cache"),
  XDG_CONFIG_HOME: path.win32.join(root, ".config"),
  XDG_DATA_HOME: path.win32.join(root, "data"),
  XDG_STATE_HOME: path.win32.join(root, "state"),
}
const systemRoot =
  process.env.SystemRoot || process.env.WINDIR || "C:\\Windows"
const shell = path.win32.join(systemRoot, "System32", "cmd.exe")
const result = spawnSync(
  shell,
  ["/d", "/s", "/c", request.command],
  {
    env,
    stdio: "inherit",
    windowsHide: true,
  }
)

if (result.error) {
  process.stderr.write(
    "[AstraFlow sandbox] Isolated profile launch failed: " +
      result.error.message +
      "\n"
  )
  process.exit(126)
}
process.exit(Number.isInteger(result.status) ? result.status : 126)
`
const WINDOWS_SANDBOX_PROFILE_EVAL_SOURCE =
  'eval(Buffer.from(process.argv[1],"base64url").toString("utf8"))'

function quoteWindowsCommandArgument(value) {
  if (!value || /[\s"&|<>^()]/.test(value)) {
    return `"${value
      .replaceAll(/(\\*)"/g, '$1$1\\"')
      .replaceAll(/(\\+)$/g, "$1$1")}"`
  }

  return value
}

export function createWindowsSandboxProfileCommand(
  command,
  profileId,
  nodeExecutable
) {
  if (
    typeof command !== "string" ||
    !command.trim() ||
    !WINDOWS_SANDBOX_PROFILE_ID_PATTERN.test(profileId) ||
    typeof nodeExecutable !== "string" ||
    !nodeExecutable.trim()
  ) {
    throw new Error("Windows sandbox profile request is invalid.")
  }

  // srt-win starts this Node bootstrap with the dedicated srt-sandbox
  // account's real profile. Create and apply the per-session profile only
  // after that user boundary has been crossed. Keeping the original Agent
  // command in a base64url payload avoids both host-shell interpolation and
  // cmd.exe's fragile parsing of a long chain of `set`/`mkdir` statements.
  const bootstrap = Buffer.from(
    WINDOWS_SANDBOX_PROFILE_BOOTSTRAP_SOURCE
  ).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({ command, profileId })
  ).toString("base64url")

  return [
    nodeExecutable,
    "-e",
    WINDOWS_SANDBOX_PROFILE_EVAL_SOURCE,
    bootstrap,
    payload,
  ]
    .map(quoteWindowsCommandArgument)
    .join(" ")
}
