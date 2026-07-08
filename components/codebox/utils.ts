import * as React from "react"

import type { useI18n } from "@/components/i18n-provider"
import { cn } from "@/lib/utils"

import type { ApiEnvelope, CodeBoxSandbox } from "./types"

export class ApiRequestError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiRequestError"
    this.status = status
  }
}

export async function apiRequest<T>(
  url: string,
  init?: RequestInit,
  fallbackMessage = "Request failed."
) {
  const headers = new Headers(init?.headers)

  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json")
  }

  const response = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
  })
  const payload = (await response
    .json()
    .catch(() => null)) as ApiEnvelope<T> | null

  if (!response.ok || !payload?.ok) {
    const message =
      payload && "message" in payload && payload.message
        ? payload.message
        : fallbackMessage

    throw new ApiRequestError(message, response.status)
  }

  return payload.data
}

export function formatDate(value: string | null, locale?: string) {
  if (!value) {
    return "-"
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return "-"
  }

  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function getRepoName(repoUrl: string) {
  try {
    const url = new URL(repoUrl)
    const parts = url.pathname
      .replace(/\.git$/i, "")
      .split("/")
      .filter(Boolean)

    return parts.slice(-2).join("/") || repoUrl
  } catch {
    return repoUrl.replace(/\.git$/i, "")
  }
}

export function normalizeWorkspaceDirectoryPath(path: string) {
  const trimmed = path.trim()

  if (!trimmed) {
    throw new Error("Workspace directory is required.")
  }

  if (!trimmed.startsWith("/")) {
    throw new Error("Workspace directory must be an absolute path.")
  }

  if (trimmed.includes("\0")) {
    throw new Error("Workspace directory contains an invalid character.")
  }

  const parts: string[] = []

  for (const part of trimmed.split("/")) {
    if (!part || part === ".") {
      continue
    }

    if (part === "..") {
      if (parts.length === 0) {
        throw new Error("Workspace directory cannot escape root.")
      }

      parts.pop()
      continue
    }

    parts.push(part)
  }

  return `/${parts.join("/")}` || "/"
}

export function createWorkspaceUrl(sandbox: CodeBoxSandbox, workspacePath: string) {
  const baseUrl = sandbox.codeServerUrl

  if (!baseUrl) {
    throw new Error("CodeBox URL is unavailable.")
  }

  const url = new URL(baseUrl)
  url.searchParams.set("folder", workspacePath)

  return url.toString()
}

export function getSandboxStatusLabel(
  status: CodeBoxSandbox["status"],
  t: ReturnType<typeof useI18n>["t"]
) {
  if (status === "running") {
    return t.codeboxStatusRunning
  }

  if (status === "paused") {
    return t.codeboxStatusPaused
  }

  return t.codeboxStatusUnknown
}

export function VSCodeIcon({ className }: { className?: string }) {
  return React.createElement(
    "svg",
    {
      viewBox: "0 0 24 24",
      "aria-hidden": "true",
      className: cn("shrink-0 text-[#007acc]", className),
      fill: "none",
    },
    React.createElement("path", {
      fill: "currentColor",
      d: "M18.2 3.2 9.35 10.05 4.6 6.45 2.25 7.85 6.95 12l-4.7 4.15 2.35 1.4 4.75-3.6 8.85 6.85c1.05.8 2.55.05 2.55-1.25V4.45c0-1.3-1.5-2.05-2.55-1.25Zm-.45 4.3v9L11.95 12l5.8-4.5Z",
    })
  )
}

function copyWithFallback(value: string) {
  let eventCopied = false
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) {
      return
    }

    event.clipboardData.setData("text/plain", value)
    event.preventDefault()
    eventCopied = true
  }

  document.addEventListener("copy", onCopy)

  try {
    document.execCommand("copy")

    if (eventCopied) {
      return true
    }
  } finally {
    document.removeEventListener("copy", onCopy)
  }

  const textarea = document.createElement("textarea")
  const selection = document.getSelection()
  const selectedRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange()
      )
    : []
  const activeElement =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

  textarea.value = value
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "0"
  textarea.style.left = "0"
  textarea.style.width = "1px"
  textarea.style.height = "1px"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.focus({ preventScroll: true })
  textarea.select()
  textarea.setSelectionRange(0, value.length)

  try {
    return document.execCommand("copy")
  } finally {
    document.body.removeChild(textarea)
    selection?.removeAllRanges()
    selectedRanges.forEach((range) => selection?.addRange(range))
    activeElement?.focus({ preventScroll: true })
  }
}

export async function writeClipboard(value: string) {
  if (copyWithFallback(value)) {
    return true
  }

  if (!window.isSecureContext || !navigator.clipboard?.writeText) {
    return false
  }

  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
