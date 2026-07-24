"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import type { SessionConfigOption } from "@agentclientprotocol/sdk"
import { Bot, GitFork, LoaderCircle, Settings2 } from "lucide-react"
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
import {
  OPENCODE_MODE_CONFIG_ID,
  OPENCODE_PLAN_MODE,
  getOpenCodePlanMode,
  getOpenCodeSelectOptions,
} from "@/lib/agent/acp/opencode-features"
import { cn } from "@/lib/utils"

import { AcpSessionControls } from "./acp-controls"
import type { ComposerToggleControl } from "./types"

type OpenCodeSessionSnapshot = {
  connected: true
  phase: "initialized" | "session"
  sessionId: string | null
  session: {
    canFork: boolean
    configOptions: SessionConfigOption[]
  }
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error?: string }

function openCodeAcpEndpoint(sessionId?: string) {
  const path = "/api/studio/agent-runtimes/opencode/acp"

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
        : `OpenCode control failed (${response.status}).`
    )
  }

  return payload.data
}

async function requestOpenCodeControl<T>(
  sessionId: string,
  control: Record<string, unknown>
) {
  const response = await fetch(openCodeAcpEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, control }),
  })

  return readEnvelope<T>(response)
}

function OpenCodeConfigRow({
  disabled,
  onChange,
  option,
}: {
  disabled: boolean
  onChange: (value: string) => void
  option: SessionConfigOption
}) {
  const values = getOpenCodeSelectOptions(option)

  if (option.type !== "select") {
    return null
  }

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

      <Select
        value={option.currentValue}
        disabled={disabled || values.length === 0}
        onValueChange={onChange}
      >
        <SelectTrigger className="h-7 w-40 min-w-0 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end" className="max-h-80 max-w-96">
          {values.map((value) => (
            <SelectItem
              key={`${value.groupId ?? ""}:${value.value}`}
              value={value.value}
            >
              <span className="block max-w-72 truncate">
                {value.groupName
                  ? `${value.groupName} / ${value.name}`
                  : value.name}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function useOpenCodeComposerControls({
  compact,
  isBusy,
  runtimeId,
  sessionId,
}: {
  compact: boolean
  isBusy: boolean
  runtimeId: string
  sessionId: string
}) {
  const router = useRouter()
  const { locale, t } = useI18n()
  const enabled = runtimeId === "opencode"
  const [snapshot, setSnapshot] =
    React.useState<OpenCodeSessionSnapshot | null>(null)
  const [pendingAction, setPendingAction] = React.useState<string | null>(null)

  const loadSnapshot = React.useCallback(async () => {
    if (!enabled || !sessionId) {
      setSnapshot(null)
      return null
    }

    try {
      const response = await fetch(openCodeAcpEndpoint(sessionId), {
        cache: "no-store",
      })
      const data = await readEnvelope<OpenCodeSessionSnapshot | null>(response)

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
        toast.error(t.studioOpenCodeControlFailed, {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setPendingAction(null)
      }
    },
    [loadSnapshot, pendingAction, t.studioOpenCodeControlFailed]
  )

  const ensureActiveSnapshot = React.useCallback(async () => {
    if (!sessionId) {
      throw new Error(t.studioOpenCodeStartChatFirst)
    }
    if (snapshot?.phase === "session") {
      return snapshot
    }

    const next = await requestOpenCodeControl<OpenCodeSessionSnapshot>(
      sessionId,
      { action: "activate" }
    )
    setSnapshot(next)
    return next
  }, [sessionId, snapshot, t.studioOpenCodeStartChatFirst])

  const setConfigOption = React.useCallback(
    (configId: string, value: string) =>
      runAction(`config:${configId}`, async () => {
        await ensureActiveSnapshot()
        await requestOpenCodeControl(sessionId, {
          action: "set_config_option",
          configId,
          value,
        })
      }),
    [ensureActiveSnapshot, runAction, sessionId]
  )

  const togglePlan = React.useCallback(() => {
    if (!enabled || isBusy || !sessionId) {
      return
    }

    void runAction("plan", async () => {
      const active = await ensureActiveSnapshot()
      const plan = getOpenCodePlanMode(active.session.configOptions)

      if (!plan.available) {
        throw new Error(t.studioOpenCodePlanUnavailable)
      }

      const nextMode = plan.active ? plan.defaultMode : OPENCODE_PLAN_MODE

      if (!nextMode) {
        throw new Error(t.studioOpenCodePlanUnavailable)
      }

      await requestOpenCodeControl(sessionId, {
        action: "set_config_option",
        configId: OPENCODE_MODE_CONFIG_ID,
        value: nextMode,
      })
    })
  }, [
    enabled,
    ensureActiveSnapshot,
    isBusy,
    runAction,
    sessionId,
    t.studioOpenCodePlanUnavailable,
  ])

  if (!enabled) {
    return { modeControls: null, planControl: null }
  }

  const configOptions = snapshot?.session.configOptions ?? []
  const plan = getOpenCodePlanMode(configOptions)
  const pending = pendingAction !== null
  const openOptions = (open: boolean) => {
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
      disabled: isBusy || pending || !sessionId,
      pending: pendingAction === "plan",
      onToggle: togglePlan,
    } satisfies ComposerToggleControl,
    modeControls: (
      <>
        {plan.active ? (
          <Button
            type="button"
            variant="ghost"
            size={compact ? "icon-sm" : "sm"}
            disabled={isBusy || pending || !sessionId}
            aria-pressed="true"
            aria-label={t.studioOpenCodePlanMode}
            title={t.studioOpenCodePlanMode}
            data-analytics-event="composer.plan.toggle"
            data-analytics-label={t.studioOpenCodePlanMode}
            className={cn(
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
              <Settings2 aria-hidden className="size-3.5" />
            )}
            <span className={compact ? "sr-only" : undefined}>
              {t.studioOpenCodePlanMode}
            </span>
          </Button>
        ) : null}

        <Popover onOpenChange={openOptions}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              disabled={isBusy && !snapshot}
              aria-label={t.studioOpenCodeOptions}
              title={t.studioOpenCodeOptions}
              data-analytics-event="composer.agent_options.open"
              data-analytics-label={t.studioOpenCodeOptions}
              className="size-7 rounded-full"
            >
              <Bot aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-88 p-3">
            <PopoverHeader className="pb-1">
              <PopoverTitle>{t.studioOpenCodeOptions}</PopoverTitle>
            </PopoverHeader>

            {configOptions.length > 0 ? (
              <div className="divide-y divide-border/70">
                {configOptions.map((option) => (
                  <OpenCodeConfigRow
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
                  ? t.studioOpenCodeOptionsUnavailable
                  : t.studioOpenCodeStartChatFirst}
              </div>
            )}

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
                      const result = await requestOpenCodeControl<{
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
                  {t.studioOpenCodeForkSession}
                </Button>
              </div>
            ) : null}

            <div className="mt-2 border-t border-border/70 pt-2">
              <AcpSessionControls
                dense={false}
                disabled={isBusy || pending}
                locale={locale}
                runtimeId="opencode"
                sessionId={sessionId}
                showLabel
                onEnsureSession={async () => {
                  if (!sessionId) {
                    throw new Error(t.studioOpenCodeStartChatFirst)
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
