import { type NextRequest, NextResponse } from "next/server"
import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

import { getAppAuthState } from "@/lib/app-auth"

export const runtime = "nodejs"

const MAX_TITLE_BYTES = 160_000
const MAX_TITLE_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36 CompShare/1.0"

async function requireAuthenticatedRequest() {
  const auth = await getAppAuthState()

  if (!auth.authenticated) {
    return NextResponse.json(
      { ok: false, error: "Login is required." },
      { status: 401 }
    )
  }

  return null
}

function parseHttpUrl(value: string | null) {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null
    }

    return url
  } catch {
    return null
  }
}

function isPrivateAddress(address: string) {
  if (address === "::1") {
    return true
  }

  if (address.startsWith("fc") || address.startsWith("fd")) {
    return true
  }

  if (address.startsWith("fe80:")) {
    return true
  }

  const parts = address.split(".").map((part) => Number(part))

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) {
    return false
  }

  const [a, b] = parts

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

async function isPublicHost(hostname: string) {
  const normalized = hostname.toLowerCase()

  if (normalized === "localhost" || normalized.endsWith(".localhost")) {
    return false
  }

  if (isIP(normalized)) {
    return !isPrivateAddress(normalized)
  }

  const records = await lookup(normalized, { all: true, verbatim: false })

  return records.length > 0 && records.every((record) => !isPrivateAddress(record.address))
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  const title = match?.[1]
    ?.replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()

  return title ? decodeHtmlEntities(title) : ""
}

async function fetchTitleDocument(initialUrl: URL, signal: AbortSignal) {
  let currentUrl = initialUrl

  for (
    let redirectCount = 0;
    redirectCount <= MAX_TITLE_REDIRECTS;
    redirectCount += 1
  ) {
    if (!(await isPublicHost(currentUrl.hostname).catch(() => false))) {
      throw new Error("Browser title redirect target is not public.")
    }

    const response = await fetch(currentUrl, {
      headers: { "user-agent": BROWSER_USER_AGENT },
      redirect: "manual",
      signal,
    })

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, url: currentUrl }
    }

    const location = response.headers.get("location")

    if (!location || redirectCount === MAX_TITLE_REDIRECTS) {
      return { response, url: currentUrl }
    }

    if (response.body) {
      await response.body.cancel().catch(() => undefined)
    }

    const redirectUrl = parseHttpUrl(new URL(location, currentUrl).toString())

    if (!redirectUrl) {
      throw new Error("Browser title redirect target is invalid.")
    }

    currentUrl = redirectUrl
  }

  throw new Error("Browser title redirect limit exceeded.")
}

export async function GET(request: NextRequest) {
  const authError = await requireAuthenticatedRequest()

  if (authError) {
    return authError
  }

  const url = parseHttpUrl(request.nextUrl.searchParams.get("url"))

  if (!url) {
    return NextResponse.json(
      { ok: false, error: "A valid HTTP URL is required." },
      { status: 400 }
    )
  }

  if (!(await isPublicHost(url.hostname).catch(() => false))) {
    return NextResponse.json(
      { ok: false, error: "Only public website URLs are supported." },
      { status: 400 }
    )
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6_000)

  try {
    const { response, url: finalUrl } = await fetchTitleDocument(
      url,
      controller.signal
    )
    const body = await response.text()
    const title = extractTitle(body.slice(0, MAX_TITLE_BYTES))

    return NextResponse.json({
      ok: true,
      title: title || finalUrl.hostname.replace(/^www\./, ""),
    })
  } catch {
    return NextResponse.json({
      ok: true,
      title: url.hostname.replace(/^www\./, ""),
    })
  } finally {
    clearTimeout(timeout)
  }
}
