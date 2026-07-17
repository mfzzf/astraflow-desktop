// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"

import {
  findStudioWorkspaceFileByName,
  resolveExistingStudioWorkspaceFilePath,
} from "@/components/studio-chat/workspace-transport"

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
  return { name, path, kind: "directory", extension: "", size: 0, modifiedAt: 0 }
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
          fakeDirectory(
            "ws",
            "/home/Library/Application Support/AstraFlow/ws"
          ),
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

  test("skips dependency directories and reports missing files", async () => {
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
    ).resolves.toBeNull()
    await expect(
      resolveExistingStudioWorkspaceFilePath(workspace, "/home/portfolio.html")
    ).resolves.toBeNull()
  })
})
