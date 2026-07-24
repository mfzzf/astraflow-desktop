export const WINDOWS_SANDBOX_PROFILE_ID_PATTERN = /^[0-9a-f]{32}$/

const WINDOWS_SANDBOX_PROFILE_ROOT = ".astraflow\\sandbox-profiles"

export function createWindowsSandboxProfileCommand(command, profileId) {
  if (
    typeof command !== "string" ||
    !command.trim() ||
    !WINDOWS_SANDBOX_PROFILE_ID_PATTERN.test(profileId)
  ) {
    throw new Error("Windows sandbox profile request is invalid.")
  }

  // srt-win starts the inner command with the dedicated srt-sandbox
  // account's real profile. Build the session profile only after that user
  // boundary has been crossed: host-side APPDATA/USERPROFILE paths cannot be
  // safely probed by runtimes that lstat every ancestor.
  const root = `%USERPROFILE%\\${WINDOWS_SANDBOX_PROFILE_ROOT}\\${profileId}`
  const directories = [
    `${root}\\.claude`,
    `${root}\\.config\\opencode`,
    `${root}\\AppData\\Local`,
    `${root}\\AppData\\Roaming`,
    `${root}\\cache\\python`,
    `${root}\\data`,
    `${root}\\state`,
    `${root}\\tmp`,
  ]
  const bootstrap = directories.flatMap((directory) => [
    `if not exist "${directory}" mkdir "${directory}"`,
    `if not exist "${directory}" exit /b 126`,
  ])

  bootstrap.push(
    `set "ANTHROPIC_CONFIG_DIR=${root}\\.claude"`,
    `set "APPDATA=${root}\\AppData\\Roaming"`,
    `set "CLAUDE_CONFIG_DIR=${root}\\.claude"`,
    `set "CODEX_HOME=${root}\\.codex"`,
    `set "HOME=${root}"`,
    `set "LOCALAPPDATA=${root}\\AppData\\Local"`,
    `set "NPM_CONFIG_USERCONFIG=${root}\\.npmrc"`,
    `set "OPENCODE_CONFIG_DIR=${root}\\.config\\opencode"`,
    `set "PYTHONPYCACHEPREFIX=${root}\\cache\\python"`,
    `set "TEMP=${root}\\tmp"`,
    `set "TMP=${root}\\tmp"`,
    `set "XDG_CACHE_HOME=${root}\\cache"`,
    `set "XDG_CONFIG_HOME=${root}\\.config"`,
    `set "XDG_DATA_HOME=${root}\\data"`,
    `set "XDG_STATE_HOME=${root}\\state"`,
    // Set USERPROFILE last so every %USERPROFILE% expansion above resolves
    // against the original srt-sandbox profile with either cmd expansion
    // strategy (whole-line or command-at-a-time).
    `set "USERPROFILE=${root}"`,
    command
  )

  // Use unconditional separators plus explicit post-mkdir existence checks.
  // This remains race-safe when two processes resume the same session and
  // fails closed before the Agent starts if the profile cannot be created.
  return bootstrap.join(" & ")
}
