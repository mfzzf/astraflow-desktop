import { gzipSync } from "node:zlib"

export const WINDOWS_SANDBOX_PROFILE_ID_PATTERN = /^[0-9a-f]{32}$/

const WINDOWS_SANDBOX_PROFILE_BOOTSTRAP_SOURCE = String.raw`
const { spawn, spawnSync } = require("node:child_process")
const { mkdirSync } = require("node:fs")
const { connect } = require("node:net")
const path = require("node:path")

const request = JSON.parse(
  Buffer.from(process.argv[2], "base64url").toString("utf8")
)
if (
  !request ||
  typeof request.command !== "string" ||
  !request.command.trim() ||
  !/^[0-9a-f]{32}$/.test(request.profileId) ||
  (
    request.acpTransport !== undefined &&
    (
      !request.acpTransport ||
      request.acpTransport.host !== "127.0.0.1" ||
      !Number.isInteger(request.acpTransport.port) ||
      request.acpTransport.port < 1 ||
      request.acpTransport.port > 65535 ||
      typeof request.acpTransport.token !== "string" ||
      !/^[0-9a-f]{64}$/.test(request.acpTransport.token)
    )
  )
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

function connectAcpTransport() {
  const rawProxy =
    process.env.HTTPS_PROXY ||
    process.env.HTTP_PROXY ||
    process.env.https_proxy ||
    process.env.http_proxy
  if (!rawProxy) {
    return Promise.reject(
      new Error("The Windows sandbox proxy is unavailable.")
    )
  }

  let proxy
  try {
    proxy = new URL(rawProxy)
  } catch {
    return Promise.reject(
      new Error("The Windows sandbox proxy URL is invalid.")
    )
  }
  if (
    proxy.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(proxy.hostname) ||
    !Number.isInteger(Number(proxy.port)) ||
    Number(proxy.port) < 1 ||
    Number(proxy.port) > 65535
  ) {
    return Promise.reject(
      new Error("The Windows sandbox proxy endpoint is invalid.")
    )
  }

  return new Promise((resolve, reject) => {
    const socket = connect(
      Number(proxy.port),
      proxy.hostname === "localhost" ? "127.0.0.1" : proxy.hostname
    )
    let response = Buffer.alloc(0)
    const fail = (error) => {
      socket.destroy()
      reject(error)
    }
    socket.once("error", fail)
    socket.once("connect", () => {
      const authority =
        request.acpTransport.host + ":" + request.acpTransport.port
      const authorization =
        proxy.username || proxy.password
          ? "Proxy-Authorization: Basic " +
            Buffer.from(
              decodeURIComponent(proxy.username) +
                ":" +
                decodeURIComponent(proxy.password)
            ).toString("base64") +
            "\r\n"
          : ""
      socket.write(
        "CONNECT " + authority + " HTTP/1.1\r\n" +
          "Host: " + authority + "\r\n" +
          authorization +
          "\r\n"
      )
    })
    socket.on("data", function onHandshake(chunk) {
      response = Buffer.concat([response, chunk])
      if (response.length > 16 * 1024) {
        fail(new Error("The Windows sandbox proxy response is too large."))
        return
      }
      const end = response.indexOf("\r\n\r\n")
      if (end < 0) {
        return
      }
      socket.off("data", onHandshake)
      socket.off("error", fail)
      const status = response.subarray(0, end).toString("latin1")
      if (!/^HTTP\/1\.[01] 2\d\d(?:\s|$)/.test(status)) {
        fail(new Error("The Windows sandbox proxy refused ACP transport."))
        return
      }
      const remainder = response.subarray(end + 4)
      if (remainder.length > 0) {
        socket.unshift(remainder)
      }
      resolve(socket)
    })
  })
}

if (request.acpTransport) {
  let child = null
  let settled = false
  const fail = (error) => {
    if (settled) {
      return
    }
    settled = true
    child?.kill()
    process.stderr.write(
      "[AstraFlow sandbox] ACP transport failed: " +
        (error instanceof Error ? error.message : String(error)) +
        "\n"
    )
    process.exitCode = 126
  }

  void connectAcpTransport().then((socket) => {
    socket.once("error", fail)
    socket.write(
      "ASTRAFLOW_ACP/1 " + request.acpTransport.token + "\n",
      () => {
    child = spawn(
      shell,
      ["/d", "/s", "/c", request.command],
      {
        env,
        stdio: ["pipe", "pipe", "inherit"],
        windowsHide: true,
      }
    )
    child.once("error", fail)
    socket.pipe(child.stdin)
    child.stdout.pipe(socket)
    child.once("exit", (code, signal) => {
      if (settled) {
        return
      }
      settled = true
      socket.end()
      process.exitCode =
        signal || !Number.isInteger(code) ? 126 : code
    })
        socket.once("close", () => {
          if (!settled && child) {
            child.stdin.end()
          }
        })
      }
    )
  }, fail)
} else {
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
}
`
const WINDOWS_SANDBOX_PROFILE_EVAL_SOURCE =
  'eval(require("node:zlib").gunzipSync(Buffer.from(process.argv[1],"base64url")).toString("utf8"))'

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
  nodeExecutable,
  acpTransport
) {
  if (
    typeof command !== "string" ||
    !command.trim() ||
    !WINDOWS_SANDBOX_PROFILE_ID_PATTERN.test(profileId) ||
    typeof nodeExecutable !== "string" ||
    !nodeExecutable.trim() ||
    (acpTransport !== undefined &&
      (!acpTransport ||
        acpTransport.host !== "127.0.0.1" ||
        !Number.isInteger(acpTransport.port) ||
        acpTransport.port < 1 ||
        acpTransport.port > 65_535 ||
        typeof acpTransport.token !== "string" ||
        !/^[0-9a-f]{64}$/.test(acpTransport.token)))
  ) {
    throw new Error("Windows sandbox profile request is invalid.")
  }

  // srt-win starts this Node bootstrap with the dedicated srt-sandbox
  // account's real profile. Create and apply the per-session profile only
  // after that user boundary has been crossed. Keeping the original Agent
  // command in a base64url payload avoids both host-shell interpolation and
  // cmd.exe's fragile parsing of a long chain of `set`/`mkdir` statements.
  const bootstrapSource = WINDOWS_SANDBOX_PROFILE_BOOTSTRAP_SOURCE
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
  const bootstrap = gzipSync(Buffer.from(bootstrapSource), {
    level: 9,
  }).toString("base64url")
  const payload = Buffer.from(
    JSON.stringify({ command, profileId, ...(acpTransport
      ? { acpTransport }
      : {}) })
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
