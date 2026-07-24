import net from "node:net"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

function normalizeLoopbackProxy(value) {
  const url = new URL(value)

  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "::1"].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password
  ) {
    throw new Error("Agent model bridge requires a loopback HTTP proxy.")
  }

  return {
    host: url.hostname === "::1" ? "::1" : "127.0.0.1",
    port: Number(url.port),
  }
}

export async function createAgentModelBridge({ proxyUrl } = {}) {
  const target = normalizeLoopbackProxy(proxyUrl)
  const root = await mkdtemp(path.join(tmpdir(), "af-agent-net-"))
  const socketPath = path.join(root, "proxy.sock")
  const sockets = new Set()
  const server = net.createServer((sandboxSocket) => {
    const proxySocket = net.createConnection(target)

    sockets.add(sandboxSocket)
    sockets.add(proxySocket)
    sandboxSocket.once("close", () => sockets.delete(sandboxSocket))
    proxySocket.once("close", () => sockets.delete(proxySocket))
    sandboxSocket.once("error", () => proxySocket.destroy())
    proxySocket.once("error", () => sandboxSocket.destroy())
    sandboxSocket.pipe(proxySocket)
    proxySocket.pipe(sandboxSocket)
  })

  try {
    await new Promise((resolve, reject) => {
      const onError = (error) => {
        server.off("listening", onListening)
        reject(error)
      }
      const onListening = () => {
        server.off("error", onError)
        resolve()
      }

      server.once("error", onError)
      server.once("listening", onListening)
      server.listen(socketPath)
    })
    await chmod(root, 0o700)
    await chmod(socketPath, 0o600)
  } catch (error) {
    server.close()
    await rm(root, { force: true, recursive: true })
    throw error
  }

  server.unref()
  let closePromise = null

  return {
    port: target.port,
    socketPath,
    close() {
      if (closePromise) {
        return closePromise
      }

      closePromise = new Promise((resolve) => {
        for (const socket of sockets) {
          socket.destroy()
        }

        server.close(() => resolve())
      }).finally(() => rm(root, { force: true, recursive: true }))

      return closePromise
    },
  }
}
