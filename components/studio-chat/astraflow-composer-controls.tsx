"use client"

import * as React from "react"
import type {
  SessionConfigOption,
  SessionModeState,
} from "@agentclientprotocol/sdk"
import { toast } from "sonner"

import { useI18n } from "@/components/i18n-provider"
import {
  ASTRAFLOW_DEFAULT_MODE,
  ASTRAFLOW_MODE_CONFIG_ID,
  ASTRAFLOW_PLAN_MODE,
  getAstraFlowPlanMode,
} from "@/lib/agent/acp/astraflow-features"

import type { ComposerToggleControl } from "./types"

type AstraFlowSessionSnapshot = {
  connected: true
  phase: "initialized" | "session"
  sessionId: string | null
  session: {
    configOptions: SessionConfigOption[]
    modes: SessionModeState | null
  }
}

type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error?: string }

function astraFlowAcpEndpoint(sessionId?: string) {
  const path = "/api/studio/agent-runtimes/astraflow/acp"

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
        : `AstraFlow control failed (${response.status}).`
    )
  }

  return payload.data
}

async function requestAstraFlowControl<T>(
  sessionId: string,
  control: Record<string, unknown>
) {
  const response = await fetch(astraFlowAcpEndpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, control }),
  })

  return readEnvelope<T>(response)
}

export function useAstraFlowComposerControls({
  isBusy,
  runtimeId,
  sessionId,
}: {
  isBusy: boolean
  runtimeId: string
  sessionId: string
}): { planControl: ComposerToggleControl | null } {
  const { t } = useI18n()
  const enabled = runtimeId === "astraflow"
  const [snapshot, setSnapshot] =
    React.useState<AstraFlowSessionSnapshot | null>(null)
  const [pending, setPending] = React.useState(false)

  const loadSnapshot = React.useCallback(async () => {
    if (!enabled || !sessionId) {
      setSnapshot(null)
      return null
    }

    try {
      const response = await fetch(astraFlowAcpEndpoint(sessionId), {
        cache: "no-store",
      })
      const data = await readEnvelope<AstraFlowSessionSnapshot | null>(response)

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

  const ensureActiveSnapshot = React.useCallback(async () => {
    if (!sessionId) {
      throw new Error(t.studioAstraFlowStartChatFirst)
    }
    if (snapshot?.phase === "session") {
      return snapshot
    }

    const next = await requestAstraFlowControl<AstraFlowSessionSnapshot>(
      sessionId,
      { action: "activate" }
    )
    setSnapshot(next)
    return next
  }, [sessionId, snapshot, t.studioAstraFlowStartChatFirst])

  const togglePlan = React.useCallback(() => {
    if (!enabled || isBusy || pending || !sessionId) {
      return
    }

    setPending(true)
    void (async () => {
      try {
        const active = await ensureActiveSnapshot()
        const plan = getAstraFlowPlanMode(
          active.session.configOptions,
          active.session.modes
        )

        if (!plan.available) {
          throw new Error(t.studioAstraFlowPlanUnavailable)
        }

        await requestAstraFlowControl(sessionId, {
          action: "set_config_option",
          configId: ASTRAFLOW_MODE_CONFIG_ID,
          value: plan.active ? ASTRAFLOW_DEFAULT_MODE : ASTRAFLOW_PLAN_MODE,
        })
        await loadSnapshot()
      } catch (error) {
        toast.error(t.studioAstraFlowControlFailed, {
          description: error instanceof Error ? error.message : String(error),
        })
      } finally {
        setPending(false)
      }
    })()
  }, [
    enabled,
    ensureActiveSnapshot,
    isBusy,
    loadSnapshot,
    pending,
    sessionId,
    t.studioAstraFlowControlFailed,
    t.studioAstraFlowPlanUnavailable,
  ])

  if (!enabled) {
    return { planControl: null }
  }

  const plan = getAstraFlowPlanMode(
    snapshot?.session.configOptions ?? [],
    snapshot?.session.modes ?? null
  )

  return {
    planControl: {
      active: plan.active,
      available: plan.available || snapshot?.phase !== "session",
      disabled: isBusy || pending || !sessionId,
      pending,
      onToggle: togglePlan,
    },
  }
}
