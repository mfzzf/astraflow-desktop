// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"

import {
  findStudioWorkspaceFileByName,
  findStudioWorkspaceFileByReference,
  resolveExistingStudioWorkspaceFilePath,
  resolveStudioWorkspaceFileReference,
} from "@/components/studio-chat/workspace-transport"
import { resolveWorkspaceArtifactCard } from "@/components/studio-message-parts/file-output"
import { resolveStudioWorkspaceArtifact } from "@/lib/studio-markdown-artifacts"

type FakeEntry = {
  name: string
  path: string
  kind: "file" | "directory"
  extension: string
  size: number
  modifiedAt: number
}

function fakeFile(name: string, path: string): FakeEntry {
  return { name, path, kind: "file", extension: "html", size: 1, modifiedAt: 0 }
}

function fakeDirectory(name: string, path: string): FakeEntry {
  return {
    name,
    path,
    kind: "directory",
    extension: "",
    size: 0,
    modifiedAt: 0,
  }
}

function createLocalBridge(tree: Record<string, FakeEntry[]>) {
  return {
    localWorkspaceStatPath: async (_root: string, path: string) => {
      for (const entries of Object.values(tree)) {
        const hit = entries.find(
          (entry) => entry.path === path && entry.kind === "file"
        )

        if (hit) {
          return hit
        }
      }

      return null
    },
    localWorkspaceListDirectory: async (_root: string, directory: string) => {
      const entries = tree[directory]

      if (!entries) {
        throw new Error(`ENOENT: ${directory}`)
      }

      return { cwd: directory, name: directory, parent: null, entries }
    },
  }
}

function installBridge(bridge: unknown) {
  Reflect.set(globalThis, "window", { astraflowDesktop: bridge })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window")
})

const workspace = { id: "w1", type: "local", rootPath: "/home" } as const

describe("studio workspace file target repair", () => {
  test("returns the resolved path when the file exists", async () => {
    installBridge(
      createLocalBridge({
        "/home": [fakeFile("portfolio.html", "/home/portfolio.html")],
      })
    )

    await expect(
      resolveExistingStudioWorkspaceFilePath(workspace, "/home/portfolio.html")
    ).resolves.toBe("/home/portfolio.html")
  })

  test("repairs a wrongly resolved path by searching the workspace", async () => {
    installBridge(
      createLocalBridge({
        "/home": [fakeDirectory("Library", "/home/Library")],
        "/home/Library": [
          fakeDirectory(
            "Application Support",
            "/home/Library/Application Support"
          ),
        ],
        "/home/Library/Application Support": [
          fakeDirectory(
            "AstraFlow",
            "/home/Library/Application Support/AstraFlow"
          ),
        ],
        "/home/Library/Application Support/AstraFlow": [
          fakeDirectory("ws", "/home/Library/Application Support/AstraFlow/ws"),
        ],
        "/home/Library/Application Support/AstraFlow/ws": [
          fakeFile(
            "portfolio.html",
            "/home/Library/Application Support/AstraFlow/ws/portfolio.html"
          ),
        ],
      })
    )

    await expect(
      resolveExistingStudioWorkspaceFilePath(workspace, "/home/portfolio.html")
    ).resolves.toBe(
      "/home/Library/Application Support/AstraFlow/ws/portfolio.html"
    )
  })

  test("repairs generated file cards before rendering preview and download actions", async () => {
    installBridge(
      createLocalBridge({
        "/home": [fakeDirectory("outputs", "/home/outputs")],
        "/home/outputs": [
          fakeFile("report.pptx", "/home/outputs/report.pptx"),
        ],
      })
    )
    const resolution = resolveStudioWorkspaceArtifact({
      reference: "report.pptx",
      source: "generated",
      workspace,
    })

    if (resolution.status !== "available") {
      throw new Error("Expected an available artifact resolution.")
    }

    await expect(
      resolveWorkspaceArtifactCard(resolution, workspace)
    ).resolves.toMatchObject({
      repaired: true,
      resolution: {
        status: "available",
        artifact: { path: "/home/outputs/report.pptx" },
      },
    })
  })

  test("uses the native exhaustive workspace index before compatibility traversal", async () => {
    installBridge({
      localWorkspaceStatPath: async () => null,
      localWorkspaceFindFile: async () => ({
        path: "/home/deeper/than/the/browser/budget/report.pptx",
        candidates: ["/home/deeper/than/the/browser/budget/report.pptx"],
      }),
      localWorkspaceListDirectory: async () => {
        throw new Error("The compatibility traversal should not run.")
      },
    })

    await expect(
      resolveExistingStudioWorkspaceFilePath(workspace, "report.pptx")
    ).resolves.toBe("/home/deeper/than/the/browser/budget/report.pptx")
  })

  test("prefers the strongest path-suffix match over the first same-named file", async () => {
    installBridge(
      createLocalBridge({
        "/home": [
          fakeDirectory("archive", "/home/archive"),
          fakeDirectory("work", "/home/work"),
        ],
        "/home/archive": [fakeFile("report.pptx", "/home/archive/report.pptx")],
        "/home/work": [fakeDirectory("rendered", "/home/work/rendered")],
        "/home/work/rendered": [
          fakeFile("report.pptx", "/home/work/rendered/report.pptx"),
        ],
      })
    )

    await expect(
      findStudioWorkspaceFileByReference(
        workspace,
        "/stale/session/work/rendered/report.pptx"
      )
    ).resolves.toBe("/home/work/rendered/report.pptx")
    await expect(
      resolveExistingStudioWorkspaceFilePath(
        workspace,
        "/stale/session/work/rendered/report.pptx"
      )
    ).resolves.toBe("/home/work/rendered/report.pptx")
  })

  test("searches generated and dependency directories exhaustively", async () => {
    installBridge(
      createLocalBridge({
        "/home": [fakeDirectory("node_modules", "/home/node_modules")],
        "/home/node_modules": [
          fakeFile("portfolio.html", "/home/node_modules/portfolio.html"),
        ],
      })
    )

    await expect(
      findStudioWorkspaceFileByName(workspace, "portfolio.html")
    ).resolves.toBe("/home/node_modules/portfolio.html")
    await expect(
      resolveExistingStudioWorkspaceFilePath(workspace, "/home/portfolio.html")
    ).resolves.toBe("/home/node_modules/portfolio.html")
  })

  test("returns every candidate instead of guessing between equally strong matches", async () => {
    installBridge(
      createLocalBridge({
        "/home": [
          fakeDirectory("archive", "/home/archive"),
          fakeDirectory("outputs", "/home/outputs"),
        ],
        "/home/archive": [fakeFile("report.pptx", "/home/archive/report.pptx")],
        "/home/outputs": [fakeFile("report.pptx", "/home/outputs/report.pptx")],
      })
    )

    await expect(
      resolveStudioWorkspaceFileReference(workspace, "report.pptx")
    ).resolves.toEqual({
      path: null,
      candidates: ["/home/archive/report.pptx", "/home/outputs/report.pptx"],
    })
  })
})
