// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, mock, test } from "bun:test"

import type * as ControlPlaneModule from "@/lib/compshare/control-plane"

mock.module("server-only", () => ({}))

// The import must be dynamic so the server-only mock is installed first. Its
// runtime-selected unique URL also keeps suite-wide dependency doubles from
// replacing this unit.
const controlPlaneModuleUrl =
  "../lib/compshare/control-plane.ts?test=compshare-control-plane"
const { callCompShareAction, CompShareApiError } = (await import(
  controlPlaneModuleUrl
)) as typeof ControlPlaneModule

const originalFetch = globalThis.fetch
const fixtureCredentials = {
  publicKey: " AKIDEXAMPLE ",
  privateKey: " SKEXAMPLE-NOT-SECRET ",
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe("CompShare control-plane requests", () => {
  test("posts the exact expanded and signed UCloud request without inherited account fields", async () => {
    let requestUrl = ""
    let requestInit: RequestInit | undefined

    globalThis.fetch = async (input, init) => {
      requestUrl = String(input)
      requestInit = init

      return new Response(JSON.stringify({ RetCode: 0, Packages: ["starter"] }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    const params = Object.assign(
      Object.create({
        ProjectId: "inherited-project",
        CompanyId: "inherited-company",
        OrgId: "inherited-org",
      }) as Record<string, string | number | boolean | readonly string[]>,
      {
        Action: "DescribePackage",
        Enabled: true,
        Regions: ["cn-bj2", "cn-sh2"] as const,
        Count: 3,
      }
    )

    const result = await callCompShareAction<{
      RetCode: number
      Packages: string[]
    }>({
      credentials: fixtureCredentials,
      params,
    })

    expect(requestUrl).toBe("https://api.compshare.cn/")
    expect(requestInit?.method).toBe("POST")
    expect(requestInit?.headers).toEqual({ "Content-Type": "application/json" })
    expect(requestInit?.cache).toBe("no-store")
    expect(requestInit?.body).toBe(
      JSON.stringify({
        Action: "DescribePackage",
        Enabled: true,
        "Regions.0": "cn-bj2",
        "Regions.1": "cn-sh2",
        Count: 3,
        PublicKey: "AKIDEXAMPLE",
        Signature: "098e67853a185287d594f198ed4f0b1ca018547b",
      })
    )
    expect(requestInit?.signal).toBeInstanceOf(AbortSignal)
    expect(result).toEqual({ RetCode: 0, Packages: ["starter"] })
  })

  test("maps a nonzero RetCode to a client error and redacts both credentials", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          RetCode: 270042,
          Message:
            "Public AKIDEXAMPLE rejected SKEXAMPLE-NOT-SECRET; AKIDEXAMPLE is invalid",
        }),
        { headers: { "Content-Type": "application/json" } }
      )

    const error = await callCompShareAction({
      credentials: fixtureCredentials,
      params: { Action: "DescribePackage" },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CompShareApiError)
    expect(error).toMatchObject({
      name: "CompShareApiError",
      message:
        "Public [redacted] rejected [redacted]; [redacted] is invalid",
      retCode: 270042,
      status: 400,
    })
    expect(String(error)).not.toContain("AKIDEXAMPLE")
    expect(String(error)).not.toContain("SKEXAMPLE-NOT-SECRET")
  })

  test("preserves the HTTP status and RetCode for a failed response", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ RetCode: 170, Message: "Access denied" }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      })

    const error = await callCompShareAction({
      credentials: fixtureCredentials,
      params: { Action: "DescribePackage" },
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(CompShareApiError)
    expect(error).toMatchObject({
      message: "Access denied",
      retCode: 170,
      status: 403,
    })
  })

  test("maps transport and malformed-response failures without leaking credentials", async () => {
    globalThis.fetch = async () => {
      throw new Error(
        `request with ${fixtureCredentials.publicKey} and ${fixtureCredentials.privateKey} failed`
      )
    }

    const transportError = await callCompShareAction({
      credentials: fixtureCredentials,
      params: { Action: "DescribePackage" },
    }).catch((caught: unknown) => caught)

    expect(transportError).toMatchObject({
      name: "CompShareApiError",
      message: "Unable to reach CompShare.",
      status: 502,
    })
    expect(String(transportError)).not.toContain("AKIDEXAMPLE")
    expect(String(transportError)).not.toContain("SKEXAMPLE-NOT-SECRET")

    globalThis.fetch = async () => new Response("not-json", { status: 429 })

    const invalidResponseError = await callCompShareAction({
      credentials: fixtureCredentials,
      params: { Action: "DescribePackage" },
    }).catch((caught: unknown) => caught)

    expect(invalidResponseError).toMatchObject({
      name: "CompShareApiError",
      message: "CompShare returned an invalid response.",
      status: 429,
    })
  })
})
