"use client"

import * as React from "react"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import { RiListCheck } from "@remixicon/react"
import {
  LoaderCircle,
  Pause,
  Pencil,
  Play,
  Target,
  Trash2,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  CODEX_COLLABORATION_MODE_CONFIG_ID,
  CODEX_DEFAULT_COLLABORATION_MODE,
  CODEX_FAST_MODE_CONFIG_ID,
  CODEX_PLAN_COLLABORATION_MODE,
  findCodexConfigOption,
  getCodexFastMode,
  getCodexPlanMode,
} from "@/lib/agent/acp/codex-features"
import {
  getAcpSessionInfoPresentation,
  type AcpSessionInfoSnapshot,
} from "@/lib/agent/acp/session-presentation"
import { cn } from "@/lib/utils"

import {
  COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME,
  COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
  ComposerStackedPanel,
  ComposerStackedPanelHeaderRow,
  ComposerStackedPanelRowLabel,
  ComposerStackedPanelRowMain,
} from "./composer-stacked-panel"
import type { ComposerToggleControl } from "./types"

type CodexSessionSnapshot = {
  connected: true
  phase: "initialized" | "session"
  sessionId: string | null
  session: {
    configOptions: SessionConfigOption[]
    info: AcpSessionInfoSnapshot | null
  }
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error?: string }

function codexAcpEndpoint(sessionId?: string) {
  const path = "/api/studio/agent-runtimes/codex/acp"

  return sessionId ? `${path}?sessionId=${encodeURIComponent(sessionId)}` : path
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => null)) as
    | ApiEnvelope<T>
    | null

  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : `Codex control failed (${response.status}).`
    )
  }

  return payload.data
}

async function requestCodexControl<T>(
  sessionId: string,
  control: Record<string, unknown>
) {
  const response = await fetch(codexAcpEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, control }),
  })

  return readEnvelope<T>(response)
}

function CodexGoalPanel({
  disabled,
  goal,
  onClear,
  onEdit,
  onPause,
  onResume,
  pending,
}: {
  disabled: boolean
  goal: NonNullable<
    ReturnType<typeof getAcpSessionInfoPresentation>["goal"]
  >
  onClear: () => void
  onEdit: (objective: string) => void
  onPause: () => void
  onResume: () => void
  pending: boolean
}) {
  const { t } = useI18n()
  const [editOpen, setEditOpen] = React.useState(false)
  const [objective, setObjective] = React.useState(goal.objective)
  const paused = goal.status === "paused"
  const metadata = [
    paused ? t.studioCodexGoalPaused : t.studioCodexGoalActive,
    goal.tokenBudget !== null
      ? t.studioCodexGoalTokenBudget(goal.tokenBudget)
      : null,
    goal.timeUsedSeconds !== null
      ? t.studioCodexGoalElapsed(goal.timeUsedSeconds)
      : null,
  ].filter(Boolean)

  const save = () => {
    const value = objective.trim()

    if (!value || value === goal.objective) {
      setEditOpen(false)
      return
    }

    onEdit(value)
    setEditOpen(false)
  }

  return (
    <ComposerStackedPanel data-testid="codex-goal-panel">
      <ComposerStackedPanelHeaderRow>
        <ComposerStackedPanelRowMain>
          <Target
            aria-hidden
            className={cn(
              COMPOSER_STACKED_PANEL_ICON_CLASS_NAME,
              !paused && "text-primary"
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium text-foreground">
              {goal.objective}
            </div>
            <ComposerStackedPanelRowLabel>
              {metadata.join(" · ")}
            </ComposerStackedPanelRowLabel>
          </div>
        </ComposerStackedPanelRowMain>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={pending || (paused ? disabled : false)}
            aria-label={paused ? t.studioCodexGoalResume : t.studioCodexGoalPause}
            title={paused ? t.studioCodexGoalResume : t.studioCodexGoalPause}
            className={COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME}
            onClick={paused ? onResume : onPause}
          >
            {pending ? (
              <LoaderCircle aria-hidden className="animate-spin" />
            ) : paused ? (
              <Play aria-hidden />
            ) : (
              <Pause aria-hidden />
            )}
          </Button>

          <Popover
            open={editOpen}
            onOpenChange={(nextOpen) => {
              if (nextOpen) {
                setObjective(goal.objective)
              }
              setEditOpen(nextOpen)
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={disabled || pending}
                aria-label={t.studioCodexGoalEdit}
                title={t.studioCodexGoalEdit}
                className={COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME}
              >
                <Pencil aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent side="top" align="end" className="w-80 p-2.5">
              <form
                className="flex items-center gap-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  save()
                }}
              >
                <Input
                  autoFocus
                  value={objective}
                  maxLength={4000}
                  aria-label={t.studioCodexGoalEdit}
                  onChange={(event) => setObjective(event.target.value)}
                />
                <Button type="submit" size="sm" disabled={!objective.trim()}>
                  {t.studioSave}
                </Button>
              </form>
            </PopoverContent>
          </Popover>

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            disabled={pending}
            aria-label={t.studioCodexGoalClear}
            title={t.studioCodexGoalClear}
            className={COMPOSER_STACKED_PANEL_ICON_BUTTON_CLASS_NAME}
            onClick={onClear}
          >
            <Trash2 aria-hidden />
          </Button>
        </div>
      </ComposerStackedPanelHeaderRow>
    </ComposerStackedPanel>
  )
}

export function useCodexComposerControls({
  compact,
  isBusy,
  onExecuteCommand,
  runtimeId,
  sessionId,
}: {
  compact: boolean
  isBusy: boolean
  onExecuteCommand: (command: string) => void
  runtimeId: string
  sessionId: string
}) {
  const { t } = useI18n()
  const enabled = runtimeId === "codex"
  const [snapshot, setSnapshot] = React.useState<CodexSessionSnapshot | null>(
    null
  )
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)

  const loadSnapshot = React.useCallback(async () => {
    if (!enabled || !sessionId) {
      setSnapshot(null)
      return null
    }

    try {
      const response = await fetch(codexAcpEndpoint(sessionId), {
        cache: "no-store",
      })
      const data = await readEnvelope<CodexSessionSnapshot | null>(response)

      setSnapshot(data)
      return data
    } catch {
      return null
    }
  }, [enabled, sessionId])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadSnapshot()
    }, 0)

    return () => window.clearTimeout(timeoutId)
  }, [isBusy, loadSnapshot])

  React.useEffect(() => {
    if (!enabled || !sessionId || !isBusy) {
      return
    }

    const intervalId = window.setInterval(() => {
      void loadSnapshot()
    }, 2_000)

    return () => window.clearInterval(intervalId)
  }, [enabled, isBusy, loadSnapshot, sessionId])

  const runAction = React.useCallback(
    async (name: string, operation: () => Promise<void>) => {
      if (pendingAction) {
        return
      }

      setPendingAction(name)
      try {
        await operation()
        await loadSnapshot()
      } catch (error) {
        toast.error(t.studioCodexControlFailed, {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setPendingAction(null)
      }
    },
    [loadSnapshot, pendingAction, t.studioCodexControlFailed]
  )

  const ensureActiveSnapshot = React.useCallback(async () => {
    if (!sessionId) {
      throw new Error(t.studioCodexStartChatFirst)
    }
    if (snapshot?.phase === "session") {
      return snapshot
    }

    const next = await requestCodexControl<CodexSessionSnapshot>(sessionId, {
      action: "activate",
    })
    setSnapshot(next)
    return next
  }, [sessionId, snapshot, t.studioCodexStartChatFirst])

  const setConfigOption = React.useCallback(
    async (configId: string, value: string | boolean) => {
      await requestCodexControl(sessionId, {
        action: "set_config_option",
        configId,
        value,
      })
    },
    [sessionId]
  )

  const togglePlan = React.useCallback(() => {
    if (!enabled || isBusy) {
      return
    }

    if (!sessionId) {
      onExecuteCommand("/plan")
      return
    }

    void runAction("plan", async () => {
      const active = await ensureActiveSnapshot()
      const mode = getCodexPlanMode(active.session.configOptions)

      if (!mode.available) {
        throw new Error(t.studioCodexPlanUnavailable)
      }

      await setConfigOption(
        CODEX_COLLABORATION_MODE_CONFIG_ID,
        mode.active
          ? CODEX_DEFAULT_COLLABORATION_MODE
          : CODEX_PLAN_COLLABORATION_MODE
      )
    })
  }, [
    enabled,
    ensureActiveSnapshot,
    isBusy,
    onExecuteCommand,
    runAction,
    sessionId,
    setConfigOption,
    t.studioCodexPlanUnavailable,
  ])

  const toggleFast = React.useCallback(() => {
    if (!enabled || isBusy || !sessionId) {
      return
    }

    void runAction("fast", async () => {
      const active = await ensureActiveSnapshot()
      const option = findCodexConfigOption(
        active.session.configOptions,
        CODEX_FAST_MODE_CONFIG_ID
      )
      const fast = getCodexFastMode(active.session.configOptions)

      if (!option || !fast.available) {
        throw new Error(t.studioCodexFastUnavailable)
      }

      await setConfigOption(
        CODEX_FAST_MODE_CONFIG_ID,
        option.type === "boolean" ? !fast.active : fast.active ? "off" : "on"
      )
    })
  }, [
    enabled,
    ensureActiveSnapshot,
    isBusy,
    runAction,
    sessionId,
    setConfigOption,
    t.studioCodexFastUnavailable,
  ])

  if (!enabled) {
    return {
      fastControl: null,
      goalPanel: null,
      modeControls: null,
      planControl: null,
    }
  }

  const info = getAcpSessionInfoPresentation(snapshot?.session.info ?? null)
  const plan = getCodexPlanMode(snapshot?.session.configOptions ?? [])
  const fast = getCodexFastMode(snapshot?.session.configOptions ?? [])
  const pending = pendingAction !== null

  return {
    planControl: {
      active: plan.active,
      available: plan.available || snapshot?.phase !== "session",
      disabled: isBusy || pending,
      pending: pendingAction === "plan",
      onToggle: togglePlan,
    } satisfies ComposerToggleControl,
    fastControl: fast.available
      ? ({
          active: fast.active,
          available: true,
          disabled: isBusy || pending || !sessionId,
          pending: pendingAction === "fast",
          onToggle: toggleFast,
        } satisfies ComposerToggleControl)
      : null,
    goalPanel: info.goal ? (
      <CodexGoalPanel
        disabled={isBusy}
        goal={info.goal}
        pending={pending}
        onPause={() =>
          void runAction("goal", async () => {
            await requestCodexControl(sessionId, {
              action: "goal_control",
              operation: "pause",
            })
          })
        }
        onResume={() => onExecuteCommand("/goal resume")}
        onEdit={(objective) => onExecuteCommand(`/goal ${objective}`)}
        onClear={() =>
          void runAction("goal", async () => {
            await requestCodexControl(sessionId, {
              action: "goal_control",
              operation: "clear",
            })
          })
        }
      />
    ) : null,
    modeControls: (
      <>
        {plan.active ? (
          <Button
            type="button"
            variant="ghost"
            size={compact ? "icon-sm" : "sm"}
            disabled={isBusy || pending}
            aria-pressed={plan.active}
            aria-label={t.studioCodexPlanMode}
            title={t.studioCodexPlanShortcut}
            className={cn(
              "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
              plan.active &&
                "bg-primary/10 text-primary hover:bg-primary/15",
              compact
                ? "size-7 rounded-md"
                : "h-7 gap-1.5 rounded-md px-2 text-xs font-normal"
            )}
            onClick={togglePlan}
          >
            {pendingAction === "plan" ? (
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <RiListCheck aria-hidden className="size-4" />
            )}
            <span className={compact ? "sr-only" : undefined}>
              {t.studioCodexPlanMode}
            </span>
          </Button>
        ) : null}

        {fast.available ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isBusy || pending}
            aria-label={t.studioCodexFastMode}
            aria-pressed={fast.active}
            title={t.studioCodexFastMode}
            className={cn(
              "size-7 rounded-full",
              fast.active && "bg-primary/10 text-primary hover:bg-primary/15"
            )}
            onClick={toggleFast}
          >
            {pendingAction === "fast" ? (
              <LoaderCircle aria-hidden className="animate-spin" />
            ) : (
              <Zap aria-hidden />
            )}
          </Button>
        ) : null}
      </>
    ),
  }
}
