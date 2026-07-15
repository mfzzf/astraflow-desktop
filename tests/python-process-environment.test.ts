// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { expect, test } from "bun:test"
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { delimiter, dirname, join } from "node:path"

import { getConfiguredPythonProcessEnvironment } from "@/lib/agent/python-process-environment"

test("native Agent processes pick up the current shared Python state", () => {
  if (process.platform === "win32") {
    return
  }

  const root = mkdtempSync(join(tmpdir(), "astraflow-python-process-env-"))
  const executable = join(
    root,
    "python-environments",
    "managed-test",
    "bin",
    "python3"
  )
  const statePath = join(root, "python-environment-state.json")

  try {
    mkdirSync(dirname(executable), { recursive: true })
    writeFileSync(executable, "managed Python placeholder")
    chmodSync(executable, 0o755)
    writeFileSync(
      statePath,
      JSON.stringify({
        ready: true,
        source: "managed",
        executable,
        isolated: true,
        pythonUserBase: null,
      })
    )

    const env = getConfiguredPythonProcessEnvironment({
      ASTRAFLOW_PYTHON_STATE_PATH: statePath,
      PATH: "/usr/bin",
      PYTHONHOME: "/bootstrap",
      PYTHONUSERBASE: "/old-user-base",
    })

    const canonicalExecutable = realpathSync.native(executable)

    expect(env.ASTRAFLOW_PYTHON_EXECUTABLE).toBe(canonicalExecutable)
    expect(env.PATH?.split(delimiter)[0]).toBe(dirname(canonicalExecutable))
    expect(env.PYTHONHOME).toBeUndefined()
    expect(env.PYTHONNOUSERSITE).toBe("1")
    expect(env.PYTHONUSERBASE).toBeUndefined()
    expect(env.PIP_NO_INPUT).toBe("1")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
