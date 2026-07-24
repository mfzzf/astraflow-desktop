import { spawnSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { mkdirSync } from "node:fs"
import { dirname, join, win32 } from "node:path"

const WINDOWS_SID_PATTERN = /^S-\d(?:-\d+)+$/i
const WINDOWS_SANDBOX_ANCESTOR_STATE_DIRECTORY =
  "astraflow-sandbox-ancestor-access"
const WINDOWS_SANDBOX_ANCESTOR_STATE_FILE = "leases-v1.json"
const POWERSHELL_TIMEOUT_MS = 60_000

// OpenCode canonicalizes its ACP cwd with Bun's realpath implementation.
// Unlike normal Windows traversal, that implementation opens every ancestor
// for metadata. A workspace grant on the leaf therefore is not sufficient
// when the real user's protected profile (for example AppData) is in the
// path. Grant only FILE_READ_ATTRIBUTES on strict ancestors, without
// inheritance. The workspace leaf keeps using Sandbox Runtime's refcounted
// read/write grant.
//
// The lease file and named mutex make the minimal ACE safe across concurrent
// AstraFlow and CompShare processes. Exact rules are removed when the final
// live holder exits; a later acquire also prunes holders left by a crash.
const WINDOWS_SANDBOX_ANCESTOR_ACL_SCRIPT = String.raw`
$ErrorActionPreference = "Stop"

function Convert-ToArray($value) {
  if ($null -eq $value) {
    return @()
  }
  return @($value)
}

function Test-HolderAlive($holder) {
  try {
    $holderPid = [int]$holder.pid
    if ($holderPid -le 0) {
      return $false
    }
    Get-Process -Id $holderPid -ErrorAction Stop | Out-Null
    return $true
  } catch {
    return $false
  }
}

function Get-MinimalRules($acl, $sid) {
  $readAttributes = [System.Security.AccessControl.FileSystemRights]::ReadAttributes
  $readAttributesWithSynchronize =
    $readAttributes -bor [System.Security.AccessControl.FileSystemRights]::Synchronize

  return @(
    $acl.GetAccessRules(
      $true,
      $false,
      [System.Security.Principal.SecurityIdentifier]
    ) | Where-Object {
      $_.IdentityReference.Value -eq $sid -and
      $_.AccessControlType -eq
        [System.Security.AccessControl.AccessControlType]::Allow -and
      $_.InheritanceFlags -eq
        [System.Security.AccessControl.InheritanceFlags]::None -and
      $_.PropagationFlags -eq
        [System.Security.AccessControl.PropagationFlags]::None -and
      (
        $_.FileSystemRights -eq $readAttributes -or
        $_.FileSystemRights -eq $readAttributesWithSynchronize
      )
    }
  )
}

function Add-MinimalRule($path, $sid) {
  $acl = Get-Acl -LiteralPath $path
  if ((Get-MinimalRules $acl $sid).Count -gt 0) {
    return $false
  }

  $identity =
    [System.Security.Principal.SecurityIdentifier]::new($sid)
  $rule = [System.Security.AccessControl.FileSystemAccessRule]::new(
    $identity,
    [System.Security.AccessControl.FileSystemRights]::ReadAttributes,
    [System.Security.AccessControl.InheritanceFlags]::None,
    [System.Security.AccessControl.PropagationFlags]::None,
    [System.Security.AccessControl.AccessControlType]::Allow
  )
  [void]$acl.AddAccessRule($rule)
  Set-Acl -LiteralPath $path -AclObject $acl
  return $true
}

function Remove-MinimalRule($path, $sid) {
  if (-not (Test-Path -LiteralPath $path)) {
    return
  }

  $acl = Get-Acl -LiteralPath $path
  $changed = $false
  foreach ($rule in (Get-MinimalRules $acl $sid)) {
    $acl.RemoveAccessRuleSpecific($rule)
    $changed = $true
  }
  if ($changed) {
    Set-Acl -LiteralPath $path -AclObject $acl
  }
}

function Save-State($path, $state) {
  $parent = Split-Path -Parent $path
  [System.IO.Directory]::CreateDirectory($parent) | Out-Null
  $temporary = "$path.$PID.tmp"
  $json = ConvertTo-Json $state -Depth 8 -Compress
  [System.IO.File]::WriteAllText(
    $temporary,
    $json,
    [System.Text.UTF8Encoding]::new($false)
  )
  Move-Item -LiteralPath $temporary -Destination $path -Force
}

$requestText = [Console]::In.ReadToEnd()
$request = ConvertFrom-Json $requestText
$mutex = [System.Threading.Mutex]::new(
  $false,
  "Local\AstraFlowSandboxAncestorAclV1"
)
$locked = $false

try {
  $locked = $mutex.WaitOne([TimeSpan]::FromSeconds(30))
  if (-not $locked) {
    throw "Timed out waiting for the sandbox ancestor ACL lease lock."
  }

  $state = [ordered]@{
    version = 1
    entries = @()
  }
  if (Test-Path -LiteralPath $request.statePath) {
    $loaded = ConvertFrom-Json (
      [System.IO.File]::ReadAllText($request.statePath)
    )
    if ($loaded.version -ne 1) {
      throw "Unsupported sandbox ancestor ACL lease state."
    }
    $state.entries = Convert-ToArray $loaded.entries
  }

  $liveEntries = @()
  foreach ($entry in (Convert-ToArray $state.entries)) {
    $entry.holders = @(
      Convert-ToArray $entry.holders | Where-Object {
        Test-HolderAlive $_
      }
    )
    if ($entry.holders.Count -eq 0) {
      if ($entry.created -eq $true) {
        Remove-MinimalRule $entry.path $entry.sid
      }
    } else {
      $liveEntries += $entry
    }
  }
  $state.entries = $liveEntries

  if ($request.action -eq "acquire") {
    foreach ($path in (Convert-ToArray $request.paths)) {
      $entry = $state.entries | Where-Object {
        $_.path -ieq $path -and $_.sid -eq $request.sid
      } | Select-Object -First 1

      if ($null -eq $entry) {
        $created = Add-MinimalRule $path $request.sid
        $entry = [ordered]@{
          path = $path
          sid = $request.sid
          created = $created
          holders = @()
        }
        $state.entries += $entry
      }

      $alreadyHeld = $entry.holders | Where-Object {
        $_.id -eq $request.holderId
      } | Select-Object -First 1
      if ($null -eq $alreadyHeld) {
        $entry.holders += [ordered]@{
          id = $request.holderId
          pid = [int]$request.holderPid
        }
      }
    }
  } elseif ($request.action -eq "release") {
    $remainingEntries = @()
    foreach ($entry in (Convert-ToArray $state.entries)) {
      $entry.holders = @(
        Convert-ToArray $entry.holders | Where-Object {
          $_.id -ne $request.holderId
        }
      )
      if ($entry.holders.Count -eq 0) {
        if ($entry.created -eq $true) {
          Remove-MinimalRule $entry.path $entry.sid
        }
      } else {
        $remainingEntries += $entry
      }
    }
    $state.entries = $remainingEntries
  } else {
    throw "Unknown sandbox ancestor ACL lease action."
  }

  Save-State $request.statePath $state
  [Console]::Out.Write(
    (ConvertTo-Json @{
      ok = $true
      entries = $state.entries.Count
    } -Compress)
  )
} finally {
  if ($locked) {
    $mutex.ReleaseMutex()
  }
  $mutex.Dispose()
}
`

function normalizeWindowsPathForComparison(value) {
  return win32.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US")
}

function isSameOrDescendantWindowsPath(path, root) {
  const normalizedPath = normalizeWindowsPathForComparison(path)
  const normalizedRoot = normalizeWindowsPathForComparison(root)

  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}\\`)
  )
}

export function collectWindowsSandboxAncestorMetadataPaths(
  paths,
  userProfile
) {
  if (
    !Array.isArray(paths) ||
    typeof userProfile !== "string" ||
    !win32.isAbsolute(userProfile)
  ) {
    return []
  }

  const canonicalProfile = win32.resolve(userProfile)
  const candidates = new Map()

  for (const value of paths) {
    if (
      typeof value !== "string" ||
      !win32.isAbsolute(value) ||
      !isSameOrDescendantWindowsPath(value, canonicalProfile)
    ) {
      continue
    }

    let current = win32.dirname(win32.resolve(value))
    while (
      current !== win32.dirname(current) &&
      isSameOrDescendantWindowsPath(current, canonicalProfile)
    ) {
      const key = normalizeWindowsPathForComparison(current)
      if (!candidates.has(key)) {
        candidates.set(key, current)
      }
      if (key === normalizeWindowsPathForComparison(canonicalProfile)) {
        break
      }
      current = win32.dirname(current)
    }
  }

  return [...candidates.values()].sort((left, right) => {
    const leftDepth = left.split(/[\\/]/).length
    const rightDepth = right.split(/[\\/]/).length
    return leftDepth - rightDepth || left.localeCompare(right)
  })
}

function resolvePowerShellExecutable(systemRoot) {
  return join(
    systemRoot || "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe"
  )
}

function runWindowsAncestorAclLease(request, options = {}) {
  const systemRoot =
    options.systemRoot || process.env.SystemRoot || process.env.WINDIR
  const executable = resolvePowerShellExecutable(systemRoot)
  const encodedScript = Buffer.from(
    WINDOWS_SANDBOX_ANCESTOR_ACL_SCRIPT,
    "utf16le"
  ).toString("base64")
  const result = (options.spawnSyncImpl || spawnSync)(
    executable,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      encodedScript,
    ],
    {
      encoding: "utf8",
      input: JSON.stringify(request),
      timeout: POWERSHELL_TIMEOUT_MS,
      windowsHide: true,
    }
  )

  if (result.error) {
    throw new Error(
      `Windows sandbox ancestor ACL lease failed to start: ${result.error.message}`
    )
  }
  if (result.status !== 0) {
    throw new Error(
      `Windows sandbox ancestor ACL lease exited ${result.status}: ${
        result.stderr?.trim() || result.stdout?.trim() || "unknown error"
      }`
    )
  }

  let response
  try {
    response = JSON.parse(result.stdout.trim())
  } catch {
    throw new Error(
      `Windows sandbox ancestor ACL lease returned invalid output: ${
        result.stdout?.trim() || "<empty>"
      }`
    )
  }
  if (response?.ok !== true) {
    throw new Error("Windows sandbox ancestor ACL lease was not acquired.")
  }
}

export function acquireWindowsSandboxAncestorMetadataAccess({
  paths,
  sandboxUserSid,
  userProfile = process.env.USERPROFILE,
  localAppData = process.env.LOCALAPPDATA,
  holderPid = process.pid,
  spawnSyncImpl,
  systemRoot,
}) {
  if (
    process.platform !== "win32" ||
    typeof userProfile !== "string" ||
    typeof localAppData !== "string"
  ) {
    return null
  }
  if (!WINDOWS_SID_PATTERN.test(sandboxUserSid)) {
    throw new Error("The Windows sandbox user SID is invalid.")
  }

  const ancestorPaths = collectWindowsSandboxAncestorMetadataPaths(
    paths,
    userProfile
  )
  if (ancestorPaths.length === 0) {
    return null
  }

  const statePath = join(
    localAppData,
    WINDOWS_SANDBOX_ANCESTOR_STATE_DIRECTORY,
    WINDOWS_SANDBOX_ANCESTOR_STATE_FILE
  )
  mkdirSync(dirname(statePath), { recursive: true })
  const holderId = `${holderPid}-${randomBytes(16).toString("hex")}`
  const options = { spawnSyncImpl, systemRoot }

  runWindowsAncestorAclLease(
    {
      action: "acquire",
      holderId,
      holderPid,
      paths: ancestorPaths,
      sid: sandboxUserSid,
      statePath,
    },
    options
  )

  let released = false
  return {
    paths: ancestorPaths,
    release() {
      if (released) {
        return
      }
      released = true
      runWindowsAncestorAclLease(
        {
          action: "release",
          holderId,
          holderPid,
          paths: [],
          sid: sandboxUserSid,
          statePath,
        },
        options
      )
    },
  }
}
