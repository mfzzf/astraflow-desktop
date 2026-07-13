import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { after, before } from "node:test"
import { setTimeout as delay } from "node:timers/promises"
import { promisify } from "node:util"

import { WebSocket } from "ws"

import { createWorkspaceGateway } from "../src/server.mjs"

const TOKEN = "workspace-gateway-test-token-000001"
const execFileAsync = promisify(execFile)

let baseUrl
let gateway
let workspaceRoot
let outsideFile

function authenticatedFetch(pathname, init = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      authorization: `Bearer ${TOKEN}`,
      ...init.headers,
    },
  })
}

async function git(root, args) {
  return execFileAsync("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  })
}

async function createDirtyGitWorkspace(name, committed, current, untracked) {
  const root = path.join(workspaceRoot, name)

  await mkdir(root)
  await git(root, ["init", "-q"])
  await git(root, ["config", "user.name", "Gateway Test"])
  await git(root, ["config", "user.email", "gateway@example.test"])
  await writeFile(path.join(root, "tracked.txt"), committed)
  await git(root, ["add", "tracked.txt"])
  await git(root, ["commit", "-q", "-m", "initial"])
  await writeFile(path.join(root, "tracked.txt"), current)
  await writeFile(path.join(root, "untracked.txt"), untracked)

  return root
}

before(async () => {
  workspaceRoot = await mkdtemp(path.join(tmpdir(), "astraflow-gateway-workspace-"))
  const outsideRoot = await mkdtemp(path.join(tmpdir(), "astraflow-gateway-outside-"))
  outsideFile = path.join(outsideRoot, "secret.txt")

  await writeFile(path.join(workspaceRoot, "hello.txt"), "hello gateway")
  await writeFile(path.join(workspaceRoot, ".env"), "VISIBLE=yes")
  await writeFile(path.join(workspaceRoot, ".hidden"), "hidden")
  await mkdir(path.join(workspaceRoot, "src"))
  await writeFile(path.join(workspaceRoot, "src", "index.mjs"), "export {}")
  await createDirtyGitWorkspace(
    "project-a",
    "project a before\n",
    "project a after\n",
    "project a new\n"
  )
  await createDirtyGitWorkspace(
    "project-b",
    "project b before\n",
    "project b after\n",
    "project b new\n"
  )
  await mkdir(path.join(workspaceRoot, "project-a", "nested"))
  await writeFile(outsideFile, "outside")
  await symlink(outsideFile, path.join(workspaceRoot, "outside-link.txt"))

  gateway = await createWorkspaceGateway({
    host: "127.0.0.1",
    port: 0,
    token: TOKEN,
    workspaceRoot,
    workspaceId: "workspace-test",
    sandboxId: "sandbox-test",
    templateVersion: "template-test",
    terminalDisposeDelayMs: 100,
    terminalDetachedDisposeDelayMs: 100,
  })
  const address = await gateway.listen()

  baseUrl = `http://127.0.0.1:${address.port}`
})

after(async () => {
  await gateway?.close()
  await rm(workspaceRoot, { recursive: true, force: true })
  await rm(path.dirname(outsideFile), { recursive: true, force: true })
})

test("exposes only the minimal unauthenticated health probe", async () => {
  const probe = await fetch(`${baseUrl}/healthz`)
  const unauthorized = await fetch(`${baseUrl}/v1/health`)

  assert.equal(probe.status, 200)
  assert.deepEqual(await probe.json(), { ok: true, status: "ok" })
  assert.equal(unauthorized.status, 401)
  assert.equal((await unauthorized.json()).error.code, "UNAUTHORIZED")
})

test("reports versioned workspace capabilities", async () => {
  const health = await authenticatedFetch("/v1/health")
  const workspace = await authenticatedFetch("/v1/workspace")

  assert.equal(health.status, 200)
  assert.deepEqual((await health.json()).data, {
    status: "ok",
    protocolVersion: 1,
    gatewayVersion: "0.2.0",
    templateVersion: "template-test",
    workspaceId: "workspace-test",
    sandboxId: "sandbox-test",
  })
  assert.deepEqual((await workspace.json()).data.capabilities, [
    "fs.entries",
    "fs.read",
    "git.review",
    "terminal.pty",
    "terminal.websocket-ticket",
  ])
})

test("reviews Git changes inside one selected workspace directory", async () => {
  const projectA = await authenticatedFetch("/v1/git/review?path=project-a")
  const payload = await projectA.json()

  assert.equal(projectA.status, 200)
  assert.equal(payload.ok, true)
  assert.equal(payload.data.gitAvailable, true)
  assert.equal(typeof payload.data.git.branch, "string")
  assert.deepEqual(
    payload.data.files.map((file) => file.path).sort(),
    ["tracked.txt", "untracked.txt"]
  )
  assert.match(
    payload.data.files.find((file) => file.path === "tracked.txt").diff,
    /project a after/
  )
  assert.equal(
    payload.data.files.some((file) => file.diff?.includes("project b after")),
    false
  )

  const projectB = await authenticatedFetch("/v1/git/review?path=project-b")
  const projectBPayload = await projectB.json()

  assert.equal(projectB.status, 200)
  assert.match(
    projectBPayload.data.files.find((file) => file.path === "tracked.txt").diff,
    /project b after/
  )

  const nested = await authenticatedFetch(
    "/v1/git/review?path=project-a/nested"
  )
  const nestedPayload = await nested.json()

  assert.equal(nested.status, 200)
  assert.equal(nestedPayload.data.gitAvailable, false)
  assert.deepEqual(nestedPayload.data.files, [])
})

test("blocks Git review traversal and escaping directory symlinks", async () => {
  const outsideRoot = path.dirname(outsideFile)
  const outsideDirectoryLink = path.join(workspaceRoot, "outside-directory")

  await symlink(outsideRoot, outsideDirectoryLink, "dir")

  const traversal = await authenticatedFetch(
    "/v1/git/review?path=../outside"
  )
  const symlinkEscape = await authenticatedFetch(
    "/v1/git/review?path=outside-directory"
  )

  assert.equal(traversal.status, 400)
  assert.equal((await traversal.json()).error.code, "PATH_OUTSIDE_WORKSPACE")
  assert.equal(symlinkEscape.status, 403)
  assert.equal((await symlinkEscape.json()).error.code, "PATH_OUTSIDE_WORKSPACE")
})

test("lists workspace directories without exposing hidden or escaping entries", async () => {
  const root = await authenticatedFetch("/v1/fs/entries?path=")
  const child = await authenticatedFetch("/v1/fs/entries?path=src")
  const rootData = (await root.json()).data
  const childData = (await child.json()).data

  assert.equal(root.status, 200)
  assert.equal(rootData.path, "")
  assert.equal(rootData.parent, null)
  assert.deepEqual(
    rootData.entries.map((entry) => entry.name),
    ["project-a", "project-b", "src", ".env", "hello.txt"]
  )
  assert.equal(rootData.entries.find((entry) => entry.name === "src").kind, "directory")
  assert.equal(rootData.entries.some((entry) => entry.name === ".hidden"), false)
  assert.equal(rootData.entries.some((entry) => entry.name === "outside-link.txt"), false)
  assert.equal(childData.path, "src")
  assert.equal(childData.parent, "")
  assert.equal(childData.entries[0].path, "src/index.mjs")
})

test("reads files with ranges and blocks traversal or escaping symlinks", async () => {
  const file = await authenticatedFetch("/v1/fs/file?path=hello.txt")
  const head = await authenticatedFetch("/v1/fs/file?path=hello.txt", {
    method: "HEAD",
  })
  const range = await authenticatedFetch("/v1/fs/file?path=hello.txt", {
    headers: { range: "bytes=6-12" },
  })
  const traversal = await authenticatedFetch(
    "/v1/fs/file?path=../outside.txt"
  )
  const symlinkEscape = await authenticatedFetch(
    "/v1/fs/file?path=outside-link.txt"
  )

  assert.equal(file.status, 200)
  assert.equal(await file.text(), "hello gateway")
  assert.equal(head.status, 200)
  assert.equal(head.headers.get("content-length"), "13")
  assert.equal(await head.text(), "")
  assert.equal(range.status, 206)
  assert.equal(range.headers.get("content-range"), "bytes 6-12/13")
  assert.equal(await range.text(), "gateway")
  assert.equal(traversal.status, 400)
  assert.equal((await traversal.json()).error.code, "PATH_OUTSIDE_WORKSPACE")
  assert.equal(symlinkEscape.status, 403)
  assert.equal((await symlinkEscape.json()).error.code, "PATH_OUTSIDE_WORKSPACE")
})

test(
  "runs an interactive PTY over authenticated WebSocket",
  { skip: process.platform === "win32" },
  async () => {
    const created = await authenticatedFetch("/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "", cols: 100, rows: 30 }),
    })
    const terminal = (await created.json()).data
    const ticketResponse = await authenticatedFetch("/v1/connection-tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "terminal",
        terminalId: terminal.terminalId,
      }),
    })
    const ticket = (await ticketResponse.json()).data

    assert.equal(ticketResponse.status, 201)
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, "ws")}${ticket.websocketPath}`
    )
    let output = ""

    socket.on("message", (data, isBinary) => {
      if (isBinary) {
        output += Buffer.from(data).toString("utf8")
      }
    })

    await new Promise((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    })

    const replayStatus = await new Promise((resolve) => {
      const replay = new WebSocket(
        `${baseUrl.replace(/^http/, "ws")}${ticket.websocketPath}`
      )

      replay.once("unexpected-response", (_request, response) => {
        resolve(response.statusCode)
        response.resume()
      })
      replay.once("open", () => {
        replay.close()
        resolve(101)
      })
      replay.on("error", () => undefined)
    })

    assert.equal(replayStatus, 401)

    socket.send(
      JSON.stringify({
        type: "terminal.input",
        data: "printf '__GATEWAY_PTY_OK__\\n'; exit\\n",
      })
    )

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error(`PTY output timed out: ${output}`)),
        5_000
      )
      const poll = setInterval(() => {
        if (!output.includes("__GATEWAY_PTY_OK__")) {
          return
        }

        clearTimeout(timeout)
        clearInterval(poll)
        resolve()
      }, 20)

      timeout.unref?.()
    })

    assert.match(output, /__GATEWAY_PTY_OK__/)
    socket.close()
  }
)

test(
  "disposes a PTY after its WebSocket remains detached",
  { skip: process.platform === "win32" },
  async () => {
    const created = await authenticatedFetch("/v1/terminals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "" }),
    })
    const terminal = (await created.json()).data
    const ticketResponse = await authenticatedFetch("/v1/connection-tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scope: "terminal",
        terminalId: terminal.terminalId,
      }),
    })
    const ticket = (await ticketResponse.json()).data
    const socket = new WebSocket(
      `${baseUrl.replace(/^http/, "ws")}${ticket.websocketPath}`
    )

    await new Promise((resolve, reject) => {
      socket.once("open", resolve)
      socket.once("error", reject)
    })
    const closed = new Promise((resolve) => socket.once("close", resolve))

    socket.close()
    await closed
    await delay(180)

    const deletion = await authenticatedFetch(
      `/v1/terminals/${terminal.terminalId}`,
      { method: "DELETE" }
    )

    assert.equal(deletion.status, 404)
    assert.equal((await deletion.json()).error.code, "TERMINAL_NOT_FOUND")
  }
)
