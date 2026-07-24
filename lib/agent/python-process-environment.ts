import { accessSync, constants, readFileSync, realpathSync } from "node:fs"
import { delimiter, dirname, resolve } from "node:path"

type PythonRuntimeState = {
  ready?: boolean
  source?: string
  executable?: string
  isolated?: boolean
  pythonUserBase?: string | null
}

function readPythonRuntimeState(path: string) {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PythonRuntimeState
  } catch {
    return null
  }
}

function resolveExecutable(path: string) {
  try {
    const executable = realpathSync.native(resolve(path))
    accessSync(executable, constants.X_OK)
    return executable
  } catch {
    return null
  }
}

export function getConfiguredPythonProcessEnvironment(
  overrides: Record<string, string | undefined> = {},
  options: { inheritProcessEnv?: boolean } = {}
): NodeJS.ProcessEnv {
  const env = {
    ...(options.inheritProcessEnv === false ? {} : process.env),
    ...overrides,
  } as NodeJS.ProcessEnv
  const statePath = env.ASTRAFLOW_PYTHON_STATE_PATH?.trim()

  if (!statePath) {
    return env
  }

  const state = readPythonRuntimeState(statePath)

  if (!state?.ready || typeof state.executable !== "string") {
    return env
  }

  const executable = resolveExecutable(state.executable)

  if (!executable) {
    return env
  }

  env.ASTRAFLOW_PYTHON_EXECUTABLE = executable
  env.PATH = `${dirname(executable)}${delimiter}${env.PATH ?? ""}`
  env.PIP_DISABLE_PIP_VERSION_CHECK = "1"
  env.PIP_NO_INPUT = "1"

  if (state.source !== "bootstrap") {
    delete env.PYTHONHOME
  }

  if (state.isolated) {
    env.PYTHONNOUSERSITE = "1"
  } else {
    delete env.PYTHONNOUSERSITE
  }

  if (typeof state.pythonUserBase === "string" && state.pythonUserBase) {
    env.PYTHONUSERBASE = state.pythonUserBase
  } else {
    delete env.PYTHONUSERBASE
  }

  return env
}
