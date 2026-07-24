import { randomUUID } from "node:crypto"
import { createServer, type Server } from "node:net"

export type ProviderProxyTokenTransport =
  | "environment"
  | "fd3"
  | "windows_named_pipe"

const WINDOWS_PROVIDER_PIPE_PREFIX = "\\\\.\\pipe\\astraflow-provider-"
const PROVIDER_PROXY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
const PROVIDER_PIPE_TIMEOUT_MS = 30_000

export function createWindowsProviderCredentialPipePath() {
  return `${WINDOWS_PROVIDER_PIPE_PREFIX}${process.pid}-${randomUUID()}`
}

export function isWindowsProviderCredentialPipePath(value: unknown) {
  return (
    typeof value === "string" &&
    value.startsWith(WINDOWS_PROVIDER_PIPE_PREFIX) &&
    /^[A-Za-z0-9._\\-]+$/.test(value)
  )
}

export function startWindowsProviderCredentialPipe({
  credential,
  pipePath,
}: {
  credential: string
  pipePath: string
}) {
  if (process.platform !== "win32") {
    throw new Error(
      "Windows named-pipe provider credential transport is only available on Windows."
    )
  }
  if (!PROVIDER_PROXY_TOKEN_PATTERN.test(credential)) {
    throw new Error(
      "Windows named-pipe provider credential transport requires a Desktop-scoped provider credential."
    )
  }
  if (!isWindowsProviderCredentialPipePath(pipePath)) {
    throw new Error("Windows provider credential pipe path is invalid.")
  }

  let consumed = false
  let closed = false
  const server: Server = createServer()
  const close = () => {
    if (closed) {
      return
    }

    closed = true
    clearTimeout(timeout)
    if (server.listening) {
      server.close()
    }
  }
  const timeout = setTimeout(close, PROVIDER_PIPE_TIMEOUT_MS)

  server.on("connection", (socket) => {
    socket.on("error", close)
    if (consumed) {
      socket.destroy()
      return
    }

    // The random pipe name is the bootstrap capability. Serve the scoped
    // proxy token once, then remove the endpoint so later Agent subprocesses
    // cannot recover it from OpenCode's inherited configuration.
    consumed = true
    socket.end(credential)
    close()
  })
  server.on("error", close)
  server.listen(pipePath)
  server.unref()

  return { close }
}
