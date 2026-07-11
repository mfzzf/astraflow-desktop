# Lark、Telegram、Discord 移动渠道接入说明

本文只记录官方协议可以确认的能力，以及 AstraFlow Desktop 的落地约束。

## 能力与接入方式

| 渠道 | 收消息 | 发文字/图片/视频 | 桌面连接方式 | 二维码能否直接取得 Bot 凭据 |
| --- | --- | --- | --- | --- |
| Lark | 文字、图片 | 文字、图片、视频 | 官方 Node SDK WebSocket 长连接 | 支持。官方 `registerApp()` 提供设备授权和应用自动创建 |
| Telegram | 文字、图片 | 文字、图片、视频 | HTTPS `getUpdates` 长轮询 | 普通 Bot 不支持。必须先由 BotFather 创建并取得 token；配置后可用 `t.me/<bot>?start=<code>` 二维码绑定用户 |
| Discord | 文字、图片 | 文字、图片、视频 | Gateway WebSocket + REST | 不支持取得 token。必须先在 Developer Portal 创建应用；配置后可用 OAuth2 Bot Install URL 二维码安装到服务器 |

Telegram 官方后来提供 Managed Bots，但它依赖一个预先配置了 Bot Management Mode 的管理机器人。AstraFlow 第一版不应把这一平台级前置条件伪装成“扫码自动创建普通 Bot”。Discord OAuth2 安装同样只负责授权安装，不会把 Bot token 返回给桌面端。

## 已实现的 Provider

- `providers/lark.ts`
  - 强制使用 `Domain.Lark`，避免请求被发送到飞书中国区域名。
  - 使用官方 `createLarkChannel()` WebSocket、消息标准化、下载媒体和自动重连。
  - 收文字、图片；发 Markdown、图片、Agent 生成的视频；回复原消息。
- `providers/telegram.ts`
  - `getMe` 校验 token，清除冲突 webhook 后使用 `getUpdates`。
  - 持久化 update offset；顺序确认 update，避免重启重复消费。
  - 收文字、caption、图片；通过 `getFile` 下载附件。协议 helper 能识别视频引用，但本轮不送入 Studio 会话。
  - `sendMessage`、`sendPhoto`、`sendVideo`；支持话题和回复上下文。
  - 处理 429 `retry_after`、401 凭据失效、指数退避和取消连接。
- `providers/discord.ts`
  - 使用 `Get Gateway Bot` 获取地址，Gateway v10 Identify/Resume。
  - 实现 heartbeat、ACK 看门狗、重连、session resume、fatal close code 和 Identify 限额检查。
  - 收 `MESSAGE_CREATE` 的文字、图片；忽略 Bot/Webhook 消息。协议 helper 能识别视频附件，但本轮不送入 Studio 会话。
  - REST 创建消息和 multipart 附件上传；清空 `allowed_mentions`，避免 Agent 输出触发意外群体提及。
  - 遵守 REST 429 `Retry-After`。

## 核心类型集成

三个 provider 已接入统一类型、加密凭据存储、配对流程和运行时。凭据字段如下：

```ts
type LarkCredentials = {
  provider: "lark"
  appId: string
  appSecret: string
  ownerOpenId: string | null
}

type TelegramCredentials = {
  provider: "telegram"
  botToken: string
  botUsername: string | null
  ownerUserId: string | null
}

type DiscordCredentials = {
  provider: "discord"
  applicationId: string
  botToken: string
  ownerUserId: string | null
}
```

回复上下文：

```ts
type LarkReplyContext = {
  provider: "lark"
  replyToMessageId: string | null
}

type TelegramReplyContext = {
  provider: "telegram"
  messageId: number
  messageThreadId: number | null
}

type DiscordReplyContext = {
  provider: "discord"
  messageId: string
  guildId: string | null
}
```

当前实现：

1. `lark`、`telegram`、`discord` 已加入 `mobileChannelProviders`、标签映射和 Zod discriminated union。
2. `runtime.ts` 已挂载三个 adapter factory，移动版三个渠道卡片可直接进入接入流程。
3. Lark 复用 `registerApp()`，初始 `domain` 和 `larkDomain` 都使用 `accounts.larksuite.com`，并申请 `im:message:send_as_bot`、`im:resource` 与消息事件权限。
4. Telegram、Discord 使用凭据输入步骤。Secret 只写入本地加密存储，不进入二维码、URL、日志或前端查询响应。
5. Telegram 校验 `getMe` 后，二维码使用 `telegramBotDeepLink(bot.username, bindCode)`；用户点击 Start 后收到的 `/start <bindCode>` 会转换为现有 `/bind <bindCode>`。
6. Discord 校验 Bot token 后，二维码使用 `discordBotInstallUrl({ applicationId })`；安装完成后用户在目标频道发送 `/bind <bindCode>`。
7. Discord Developer Portal 必须开启 Message Content Intent；安装链接请求 View Channels、Send Messages、Attach Files、Read Message History 等机器人权限。

## 安全和产品约束

- Telegram Bot token 和 Discord Bot token 等价于账户密码，不能编码进二维码。
- Lark/Discord 群消息仍需现有 binding + owner/ACL 校验，不能仅凭 Bot 已加入群就执行本地 Agent。
- Discord 任意群消息需要 privileged Message Content Intent；未开启时，DM、提及 Bot 和 Bot 自己发送的消息是官方列出的例外，但不足以支撑完整群聊体验。
- Telegram `getUpdates` 与 webhook 互斥，一个 Bot token 只能由一个消费端负责更新。
- Discord 附件 URL 带签名和有效期，入站后应立即下载到受控本地存储，不要长期保存原始 CDN URL。
- 平台附件上限不同。Discord 默认单文件 10 MiB；Telegram 官方 Bot API 当前允许 Bot 发 50 MB 视频。平台拒绝大视频时应给用户明确失败消息，不应只丢失附件。

## 官方资料

- Lark 官方 Node SDK及 Channel/App Registration：<https://github.com/larksuite/node-sdk>
- Lark 发送消息：<https://open.larksuite.com/document/server-docs/im-v1/message/create>
- Telegram Bot API：<https://core.telegram.org/bots/api>
- Telegram Bot Features、Deep Linking、BotFather：<https://core.telegram.org/bots/features>
- Discord Gateway：<https://docs.discord.com/developers/events/gateway>
- Discord Gateway Events：<https://docs.discord.com/developers/events/gateway-events>
- Discord Message/Create Message：<https://docs.discord.com/developers/resources/message>
- Discord OAuth2 和 Bot 安装权限：<https://docs.discord.com/developers/platform/oauth2-and-permissions>
- Discord 文件上传与 CDN：<https://docs.discord.com/developers/reference#uploading-files>
- Discord Rate Limits：<https://docs.discord.com/developers/topics/rate-limits>
