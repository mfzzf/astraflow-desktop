"use client"

import * as React from "react"
import { RiLoader4Line } from "@remixicon/react"
import { Cloud, FolderGit2, FolderPlus, GitBranch, Globe } from "lucide-react"

import type { useI18n } from "@/components/i18n-provider"
import { PanelSearchInput } from "@/components/search-input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import type { StudioLocalProjectWithGitInfo } from "@/lib/studio-types"
import { dispatchStudioRemoteWorkspaceCreateRequested } from "@/lib/studio-session-events"
import { cn } from "@/lib/utils"

import { PROJECT_NONE_VALUE } from "./constants"
import { SelectOptionRow } from "./composer-parts"
import { formatProjectGitMeta } from "./composer-utils"
import type { ChatRunEnvironment } from "./types"

const PROJECT_ADD_VALUE = "__add_project__"

type ComposerSessionScopeControlsProps = {
  showSessionScopeControls: boolean
  selectedProjectValue: string
  handleProjectValueChange: (value: string) => void
  isBusy: boolean
  selectedProject: StudioLocalProjectWithGitInfo | null
  projectSearch: string
  setProjectSearch: React.Dispatch<React.SetStateAction<string>>
  isAddingProject: boolean
  onAddProject: () => void
  filteredLocalProjects: StudioLocalProjectWithGitInfo[]
  localProjects: StudioLocalProjectWithGitInfo[]
  runtimeEnvironment: ChatRunEnvironment
  handleEnvironmentChange: (value: string) => void
  hasAstraflowRuntime: boolean
  isAstraflowRuntime: boolean
  t: ReturnType<typeof useI18n>["t"]
}

export function ComposerSessionScopeControls({
  showSessionScopeControls,
  selectedProjectValue,
  handleProjectValueChange,
  isBusy,
  selectedProject,
  projectSearch,
  setProjectSearch,
  isAddingProject,
  onAddProject,
  filteredLocalProjects,
  localProjects,
  runtimeEnvironment,
  handleEnvironmentChange,
  hasAstraflowRuntime,
  isAstraflowRuntime,
  t,
}: ComposerSessionScopeControlsProps) {
  if (!showSessionScopeControls) {
    return null
  }

  function handleSelectValueChange(value: string) {
    if (value === PROJECT_ADD_VALUE) {
      onAddProject()
      return
    }

    handleProjectValueChange(value)
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground">
      {runtimeEnvironment === "remote" ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 rounded-lg px-2 text-xs font-medium text-foreground shadow-none"
          disabled={isBusy}
          onClick={dispatchStudioRemoteWorkspaceCreateRequested}
        >
          <Cloud aria-hidden className="size-3.5 text-sky-500" />
          <span>{t.studioRemoteWorkspaceCreate}</span>
        </Button>
      ) : (
        <Select
          value={selectedProjectValue}
          onValueChange={handleSelectValueChange}
          disabled={isBusy}
        >
          <SelectTrigger
            data-tour-id="studio-composer-project"
            size="sm"
            className="h-6 w-fit max-w-52 rounded-lg border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/70"
            aria-label={t.studioLocalProjectSelect}
            title={
              selectedProject
                ? t.studioLocalProjectBoundDescription(selectedProject.path)
                : t.studioLocalProjectNoneDescription
            }
          >
            <FolderGit2 aria-hidden className="size-3.5" />
            <span
              className={cn(
                "truncate",
                selectedProject && "font-medium text-foreground"
              )}
            >
              {selectedProject
                ? selectedProject.name
                : t.studioLocalProjectSelect}
            </span>
          </SelectTrigger>
          <SelectContent position="popper" side="top" align="start">
            <div className="sticky top-0 z-10 space-y-1 border-b bg-popover p-1.5">
              <PanelSearchInput
                onKeyDown={(event) => event.stopPropagation()}
                onValueChange={setProjectSearch}
                placeholder={t.search}
                size="xs"
                value={projectSearch}
              />
              <SelectItem
                value={PROJECT_ADD_VALUE}
                disabled={isAddingProject}
                className="pr-10"
              >
                <SelectOptionRow
                  description={t.studioLocalProjectAddTitle}
                  icon={
                    isAddingProject ? (
                      <RiLoader4Line
                        aria-hidden
                        className="size-4 animate-spin text-muted-foreground"
                      />
                    ) : (
                      <FolderPlus
                        aria-hidden
                        className="size-4 text-muted-foreground"
                      />
                    )
                  }
                  label={t.studioLocalProjectAdd}
                />
              </SelectItem>
            </div>
            <SelectGroup>
              <SelectItem value={PROJECT_NONE_VALUE} className="pr-10">
                <SelectOptionRow
                  description={t.studioLocalProjectNoneDescription}
                  icon={
                    <FolderGit2
                      aria-hidden
                      className="size-4 text-muted-foreground"
                    />
                  }
                  label={t.studioLocalProjectNone}
                />
              </SelectItem>
              {filteredLocalProjects.length > 0 ? (
                filteredLocalProjects.map((project) => (
                  <SelectItem
                    key={project.id}
                    value={project.id}
                    textValue={project.name}
                    title={project.path}
                    className="pr-10"
                  >
                    <SelectOptionRow
                      description={t.studioLocalProjectBoundDescription(
                        project.path
                      )}
                      icon={
                        <FolderGit2
                          aria-hidden
                          className="size-4 text-muted-foreground"
                        />
                      }
                      label={project.name}
                      meta={formatProjectGitMeta(project, t)}
                    />
                  </SelectItem>
                ))
              ) : (
                <SelectItem value="__empty__" disabled>
                  {localProjects.length > 0
                    ? t.studioNoResults
                    : t.studioLocalProjectEmpty}
                </SelectItem>
              )}
            </SelectGroup>
            {isAddingProject ? (
              <div className="sticky bottom-0 flex items-center gap-2 border-t bg-popover px-3 py-2 text-xs text-muted-foreground">
                <RiLoader4Line className="animate-spin" aria-hidden />
                <span>{t.studioLocalProjectAdding}</span>
              </div>
            ) : null}
          </SelectContent>
        </Select>
      )}

      <Select
        value={runtimeEnvironment}
        onValueChange={handleEnvironmentChange}
        disabled={isBusy}
      >
        <SelectTrigger
          data-tour-id="studio-composer-environment"
          size="sm"
          className="h-6 w-fit rounded-lg border-transparent bg-transparent px-2 text-xs shadow-none hover:bg-muted/70"
          aria-label={t.studioProjectEnvironment}
          title={
            runtimeEnvironment === "remote"
              ? t.studioLocalProjectRemoteDescription
              : t.studioLocalProjectLocalDescription
          }
        >
          <Globe aria-hidden className="size-3.5" />
          <span>
            {runtimeEnvironment === "remote"
              ? t.studioLocalProjectRemote
              : t.studioLocalProjectLocal}
          </span>
        </SelectTrigger>
        <SelectContent position="popper" side="top" align="start">
          <SelectGroup>
            <SelectItem
              value="remote"
              disabled={!hasAstraflowRuntime}
              className="pr-10"
            >
              <SelectOptionRow
                description={t.studioLocalProjectRemoteDescription}
                icon={
                  <Globe aria-hidden className="size-4 text-muted-foreground" />
                }
                label={t.studioLocalProjectRemote}
              />
            </SelectItem>
            <SelectItem
              value="local"
              disabled={!isAstraflowRuntime}
              className="pr-10"
            >
              <SelectOptionRow
                description={t.studioLocalProjectLocalDescription}
                icon={
                  <Globe aria-hidden className="size-4 text-muted-foreground" />
                }
                label={t.studioLocalProjectLocal}
              />
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>

      {runtimeEnvironment === "local" && selectedProject?.git.branch ? (
        <span
          className="flex min-w-0 items-center gap-1.5 px-2"
          title={
            selectedProject.git.isDirty
              ? formatProjectGitMeta(selectedProject, t)
              : selectedProject.git.branch
          }
        >
          <GitBranch aria-hidden className="size-4" />
          <span className="max-w-32 truncate">
            {selectedProject.git.branch}
          </span>
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
