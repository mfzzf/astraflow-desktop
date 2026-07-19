import type { SessionConfigOption } from "@agentclientprotocol/sdk"

import type { SlashCommandDescriptor } from "@/lib/agent/composer-types"

export const CODEX_COLLABORATION_MODE_CONFIG_ID = "collaboration_mode"
export const CODEX_DEFAULT_COLLABORATION_MODE = "default"
export const CODEX_PLAN_COLLABORATION_MODE = "plan"
export const CODEX_FAST_MODE_CONFIG_ID = "fast-mode"
export const CODEX_GOAL_CONTROL_METHOD = "_codex/session/goal_control"

const CODEX_RUNTIME_ID = "codex"

export function getCodexAcpRuntimeCommands(): SlashCommandDescriptor[] {
  return [
    {
      name: "plan",
      description: "Turn plan mode on.",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
      meta: {
        commandAction: {
          kind: "setConfigOption",
          configId: CODEX_COLLABORATION_MODE_CONFIG_ID,
          value: CODEX_PLAN_COLLABORATION_MODE,
          resetValue: CODEX_DEFAULT_COLLABORATION_MODE,
          presentation: "state",
        },
      },
    },
    {
      name: "mcp",
      description: "List configured Model Context Protocol (MCP) tools.",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
    },
    {
      name: "skills",
      description: "List available skills.",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
    },
    {
      name: "status",
      description: "Display session configuration and token usage.",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
    },
    {
      name: "review",
      description:
        "Review uncommitted changes, or review with custom instructions.",
      inputHint: "optional review instructions",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
    },
    {
      name: "review-branch",
      description: "Review changes relative to a base branch.",
      inputHint: "branch name",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
    },
    {
      name: "review-commit",
      description: "Review a specific commit.",
      inputHint: "commit sha",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
    },
    {
      name: "compact",
      description: "Summarize conversation to avoid hitting the context limit.",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
    },
    {
      name: "goal",
      description: "Set a goal to keep pursuing.",
      inputHint: "[<objective>|clear|pause|resume]",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
      meta: {
        commandAction: {
          kind: "prefixPrompt",
          presentation: "state",
        },
      },
    },
    {
      name: "logout",
      description:
        "Sign out of Codex. This option is available when you are logged in via ChatGPT.",
      source: "runtime",
      runtimeId: CODEX_RUNTIME_ID,
    },
  ]
}

export function findCodexConfigOption(
  options: SessionConfigOption[],
  id: string
) {
  return options.find((option) => option.id === id) ?? null
}

export function getCodexPlanMode(options: SessionConfigOption[]) {
  const option = findCodexConfigOption(
    options,
    CODEX_COLLABORATION_MODE_CONFIG_ID
  )

  return option?.type === "select"
    ? {
        active: option.currentValue === CODEX_PLAN_COLLABORATION_MODE,
        available: option.options.some((candidate) =>
          "group" in candidate
            ? candidate.options.some(
                (entry) => entry.value === CODEX_PLAN_COLLABORATION_MODE
              )
            : candidate.value === CODEX_PLAN_COLLABORATION_MODE
        ),
      }
    : { active: false, available: false }
}

export function getCodexFastMode(options: SessionConfigOption[]) {
  const option = findCodexConfigOption(options, CODEX_FAST_MODE_CONFIG_ID)

  if (option?.type === "boolean") {
    return { active: option.currentValue, available: true }
  }

  if (option?.type === "select") {
    return {
      active: option.currentValue === "on",
      available: true,
    }
  }

  return { active: false, available: false }
}
