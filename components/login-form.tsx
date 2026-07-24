"use client"

import * as React from "react"
import {
  RiArrowRightLine,
  RiExternalLinkLine,
  RiLoader4Line,
} from "@remixicon/react"
import { toast } from "sonner"

import { AstraFlowLogo } from "@/components/astraflow-logo"
import { useI18n } from "@/components/i18n-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { navigateOAuthPopup, openOAuthPopupShell } from "@/lib/oauth-popup"

type OAuthStatus = {
  configured: boolean
  email: string | null
  expiresAt: number | null
  updatedAt: string | null
}

type OAuthFlowSnapshot = {
  state: string
  status: "pending" | "complete" | "error"
  authorizationUrl: string
  redirectUri: string
  port: number
  message: string | null
}

type OAuthStatusResponse =
  | {
      ok: true
      data: {
        auth: OAuthStatus
        flow: OAuthFlowSnapshot | null
      }
    }
  | {
      ok: false
      message?: string
    }

type OAuthStartResponse =
  | {
      ok: true
      data: OAuthFlowSnapshot
    }
  | {
      ok: false
      message?: string
    }

type OAuthCompleteResponse =
  | {
      ok: true
      data: {
        auth: OAuthStatus
        flow: OAuthFlowSnapshot
        message: string
      }
    }
  | {
      ok: false
      message?: string
    }

async function fetchOAuthStatus(state?: string) {
  const search = state ? `?state=${encodeURIComponent(state)}` : ""
  const response = await fetch(`/api/studio/oauth/status${search}`, {
    cache: "no-store",
  })
  const payload = (await response.json()) as OAuthStatusResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to load login status."
    )
  }

  return payload.data
}

async function startOAuthFlow() {
  const response = await fetch("/api/studio/oauth/start", { method: "POST" })
  const payload = (await response.json()) as OAuthStartResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) || "Failed to start CompShare OAuth."
    )
  }

  return payload.data
}

async function completeOAuthFlow(callbackUrl: string) {
  const response = await fetch("/api/studio/oauth/complete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callbackUrl }),
  })
  const payload = (await response.json()) as OAuthCompleteResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) ||
        "Failed to complete CompShare OAuth."
    )
  }

  return payload.data
}

function LoginForm() {
  const { t } = useI18n()
  const initialStatusLoadedRef = React.useRef(false)
  const [flow, setFlow] = React.useState<OAuthFlowSnapshot | null>(null)
  const [phase, setPhase] = React.useState<
    "checking" | "idle" | "starting" | "waiting" | "complete"
  >("checking")
  const [callbackUrl, setCallbackUrl] = React.useState("")
  const [callbackSubmitting, setCallbackSubmitting] = React.useState(false)

  const finishLogin = React.useCallback(() => {
    setPhase("complete")
    window.location.replace("/plans")
  }, [])

  const reloadStatus = React.useCallback(
    async (state?: string) => {
      const next = await fetchOAuthStatus(state)

      setFlow(next.flow)
      if (next.flow?.status === "error") {
        throw new Error(next.flow.message || t.loginCompShareFailed)
      }
      if (next.auth.configured) {
        finishLogin()
      }

      return next
    },
    [finishLogin, t.loginCompShareFailed]
  )

  React.useEffect(() => {
    if (initialStatusLoadedRef.current) {
      return
    }

    initialStatusLoadedRef.current = true
    queueMicrotask(() => {
      void reloadStatus()
        .then((next) => {
          if (!next.auth.configured) {
            setPhase("idle")
          }
        })
        .catch((error) => {
          setPhase("idle")
          toast.error(t.loginCompShareStatusLoadFailed, {
            description:
              error instanceof Error ? error.message : t.loginCompShareFailed,
          })
        })
    })
  }, [reloadStatus, t])

  React.useEffect(() => {
    if (!flow || flow.status !== "pending" || phase !== "waiting") {
      return
    }

    const timer = window.setInterval(() => {
      void reloadStatus(flow.state).catch((error) => {
        window.clearInterval(timer)
        setPhase("idle")
        toast.error(t.loginCompShareFailed, {
          description:
            error instanceof Error ? error.message : t.loginCompShareFailed,
        })
      })
    }, 1200)

    return () => window.clearInterval(timer)
  }, [flow, phase, reloadStatus, t])

  async function handleLogin() {
    try {
      setPhase("starting")
      setCallbackUrl("")

      const popup = openOAuthPopupShell()
      const nextFlow = await startOAuthFlow()

      setFlow(nextFlow)
      setPhase("waiting")
      navigateOAuthPopup(popup, nextFlow.authorizationUrl)
    } catch (error) {
      setPhase("idle")
      toast.error(t.loginCompShareFailed, {
        description:
          error instanceof Error ? error.message : t.loginCompShareFailed,
      })
    }
  }

  async function handleCompleteFromCallback() {
    try {
      setCallbackSubmitting(true)
      const next = await completeOAuthFlow(callbackUrl)

      setFlow(next.flow)
      setCallbackUrl("")
      finishLogin()
    } catch (error) {
      toast.error(t.loginCompShareFailed, {
        description:
          error instanceof Error ? error.message : t.loginCompShareFailed,
      })
    } finally {
      setCallbackSubmitting(false)
    }
  }

  const isBusy =
    phase === "checking" ||
    phase === "starting" ||
    phase === "waiting" ||
    phase === "complete" ||
    callbackSubmitting

  return (
    <Card className="border border-border/70">
      <CardHeader className="justify-items-center gap-2 pb-5">
        <AstraFlowLogo
          className="mx-auto h-9 w-fit"
          fetchPriority="high"
          loading="eager"
        />
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <Button
          className="h-11 w-full justify-center"
          disabled={isBusy}
          onClick={() => void handleLogin()}
          type="button"
        >
          {isBusy ? (
            <RiLoader4Line className="animate-spin" data-icon="inline-start" />
          ) : (
            <RiArrowRightLine data-icon="inline-start" />
          )}
          <span>
            {phase === "checking"
              ? t.loginCompShareChecking
              : phase === "waiting"
                ? t.loginFinishInBrowser
              : t.loginCompShareSubmit}
          </span>
        </Button>

        {flow?.authorizationUrl && phase === "waiting" ? (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-muted-foreground">
              {t.loginFinishInBrowser}
            </p>
            <Button asChild className="w-full" variant="outline">
              <a
                href={flow.authorizationUrl}
                rel="noreferrer"
                target="_blank"
              >
                <RiExternalLinkLine data-icon="inline-start" />
                {t.loginCompShareSubmit}
              </a>
            </Button>
            <Input
              disabled={callbackSubmitting}
              onChange={(event) => setCallbackUrl(event.target.value)}
              placeholder={t.loginCallbackPlaceholder}
              value={callbackUrl}
            />
            <Button
              className="w-full"
              disabled={callbackSubmitting || !callbackUrl.trim()}
              onClick={() => void handleCompleteFromCallback()}
              type="button"
              variant="outline"
            >
              {callbackSubmitting ? (
                <RiLoader4Line
                  className="animate-spin"
                  data-icon="inline-start"
                />
              ) : (
                <RiArrowRightLine data-icon="inline-start" />
              )}
              {t.loginCompleteWithCallback}
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

export { LoginForm }
