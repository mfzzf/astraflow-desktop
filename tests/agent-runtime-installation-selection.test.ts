// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { resolveAgentRuntimeSelectionAction } from "@/hooks/use-agent-runtime-installations"

function status(
  phase: AstraFlowAgentRuntimeStatus["phase"],
  ready = phase === "ready"
): AstraFlowAgentRuntimeStatus {
  return {
    runtimeId: "codex",
    label: "Codex",
    version: "1.0.0",
    phase,
    ready,
    needsInstall: !ready,
    percent: ready ? 100 : 0,
    transferred: 0,
    total: null,
    bytesPerSecond: null,
    message: null,
  }
}

describe("agent runtime installation selection", () => {
  test("never selects an uninstalled downloadable runtime", () => {
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: true,
        loading: false,
        runtimeId: "codex",
        status: status("idle"),
      })
    ).toBe("install")
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: true,
        loading: false,
        runtimeId: "claude-code",
        status: { ...status("error"), runtimeId: "claude-code" },
      })
    ).toBe("install")
  })

  test("waits while status is loading or installation is active", () => {
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: true,
        loading: false,
        runtimeId: "codex",
      })
    ).toBe("install")
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: true,
        loading: true,
        runtimeId: "codex",
      })
    ).toBe("wait")
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: true,
        loading: false,
        runtimeId: "codex",
        status: status("downloading"),
      })
    ).toBe("wait")
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: true,
        loading: false,
        runtimeId: "codex",
        status: status("installing"),
      })
    ).toBe("wait")
  })

  test("selects only ready downloadable runtimes and built-in runtimes", () => {
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: true,
        loading: false,
        runtimeId: "codex",
        status: status("ready"),
      })
    ).toBe("select")
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: false,
        loading: false,
        runtimeId: "astraflow",
      })
    ).toBe("select")
    expect(
      resolveAgentRuntimeSelectionAction({
        desktopAvailable: false,
        loading: false,
        runtimeId: "codex",
      })
    ).toBe("unavailable")
  })
})
