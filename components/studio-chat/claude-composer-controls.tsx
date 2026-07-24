"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import type {
  SessionConfigOption,
  SessionModeState,
} from "@agentclientprotocol/sdk"
import {
  Bot,
  Clock3,
  Gauge,
  GitFork,
  LoaderCircle,
  ListTree,
  Sparkles,
  Settings2,
  Target,
  Zap,
} from "lucide-react"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  CLAUDE_DEFAULT_MODE,
  CLAUDE_FAST_MODE_CONFIG_ID,
  CLAUDE_MODE_CONFIG_ID,
  CLAUDE_PLAN_MODE,
  findClaudeConfigOption,
  getClaudeFastMode,
  getClaudePlanMode,
  getClaudeSelectOptions,
} from "@/lib/agent/acp/claude-features"
import { getClaudeRateLimitPresentation } from "@/lib/agent/acp/session-presentation"
import { cn } from "@/lib/utils"

import { AcpSessionControls } from "./acp-controls"
import type { ComposerToggleControl } from "./types"

type ClaudeSessionSnapshot = {
  connected: true
  phase: "initialized" | "session"
  sessionId: string | null
  session: {
    canFork: boolean
    configOptions: SessionConfigOption[]
    modes: SessionModeState | null
    rateLimitInfo: Record<string, unknown> | null
    claudeActiveGoal: Record<string, unknown> | null
    claudeAuthStatus: Record<string, unknown> | null
    claudeBackgroundTasks: Record<string, unknown>[]
    claudePromptSuggestion: string | null
  }
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error?: string }

function claudeAcpEndpoint(sessionId?: string) {
  const path = "/api/studio/agent-runtimes/claude-code/acp"

  return sessionId ? `${path}?sessionId=${encodeURIComponent(sessionId)}` : path
}

async function readEnvelope<T>(response: Response): Promise<T> {
  const payload = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<T> | null

  if (!response.ok || !payload || payload.ok !== true) {
    throw new Error(
      payload && "error" in payload && payload.error
        ? payload.error
        : `Claude Code control failed (${response.status}).`
    )
  }

  return payload.data
}

async function requestClaudeControl<T>(
  sessionId: string,
  control: Record<string, unknown>
) {
  const response = await fetch(claudeAcpEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, control }),
  })

  return readEnvelope<T>(response)
}

function ClaudeConfigRow({
  disabled,
  onChange,
  option,
}: {
  disabled: boolean
  onChange: (value: string | boolean) => void
  option: SessionConfigOption
}) {
  const values = getClaudeSelectOptions(option)

  return (
    <div className="flex min-w-0 items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-medium text-foreground">
          {option.name}
        </div>
        {option.description ? (
          <div className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">
            {option.description}
          </div>
        ) : null}
      </div>

      {option.type === "boolean" ? (
        <Switch
          checked={option.currentValue}
          disabled={disabled}
          aria-label={option.name}
          onCheckedChange={onChange}
        />
      ) : (
        <Select
          value={option.currentValue}
          disabled={disabled || values.length === 0}
          onValueChange={onChange}
        >
          <SelectTrigger className="h-7 w-36 min-w-0 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            {values.map((value) => (
              <SelectItem key={value.value} value={value.value}>
                <span className="block max-w-56 truncate">{value.name}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

export function useClaudeComposerControls({
  compact,
  isBusy,
  onAdoptSuggestion,
  onExecuteCommand,
  runtimeId,
  sessionId,
}: {
  compact: boolean
  isBusy: boolean
  onAdoptSuggestion: (suggestion: string) => void
  onExecuteCommand: (command: string) => void
  runtimeId: string
  sessionId: string
}) {
  const router = useRouter()
  const { locale, t } = useI18n()
  const enabled = runtimeId === "claude-code"
  const [snapshot, setSnapshot] = React.useState<ClaudeSessionSnapshot | null>(
    null
  )
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)

  const loadSnapshot = React.useCallback(async () => {
    if (!enabled || !sessionId) {
      setSnapshot(null)
      return null
    }

    try {
      const response = await fetch(claudeAcpEndpoint(sessionId), {
        cache: "no-store",
      })
      const data = await readEnvelope<ClaudeSessionSnapshot | null>(response)

      setSnapshot(data)
      return data
    } catch {
      return null
    }
  }, [enabled, sessionId])

  React.useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadSnapshot(), 0)

    return () => window.clearTimeout(timeoutId)
  }, [isBusy, loadSnapshot])

  React.useEffect(() => {
    if (!enabled || !sessionId || !isBusy) {
      return
    }

    const intervalId = window.setInterval(() => void loadSnapshot(), 2_000)

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
        toast.error(t.studioClaudeControlFailed, {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setPendingAction(null)
      }
    },
    [loadSnapshot, pendingAction, t.studioClaudeControlFailed]
  )

  const ensureActiveSnapshot = React.useCallback(async () => {
    if (!sessionId) {
      throw new Error(t.studioClaudeStartChatFirst)
    }
    if (snapshot?.phase === "session") {
      return snapshot
    }

    const next = await requestClaudeControl<ClaudeSessionSnapshot>(sessionId, {
      action: "activate",
    })
    setSnapshot(next)
    return next
  }, [sessionId, snapshot, t.studioClaudeStartChatFirst])

  const setConfigOption = React.useCallback(
    (configId: string, value: string | boolean) =>
      runAction(`config:${configId}`, async () => {
        await ensureActiveSnapshot()
        await requestClaudeControl(sessionId, {
          action: "set_config_option",
          configId,
          value,
        })
      }),
    [ensureActiveSnapshot, runAction, sessionId]
  )

  const setSessionMode = React.useCallback(
    async (active: ClaudeSessionSnapshot, value: string) => {
      const modeOption = findClaudeConfigOption(
        active.session.configOptions,
        CLAUDE_MODE_CONFIG_ID
      )

      await requestClaudeControl(
        sessionId,
        modeOption
          ? {
              action: "set_config_option",
              configId: CLAUDE_MODE_CONFIG_ID,
              value,
            }
          : { action: "set_mode", modeId: value }
      )
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
      const plan = getClaudePlanMode(
        active.session.configOptions,
        active.session.modes
      )

      if (!plan.available) {
        throw new Error(t.studioClaudePlanUnavailable)
      }

      const value = plan.active ? CLAUDE_DEFAULT_MODE : CLAUDE_PLAN_MODE
      await setSessionMode(active, value)
    })
  }, [
    enabled,
    ensureActiveSnapshot,
    isBusy,
    onExecuteCommand,
    runAction,
    setSessionMode,
    sessionId,
    t.studioClaudePlanUnavailable,
  ])

  if (!enabled) {
    return { fastControl: null, modeControls: null, planControl: null }
  }

  const configOptions = snapshot?.session.configOptions ?? []
  const modes = snapshot?.session.modes ?? null
  const plan = getClaudePlanMode(configOptions, modes)
  const fast = getClaudeFastMode(configOptions)
  const fastOption = findClaudeConfigOption(
    configOptions,
    CLAUDE_FAST_MODE_CONFIG_ID
  )
  const rateLimit = getClaudeRateLimitPresentation(
    snapshot?.session.rateLimitInfo ?? null
  )
  const rateLimitReset =
    rateLimit?.resetsAt && !Number.isNaN(rateLimit.resetsAt.getTime())
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(rateLimit.resetsAt)
      : null
  const activeGoal = snapshot?.session.claudeActiveGoal ?? null
  const goalCondition =
    typeof activeGoal?.condition === "string" ? activeGoal.condition.trim() : ""
  const goalIterations =
    typeof activeGoal?.iterations === "number" &&
    Number.isFinite(activeGoal.iterations)
      ? Math.max(0, Math.round(activeGoal.iterations))
      : null
  const goalLastReason =
    typeof activeGoal?.last_reason === "string"
      ? activeGoal.last_reason.trim()
      : ""
  const promptSuggestion =
    snapshot?.session.claudePromptSuggestion?.trim() ?? ""
  const authStatus = snapshot?.session.claudeAuthStatus ?? null
  const isAuthenticating = authStatus?.isAuthenticating === true
  const authError =
    typeof authStatus?.error === "string" ? authStatus.error.trim() : ""
  const backgroundTasks = snapshot?.session.claudeBackgroundTasks ?? []
  const pending = pendingAction !== null
  const openClaudeOptions = (open: boolean) => {
    if (!open || !sessionId || pending) {
      return
    }

    if (snapshot?.phase === "session") {
      void loadSnapshot()
      return
    }

    void runAction("activate", async () => {
      await ensureActiveSnapshot()
    })
  }

  return {
    planControl: {
      active: plan.active,
      available: plan.available || snapshot?.phase !== "session",
      disabled: isBusy || pending,
      pending: pendingAction === "plan",
      onToggle: togglePlan,
    } satisfies ComposerToggleControl,
    fastControl:
      fast.available && fastOption
        ? ({
            active: fast.active,
            available: true,
            disabled: isBusy || pending || !sessionId,
            pending: pendingAction === `config:${CLAUDE_FAST_MODE_CONFIG_ID}`,
            onToggle: () =>
              setConfigOption(
                CLAUDE_FAST_MODE_CONFIG_ID,
                fastOption.type === "boolean"
                  ? !fast.active
                  : fast.active
                    ? "off"
                    : "on"
              ),
          } satisfies ComposerToggleControl)
        : null,
    modeControls: (
      <>
        {plan.active ? (
          <Button
            type="button"
            variant="ghost"
            size={compact ? "icon-sm" : "sm"}
            disabled={isBusy || pending}
            aria-pressed={plan.active}
            aria-label={t.studioClaudePlanMode}
            title={t.studioClaudePlanShortcut}
            data-analytics-event="composer.plan.toggle"
            data-analytics-label={t.studioClaudePlanMode}
            className={cn(
              "text-muted-foreground hover:bg-muted/55 hover:text-foreground",
              plan.active && "bg-primary/10 text-primary hover:bg-primary/15",
              compact
                ? "size-7 rounded-md"
                : "h-7 gap-1.5 rounded-md px-2 text-xs font-normal"
            )}
            onClick={togglePlan}
          >
            {pendingAction === "plan" ? (
              <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
            ) : (
              <Settings2 aria-hidden className="size-3.5" />
            )}
            <span className={compact ? "sr-only" : undefined}>
              {t.studioClaudePlanMode}
            </span>
          </Button>
        ) : null}

        {fast.available && fastOption ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={isBusy || pending}
            aria-label={t.studioClaudeFastMode}
            aria-pressed={fast.active}
            title={t.studioClaudeFastMode}
            data-analytics-event="composer.fast.toggle"
            data-analytics-label={t.studioClaudeFastMode}
            className={cn(
              "size-7 rounded-full",
              fast.active && "bg-primary/10 text-primary hover:bg-primary/15"
            )}
            onClick={() =>
              setConfigOption(
                CLAUDE_FAST_MODE_CONFIG_ID,
                fastOption.type === "boolean"
                  ? !fast.active
                  : fast.active
                    ? "off"
                    : "on"
              )
            }
          >
            {pendingAction === `config:${CLAUDE_FAST_MODE_CONFIG_ID}` ? (
              <LoaderCircle aria-hidden className="animate-spin" />
            ) : (
              <Zap aria-hidden />
            )}
          </Button>
        ) : null}

        <Popover onOpenChange={openClaudeOptions}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isBusy && !snapshot}
              aria-label={t.studioClaudeOptions}
              title={t.studioClaudeOptions}
              data-analytics-event="composer.agent_options.open"
              data-analytics-label={t.studioClaudeOptions}
              className="size-7 rounded-full"
            >
              <Bot aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-3">
            <PopoverHeader className="pb-1">
              <PopoverTitle>{t.studioClaudeOptions}</PopoverTitle>
            </PopoverHeader>

            {configOptions.length > 0 ? (
              <div className="divide-y divide-border/70">
                {configOptions.map((option) => (
                  <ClaudeConfigRow
                    key={option.id}
                    option={option}
                    disabled={isBusy || pending}
                    onChange={(value) => setConfigOption(option.id, value)}
                  />
                ))}
              </div>
            ) : (
              <div className="py-3 text-xs text-muted-foreground">
                {sessionId
                  ? t.studioClaudeOptionsUnavailable
                  : t.studioClaudeStartChatFirst}
              </div>
            )}

            {rateLimit ? (
              <div className="mt-2 space-y-2 border-t border-border/70 pt-2.5">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
                    <Gauge aria-hidden className="size-3.5 shrink-0" />
                    <span className="truncate">
                      {rateLimit.rateLimitType ?? t.studioClaudeUsageLimit}
                    </span>
                  </div>
                  <span className="shrink-0 font-medium text-foreground">
                    {rateLimit.utilizationPercent !== null
                      ? t.studioClaudeUsagePercent(rateLimit.utilizationPercent)
                      : (rateLimit.status ?? t.studioClaudeUsageAvailable)}
                  </span>
                </div>

                {rateLimit.utilizationPercent !== null ? (
                  <div
                    role="progressbar"
                    aria-label={t.studioClaudeUsageLimit}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={rateLimit.utilizationPercent}
                    className="h-1.5 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full bg-primary transition-[width]",
                        rateLimit.utilizationPercent >= 90 && "bg-destructive"
                      )}
                      style={{ width: `${rateLimit.utilizationPercent}%` }}
                    />
                  </div>
                ) : null}

                {rateLimitReset ? (
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <Clock3 aria-hidden className="size-3.5 shrink-0" />
                    <span>
                      {t.studioClaudeUsageResets}: {rateLimitReset}
                    </span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {goalCondition ? (
              <div className="mt-2 space-y-1.5 border-t border-border/70 pt-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Target
                    aria-hidden
                    className="size-3.5 text-muted-foreground"
                  />
                  {t.studioClaudeActiveGoal}
                </div>
                <p className="line-clamp-3 text-xs leading-5 text-muted-foreground">
                  {goalCondition}
                </p>
                {goalIterations !== null || goalLastReason ? (
                  <p className="text-[11px] leading-4 text-muted-foreground">
                    {[
                      goalIterations !== null
                        ? t.studioClaudeGoalIterations(goalIterations)
                        : "",
                      goalLastReason,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                ) : null}
              </div>
            ) : null}

            {backgroundTasks.length > 0 ? (
              <div className="mt-2 space-y-2 border-t border-border/70 pt-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <ListTree
                    aria-hidden
                    className="size-3.5 text-muted-foreground"
                  />
                  {t.studioClaudeBackgroundTasks(backgroundTasks.length)}
                </div>
                <div className="space-y-1.5">
                  {backgroundTasks.slice(0, 5).map((task, index) => {
                    const description =
                      typeof task.description === "string"
                        ? task.description.trim()
                        : ""
                    const taskType =
                      typeof task.task_type === "string"
                        ? task.task_type.trim()
                        : ""
                    const taskId =
                      typeof task.task_id === "string"
                        ? task.task_id
                        : String(index)

                    return (
                      <div
                        key={taskId}
                        className="rounded-md bg-muted/45 px-2.5 py-1.5"
                      >
                        <p className="line-clamp-2 text-xs leading-4 text-foreground">
                          {description ||
                            taskType ||
                            t.studioClaudeBackgroundTask}
                        </p>
                        {taskType && taskType !== description ? (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {taskType}
                          </p>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              </div>
            ) : null}

            {promptSuggestion ? (
              <div className="mt-2 space-y-2 border-t border-border/70 pt-2.5">
                <div className="flex items-center gap-2 text-xs font-medium text-foreground">
                  <Sparkles
                    aria-hidden
                    className="size-3.5 text-muted-foreground"
                  />
                  {t.studioClaudeSuggestedPrompt}
                </div>
                <button
                  type="button"
                  className="w-full rounded-md bg-muted/55 px-2.5 py-2 text-left text-xs leading-5 text-foreground transition-colors hover:bg-muted"
                  onClick={() => onAdoptSuggestion(promptSuggestion)}
                >
                  <span className="line-clamp-3">{promptSuggestion}</span>
                  <span className="mt-1 block text-[11px] text-muted-foreground">
                    {t.studioClaudeUseSuggestion}
                  </span>
                </button>
              </div>
            ) : null}

            {isAuthenticating || authError ? (
              <div className="mt-2 border-t border-border/70 pt-2.5 text-xs text-muted-foreground">
                {authError || t.studioClaudeAuthenticating}
              </div>
            ) : null}

            {snapshot?.phase === "session" && snapshot.session.canFork ? (
              <div className="mt-2 border-t border-border/70 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 w-full justify-start gap-2 text-xs"
                  disabled={isBusy || pending}
                  onClick={() =>
                    void runAction("fork", async () => {
                      const result = await requestClaudeControl<{
                        sessionPath: string
                      }>(sessionId, { action: "fork_current_session" })

                      router.push(result.sessionPath)
                    })
                  }
                >
                  {pendingAction === "fork" ? (
                    <LoaderCircle aria-hidden className="animate-spin" />
                  ) : (
                    <GitFork aria-hidden />
                  )}
                  {t.studioClaudeForkSession}
                </Button>
              </div>
            ) : null}

            <div className="mt-2 border-t border-border/70 pt-2">
              <AcpSessionControls
                dense={false}
                disabled={isBusy || pending}
                locale={locale}
                runtimeId="claude-code"
                sessionId={sessionId}
                showLabel
                onEnsureSession={async () => {
                  if (!sessionId) {
                    throw new Error(t.studioClaudeStartChatFirst)
                  }
                  return sessionId
                }}
              />
            </div>
          </PopoverContent>
        </Popover>
      </>
    ),
  }
}
