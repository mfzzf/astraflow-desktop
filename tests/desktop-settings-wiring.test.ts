import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

function readSource(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
}

test("Electron exposes actionable native notifications end to end", () => {
  const main = readSource("electron/main.cjs")
  const preload = readSource("electron/preload.cjs")
  const workbench = readSource("components/studio-chat-workbench.tsx")
  const taskNotifications = readSource(
    "components/studio-task-notifications.tsx"
  )

  assert.match(main, /notification\.on\("action"/)
  assert.match(main, /notification\.once\("failed"/)
  assert.match(main, /function isDesktopNotificationSupported\(\)/)
  assert.match(main, /TeamIdentifier=/)
  assert.match(main, /astraflow:notification-actions-pending/)
  assert.match(preload, /listPendingNotificationActions/)
  assert.match(taskNotifications, /buildPermissionNotificationCopy/)
  assert.match(workbench, /handlePermissionDecision/)
})

test("Electron tray receives active and recent Studio tasks", () => {
  const main = readSource("electron/main.cjs")
  const preload = readSource("electron/preload.cjs")
  const taskNotifications = readSource(
    "components/studio-task-notifications.tsx"
  )

  assert.match(main, /astraflow:tray-tasks:update/)
  assert.match(main, /activeTasks\.map\(taskMenuItem\)/)
  assert.match(main, /recentTasks\.map\(taskMenuItem\)/)
  assert.match(preload, /updateTrayTasks/)
  assert.match(taskNotifications, /selectStudioDesktopTasks/)
})

test("behavior and AppSnap settings are connected to runtime consumers", () => {
  const settings = readSource("components/settings-synara-section-page.tsx")
  const sidebar = readSource("components/app-sidebar.tsx")
  const workbench = readSource("components/studio-chat-workbench.tsx")
  const main = readSource("electron/main.cjs")

  assert.match(settings, /useAppPreference\("followLiveOutput"\)/)
  assert.match(settings, /setAppSnapEnabled/)
  assert.match(sidebar, /useAppPreference\("confirmDestructive"\)/)
  assert.match(workbench, /followOutput=\{isBusy && followLiveOutput\}/)
  assert.match(main, /globalShortcut\.register\(APPSNAP_SHORTCUT/)
})
