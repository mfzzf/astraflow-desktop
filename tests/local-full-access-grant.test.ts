// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterEach, describe, expect, test } from "bun:test"
import { createHmac, randomBytes } from "node:crypto"

import {
  consumeLocalFullAccessGrant,
  STUDIO_LOCAL_FULL_ACCESS_POLICY_VERSION,
} from "@/lib/agent/local-full-access-grant"

const previousSecretKey = process.env.ASTRAFLOW_SECRET_KEY
const previousDeviceId = process.env.ASTRAFLOW_DEVICE_ID

function createGrant(
  overrides: Partial<{
    sessionId: string
    workspaceId: string | null
    environment: "local"
    deviceId: string
    policyVersion: number
    issuedAt: number
    expiresAt: number
  }> = {}
) {
  const now = Date.now()
  const payload = {
    version: 1,
    policyVersion: STUDIO_LOCAL_FULL_ACCESS_POLICY_VERSION,
    sessionId: "session-1",
    workspaceId: "workspace-1",
    environment: "local",
    deviceId: "device-1",
    nonce: randomBytes(32).toString("hex"),
    issuedAt: now,
    expiresAt: now + 60_000,
    ...overrides,
  }
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac(
    "sha256",
    Buffer.from(process.env.ASTRAFLOW_SECRET_KEY ?? "", "hex")
  )
    .update(encoded)
    .digest("base64url")

  return `${encoded}.${signature}`
}

afterEach(() => {
  if (previousSecretKey === undefined) {
    delete process.env.ASTRAFLOW_SECRET_KEY
  } else {
    process.env.ASTRAFLOW_SECRET_KEY = previousSecretKey
  }

  if (previousDeviceId === undefined) {
    delete process.env.ASTRAFLOW_DEVICE_ID
  } else {
    process.env.ASTRAFLOW_DEVICE_ID = previousDeviceId
  }
})

describe("local Full Access grants", () => {
  test("binds a grant to one session, workspace, device, and policy", () => {
    process.env.ASTRAFLOW_SECRET_KEY = "a".repeat(64)
    process.env.ASTRAFLOW_DEVICE_ID = "device-1"
    const grant = createGrant()

    expect(
      consumeLocalFullAccessGrant(grant, {
        sessionId: "wrong-session",
        workspaceId: "workspace-1",
        environment: "local",
      })
    ).toBeFalse()
    expect(
      consumeLocalFullAccessGrant(grant, {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        environment: "local",
      })
    ).toBeTrue()
    expect(
      consumeLocalFullAccessGrant(grant, {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        environment: "local",
      })
    ).toBeFalse()
  })

  test("rejects expired, wrong-device, and wrong-policy grants", () => {
    process.env.ASTRAFLOW_SECRET_KEY = "b".repeat(64)
    process.env.ASTRAFLOW_DEVICE_ID = "device-1"
    const now = Date.now()

    expect(
      consumeLocalFullAccessGrant(
        createGrant({ issuedAt: now - 70_000, expiresAt: now - 10_000 }),
        {
          sessionId: "session-1",
          workspaceId: "workspace-1",
          environment: "local",
          now,
        }
      )
    ).toBeFalse()
    expect(
      consumeLocalFullAccessGrant(createGrant({ deviceId: "device-2" }), {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        environment: "local",
      })
    ).toBeFalse()
    expect(
      consumeLocalFullAccessGrant(createGrant({ policyVersion: 1 }), {
        sessionId: "session-1",
        workspaceId: "workspace-1",
        environment: "local",
      })
    ).toBeFalse()
  })
})
