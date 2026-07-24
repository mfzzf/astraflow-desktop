import { lookup } from "node:dns/promises"
import { BlockList, isIP, type LookupFunction } from "node:net"

import { Agent, fetch as undiciFetch } from "undici"

const DEFAULT_MAX_REDIRECTS = 5
const MAX_CONFIGURABLE_REDIRECTS = 10
const PUBLIC_DNS_LOOKUP_TIMEOUT_MS = 5_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const PUBLIC_DNS_OVER_HTTPS_URL = "https://cloudflare-dns.com/dns-query"

const blockedIpv4 = new BlockList()
const blockedIpv6 = new BlockList()
const proxySyntheticIpv4 = new BlockList()

proxySyntheticIpv4.addSubnet("198.18.0.0", 15, "ipv4")

for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["168.63.129.16", 32],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4")
}

for (const [network, prefix] of [
  ["::", 96],
  ["::ffff:0.0.0.0", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6")
}

type UndiciFetch = typeof undiciFetch
type UndiciFetchResponse = Awaited<ReturnType<UndiciFetch>>
type UndiciRequestInit = NonNullable<Parameters<UndiciFetch>[1]>
type UndiciDispatcher = NonNullable<UndiciRequestInit["dispatcher"]>

export type SafeWebFetchAddress = {
  address: string
  family: 4 | 6
}

export type SafeWebFetchTarget = {
  addresses: SafeWebFetchAddress[]
  hostname: string
  pinnedAddress: SafeWebFetchAddress
  url: URL
}

export type SafeWebFetchResolver = (
  hostname: string
) => Promise<SafeWebFetchAddress[]>

export type ProxyAwareWebFetchResolverDependencies = {
  publicResolver?: SafeWebFetchResolver
  systemResolver?: SafeWebFetchResolver
}

type SafeWebFetchDispatcherLease = {
  close: () => Promise<void>
  dispatcher: UndiciDispatcher
}

export type SafeWebFetchDependencies = {
  createDispatcher?: (target: SafeWebFetchTarget) => SafeWebFetchDispatcherLease
  fetchImpl?: UndiciFetch
  resolver?: SafeWebFetchResolver
}

export type SafeWebFetchOptions = {
  headers?: UndiciRequestInit["headers"]
  maxRedirects?: number
  signal?: AbortSignal
}

export type OriginBoundSafeFetchOptions = {
  allowedOrigin: string
}

function normalizedHostname(hostname: string) {
  return hostname
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/g, "")
    .toLowerCase()
}

function unsafeTarget(message: string) {
  return new Error(`Unsafe web fetch target: ${message}`)
}

export function isPublicWebFetchAddress(address: string) {
  const normalized = normalizedHostname(address)
  const family = isIP(normalized)

  if (family === 4) {
    return !blockedIpv4.check(normalized, "ipv4")
  }

  if (family === 6) {
    return !blockedIpv6.check(normalized, "ipv6")
  }

  return false
}

function parseSafeWebFetchUrl(input: string | URL) {
  let url

  try {
    url = new URL(input)
  } catch {
    throw unsafeTarget("the URL is invalid.")
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw unsafeTarget("only HTTP and HTTPS URLs are allowed.")
  }

  if (url.username || url.password) {
    throw unsafeTarget("URLs containing credentials are not allowed.")
  }

  const hostname = normalizedHostname(url.hostname)

  if (!hostname) {
    throw unsafeTarget("the URL does not contain a hostname.")
  }

  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw unsafeTarget("localhost is not allowed.")
  }

  return { hostname, url }
}

async function systemResolver(hostname: string) {
  const addresses = await lookup(hostname, {
    all: true,
    verbatim: true,
  })

  return addresses
    .filter(
      (
        address
      ): address is {
        address: string
        family: 4 | 6
      } => address.family === 4 || address.family === 6
    )
    .map(({ address, family }) => ({ address, family }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isProxySyntheticWebFetchAddress(address: string) {
  const normalized = normalizedHostname(address)

  return isIP(normalized) === 4 && proxySyntheticIpv4.check(normalized, "ipv4")
}

async function resolvePublicDnsOverHttps(hostname: string) {
  const settled = await Promise.allSettled(
    [
      { family: 4 as const, recordType: "A", responseType: 1 },
      { family: 6 as const, recordType: "AAAA", responseType: 28 },
    ].map(async ({ family, recordType, responseType }) => {
      const url = new URL(PUBLIC_DNS_OVER_HTTPS_URL)
      url.searchParams.set("name", hostname)
      url.searchParams.set("type", recordType)

      const response = await undiciFetch(url, {
        headers: {
          accept: "application/dns-json",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(PUBLIC_DNS_LOOKUP_TIMEOUT_MS),
      })

      if (!response.ok) {
        throw new Error("The public DNS resolver request failed.")
      }

      const payload: unknown = await response.json()

      if (!isRecord(payload) || payload.Status !== 0) {
        throw new Error("The public DNS resolver returned an invalid response.")
      }

      const answers = Array.isArray(payload.Answer) ? payload.Answer : []

      return answers.flatMap((answer): SafeWebFetchAddress[] => {
        if (
          !isRecord(answer) ||
          answer.type !== responseType ||
          typeof answer.data !== "string" ||
          isIP(answer.data) !== family
        ) {
          return []
        }

        return [{ address: answer.data, family }]
      })
    })
  )
  const addresses = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : []
  )

  if (addresses.length === 0) {
    throw new Error(`Unable to resolve public web fetch hostname: ${hostname}.`)
  }

  return addresses
}

export async function resolveProxyAwareWebFetchAddresses(
  hostname: string,
  dependencies: ProxyAwareWebFetchResolverDependencies = {}
) {
  const resolvedAddresses = await (
    dependencies.systemResolver ?? systemResolver
  )(hostname)

  if (
    resolvedAddresses.length === 0 ||
    !resolvedAddresses.every(({ address }) =>
      isProxySyntheticWebFetchAddress(address)
    )
  ) {
    return resolvedAddresses
  }

  return (dependencies.publicResolver ?? resolvePublicDnsOverHttps)(hostname)
}

export async function resolveSafeWebFetchTarget(
  input: string | URL,
  resolver: SafeWebFetchResolver = resolveProxyAwareWebFetchAddresses
): Promise<SafeWebFetchTarget> {
  const { hostname, url } = parseSafeWebFetchUrl(input)
  const literalFamily = isIP(hostname)
  let resolvedAddresses: SafeWebFetchAddress[]

  if (literalFamily === 4 || literalFamily === 6) {
    resolvedAddresses = [
      {
        address: hostname,
        family: literalFamily,
      },
    ]
  } else {
    try {
      resolvedAddresses = await resolver(hostname)
    } catch {
      throw new Error(`Unable to resolve web fetch hostname: ${hostname}.`)
    }
  }

  const addresses = [
    ...new Map(
      resolvedAddresses
        .filter(
          (address) =>
            (address.family === 4 || address.family === 6) &&
            isIP(address.address) === address.family
        )
        .map((address) => [
          `${address.family}:${address.address}`,
          {
            address: address.address,
            family: address.family,
          },
        ])
    ).values(),
  ]

  if (addresses.length === 0) {
    throw new Error(`Unable to resolve web fetch hostname: ${hostname}.`)
  }

  const blockedAddress = addresses.find(
    ({ address }) => !isPublicWebFetchAddress(address)
  )

  if (blockedAddress) {
    throw unsafeTarget(
      `hostname ${hostname} resolves to a non-public network address.`
    )
  }

  return {
    addresses,
    hostname,
    pinnedAddress: addresses[0],
    url,
  }
}

export function createPinnedLookupForSafeWebFetch(
  target: Pick<SafeWebFetchTarget, "hostname" | "pinnedAddress">
): LookupFunction {
  return (hostname, options, callback) => {
    if (normalizedHostname(hostname) !== target.hostname) {
      const error = new Error(
        "Safe web fetch refused an unexpected DNS lookup."
      ) as NodeJS.ErrnoException
      error.code = "ENOTFOUND"

      if (options.all) {
        callback(error, [])
      } else {
        callback(error, "", 0)
      }
      return
    }

    if (options.all) {
      callback(null, [target.pinnedAddress])
    } else {
      callback(null, target.pinnedAddress.address, target.pinnedAddress.family)
    }
  }
}

function createPinnedDispatcher(
  target: SafeWebFetchTarget
): SafeWebFetchDispatcherLease {
  const dispatcher = new Agent({
    connections: 1,
    connect: {
      lookup: createPinnedLookupForSafeWebFetch(target),
    },
    pipelining: 1,
  })

  return {
    close: () => dispatcher.close(),
    dispatcher,
  }
}

function safeRedirectLimit(value: number | undefined) {
  if (!Number.isSafeInteger(value)) {
    return DEFAULT_MAX_REDIRECTS
  }

  return Math.min(
    Math.max(value ?? DEFAULT_MAX_REDIRECTS, 0),
    MAX_CONFIGURABLE_REDIRECTS
  )
}

function safeRequestHeaders(headers: UndiciRequestInit["headers"]) {
  const safeHeaders = new Headers(headers as HeadersInit)

  for (const name of [
    "authorization",
    "cookie",
    "host",
    "proxy-authorization",
  ]) {
    safeHeaders.delete(name)
  }

  return safeHeaders
}

async function closeAfterDiscarding(
  response: UndiciFetchResponse,
  lease: SafeWebFetchDispatcherLease
) {
  try {
    await response.body?.cancel()
  } finally {
    await lease.close()
  }
}

function releaseSafeFetchResponse(
  response: UndiciFetchResponse,
  lease: SafeWebFetchDispatcherLease,
  signal?: AbortSignal | null
) {
  const source = response.body

  if (
    !source ||
    response.status === 204 ||
    response.status === 205 ||
    response.status === 304
  ) {
    void source?.cancel().catch(() => undefined)
    void lease.close().catch(() => undefined)

    return new Response(null, {
      headers: response.headers as unknown as HeadersInit,
      status: response.status,
      statusText: response.statusText,
    })
  }

  const reader = source.getReader()
  let released = false

  const release = async () => {
    if (released) {
      return
    }

    released = true
    signal?.removeEventListener("abort", abort)
    await lease.close().catch(() => undefined)
  }
  const abort = () => {
    void reader
      .cancel(signal?.reason)
      .catch(() => undefined)
      .finally(release)
  }

  if (signal?.aborted) {
    abort()
  } else {
    signal?.addEventListener("abort", abort, { once: true })
  }

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read()

        if (chunk.done) {
          controller.close()
          await release()
          return
        }

        controller.enqueue(chunk.value)
      } catch (error) {
        controller.error(error)
        await release()
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        await release()
      }
    },
  })

  return new Response(body, {
    headers: response.headers as unknown as HeadersInit,
    status: response.status,
    statusText: response.statusText,
  })
}

/**
 * Creates a fetch implementation for a credentialed, fixed-origin protocol
 * transport such as MCP. Unlike the public web-fetch helper, caller headers
 * are preserved; the destination is therefore pinned to one origin and every
 * redirect is rejected instead of forwarding credentials to another hop.
 */
export function createOriginBoundSafeFetch(
  options: OriginBoundSafeFetchOptions,
  dependencies: SafeWebFetchDependencies = {}
): (input: string | URL, init?: RequestInit) => Promise<Response> {
  const allowedUrl = parseSafeWebFetchUrl(options.allowedOrigin).url
  const allowedOrigin = allowedUrl.origin
  const createDispatcher =
    dependencies.createDispatcher || createPinnedDispatcher
  const fetchImpl = dependencies.fetchImpl || undiciFetch
  const resolver = dependencies.resolver || resolveProxyAwareWebFetchAddresses

  return async (input, init = {}) => {
    const target = await resolveSafeWebFetchTarget(input, resolver)

    if (target.url.origin !== allowedOrigin) {
      throw unsafeTarget(
        `origin ${target.url.origin} does not match the configured origin ${allowedOrigin}.`
      )
    }

    const lease = createDispatcher(target)
    let response: UndiciFetchResponse

    try {
      response = await fetchImpl(target.url, {
        ...(init as unknown as UndiciRequestInit),
        dispatcher: lease.dispatcher,
        redirect: "manual",
      })
    } catch (error) {
      await lease.close().catch(() => undefined)
      throw error
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      await closeAfterDiscarding(response, lease)
      throw unsafeTarget(
        "redirects are not allowed for credentialed fixed-origin requests."
      )
    }

    return releaseSafeFetchResponse(response, lease, init.signal)
  }
}

/**
 * Fetch an untrusted URL while pinning each request to a prevalidated public
 * DNS answer. Redirects are handled manually and re-enter the same validation
 * path before any subsequent connection is opened.
 */
export async function consumeSafeWebFetch<T>(
  input: string | URL,
  consume: (response: UndiciFetchResponse, finalUrl: URL) => Promise<T>,
  options: SafeWebFetchOptions = {},
  dependencies: SafeWebFetchDependencies = {}
): Promise<T> {
  const createDispatcher =
    dependencies.createDispatcher || createPinnedDispatcher
  const fetchImpl = dependencies.fetchImpl || undiciFetch
  const resolver = dependencies.resolver || resolveProxyAwareWebFetchAddresses
  const maxRedirects = safeRedirectLimit(options.maxRedirects)
  const headers = safeRequestHeaders(options.headers)
  let redirects = 0
  let nextUrl = input

  while (true) {
    const target = await resolveSafeWebFetchTarget(nextUrl, resolver)
    const lease = createDispatcher(target)
    let response

    try {
      response = await fetchImpl(target.url, {
        dispatcher: lease.dispatcher,
        headers,
        redirect: "manual",
        signal: options.signal,
      })
    } catch (error) {
      await lease.close().catch(() => undefined)
      throw error
    }

    const location = response.headers.get("location")

    if (location && REDIRECT_STATUSES.has(response.status)) {
      await closeAfterDiscarding(response, lease)

      if (redirects >= maxRedirects) {
        throw new Error(
          `Web fetch exceeded the ${maxRedirects}-redirect limit.`
        )
      }

      try {
        nextUrl = new URL(location, target.url)
      } catch {
        throw new Error("Web fetch received an invalid redirect URL.")
      }

      redirects += 1
      continue
    }

    try {
      return await consume(response, target.url)
    } finally {
      await lease.close()
    }
  }
}
