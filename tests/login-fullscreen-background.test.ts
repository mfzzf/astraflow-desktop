// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const appShellSource = readFileSync(
  join(process.cwd(), "components", "app-shell.tsx"),
  "utf8"
)

test("the login background fills the window behind the Electron titlebar", () => {
  expect(appShellSource).toContain(
    'className="relative h-svh min-h-0 overflow-hidden bg-background"'
  )
  expect(appShellSource).toContain(
    '<Titlebar className="absolute inset-x-0 top-0 z-10 bg-transparent" />'
  )
  expect(appShellSource).not.toContain(
    '<Titlebar className="bg-background" />'
  )
})
