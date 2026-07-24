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

test("direct Agent processes can opt out of inheriting host secrets", () => {
  const previous = process.env.ASTRAFLOW_TEST_HOST_SECRET
  process.env.ASTRAFLOW_TEST_HOST_SECRET = "must-not-leak"

  try {
    const env = getConfiguredPythonProcessEnvironment(
      { PATH: "/usr/bin", LANG: "en_US.UTF-8" },
      { inheritProcessEnv: false }
    )

    expect(env.ASTRAFLOW_TEST_HOST_SECRET).toBeUndefined()
    expect(env.PATH).toBe("/usr/bin")
    expect(env.LANG).toBe("en_US.UTF-8")
  } finally {
    if (previous === undefined) {
      delete process.env.ASTRAFLOW_TEST_HOST_SECRET
    } else {
      process.env.ASTRAFLOW_TEST_HOST_SECRET = previous
    }
  }
})

test("Agent processes never inherit CompShare CLI credentials", () => {
  const previous = {
    config: process.env.COMPSHARE_CONFIG_FILE,
    privateKey: process.env.COMPSHARE_PRIVATE_KEY,
    publicKey: process.env.COMPSHARE_PUBLIC_KEY,
  }
  process.env.COMPSHARE_CONFIG_FILE = "/private/compshare/config.json"
  process.env.COMPSHARE_PRIVATE_KEY = "private-key"
  process.env.COMPSHARE_PUBLIC_KEY = "public-key"

  try {
    const env = getConfiguredPythonProcessEnvironment()

    expect(env.COMPSHARE_CONFIG_FILE).toBeUndefined()
    expect(env.COMPSHARE_PRIVATE_KEY).toBeUndefined()
    expect(env.COMPSHARE_PUBLIC_KEY).toBeUndefined()
  } finally {
    for (const [name, value] of [
      ["COMPSHARE_CONFIG_FILE", previous.config],
      ["COMPSHARE_PRIVATE_KEY", previous.privateKey],
      ["COMPSHARE_PUBLIC_KEY", previous.publicKey],
    ] as const) {
      if (value === undefined) {
        delete process.env[name]
      } else {
        process.env[name] = value
      }
    }
  }
})
