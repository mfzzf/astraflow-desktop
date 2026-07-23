// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import {
  consumeSafeWebFetch,
  createOriginBoundSafeFetch,
  createPinnedLookupForSafeWebFetch,
  isPublicWebFetchAddress,
  resolveSafeWebFetchTarget,
  type SafeWebFetchAddress,
  type SafeWebFetchDependencies,
  type SafeWebFetchTarget,
} from "@/lib/network/safe-web-fetch"

const PUBLIC_IPV4: SafeWebFetchAddress = {
  address: "93.184.216.34",
  family: 4,
}
const SECOND_PUBLIC_IPV4: SafeWebFetchAddress = {
  address: "8.8.8.8",
  family: 4,
}

describe("safe web fetch network boundaries", () => {
  test("rejects local, private, metadata, special-use, and documentation addresses", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "168.63.129.16",
      "169.254.169.254",
      "172.16.0.1",
      "192.0.0.1",
      "192.0.2.1",
      "192.88.99.1",
      "192.168.1.1",
      "198.18.0.1",
      "198.51.100.1",
      "203.0.113.1",
      "224.0.0.1",
      "255.255.255.255",
      "::",
      "::1",
      "::ffff:127.0.0.1",
      "64:ff9b::a00:1",
      "100::1",
      "2001::1",
      "2001:2::1",
      "2001:db8::1",
      "2002:0a00:0001::",
      "3fff::1",
      "fc00::1",
      "fe80::1",
      "ff02::1",
    ]) {
      expect(isPublicWebFetchAddress(address)).toBe(false)
    }

    expect(isPublicWebFetchAddress(PUBLIC_IPV4.address)).toBe(true)
    expect(isPublicWebFetchAddress("2606:4700:4700::1111")).toBe(true)
    expect(isPublicWebFetchAddress("not-an-address")).toBe(false)
  })

  test("rejects unsupported, credentialed, localhost, literal private, and DNS-private targets", async () => {
    const publicResolver = async () => [PUBLIC_IPV4]

    await expect(
      resolveSafeWebFetchTarget("file:///etc/passwd", publicResolver)
    ).rejects.toThrow(/only HTTP and HTTPS/)
    await expect(
      resolveSafeWebFetchTarget(
        "https://user:password@public.example/",
        publicResolver
      )
    ).rejects.toThrow(/credentials/)
    await expect(
      resolveSafeWebFetchTarget("https://localhost./", publicResolver)
    ).rejects.toThrow(/localhost/)
    await expect(
      resolveSafeWebFetchTarget("http://169.254.169.254/latest", publicResolver)
    ).rejects.toThrow(/non-public/)
    await expect(
      resolveSafeWebFetchTarget("https://private.example/", async () => [
        { address: "10.0.0.2", family: 4 },
      ])
    ).rejects.toThrow(/non-public/)
    await expect(
      resolveSafeWebFetchTarget("https://mixed.example/", async () => [
        PUBLIC_IPV4,
        { address: "127.0.0.1", family: 4 },
      ])
    ).rejects.toThrow(/non-public/)
  })

  test("pins the connector lookup to the prevalidated address", async () => {
    const target = await resolveSafeWebFetchTarget(
      "https://public.example/",
      async () => [PUBLIC_IPV4, SECOND_PUBLIC_IPV4]
    )
    const pinnedLookup = createPinnedLookupForSafeWebFetch(target)

    const single = await new Promise<{ address: string; family: number }>(
      (resolve, reject) => {
        pinnedLookup(
          "public.example",
          { all: false },
          (error, address, family) => {
            if (error) {
              reject(error)
              return
            }

            resolve({
              address: address as string,
              family: family ?? 0,
            })
          }
        )
      }
    )
    const all = await new Promise<SafeWebFetchAddress[]>((resolve, reject) => {
      pinnedLookup("public.example", { all: true }, (error, addresses) => {
        if (error) {
          reject(error)
          return
        }

        resolve(addresses as SafeWebFetchAddress[])
      })
    })

    expect(single).toEqual(PUBLIC_IPV4)
    expect(all).toEqual([PUBLIC_IPV4])
    expect(target.addresses).toEqual([PUBLIC_IPV4, SECOND_PUBLIC_IPV4])
  })

  test("resolves, validates, and pins every redirect hop", async () => {
    const resolvedHostnames: string[] = []
    const fetchedUrls: string[] = []
    const pinnedTargets: SafeWebFetchTarget[] = []
    const closedTargets: string[] = []
    const responses = [
      new Response(null, {
        headers: { location: "https://two.example/final" },
        status: 302,
      }),
      new Response("done", { status: 200 }),
    ]
    const dependencies: SafeWebFetchDependencies = {
      async resolver(hostname) {
        resolvedHostnames.push(hostname)
        return hostname === "one.example" ? [PUBLIC_IPV4] : [SECOND_PUBLIC_IPV4]
      },
      createDispatcher(target) {
        pinnedTargets.push(target)
        return {
          async close() {
            closedTargets.push(target.hostname)
          },
          dispatcher: { target } as never,
        }
      },
      fetchImpl: (async (input, init) => {
        fetchedUrls.push(String(input))
        const headers = new Headers(init?.headers as HeadersInit)

        expect(init?.redirect).toBe("manual")
        expect(headers.get("user-agent")).toBe("AstraFlow-WebFetch/1.0")
        expect(headers.has("authorization")).toBe(false)
        expect(headers.has("cookie")).toBe(false)

        const response = responses.shift()

        if (!response) {
          throw new Error("Unexpected fetch")
        }

        return response as never
      }) as NonNullable<SafeWebFetchDependencies["fetchImpl"]>,
    }

    const text = await consumeSafeWebFetch(
      "https://one.example/start",
      (response) => response.text(),
      {
        headers: {
          Authorization: "must-not-leak",
          Cookie: "must-not-leak",
          "User-Agent": "AstraFlow-WebFetch/1.0",
        },
      },
      dependencies
    )

    expect(text).toBe("done")
    expect(resolvedHostnames).toEqual(["one.example", "two.example"])
    expect(fetchedUrls).toEqual([
      "https://one.example/start",
      "https://two.example/final",
    ])
    expect(pinnedTargets.map((target) => target.pinnedAddress)).toEqual([
      PUBLIC_IPV4,
      SECOND_PUBLIC_IPV4,
    ])
    expect(closedTargets).toEqual(["one.example", "two.example"])
  })

  test("blocks a private redirect before opening the second connection", async () => {
    let fetchCount = 0
    let closeCount = 0

    await expect(
      consumeSafeWebFetch(
        "https://public.example/start",
        async () => "unreachable",
        {},
        {
          async resolver() {
            return [PUBLIC_IPV4]
          },
          createDispatcher() {
            return {
              async close() {
                closeCount += 1
              },
              dispatcher: {} as never,
            }
          },
          fetchImpl: (async () => {
            fetchCount += 1
            return new Response(null, {
              headers: {
                location: "http://169.254.169.254/latest/meta-data/",
              },
              status: 302,
            }) as never
          }) as NonNullable<SafeWebFetchDependencies["fetchImpl"]>,
        }
      )
    ).rejects.toThrow(/non-public/)

    expect(fetchCount).toBe(1)
    expect(closeCount).toBe(1)
  })

  test("enforces the configured redirect limit", async () => {
    let fetchCount = 0
    let closeCount = 0

    await expect(
      consumeSafeWebFetch(
        "https://public.example/start",
        async () => "unreachable",
        { maxRedirects: 1 },
        {
          async resolver() {
            return [PUBLIC_IPV4]
          },
          createDispatcher() {
            return {
              async close() {
                closeCount += 1
              },
              dispatcher: {} as never,
            }
          },
          fetchImpl: (async () => {
            fetchCount += 1
            return new Response(null, {
              headers: { location: `/redirect-${fetchCount}` },
              status: 302,
            }) as never
          }) as NonNullable<SafeWebFetchDependencies["fetchImpl"]>,
        }
      )
    ).rejects.toThrow(/1-redirect limit/)

    expect(fetchCount).toBe(2)
    expect(closeCount).toBe(2)
  })

  test("pins credentialed protocol requests to one origin and rejects redirects", async () => {
    let closeCount = 0
    let fetchCount = 0
    const safeFetch = createOriginBoundSafeFetch(
      { allowedOrigin: "https://mcp.example" },
      {
        async resolver() {
          return [PUBLIC_IPV4]
        },
        createDispatcher(target) {
          expect(target.hostname).toBe("mcp.example")
          return {
            async close() {
              closeCount += 1
            },
            dispatcher: {} as never,
          }
        },
        fetchImpl: (async (_input, init) => {
          fetchCount += 1
          expect(init?.redirect).toBe("manual")
          expect(init?.method).toBe("POST")
          expect(
            new Headers(init?.headers as HeadersInit).get("authorization")
          ).toBe("Bearer desktop-owned-secret")

          return new Response(null, {
            status: 307,
            headers: { location: "https://attacker.example/mcp" },
          }) as never
        }) as NonNullable<SafeWebFetchDependencies["fetchImpl"]>,
      }
    )

    await expect(
      safeFetch("https://mcp.example/rpc", {
        method: "POST",
        headers: { Authorization: "Bearer desktop-owned-secret" },
        body: "{}",
      })
    ).rejects.toThrow(/redirects are not allowed/)
    expect(fetchCount).toBe(1)
    expect(closeCount).toBe(1)
  })

  test("blocks cross-origin and private protocol targets before opening a connection", async () => {
    let dispatcherCount = 0
    let fetchCount = 0
    const safeFetch = createOriginBoundSafeFetch(
      { allowedOrigin: "https://mcp.example" },
      {
        async resolver(hostname) {
          return hostname === "private.example"
            ? [{ address: "169.254.169.254", family: 4 }]
            : [PUBLIC_IPV4]
        },
        createDispatcher() {
          dispatcherCount += 1
          return {
            async close() {},
            dispatcher: {} as never,
          }
        },
        fetchImpl: (async () => {
          fetchCount += 1
          return new Response("unreachable") as never
        }) as NonNullable<SafeWebFetchDependencies["fetchImpl"]>,
      }
    )

    await expect(safeFetch("https://other.example/mcp")).rejects.toThrow(
      /does not match the configured origin/
    )
    await expect(safeFetch("https://private.example/mcp")).rejects.toThrow(
      /non-public/
    )
    expect(dispatcherCount).toBe(0)
    expect(fetchCount).toBe(0)
  })

  test("keeps the pinned dispatcher alive until the protocol response is consumed", async () => {
    let closeCount = 0
    const safeFetch = createOriginBoundSafeFetch(
      { allowedOrigin: "https://mcp.example" },
      {
        async resolver() {
          return [PUBLIC_IPV4]
        },
        createDispatcher() {
          return {
            async close() {
              closeCount += 1
            },
            dispatcher: {} as never,
          }
        },
        fetchImpl: (async () =>
          new Response("protocol-body") as never) as NonNullable<
          SafeWebFetchDependencies["fetchImpl"]
        >,
      }
    )

    const response = await safeFetch("https://mcp.example/rpc")

    expect(closeCount).toBe(0)
    expect(await response.text()).toBe("protocol-body")
    expect(closeCount).toBe(1)
  })
})
