// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { getActivityLabel } from "@/components/studio-message-parts/tool-labels"
import { dictionaries } from "@/lib/i18n"
import type { StudioMessageActivity } from "@/lib/studio-types"

function activity(
  toolName: string,
  input: Record<string, unknown>,
  status: StudioMessageActivity["status"] = "complete"
): StudioMessageActivity {
  return {
    id: `${toolName}-${status}`,
    toolName,
    status,
    input: JSON.stringify(input),
    output: "",
    error: null,
  }
}

describe("studio tool labels", () => {
  test("localizes Pi file and command tools", () => {
    expect(
      getActivityLabel(activity("bash", { command: "bun test" }), dictionaries.zh)
    ).toBe("已执行命令 bun test")
    expect(
      getActivityLabel(activity("read", { path: "src/app.ts" }), dictionaries.zh)
    ).toBe("已读取文件 src/app.ts")
    expect(
      getActivityLabel(
        activity("write", { path: "src/app.ts" }, "running"),
        dictionaries.en
      )
    ).toBe("Writing file src/app.ts")
  })

  test("localizes Pi skill tools without exposing internal names", () => {
    expect(
      getActivityLabel(
        activity("read_skill_file", {
          slug: "pptx",
          path: "templates/base.js",
        }),
        dictionaries.zh
      )
    ).toBe("已读取技能文件 pptx/templates/base.js")
    expect(
      getActivityLabel(
        activity("prepare_skill_sandbox", { slug: "pptx" }),
        dictionaries.zh
      )
    ).toBe("已准备技能沙箱 pptx")
  })

  test("provides localized names for badges and detail headers", () => {
    expect(dictionaries.zh.studioToolDisplayName("write")).toBe("写入文件")
    expect(
      dictionaries.zh.studioToolDisplayName("request_user_input")
    ).toBe("请求用户输入")
    expect(dictionaries.en.studioToolDisplayName("read_skill_file")).toBe(
      "Read skill file"
    )
    expect(dictionaries.zh.studioToolDisplayName("subagent")).toBe(
      "委派子任务"
    )
  })
})
