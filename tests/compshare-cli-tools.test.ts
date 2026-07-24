// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, mock, test } from "bun:test"

mock.module("server-only", () => ({}))

const { createCompShareCliTools } = await import("@/lib/ai/tools/compshare-cli")

describe("CompShare CLI Agent tools", () => {
  test("keeps queries read-only and actions behind the important-action gateway", () => {
    const [query, action] = createCompShareCliTools({
      isAvailable: () => true,
      run: async () => ({ ok: true }),
    })

    expect(query.name).toBe("compshare_cli_query")
    expect(query.effectCategory).toBe("read_only")
    expect(query.allowInSubagent).toBe(true)
    expect(query.description).toContain(
      "`instance price` requires all of [`--gpu`"
    )
    expect(query.description).toContain("Use `--memory`, never `--mem`.")
    expect(action.name).toBe("compshare_cli_action")
    expect(action.effectCategory).toBe("important_action")
    expect(action.allowInSubagent).toBe(false)
    expect(action.description).toContain(
      "`--gpu`, `--count`, `--cpu`, `--memory`"
    )
  })

  test("allows only enumerated read-only commands through the query tool", async () => {
    const calls: unknown[][] = []
    const [query] = createCompShareCliTools({
      isAvailable: () => true,
      run: async (...args) => {
        calls.push(args)
        return { ok: true, data: { items: [] } }
      },
    })

    await expect(
      query.invoke({
        command: "instance list",
        arguments: ["--all"],
        timeout_seconds: 15,
      })
    ).resolves.toEqual({ ok: true, data: { items: [] } })
    expect(calls[0]?.[0]).toBe("instance list")
    expect(calls[0]?.[1]).toEqual(["--all"])
    expect(calls[0]?.[2]).toMatchObject({ timeoutSeconds: 15 })

    await expect(
      query.invoke({
        command: "instance start",
        arguments: ["instance-id"],
      })
    ).rejects.toThrow()
    await expect(
      query.invoke({
        command: "instance show",
        arguments: ["instance-id", "--show-sensitive"],
      })
    ).rejects.toThrow("--show-sensitive")
  })

  test("reports every missing required option before invoking the CLI", async () => {
    const run = mock(async () => ({ ok: true }))
    const [query, action] = createCompShareCliTools({
      isAvailable: () => true,
      run,
    })

    await expect(
      query.invoke({
        command: "instance price",
        arguments: ["--gpu", "4090"],
      })
    ).rejects.toThrow(
      "Missing required options: --cpu, --memory, --region, --zone."
    )
    await expect(
      query.invoke({
        command: "instance search",
        arguments: ["4090"],
      })
    ).rejects.toThrow(
      'Use this complete form: ["--region","cn-sh2","--zone","cn-sh2-02","--gpu","4090"]'
    )
    await expect(
      action.invoke({
        command: "instance create",
        arguments: ["--gpu", "4090", "--dry-run"],
      })
    ).rejects.toThrow(
      "Missing required options: --count, --cpu, --memory, --image, --region, --zone."
    )
    expect(run).not.toHaveBeenCalled()
  })

  test("routes non-query commands only through the action tool", async () => {
    const calls: unknown[][] = []
    const [, action] = createCompShareCliTools({
      isAvailable: () => true,
      run: async (...args) => {
        calls.push(args)
        return { ok: true }
      },
    })

    await action.invoke({
      command: "instance stop",
      arguments: ["instance-id", "--yes"],
      timeout_seconds: 600,
    })

    expect(calls[0]?.[0]).toBe("instance stop")
    expect(calls[0]?.[1]).toEqual(["instance-id", "--yes"])
  })
})
