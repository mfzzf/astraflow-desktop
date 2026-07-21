import { expect, test } from "@playwright/test"

import { bashCommandNeedsApproval } from "../../lib/agent/bash-security"
import {
  isHighRiskPermissionRequest,
  shouldAutoApprovePermission,
} from "../../lib/agent/permission-policy"

const riskyCommands = [
  {
    command: "echo $(whoami)",
    name: "command substitution",
  },
  {
    command: "cat < ~/.ssh/id_rsa",
    name: "input redirection",
  },
  {
    command: "jq $'-f' filter data.json",
    name: "ANSI-C quoted flag",
  },
  {
    command: String.raw`echo\ test/../../../usr/bin/touch /tmp/file`,
    name: "backslash escaped whitespace",
  },
  {
    command: String.raw`cat safe.txt \; echo ~/.ssh/id_rsa`,
    name: "backslash escaped shell operator",
  },
  {
    command: "git diff {@'{'0},--output=/tmp/pwned}",
    name: "brace expansion obfuscation",
  },
  {
    command: "echo\u00A0safe",
    name: "unicode whitespace",
  },
  {
    command: "echo foo#bar",
    name: "mid-word hash",
  },
  {
    command: "zmodload zsh/system",
    name: "zsh module command",
  },
  {
    command: "echo $IFS",
    name: "IFS expansion",
  },
  {
    command: "cat /proc/self/environ",
    name: "process environment access",
  },
  {
    command: "mv ./decoy '\n#' ~/.ssh/id_rsa ./exfil_dir",
    name: "quoted newline hiding hash-prefixed line",
  },
]

const safeCommands = [
  {
    command: "echo hello",
    name: "simple echo",
  },
  {
    command: "git commit --allow-empty -m 'simple message'",
    name: "simple git commit message",
  },
  {
    command: "echo $(cat <<'EOF'\nhello\nEOF\n)",
    name: "quoted heredoc command substitution in argument position",
  },
]

test.describe("bash permission security policy", () => {
  test("auto mode requests explicit approval for local sandbox networking", () => {
    const inputPreview = JSON.stringify({
      host: "api.example.com",
      port: 443,
    })

    expect(
      isHighRiskPermissionRequest({
        inputPreview,
        toolName: "network_access",
      })
    ).toBe(true)
    expect(
      shouldAutoApprovePermission({
        inputPreview,
        mode: "auto",
        toolName: "network_access",
      })
    ).toBe(false)
  })

  test("auto mode requests approval for persistent Python package installs", () => {
    const inputPreview = JSON.stringify({
      command:
        'python -m pip install --constraint "$ASTRAFLOW_PYTHON_REQUIREMENTS" matplotlib',
    })

    expect(
      isHighRiskPermissionRequest({ inputPreview, toolName: "Bash" })
    ).toBe(true)
    expect(
      shouldAutoApprovePermission({
        inputPreview,
        mode: "auto",
        toolName: "Bash",
      })
    ).toBe(false)
  })

  for (const command of [
    "npm install sharp",
    "npm i sharp",
    "npm ci",
    "pnpm i zod",
    "bun i zod",
    "yarn add zod",
    "yarn",
    "cd app && yarn --immutable",
  ]) {
    test(`auto mode requests approval for package install: ${command}`, () => {
      const inputPreview = JSON.stringify({ command })

      expect(
        isHighRiskPermissionRequest({ inputPreview, toolName: "Bash" })
      ).toBe(true)
      expect(
        shouldAutoApprovePermission({
          inputPreview,
          mode: "auto",
          toolName: "Bash",
        })
      ).toBe(false)
    })
  }

  for (const command of ["npm --version", "yarn --version"]) {
    test(`auto mode allows package manager inspection: ${command}`, () => {
      const inputPreview = JSON.stringify({ command })

      expect(
        shouldAutoApprovePermission({
          inputPreview,
          mode: "auto",
          toolName: "Bash",
        })
      ).toBe(true)
    })
  }

  for (const { command, name } of riskyCommands) {
    test(`auto mode requests approval for ${name}`, () => {
      const inputPreview = JSON.stringify({ command })

      expect(bashCommandNeedsApproval(command)).toBe(true)
      expect(
        isHighRiskPermissionRequest({
          inputPreview,
          toolName: "Bash",
        })
      ).toBe(true)
      expect(
        shouldAutoApprovePermission({
          inputPreview,
          mode: "auto",
          toolName: "Bash",
        })
      ).toBe(false)
    })
  }

  for (const { command, name } of safeCommands) {
    test(`auto mode allows ${name}`, () => {
      const inputPreview = JSON.stringify({ command })

      expect(bashCommandNeedsApproval(command)).toBe(false)
      expect(
        shouldAutoApprovePermission({
          inputPreview,
          mode: "auto",
          toolName: "Bash",
        })
      ).toBe(true)
    })
  }
})
