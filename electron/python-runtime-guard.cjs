async function ensureManagedPythonRuntimeIfNeeded({
  developerRuntimeEnvironment,
  pythonEnvironment,
}) {
  const status = await pythonEnvironment.getStatus()

  if (status.mode === "managed") {
    await developerRuntimeEnvironment.install("python")
  }

  return pythonEnvironment
}

module.exports = {
  ensureManagedPythonRuntimeIfNeeded,
}
