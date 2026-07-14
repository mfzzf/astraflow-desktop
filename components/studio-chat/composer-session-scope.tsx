"use client"

import * as React from "react"
import { RiLoader4Line } from "@remixicon/react"
import {
  Cloud,
  Folder,
  FolderPlus,
  GitBranch,
  Laptop,
  MessageSquare,
} from "lucide-react"

import type { useI18n } from "@/components/i18n-provider"
import { PanelSearchInput } from "@/components/search-input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from "@/components/ui/select"
import type {
  StudioLocalProjectWithGitInfo,
  StudioWorkspace,
} from "@/lib/studio-types"
import { cn } from "@/lib/utils"

import { SelectOptionRow } from "./composer-parts"
import { formatProjectGitMeta } from "./composer-utils"

const WORKSPACE_ADD_VALUE = "__add_workspace__"
const WORKSPACE_EMPTY_VALUE = "__empty_workspace__"
const WORKSPACE_LOADING_VALUE = "__loading_workspaces__"
const WORKSPACE_NONE_VALUE = "__no_workspace__"

type ComposerSessionScopeControlsProps = {
  showSessionScopeControls: boolean
  workspace: StudioWorkspace | null
  workspaces: StudioWorkspace[]
  workspacesLoading: boolean
  onWorkspaceChange: (workspaceId: string | null) => void
  onAddWorkspace: () => void
  isBusy: boolean
  selectedProject: StudioLocalProjectWithGitInfo | null
  t: ReturnType<typeof useI18n>["t"]
}

export function ComposerSessionScopeControls({
  showSessionScopeControls,
  workspace,
  workspaces,
  workspacesLoading,
  onWorkspaceChange,
  onAddWorkspace,
  isBusy,
  selectedProject,
  t,
}: ComposerSessionScopeControlsProps) {
  const [workspaceSearch, setWorkspaceSearch] = React.useState("")
  const normalizedSearch = workspaceSearch.trim().toLocaleLowerCase()
  const filteredWorkspaces = React.useMemo(
    () =>
      normalizedSearch
        ? workspaces.filter((candidate) =>
            `${candidate.name} ${candidate.rootPath}`
              .toLocaleLowerCase()
              .includes(normalizedSearch)
          )
        : workspaces,
    [normalizedSearch, workspaces]
  )
  const localWorkspaces = filteredWorkspaces.filter(
    (candidate) => candidate.type === "local"
  )
  const sandboxWorkspaces = filteredWorkspaces.filter(
    (candidate) => candidate.type === "sandbox"
  )

  if (!showSessionScopeControls) {
    return null
  }

  function handleSelectValueChange(value: string) {
    if (value === WORKSPACE_ADD_VALUE) {
      onAddWorkspace()
      return
    }

    if (value === WORKSPACE_NONE_VALUE) {
      onWorkspaceChange(null)
      return
    }

    onWorkspaceChange(value)
  }

  function renderWorkspaceOption(candidate: StudioWorkspace) {
    const isSandbox = candidate.type === "sandbox"

    return (
      <SelectItem
        key={candidate.id}
        value={candidate.id}
        textValue={`${candidate.name} ${candidate.rootPath}`}
        className="h-8 pr-10"
      >
        <SelectOptionRow
          description={candidate.rootPath}
          icon={
            isSandbox ? (
              <Cloud aria-hidden className="size-4 text-sky-500" />
            ) : (
              <Folder aria-hidden className="size-4 text-muted-foreground" />
            )
          }
          label={candidate.name}
          meta={
            isSandbox
              ? t.studioWorkspaceSandboxBadge
              : t.studioWorkspaceTypeLocal
          }
        />
      </SelectItem>
    )
  }

  function renderNoWorkspaceOption() {
    return (
      <SelectItem
        value={WORKSPACE_NONE_VALUE}
        className="h-8 pr-10"
      >
        <SelectOptionRow
          description={t.studioWorkspaceNoneDescription}
          icon={
            <MessageSquare
              aria-hidden
              className="size-4 text-muted-foreground"
            />
          }
          label={t.studioWorkspaceNone}
          meta={t.studioWorkspaceTypeLocal}
        />
      </SelectItem>
    )
  }

  const WorkspaceIcon = workspace
    ? workspace.type === "sandbox"
      ? Cloud
      : Folder
    : MessageSquare

  return (
    <div className="flex min-h-9 w-full min-w-0 items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground">
      <Select
        value={workspace?.id ?? WORKSPACE_NONE_VALUE}
        onValueChange={handleSelectValueChange}
        disabled={isBusy}
      >
        <SelectTrigger
          data-tour-id="studio-composer-project"
          size="sm"
          className="h-6 w-fit max-w-60 rounded-lg border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/70"
          aria-label={t.studioWorkspaceSelect}
          title={workspace?.rootPath ?? t.studioWorkspaceNoneDescription}
        >
          {workspacesLoading && !workspace ? (
            <RiLoader4Line aria-hidden className="size-3.5 animate-spin" />
          ) : (
            <WorkspaceIcon
              aria-hidden
              className={cn(
                "size-3.5",
                workspace?.type === "sandbox"
                  ? "text-sky-500"
                  : "text-muted-foreground"
              )}
            />
          )}
          <span
            className={cn(
              "truncate",
              workspace && "font-medium text-foreground"
            )}
          >
            {workspace?.name ?? t.studioWorkspaceNone}
          </span>
        </SelectTrigger>
        <SelectContent
          position="popper"
          side="top"
          align="start"
          className="w-[min(24rem,var(--radix-select-content-available-width))]"
        >
          <div className="sticky top-0 z-10 border-b bg-popover p-1.5">
            <PanelSearchInput
              onKeyDown={(event) => event.stopPropagation()}
              onValueChange={setWorkspaceSearch}
              placeholder={t.search}
              size="xs"
              value={workspaceSearch}
            />
          </div>

          <SelectGroup className="border-b border-token-menu-border">
            <SelectItem
              value={WORKSPACE_ADD_VALUE}
              className="h-8 pr-10"
            >
              <SelectOptionRow
                description={t.studioWorkspaceCreateDescription}
                icon={
                  <FolderPlus
                    aria-hidden
                    className="size-4 text-muted-foreground"
                  />
                }
                label={t.studioOpenWorkspace}
                meta={`${t.studioWorkspaceTypeLocal} / ${t.studioWorkspaceTypeSandbox}`}
              />
            </SelectItem>
          </SelectGroup>

          {workspacesLoading ? (
            <SelectGroup>
              <SelectItem
                value={WORKSPACE_LOADING_VALUE}
                className="h-8"
                disabled
              >
                <RiLoader4Line aria-hidden className="size-3.5 animate-spin" />
                <span>{t.studioWorkspacesLoading}</span>
              </SelectItem>
            </SelectGroup>
          ) : filteredWorkspaces.length === 0 ? (
            <SelectGroup>
              {renderNoWorkspaceOption()}
              <SelectItem
                value={WORKSPACE_EMPTY_VALUE}
                className="h-8"
                disabled
              >
                {workspaces.length > 0
                  ? t.studioNoResults
                  : t.studioWorkspaceEmpty}
              </SelectItem>
            </SelectGroup>
          ) : (
            <>
              <SelectGroup>{renderNoWorkspaceOption()}</SelectGroup>
              {localWorkspaces.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>{t.studioWorkspaceTypeLocal}</SelectLabel>
                  {localWorkspaces.map(renderWorkspaceOption)}
                </SelectGroup>
              ) : null}
              {sandboxWorkspaces.length > 0 ? (
                <SelectGroup>
                  <SelectLabel>{t.studioWorkspaceTypeSandbox}</SelectLabel>
                  {sandboxWorkspaces.map(renderWorkspaceOption)}
                </SelectGroup>
              ) : null}
            </>
          )}
        </SelectContent>
      </Select>

      <span
        data-tour-id="studio-composer-environment"
        className={cn(
          "inline-flex h-6 shrink-0 items-center gap-1.5 rounded-lg px-2",
          workspace?.type === "sandbox"
            ? "bg-sky-500/8 text-sky-700 dark:text-sky-300"
            : "text-muted-foreground"
        )}
        title={workspace?.rootPath ?? t.studioWorkspaceNoneDescription}
      >
        {workspace ? (
          <WorkspaceIcon aria-hidden className="size-3.5" />
        ) : (
          <Laptop aria-hidden className="size-3.5" />
        )}
        <span>
          {workspace?.type === "sandbox"
            ? t.studioWorkspaceTypeSandbox
            : t.studioWorkspaceTypeLocal}
        </span>
        {workspace?.type === "sandbox" ? (
          <span className="rounded border border-sky-500/25 px-1 py-0.5 text-[8px] leading-none font-semibold tracking-[0.08em] uppercase">
            {t.studioWorkspaceSandboxBadge}
          </span>
        ) : null}
      </span>

      {workspace?.type === "local" && selectedProject?.git.branch ? (
        <span
          className="flex min-w-0 items-center gap-1.5 px-2"
          title={
            selectedProject.git.isDirty
              ? formatProjectGitMeta(selectedProject, t)
              : selectedProject.git.branch
          }
        >
          <GitBranch aria-hidden className="size-4" />
          <span className="max-w-32 truncate">{selectedProject.git.branch}</span>
          {selectedProject.git.isDirty ? (
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full bg-amber-500"
            />
          ) : null}
        </span>
      ) : null}
    </div>
  )
}
