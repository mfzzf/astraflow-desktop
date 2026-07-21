import assert from "node:assert/strict"
import test from "node:test"

import pythonRuntimeGuard from "../electron/python-runtime-guard.cjs"

const { ensureManagedPythonRuntimeIfNeeded } = pythonRuntimeGuard

test("downloads managed Python before a managed environment operation", async () => {
  const installs = []
  const pythonEnvironment = {
    getStatus: async () => ({ mode: "managed" }),
  }

  const result = await ensureManagedPythonRuntimeIfNeeded({
    developerRuntimeEnvironment: {
      install: async (runtimeId) => installs.push(runtimeId),
    },
    pythonEnvironment,
  })

  assert.equal(result, pythonEnvironment)
  assert.deepEqual(installs, ["python"])
})

test("keeps custom Python independent from the managed runtime download", async () => {
  let installCalled = false
  const pythonEnvironment = {
    getStatus: async () => ({ mode: "custom" }),
  }

  const result = await ensureManagedPythonRuntimeIfNeeded({
    developerRuntimeEnvironment: {
      install: async () => {
        installCalled = true
      },
    },
    pythonEnvironment,
  })

  assert.equal(result, pythonEnvironment)
  assert.equal(installCalled, false)
})
