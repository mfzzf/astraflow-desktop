import type { MobileChannelProvider } from "./types"

export const MOBILE_CHANNEL_USAGE_GUIDE_SENT_AT_METADATA_KEY =
  "usageGuideSentAt"

export function getMobileChannelUsageGuide({
  provider,
  connectionJustCompleted = false,
}: {
  provider: MobileChannelProvider
  connectionJustCompleted?: boolean
}) {
  const wechatInstructions =
    provider === "wechat"
      ? [
          "",
          "**微信图片说明**",
          "- 文字和图片分开发送时，AstraFlow 会短暂等待并尽量合并为同一个任务。",
          "- 只发送图片时，会先暂存并回复已收到的数量；继续输入要求后再一起处理。",
          "- `/send`：立即提交已暂存的图片。",
          "- `/cancel`：取消已暂存的图片。",
        ]
      : []

  return [
    connectionJustCompleted
      ? "✅ **AstraFlow 移动端连接成功**"
      : "**AstraFlow 移动控制使用说明**",
    "",
    "你现在可以从手机向这台电脑上的 AstraFlow Agent 派发任务。文件读取、代码修改、终端命令和媒体生成仍在电脑端执行。",
    "",
    "**开始使用**",
    "1. 在电脑端「移动版」页面设置默认工作区、Agent、模型、思考强度和机器人权限。机器人默认使用自动批准模式。",
    "2. 直接发送任务，例如：`检查当前项目并运行测试`。",
    "3. 可以附带图片并说明要分析、修改或参考的内容。",
    "4. 需要电脑上的文件时，直接描述文件名或位置并说“发给我”，Agent 找到后会作为聊天附件回传。",
    "5. Agent 生成的图片和视频会自动回传，并在源服务提供公开地址时附上原始文件下载链接；如果平台格式或大小受限，会发送明确的失败提示。",
    "",
    "**任务与会话命令**",
    "- `/new`：结束当前上下文并新建会话。",
    "- `/status`：查看当前任务状态。",
    "- `/stop`：停止正在运行的任务。",
    "- `/help`：再次查看本说明。",
    ...wechatInstructions,
    "",
    "**授权确认**",
    "当 Agent 对高风险操作请求授权时，直接发送以下命令即可：",
    "- `/approve`：仅本次允许。",
    "- `/always`：今后同类操作始终允许，请谨慎使用。",
    "- `/deny`：拒绝本次操作。",
    "",
    "同一会话一次只运行一个任务。任务执行期间可使用 `/status` 查看进度，或用 `/stop` 停止后再发送新任务。",
  ].join("\n")
}
