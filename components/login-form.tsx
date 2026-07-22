"use client"

import * as React from "react"
import {
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiKey2Line,
  RiLoader4Line,
} from "@remixicon/react"
import { toast } from "sonner"

import { AstraFlowLogo } from "@/components/astraflow-logo"
import { useI18n } from "@/components/i18n-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card"
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type CompShareCredentialStatus = {
  configured: boolean
  publicKeyPreview: string | null
  updatedAt: string | null
}

type CompShareCredentialsResponse =
  | {
      ok: true
      data: CompShareCredentialStatus
    }
  | {
      ok: false
      message?: string
    }

type CompShareCredentialFieldErrors = {
  publicKey?: string
  privateKey?: string
}

async function fetchCompShareCredentialStatus(signal?: AbortSignal) {
  const response = await fetch("/api/compshare/credentials", {
    cache: "no-store",
    signal,
  })
  const payload = (await response.json()) as CompShareCredentialsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) ||
        "Failed to load CompShare credential status."
    )
  }

  return payload.data
}

async function loginWithCompShareCredentials(
  publicKey: string,
  privateKey: string
) {
  const response = await fetch("/api/compshare/credentials", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicKey, privateKey }),
  })
  const payload = (await response.json()) as CompShareCredentialsResponse

  if (!response.ok || !payload.ok) {
    throw new Error(
      (!payload.ok && payload.message) ||
        "Failed to validate CompShare credentials."
    )
  }

  return payload.data
}

function LoginForm() {
  const { t } = useI18n()
  const publicKeyRef = React.useRef<HTMLInputElement>(null)
  const privateKeyRef = React.useRef<HTMLInputElement>(null)
  const [fieldErrors, setFieldErrors] =
    React.useState<CompShareCredentialFieldErrors>({})
  const [error, setError] = React.useState("")
  const [statusLoading, setStatusLoading] = React.useState(true)
  const [submitting, setSubmitting] = React.useState(false)
  const isBusy = statusLoading || submitting

  React.useEffect(() => {
    const controller = new AbortController()

    void fetchCompShareCredentialStatus(controller.signal)
      .then((status) => {
        if (status.configured) {
          window.location.replace("/plans")
        }
      })
      .catch((statusError) => {
        if (controller.signal.aborted) {
          return
        }

        const message =
          statusError instanceof Error
            ? statusError.message
            : t.loginCompShareStatusLoadFailed
        setError(message)
        toast.error(t.loginCompShareStatusLoadFailed, {
          description: message,
        })
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setStatusLoading(false)
        }
      })

    return () => {
      controller.abort()
    }
  }, [t])

  async function handleCompShareLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextPublicKey = publicKeyRef.current?.value.trim() ?? ""
    const nextPrivateKey = privateKeyRef.current?.value.trim() ?? ""
    const nextFieldErrors: CompShareCredentialFieldErrors = {}

    if (!nextPublicKey) {
      nextFieldErrors.publicKey = t.loginCompSharePublicKeyRequired
    }
    if (!nextPrivateKey) {
      nextFieldErrors.privateKey = t.loginCompSharePrivateKeyRequired
    }

    setFieldErrors(nextFieldErrors)
    if (nextFieldErrors.publicKey || nextFieldErrors.privateKey) {
      setError("")
      if (nextFieldErrors.publicKey) {
        publicKeyRef.current?.focus()
      } else {
        privateKeyRef.current?.focus()
      }
      return
    }

    try {
      setSubmitting(true)
      setError("")

      await loginWithCompShareCredentials(nextPublicKey, nextPrivateKey)

      if (publicKeyRef.current) {
        publicKeyRef.current.value = ""
      }
      if (privateKeyRef.current) {
        privateKeyRef.current.value = ""
      }
      toast.success(t.loginCompShareSuccess)
      window.location.replace("/plans")
    } catch (loginError) {
      const message =
        loginError instanceof Error
          ? loginError.message
          : t.loginCompShareFailed
      setError(message)
      toast.error(t.loginCompShareFailed, { description: message })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card className="border border-border/70">
      <CardHeader className="justify-items-center gap-2 pb-5">
        <AstraFlowLogo
          className="mx-auto h-9 w-fit"
          fetchPriority="high"
          loading="eager"
        />
        <Button
          asChild
          className="h-auto gap-1 px-0 text-xs"
          size="sm"
          variant="link"
        >
          <a
            href="https://console.compshare.cn/uaccount/api_manage"
            rel="noreferrer"
            target="_blank"
          >
            {t.loginCompShareGetApiKey}
            <RiExternalLinkLine aria-hidden className="size-3.5" />
          </a>
        </Button>
      </CardHeader>

      <CardContent>
        <form
          aria-busy={isBusy}
          id="compshare-credential-login"
          method="post"
          noValidate
          onSubmit={handleCompShareLogin}
        >
          <FieldGroup className="gap-5">
            <Field
              data-disabled={isBusy}
              data-invalid={Boolean(fieldErrors.publicKey)}
            >
              <FieldLabel htmlFor="compshare-public-key">
                {t.loginCompSharePublicKeyLabel}
              </FieldLabel>
              <Input
                aria-describedby={
                  fieldErrors.publicKey
                    ? "compshare-public-key-error"
                    : undefined
                }
                aria-invalid={Boolean(fieldErrors.publicKey)}
                autoCapitalize="none"
                autoComplete="off"
                disabled={isBusy}
                id="compshare-public-key"
                onChange={() => {
                  if (fieldErrors.publicKey) {
                    setFieldErrors((current) => ({
                      ...current,
                      publicKey: undefined,
                    }))
                  }
                  if (error) {
                    setError("")
                  }
                }}
                placeholder={t.loginCompSharePublicKeyPlaceholder}
                ref={publicKeyRef}
                required
                spellCheck={false}
                type="password"
              />
              <FieldError id="compshare-public-key-error">
                {fieldErrors.publicKey}
              </FieldError>
            </Field>

            <Field
              data-disabled={isBusy}
              data-invalid={Boolean(fieldErrors.privateKey)}
            >
              <FieldLabel htmlFor="compshare-private-key">
                {t.loginCompSharePrivateKeyLabel}
              </FieldLabel>
              <Input
                aria-describedby={
                  fieldErrors.privateKey
                    ? "compshare-private-key-error"
                    : undefined
                }
                aria-invalid={Boolean(fieldErrors.privateKey)}
                autoCapitalize="none"
                autoComplete="off"
                disabled={isBusy}
                id="compshare-private-key"
                onChange={() => {
                  if (fieldErrors.privateKey) {
                    setFieldErrors((current) => ({
                      ...current,
                      privateKey: undefined,
                    }))
                  }
                  if (error) {
                    setError("")
                  }
                }}
                placeholder={t.loginCompSharePrivateKeyPlaceholder}
                ref={privateKeyRef}
                required
                spellCheck={false}
                type="password"
              />
              <FieldError id="compshare-private-key-error">
                {fieldErrors.privateKey}
              </FieldError>
            </Field>

            {error ? (
              <Alert variant="destructive">
                <RiErrorWarningLine aria-hidden />
                <AlertTitle>{t.loginCompShareErrorTitle}</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            <p
              aria-atomic="true"
              aria-live="polite"
              className="sr-only"
              role="status"
            >
              {statusLoading
                ? t.loginCompShareChecking
                : submitting
                  ? t.loginCompShareValidating
                  : ""}
            </p>
          </FieldGroup>
        </form>
      </CardContent>

      <CardFooter>
        <Button
          className="h-11 w-full justify-center"
          disabled={isBusy}
          form="compshare-credential-login"
          type="submit"
        >
          {isBusy ? (
            <RiLoader4Line className="animate-spin" data-icon="inline-start" />
          ) : (
            <RiKey2Line data-icon="inline-start" />
          )}
          <span>
            {statusLoading
              ? t.loginCompShareChecking
              : submitting
                ? t.loginCompShareValidating
                : t.loginCompShareSubmit}
          </span>
        </Button>
      </CardFooter>
    </Card>
  )
}

export { LoginForm }
