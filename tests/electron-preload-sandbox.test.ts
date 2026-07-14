// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const preloadSource = readFileSync(
  join(process.cwd(), "electron", "preload.cjs"),
  "utf8"
)
const mainSource = readFileSync(
  join(process.cwd(), "electron", "main.cjs"),
  "utf8"
)

describe("Electron sandbox preload", () => {
  test("does not import Node built-ins", () => {
    expect(preloadSource).not.toMatch(/require\(["']node:/)
  })

  test("gets the home directory through a main-process IPC bridge", () => {
    expect(preloadSource).toContain(
      'ipcRenderer.sendSync("astraflow:home-path")'
    )
    expect(mainSource).toContain('ipcMain.on("astraflow:home-path"')
    expect(mainSource).toContain('event.returnValue = app.getPath("home")')
  })
})
