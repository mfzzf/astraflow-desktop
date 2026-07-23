import * as React from "react"
import { toast } from "sonner"

import { useChannelConfig } from "@/components/channel-config-provider"
import { useI18n } from "@/components/i18n-provider"
import { resolveCompShareApiKeyOptions } from "./api-key-options"
import { UCLOUD_PROJECT_CHANGED_EVENT } from "@/lib/project-selection"
import {
  DEFAULT_CODEBOX_WORKSPACE_PATH,
  type CodeBoxLocalDependencyStatus,
  type CodeBoxSshAccess,
  type CodeBoxSandbox,
  type CodeBoxStatus,
  type ConfirmAction,
  type CompShareApiKeysResponse,
  type GithubDeviceFlow,
  type GithubPollResult,
  type ModelverseApiKeyOption,
  type ModelverseApiKeysResponse,
  type SaveModelverseApiKeyResponse,
  type SandboxFilter,
} from "./types"
import {
  ApiRequestError,
  apiRequest,
  createWorkspaceUrl,
  writeClipboard,
} from "./utils"

export function useCodeBoxPageState() {
  const { t } = useI18n()
  const channelConfig = useChannelConfig()
  const isCompShare = channelConfig.slug.trim().toLowerCase() === "compshare"

  const [status, setStatus] = React.useState<CodeBoxStatus | null>(null)
  const [sandboxes, setSandboxes] = React.useState<CodeBoxSandbox[]>([])
  const [sandboxName, setSandboxName] = React.useState("")
  const [repoUrl, setRepoUrl] = React.useState("")
  const [apiKeys, setApiKeys] = React.useState<ModelverseApiKeyOption[]>([])
  const [selectedApiKeyId, setSelectedApiKeyId] = React.useState("")
  const [isApiKeyLoading, setIsApiKeyLoading] = React.useState(true)
  const [sandboxFilter, setSandboxFilter] = React.useState<SandboxFilter>("all")
  const [isLoading, setIsLoading] = React.useState(true)
  const [busyAction, setBusyAction] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [githubFlow, setGithubFlow] = React.useState<GithubDeviceFlow | null>(
    null
  )
  const [githubDialogOpen, setGithubDialogOpen] = React.useState(false)
  const [githubMessage, setGithubMessage] = React.useState("")
  const [confirmAction, setConfirmAction] =
    React.useState<ConfirmAction | null>(null)
  const [confirmSandboxId, setConfirmSandboxId] = React.useState("")
  const [editingSandbox, setEditingSandbox] =
    React.useState<CodeBoxSandbox | null>(null)
  const [editingSandboxName, setEditingSandboxName] = React.useState("")
  const [workspaceSandbox, setWorkspaceSandbox] =
    React.useState<CodeBoxSandbox | null>(null)
  const [workspacePath, setWorkspacePath] = React.useState(
    DEFAULT_CODEBOX_WORKSPACE_PATH
  )
  const [terminalSandbox, setTerminalSandbox] =
    React.useState<CodeBoxSandbox | null>(null)
  const [sshSandbox, setSshSandbox] = React.useState<CodeBoxSandbox | null>(
    null
  )
  const [sshAccess, setSshAccess] = React.useState<CodeBoxSshAccess | null>(
    null
  )
  const [localDependencies, setLocalDependencies] =
    React.useState<CodeBoxLocalDependencyStatus | null>(null)
  const [sshError, setSshError] = React.useState<string | null>(null)
  const [isSshPreparing, setIsSshPreparing] = React.useState(false)
  const [isSshConfigWriting, setIsSshConfigWriting] = React.useState(false)
  const [isSshDependencyChecking, setIsSshDependencyChecking] =
    React.useState(false)
  const activeSshSandboxIdRef = React.useRef<string | null>(null)

  const showNotice = React.useCallback((message: string) => {
    toast.success(message)
  }, [])

  const copyText = React.useCallback(
    async (value: string | null | undefined) => {
      if (!value) {
        return false
      }

      return writeClipboard(value)
    },
    []
  )

  const loadData = React.useCallback(async () => {
    setError(null)
    setIsApiKeyLoading(true)

    try {
      const nextStatus = await apiRequest<CodeBoxStatus>(
        "/api/codebox/status",
        undefined,
        t.requestFailed
      )
      let nextApiKeys: ModelverseApiKeyOption[] = []
      let selectedApiKey: ModelverseApiKeyOption | null = null
      let apiKeyProjectId = nextStatus.modelverseApiKey.projectId

      if (isCompShare) {
        const [personalKeys, teamKeys] = await Promise.all([
          apiRequest<CompShareApiKeysResponse>(
            "/api/compshare/keys?isTeam=false",
            undefined,
            t.requestFailed
          ),
          apiRequest<CompShareApiKeysResponse>(
            "/api/compshare/keys?isTeam=true",
            undefined,
            t.requestFailed
          ),
        ])
        const resolvedKeys = resolveCompShareApiKeyOptions([
          personalKeys,
          teamKeys,
        ])
        nextApiKeys = resolvedKeys.items
        selectedApiKey = resolvedKeys.selected
        apiKeyProjectId = "compshare"
      } else {
        let apiKeyData: ModelverseApiKeysResponse | null = null

        try {
          apiKeyData = await apiRequest<ModelverseApiKeysResponse>(
            "/api/studio/modelverse-api-keys",
            undefined,
            t.requestFailed
          )
        } catch (apiKeyError) {
          if (
            !(apiKeyError instanceof ApiRequestError) ||
            apiKeyError.status !== 403
          ) {
            throw apiKeyError
          }
        }

        const canUseCurrentApiKeyFallback =
          !apiKeyData || nextStatus.modelverseApiKey.projectId === "manual"
        const currentApiKey =
          canUseCurrentApiKeyFallback &&
          nextStatus.modelverseApiKey.configured &&
          nextStatus.modelverseApiKey.id
            ? {
                id: nextStatus.modelverseApiKey.id,
                name: nextStatus.modelverseApiKey.name ?? t.codeboxApiKey,
              }
            : null
        selectedApiKey = apiKeyData?.selected ?? currentApiKey
        const apiKeyItems = apiKeyData?.items ?? []
        nextApiKeys =
          currentApiKey &&
          !apiKeyItems.some((apiKey) => apiKey.id === currentApiKey.id)
            ? [currentApiKey, ...apiKeyItems]
            : apiKeyItems
        apiKeyProjectId =
          apiKeyData?.projectId ?? nextStatus.modelverseApiKey.projectId
      }

      const apiKeyConfigured = Boolean(selectedApiKey)

      setStatus({
        ...nextStatus,
        modelverseApiKey: {
          ...nextStatus.modelverseApiKey,
          configured: apiKeyConfigured,
          id: selectedApiKey?.id ?? null,
          name: selectedApiKey?.name ?? null,
          projectId: apiKeyProjectId,
        },
      })
      setApiKeys(nextApiKeys)
      setSelectedApiKeyId(selectedApiKey?.id ?? "")
      if (!apiKeyConfigured) {
        setSandboxes([])
        return
      }

      const nextSandboxes = await apiRequest<CodeBoxSandbox[]>(
        `/api/codebox/sandboxes?state=${sandboxFilter}`,
        undefined,
        t.requestFailed
      )
      setSandboxes(nextSandboxes)
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : t.codeboxLoadFailed
      )
    } finally {
      setIsLoading(false)
      setIsApiKeyLoading(false)
    }
  }, [isCompShare, sandboxFilter, t])

  React.useEffect(() => {
    queueMicrotask(() => {
      void loadData()
    })
  }, [loadData])

  React.useEffect(() => {
    function handleProjectChanged() {
      setIsLoading(true)
      setSelectedApiKeyId("")
      void loadData()
    }

    window.addEventListener(UCLOUD_PROJECT_CHANGED_EVENT, handleProjectChanged)

    return () => {
      window.removeEventListener(
        UCLOUD_PROJECT_CHANGED_EVENT,
        handleProjectChanged
      )
    }
  }, [loadData])

  React.useEffect(() => {
    if (!githubFlow) {
      return
    }

    const activeFlow = githubFlow
    let cancelled = false
    let timer: number | undefined
    let nextIntervalSeconds = Math.max(3, activeFlow.interval)

    async function pollGithub() {
      try {
        const result = await apiRequest<GithubPollResult>(
          `/api/codebox/github/device/${activeFlow.flowId}/poll`,
          {
            method: "POST",
          },
          t.requestFailed
        )

        if (cancelled) {
          return
        }

        if (result.status === "pending") {
          if (result.interval) {
            nextIntervalSeconds = Math.max(3, result.interval)
          }

          setGithubMessage(t.codeboxWaitingGithub)
          timer = window.setTimeout(
            () => void pollGithub(),
            nextIntervalSeconds * 1000
          )
          return
        }

        if (result.status === "complete") {
          setStatus((current) =>
            current
              ? {
                  ...current,
                  github: result.github,
                }
              : current
          )
          setGithubMessage(t.codeboxGithubConnected)
          setGithubFlow(null)
          setGithubDialogOpen(false)
          showNotice(t.codeboxGithubInjected)
          void loadData()
          return
        }

        setGithubMessage(result.message ?? t.codeboxGithubStopped)
        setGithubFlow(null)
      } catch (pollError) {
        if (!cancelled) {
          setGithubMessage(
            pollError instanceof Error
              ? pollError.message
              : t.codeboxGithubFailed
          )
          setGithubFlow(null)
        }
      }
    }

    queueMicrotask(() => {
      setGithubMessage(t.codeboxWaitingGithub)
    })
    timer = window.setTimeout(
      () => void pollGithub(),
      nextIntervalSeconds * 1000
    )

    return () => {
      cancelled = true
      if (timer !== undefined) {
        window.clearTimeout(timer)
      }
    }
  }, [githubFlow, loadData, showNotice, t])

  const refresh = React.useCallback(async () => {
    setIsLoading(true)
    await loadData()
  }, [loadData])

  const selectApiKey = React.useCallback(
    async (apiKeyId: string) => {
      const normalizedApiKeyId = apiKeyId.trim()

      if (!normalizedApiKeyId || normalizedApiKeyId === "__empty") {
        return
      }

      if (normalizedApiKeyId === selectedApiKeyId) {
        return
      }

      const selectedOption = apiKeys.find(
        (apiKey) => apiKey.id === normalizedApiKeyId
      )
      const previousApiKeyId = selectedApiKeyId
      setSelectedApiKeyId(normalizedApiKeyId)
      setBusyAction("save-api-key")
      setError(null)

      try {
        if (isCompShare) {
          await apiRequest("/api/compshare/keys/selected", {
            method: "PUT",
            body: JSON.stringify({ keyCode: normalizedApiKeyId }),
          })
          showNotice(
            t.codeboxApiKeySelected(selectedOption?.name ?? normalizedApiKeyId)
          )
        } else {
          const saved = await apiRequest<SaveModelverseApiKeyResponse>(
            "/api/studio/modelverse-api-keys",
            {
              method: "POST",
              body: JSON.stringify({
                apiKeyId: normalizedApiKeyId,
              }),
            },
            t.requestFailed
          )

          showNotice(t.codeboxApiKeySelected(saved.selected.name))
        }
        await loadData()
      } catch (selectError) {
        setSelectedApiKeyId(previousApiKeyId)
        setError(
          selectError instanceof Error
            ? selectError.message
            : t.codeboxApiKeySelectFailed
        )
      } finally {
        setBusyAction(null)
      }
    },
    [apiKeys, isCompShare, loadData, selectedApiKeyId, showNotice, t]
  )

  const createSandbox = React.useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault()

      setBusyAction("create-sandbox")
      setError(null)

      try {
        const sandbox = await apiRequest<CodeBoxSandbox>(
          "/api/codebox/sandboxes",
          {
            method: "POST",
            body: JSON.stringify({
              name: sandboxName,
              repoUrl,
            }),
          },
          t.requestFailed
        )

        setSandboxes((current) => [sandbox, ...current])
        setSandboxName("")
        setRepoUrl("")
        const passwordCopied = await copyText(sandbox.password)
        showNotice(t.codeboxSandboxReady(passwordCopied))
      } catch (createError) {
        setError(
          createError instanceof Error
            ? createError.message
            : t.codeboxSandboxCreateFailed
        )
      } finally {
        setBusyAction(null)
      }
    },
    [copyText, repoUrl, sandboxName, showNotice, t]
  )

  const runSandboxAction = React.useCallback(
    async (sandbox: CodeBoxSandbox, action: "pause" | "resume" | "kill") => {
      setBusyAction(`${action}:${sandbox.sandboxId}`)
      setError(null)

      try {
        await apiRequest<{ sandboxId: string }>(
          `/api/codebox/sandboxes/${sandbox.sandboxId}/${action}`,
          {
            method: "POST",
          },
          t.requestFailed
        )
        await loadData()
        showNotice(t.codeboxSandboxActionCompleted(action))
      } catch (actionError) {
        setError(
          actionError instanceof Error
            ? actionError.message
            : t.codeboxSandboxActionFailed(action)
        )
      } finally {
        setBusyAction(null)
      }
    },
    [loadData, showNotice, t]
  )

  const handleSandboxAction = React.useCallback(
    async (sandbox: CodeBoxSandbox, action: "pause" | "resume" | "kill") => {
      if (action === "kill") {
        setConfirmSandboxId("")
        setConfirmAction({ kind: "sandbox", sandbox })
        return
      }

      await runSandboxAction(sandbox, action)
    },
    [runSandboxAction]
  )

  const openRenameSandbox = React.useCallback((sandbox: CodeBoxSandbox) => {
    setEditingSandbox(sandbox)
    setEditingSandboxName(sandbox.name ?? "")
  }, [])

  const openWorkspaceDialog = React.useCallback(
    (sandbox: CodeBoxSandbox) => {
      setWorkspaceSandbox(sandbox)
      setWorkspacePath(
        sandbox.workspacePath ||
          status?.workspacePath ||
          DEFAULT_CODEBOX_WORKSPACE_PATH
      )
    },
    [status?.workspacePath]
  )

  const openSandboxWorkspace = React.useCallback(
    (path: string) => {
      const sandbox = workspaceSandbox

      if (!sandbox) {
        return
      }

      try {
        const url = createWorkspaceUrl(sandbox, path)
        const opened = window.open(url, "_blank", "noopener,noreferrer")

        if (opened) {
          opened.opener = null
        }

        setWorkspaceSandbox(null)
        setWorkspacePath(DEFAULT_CODEBOX_WORKSPACE_PATH)
      } catch {
        setError(t.codeboxOpenFailed)
      }
    },
    [t, workspaceSandbox]
  )

  const getSandboxWorkspacePath = React.useCallback(
    (sandbox: CodeBoxSandbox) => {
      return (
        sandbox.workspacePath ||
        status?.workspacePath ||
        DEFAULT_CODEBOX_WORKSPACE_PATH
      )
    },
    [status?.workspacePath]
  )

  const requestSandboxSshAccess = React.useCallback(
    async (
      sandbox: CodeBoxSandbox,
      options: {
        prepareRemote?: boolean
        writeConfig?: boolean
      } = {}
    ) => {
      return apiRequest<CodeBoxSshAccess>(
        `/api/codebox/sandboxes/${encodeURIComponent(sandbox.sandboxId)}/ssh`,
        {
          method: "POST",
          body: JSON.stringify({
            prepareRemote: options.prepareRemote ?? false,
            writeConfig: options.writeConfig ?? false,
            workspacePath: getSandboxWorkspacePath(sandbox),
          }),
        },
        t.codeboxSshPrepareFailed
      )
    },
    [getSandboxWorkspacePath, t]
  )

  const prepareSandboxVSCode = React.useCallback(
    async (sandbox: CodeBoxSandbox) => {
      activeSshSandboxIdRef.current = sandbox.sandboxId
      setSshSandbox(sandbox)
      setSshAccess(null)
      setLocalDependencies(null)
      setSshError(null)
      setIsSshConfigWriting(false)
      setIsSshDependencyChecking(true)

      try {
        const dependencies = await apiRequest<CodeBoxLocalDependencyStatus>(
          "/api/codebox/local-dependencies",
          undefined,
          t.codeboxSshDependencyCheckFailed
        )

        if (activeSshSandboxIdRef.current !== sandbox.sandboxId) {
          return
        }

        setLocalDependencies(dependencies)

        if (!dependencies.websocat.installed) {
          return
        }
      } catch (dependencyError) {
        if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
          setSshError(
            dependencyError instanceof Error
              ? dependencyError.message
              : t.codeboxSshDependencyCheckFailed
          )
        }
        return
      } finally {
        if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
          setIsSshDependencyChecking(false)
        }
      }

      setIsSshPreparing(true)
      try {
        const access = await requestSandboxSshAccess(sandbox)

        if (activeSshSandboxIdRef.current !== sandbox.sandboxId) {
          return
        }

        setSshAccess(access)

        const preparedAccess = await requestSandboxSshAccess(sandbox, {
          prepareRemote: true,
        })

        if (activeSshSandboxIdRef.current !== sandbox.sandboxId) {
          return
        }

        setSshAccess((current) =>
          current?.sandboxId === preparedAccess.sandboxId
            ? {
                ...preparedAccess,
                sshConfigPath:
                  current.sshConfigPath ?? preparedAccess.sshConfigPath,
              }
            : current
        )
        showNotice(t.codeboxSshReady)
      } catch (sshPrepareError) {
        if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
          setSshError(
            sshPrepareError instanceof Error
              ? sshPrepareError.message
              : t.codeboxSshPrepareFailed
          )
        }
      } finally {
        if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
          setIsSshPreparing(false)
        }
      }
    },
    [requestSandboxSshAccess, showNotice, t]
  )

  const writeSandboxSshConfig = React.useCallback(async () => {
    const sandbox = sshSandbox

    if (!sandbox) {
      return
    }

    setIsSshConfigWriting(true)
    setSshError(null)

    try {
      const access = await requestSandboxSshAccess(sandbox, {
        writeConfig: true,
      })

      if (activeSshSandboxIdRef.current !== sandbox.sandboxId) {
        return
      }

      setSshAccess((current) =>
        current?.sandboxId === access.sandboxId
          ? {
              ...access,
              remoteReady: current.remoteReady || access.remoteReady,
            }
          : access
      )

      if (access.sshConfigPath) {
        showNotice(t.codeboxSshConfigInstalled(access.sshConfigPath))
      }
    } catch (writeError) {
      if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
        setSshError(
          writeError instanceof Error
            ? writeError.message
            : t.codeboxSshConfigWriteFailed
        )
      }
    } finally {
      if (activeSshSandboxIdRef.current === sandbox.sandboxId) {
        setIsSshConfigWriting(false)
      }
    }
  }, [requestSandboxSshAccess, showNotice, t, sshSandbox])

  const openVSCode = React.useCallback((access: CodeBoxSshAccess) => {
    const opened = window.open(
      access.vscodeUri,
      "_blank",
      "noopener,noreferrer"
    )

    if (opened) {
      opened.opener = null
    }
  }, [])

  const saveSandboxName = React.useCallback(async () => {
    const sandbox = editingSandbox

    if (!sandbox) {
      return
    }

    setBusyAction(`rename:${sandbox.sandboxId}`)
    setError(null)

    try {
      const updated = await apiRequest<CodeBoxSandbox>(
        `/api/codebox/sandboxes/${encodeURIComponent(sandbox.sandboxId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            name: editingSandboxName,
          }),
        },
        t.requestFailed
      )

      setSandboxes((current) =>
        current.map((item) =>
          item.sandboxId === updated.sandboxId ? updated : item
        )
      )
      setEditingSandbox(null)
      setEditingSandboxName("")
      showNotice(t.codeboxSandboxNameUpdated)
    } catch (renameError) {
      setError(
        renameError instanceof Error
          ? renameError.message
          : t.codeboxSandboxNameUpdateFailed
      )
    } finally {
      setBusyAction(null)
    }
  }, [editingSandbox, editingSandboxName, showNotice, t])

  const confirmDestructiveAction = React.useCallback(async () => {
    const action = confirmAction

    if (!action) {
      return
    }

    setConfirmAction(null)
    setConfirmSandboxId("")

    await runSandboxAction(action.sandbox, "kill")
  }, [confirmAction, runSandboxAction])

  const startGithubLogin = React.useCallback(async () => {
    setBusyAction("github-login")
    setError(null)
    setGithubMessage("")

    try {
      const flow = await apiRequest<GithubDeviceFlow>(
        "/api/codebox/github/device",
        {
          method: "POST",
        },
        t.requestFailed
      )

      setGithubFlow(flow)
      setGithubDialogOpen(true)
      setGithubMessage(t.codeboxWaitingGithub)
    } catch (loginError) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : t.codeboxGithubLoginFailed
      )
    } finally {
      setBusyAction(null)
    }
  }, [t])

  const logoutGithub = React.useCallback(async () => {
    setBusyAction("github-logout")
    setError(null)

    try {
      const github = await apiRequest<CodeBoxStatus["github"]>(
        "/api/codebox/github/logout",
        {
          method: "POST",
        },
        t.requestFailed
      )

      setStatus((current) =>
        current
          ? {
              ...current,
              github,
            }
          : current
      )
      showNotice(t.codeboxGithubRemoved)
    } catch (logoutError) {
      setError(
        logoutError instanceof Error
          ? logoutError.message
          : t.codeboxGithubLogoutFailed
      )
    } finally {
      setBusyAction(null)
    }
  }, [showNotice, t])

  const closeVSCodeDialog = React.useCallback(() => {
    activeSshSandboxIdRef.current = null
    setSshSandbox(null)
    setSshAccess(null)
    setLocalDependencies(null)
    setSshError(null)
    setIsSshPreparing(false)
    setIsSshConfigWriting(false)
    setIsSshDependencyChecking(false)
  }, [])

  return {
    status,
    setStatus,
    sandboxes,
    setSandboxes,
    sandboxName,
    setSandboxName,
    repoUrl,
    setRepoUrl,
    apiKeys,
    setApiKeys,
    selectedApiKeyId,
    setSelectedApiKeyId,
    isApiKeyLoading,
    setIsApiKeyLoading,
    sandboxFilter,
    setSandboxFilter,
    isLoading,
    setIsLoading,
    busyAction,
    setBusyAction,
    error,
    setError,
    githubFlow,
    setGithubFlow,
    githubDialogOpen,
    setGithubDialogOpen,
    githubMessage,
    setGithubMessage,
    confirmAction,
    setConfirmAction,
    confirmSandboxId,
    setConfirmSandboxId,
    editingSandbox,
    setEditingSandbox,
    editingSandboxName,
    setEditingSandboxName,
    workspaceSandbox,
    setWorkspaceSandbox,
    workspacePath,
    setWorkspacePath,
    terminalSandbox,
    setTerminalSandbox,
    sshSandbox,
    setSshSandbox,
    sshAccess,
    setSshAccess,
    localDependencies,
    setLocalDependencies,
    sshError,
    setSshError,
    isSshPreparing,
    setIsSshPreparing,
    isSshConfigWriting,
    setIsSshConfigWriting,
    isSshDependencyChecking,
    setIsSshDependencyChecking,
    refresh,
    selectApiKey,
    createSandbox,
    runSandboxAction,
    handleSandboxAction,
    openRenameSandbox,
    openWorkspaceDialog,
    openSandboxWorkspace,
    prepareSandboxVSCode,
    writeSandboxSshConfig,
    saveSandboxName,
    confirmDestructiveAction,
    startGithubLogin,
    logoutGithub,
    copyText,
    openVSCode,
    closeVSCodeDialog,
    activeSshSandboxIdRef,
  }
}
