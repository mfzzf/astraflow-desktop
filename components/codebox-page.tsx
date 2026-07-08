"use client"

import * as React from "react"
import {
  RiCodeBoxLine,
  RiCloseLine,
  RiGithubLine,
  RiInformationLine,
  RiLoader4Line,
  RiPlayLine,
  RiRefreshLine,
  RiTerminalBoxLine,
} from "@remixicon/react"

import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useSidebar } from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

import { DEFAULT_CODEBOX_WORKSPACE_PATH } from "./codebox/types"
import {
  ApiKeyRequiredBlock,
  EmptyBlock,
  LoadingBlock,
  Panel,
  SandboxItem,
} from "./codebox/panels"
import { ConfirmActionDialog } from "./codebox/dialogs/confirm-action-dialog"
import { GithubDeviceDialog } from "./codebox/dialogs/github-device-dialog"
import { OpenVSCodeDialog } from "./codebox/dialogs/open-vscode-dialog"
import { RenameSandboxDialog } from "./codebox/dialogs/rename-sandbox-dialog"
import { WorkspaceDirectoryDialog } from "./codebox/dialogs/workspace-directory-dialog"
import { CodeBoxTerminalPanel } from "./codebox/terminal/terminal-panel"
import { useCodeBoxPageState } from "./codebox/use-codebox-page-state"

function CodeBoxPage() {
  const { t } = useI18n()
  const { open: sidebarOpen, isMobile } = useSidebar()
  const needsSidebarToggleOffset = isMobile || !sidebarOpen

  const {
    status,
    sandboxes,
    sandboxName,
    setSandboxName,
    repoUrl,
    setRepoUrl,
    apiKeys,
    selectedApiKeyId,
    isApiKeyLoading,
    isLoading,
    busyAction,
    error,
    githubFlow,
    githubDialogOpen,
    setGithubDialogOpen,
    githubMessage,
    confirmAction,
    confirmSandboxId,
    setConfirmAction,
    setConfirmSandboxId,
    editingSandbox,
    editingSandboxName,
    setEditingSandbox,
    setEditingSandboxName,
    terminalSandbox,
    setTerminalSandbox,
    workspaceSandbox,
    workspacePath,
    setWorkspacePath,
    setWorkspaceSandbox,
    sandboxFilter,
    setSandboxFilter,
    openRenameSandbox,
    openWorkspaceDialog,
    openSandboxWorkspace,
    selectApiKey,
    refresh,
    createSandbox,
    handleSandboxAction,
    prepareSandboxVSCode,
    writeSandboxSshConfig,
    saveSandboxName,
    confirmDestructiveAction,
    startGithubLogin,
    logoutGithub,
    copyText,
    closeVSCodeDialog,
    sshSandbox,
    sshAccess,
    localDependencies,
    isSshPreparing,
    isSshConfigWriting,
    isSshDependencyChecking,
    sshError,
  } = useCodeBoxPageState()

  return (
    <main className="flex h-full max-h-full min-h-0 flex-col overflow-hidden bg-background">
      <section
        className={cn(
          "flex min-h-0 flex-1 overflow-hidden",
          needsSidebarToggleOffset
            ? "px-4 pt-14 pb-4 sm:px-6 sm:pt-16"
            : "px-4 py-4 sm:px-6"
        )}
      >
        <div className="flex min-h-0 w-full flex-1 flex-col gap-3 overflow-hidden">
          {error ? (
            <Alert variant="destructive" className="shrink-0">
              <RiInformationLine />
              <AlertTitle>{t.codeboxAttentionTitle}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
            <div className="shrink-0">
              <Panel
                title={t.codeboxNewSandboxTitle}
                description={t.codeboxUsesHomeWorkspace(status?.workspacePath)}
                icon={<RiTerminalBoxLine className="size-4" aria-hidden />}
                className="shrink-0"
              >
                <p className="mb-3 text-xs text-muted-foreground">
                  {t.codeboxNewSandboxDescription}
                </p>
                <form
                  className="grid gap-3 lg:grid-cols-[minmax(0,0.65fr)_minmax(0,0.65fr)_minmax(0,1.2fr)_auto]"
                  onSubmit={createSandbox}
                >
                  <Select
                    value={selectedApiKeyId}
                    onValueChange={(value) => {
                      const nextValue = value.trim()

                      if (nextValue && nextValue !== "__empty") {
                        void selectApiKey(nextValue)
                      }
                    }}
                    disabled={
                      isApiKeyLoading ||
                      busyAction === "save-api-key"
                    }
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          isApiKeyLoading
                            ? t.codeboxLoadingApiKeys
                            : t.codeboxApiKey
                        }
                      />
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      className="max-h-80"
                      position="popper"
                    >
                      <SelectGroup>
                        {apiKeys.length === 0 ? (
                          <SelectItem value="__empty" disabled>
                            {t.codeboxNoApiKeys}
                          </SelectItem>
                        ) : (
                          apiKeys.map((apiKey) => (
                            <SelectItem key={apiKey.id} value={apiKey.id}>
                              {apiKey.name}
                            </SelectItem>
                          ))
                        )}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  <Input
                    value={sandboxName}
                    onChange={(event) => setSandboxName(event.target.value)}
                    placeholder={t.codeboxSandboxNamePlaceholder}
                    className="h-9"
                    maxLength={64}
                  />

                  <Input
                    type="url"
                    value={repoUrl}
                    onChange={(event) => setRepoUrl(event.target.value)}
                    placeholder={t.codeboxRepoPlaceholder}
                    className="h-9"
                  />

                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      busyAction === "create-sandbox" ||
                      busyAction === "save-api-key" ||
                      !selectedApiKeyId
                    }
                  >
                    {busyAction === "create-sandbox" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiPlayLine />
                    )}
                    {t.codeboxLaunch}
                  </Button>
                </form>
              </Panel>
            </div>

            <Panel
              title={t.codeboxSandboxesTitle}
              description={t.codeboxSandboxesShown(sandboxes.length)}
              icon={<RiCodeBoxLine className="size-4" aria-hidden />}
              className="flex min-h-0 flex-1 flex-col"
              bodyClassName="min-h-0 flex-1"
              action={
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => void refresh()}
                    disabled={isLoading}
                    aria-label={t.codeboxRefreshSandboxes}
                  >
                    <RiRefreshLine
                      className={cn(isLoading && "animate-spin")}
                    />
                  </Button>
                  <Select
                    value={sandboxFilter}
                    onValueChange={(value) =>
                      setSandboxFilter(value as "all" | "running" | "paused")
                    }
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">
                          {t.codeboxFilterAll}
                        </SelectItem>
                        <SelectItem value="running">
                          {t.codeboxFilterRunning}
                        </SelectItem>
                        <SelectItem value="paused">
                          {t.codeboxFilterPaused}
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              }
            >
              <div className="flex max-h-full min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                {isLoading && sandboxes.length === 0 ? (
                  <LoadingBlock />
                ) : status && !status.modelverseApiKey.configured ? (
                  <ApiKeyRequiredBlock />
                ) : sandboxes.length === 0 ? (
                  <EmptyBlock text={t.codeboxNoSandboxes} />
                ) : (
                  sandboxes.map((sandbox) => (
                    <SandboxItem
                      key={sandbox.sandboxId}
                      sandbox={sandbox}
                      busyAction={busyAction}
                      sshBusy={
                        (isSshPreparing || isSshDependencyChecking) &&
                        sshSandbox?.sandboxId === sandbox.sandboxId
                      }
                      onCopy={copyText}
                      onAction={handleSandboxAction}
                      onRename={openRenameSandbox}
                      onOpenWorkspace={openWorkspaceDialog}
                      onOpenTerminal={setTerminalSandbox}
                      onOpenVSCode={(item) => void prepareSandboxVSCode(item)}
                    />
                  ))
                )}
              </div>
            </Panel>

            <Panel
              title="GitHub"
              description={
                status?.github.configured
                  ? (status.github.login ?? t.codeboxGithubConnectedLabel)
                  : t.codeboxGithubDeviceFlow
              }
              icon={<RiGithubLine className="size-4" aria-hidden />}
              className="shrink-0"
              action={
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    onClick={() => void startGithubLogin()}
                    disabled={busyAction === "github-login"}
                  >
                    {busyAction === "github-login" ? (
                      <RiLoader4Line className="animate-spin" />
                    ) : (
                      <RiGithubLine />
                    )}
                    {status?.github.configured
                      ? t.codeboxReconnect
                      : t.codeboxConnect}
                  </Button>
                  {status?.github.configured ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void logoutGithub()}
                      disabled={busyAction === "github-logout"}
                    >
                      <RiCloseLine />
                      {t.logout}
                    </Button>
                  ) : null}
                </div>
              }
            >
              {null}
            </Panel>
          </div>
        </div>
      </section>

      <CodeBoxTerminalPanel
        sandbox={terminalSandbox}
        onClose={() => setTerminalSandbox(null)}
      />

      <GithubDeviceDialog
        open={githubDialogOpen}
        onOpenChange={setGithubDialogOpen}
        flow={githubFlow}
        message={githubMessage}
        onCopy={copyText}
      />
      <ConfirmActionDialog
        action={confirmAction}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmSandboxId("")
            setConfirmAction(null)
          }
        }}
        confirmSandboxId={confirmSandboxId}
        onConfirmSandboxIdChange={setConfirmSandboxId}
        onConfirm={() => void confirmDestructiveAction()}
      />
      <RenameSandboxDialog
        sandbox={editingSandbox}
        value={editingSandboxName}
        busy={Boolean(
          editingSandbox && busyAction === `rename:${editingSandbox.sandboxId}`
        )}
        onValueChange={setEditingSandboxName}
        onOpenChange={(open) => {
          if (!open) {
            setEditingSandbox(null)
            setEditingSandboxName("")
          }
        }}
        onSave={() => void saveSandboxName()}
      />
      <WorkspaceDirectoryDialog
        key={workspaceSandbox?.sandboxId ?? "workspace-directory-dialog"}
        sandbox={workspaceSandbox}
        value={workspacePath}
        defaultPath={status?.workspacePath || DEFAULT_CODEBOX_WORKSPACE_PATH}
        onValueChange={setWorkspacePath}
        onOpenChange={(open) => {
          if (!open) {
            setWorkspaceSandbox(null)
            setWorkspacePath(DEFAULT_CODEBOX_WORKSPACE_PATH)
          }
        }}
        onOpen={openSandboxWorkspace}
      />
      <OpenVSCodeDialog
        sandbox={sshSandbox}
        access={sshAccess}
        localDependencies={localDependencies}
        busy={isSshPreparing}
        configWriting={isSshConfigWriting}
        checkingDependencies={isSshDependencyChecking}
        error={sshError}
        onCopy={copyText}
        onRetry={() => {
          if (sshSandbox) {
            void prepareSandboxVSCode(sshSandbox)
          }
        }}
        onWriteConfig={() => void writeSandboxSshConfig()}
        onOpenVSCode={(access) => {
          const opened = window.open(access.vscodeUri, "_blank", "noopener,noreferrer")

          if (opened) {
            opened.opener = null
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            closeVSCodeDialog()
          }
        }}
      />
    </main>
  )
}

export { CodeBoxPage }
