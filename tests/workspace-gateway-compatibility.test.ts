// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { requireCompatibleWorkspaceGatewayAgentRuntime } from "@/lib/workspace-gateway-compatibility"

const expectedProtocolVersion = 1

function health(version: string) {
  return {
    protocolVersion: expectedProtocolVersion,
    agentRuntimes: [
      {
        id: "astraflow",
        available: true,
        version,
      },
    ],
  }
}

describe("Workspace Gateway compatibility", () => {
  test.each(["0.1.0", "0.1.1", "0.2.0"])(
    "accepts AstraFlow runtime %s when the protocol is compatible",
    (version: string) => {
      expect(
        requireCompatibleWorkspaceGatewayAgentRuntime({
          health: health(version),
          runtimeId: "astraflow",
          expectedProtocolVersion,
        })
      ).toMatchObject({
        id: "astraflow",
        available: true,
        version,
      })
    }
  )

  test("rejects an incompatible Gateway protocol", () => {
    expect(() =>
      requireCompatibleWorkspaceGatewayAgentRuntime({
        health: {
          ...health("0.1.1"),
          protocolVersion: expectedProtocolVersion + 1,
        },
        runtimeId: "astraflow",
        expectedProtocolVersion,
      })
    ).toThrow("incompatible with Desktop protocol")
  })

  test("rejects an unavailable Agent runtime", () => {
    expect(() =>
      requireCompatibleWorkspaceGatewayAgentRuntime({
        health: {
          protocolVersion: expectedProtocolVersion,
          agentRuntimes: [
            {
              id: "astraflow",
              available: false,
              version: "0.1.1",
            },
          ],
        },
        runtimeId: "astraflow",
        expectedProtocolVersion,
      })
    ).toThrow("does not provide the astraflow Agent runtime")
  })
})
