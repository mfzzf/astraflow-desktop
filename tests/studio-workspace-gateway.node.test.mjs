import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { register } from "node:module"
import { after, test } from "node:test"

register("./helpers/typescript-alias-loader.mjs", import.meta.url)

const testDirectory = mkdtempSync(
  join(tmpdir(), "astraflow-workspace-gateway-")
)
process.env.ASTRAFLOW_SQLITE_PATH = join(testDirectory, "studio.sqlite")

const studioDb = await import("../lib/studio-db.ts")
const remoteWorkspace = await import("../lib/studio-remote-workspace.ts")
const workspaceGateway = await import("../lib/studio-workspace-gateway.ts")

studioDb.saveStudioModelverseApiKey({
  id: "test-key",
  name: "Test key",
  key: "test-secret",
  projectId: "test-project",
})
studioDb.saveStudioOAuthTokens({
  accessToken: "test-token",
  refreshToken: null,
  tokenType: "Bearer",
  expiresAt: null,
  email: "test@example.com",
})
studioDb.upsertCodeBoxSandboxRecord({
  sandboxId: "sandbox-owned",
  name: "Owned sandbox",
  ownerKey: "test@example.com:test-project",
  ownerEmail: "test@example.com",
  companyId: "test@example.com",
  projectId: "test-project",
  template: "template-test",
  status: "paused",
  codeServerPort: 8080,
  workspacePath: "/workspace",
})

after(() => {
  studioDb.getStudioDatabase().close()
  rmSync(testDirectory, { recursive: true, force: true })
})

test("rejects a local workspace before any remote Gateway access", () => {
  const project = studioDb.createStudioLocalProject({
    name: "Local project",
    path: join(testDirectory, "local-project"),
  })
  const workspace = studioDb.getStudioWorkspaceForLocalProject(project.id)
  assert.ok(workspace)

  let mismatchError = null
  assert.throws(
    () => workspaceGateway.requireStudioSandboxWorkspace(workspace.id),
    (error) => {
      mismatchError = error
      return error instanceof remoteWorkspace.StudioWorkspaceTypeMismatchError
    }
  )
  assert.equal(
    workspaceGateway.getStudioWorkspaceGatewayErrorStatus(mismatchError),
    409
  )
})

test("scopes Gateway paths to the selected sandbox subdirectory", () => {
  const workspace = studioDb.createStudioSandboxWorkspace({
    name: "Project A",
    rootPath: "/workspace/project-a",
    sandboxId: "sandbox-owned",
  })
  const siblingWorkspace = studioDb.createStudioSandboxWorkspace({
    name: "Project B",
    rootPath: "/workspace/project-b",
    sandboxId: "sandbox-owned",
  })
  const context = workspaceGateway.requireStudioSandboxWorkspace(workspace.id)
  const siblingContext = workspaceGateway.requireStudioSandboxWorkspace(
    siblingWorkspace.id
  )

  assert.deepEqual(context, {
    workspaceId: workspace.id,
    sandboxId: "sandbox-owned",
    workspacePath: "/workspace/project-a",
    gatewayRoot: "/workspace",
  })
  assert.equal(
    workspaceGateway.toStudioWorkspaceGatewayRelativePath(
      context,
      "/workspace/project-a/src/index.ts"
    ),
    "project-a/src/index.ts"
  )
  assert.equal(
    workspaceGateway.toStudioWorkspaceGatewayRelativePath(
      context,
      "src/index.ts"
    ),
    "project-a/src/index.ts"
  )
  assert.equal(
    workspaceGateway.toStudioWorkspaceAbsolutePath(
      context,
      "project-a/src/index.ts"
    ),
    "/workspace/project-a/src/index.ts"
  )
  assert.equal(
    workspaceGateway.toStudioWorkspaceGatewayRelativePath(
      siblingContext,
      "src/index.ts"
    ),
    "project-b/src/index.ts"
  )

  assert.throws(
    () =>
      workspaceGateway.toStudioWorkspaceGatewayRelativePath(
        context,
        "/workspace/project-b/secret.txt"
      ),
    /inside workspace root/
  )
  assert.throws(
    () =>
      workspaceGateway.toStudioWorkspaceAbsolutePath(
        context,
        "project-b/secret.txt"
    ),
    /outside the Studio workspace/
  )
  assert.throws(
    () =>
      workspaceGateway.toStudioWorkspaceGatewayRelativePath(
        siblingContext,
        "/workspace/project-a/secret.txt"
      ),
    /inside workspace root/
  )
})

test("rejects a sandbox record that is not owned by the active account", () => {
  studioDb.upsertCodeBoxSandboxRecord({
    sandboxId: "sandbox-other-owner",
    name: "Other owner sandbox",
    ownerKey: "other@example.com:other-project",
    ownerEmail: "other@example.com",
    companyId: "other@example.com",
    projectId: "other-project",
    template: "template-test",
    status: "paused",
    codeServerPort: 8080,
    workspacePath: "/workspace",
  })
  const workspace = studioDb.createStudioSandboxWorkspace({
    name: "Foreign binding",
    rootPath: "/workspace/foreign",
    sandboxId: "sandbox-other-owner",
  })

  let notFoundError = null
  assert.throws(
    () => workspaceGateway.requireStudioSandboxWorkspace(workspace.id),
    (error) => {
      notFoundError = error
      return (
        error instanceof workspaceGateway.StudioWorkspaceGatewayNotFoundError
      )
    }
  )
  assert.equal(
    workspaceGateway.getStudioWorkspaceGatewayErrorStatus(notFoundError),
    404
  )
})
