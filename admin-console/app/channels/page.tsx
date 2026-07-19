import { connection } from "next/server"

import { ChannelTable } from "@/components/channel-table"
import { listChannels } from "@/lib/admin-data"

export default async function ChannelsPage() {
  await connection()
  const response = await listChannels()

  return (
    <div className="flex flex-col gap-6 p-4 lg:p-6">
      <div>
        <h2 className="font-heading text-2xl font-semibold">多渠道分发策略</h2>
        <p className="text-sm text-muted-foreground">
          一处管理渠道 OAuth、侧边栏能力和跨模态模型白名单。
        </p>
      </div>
      <ChannelTable channels={response.channels ?? []} />
    </div>
  )
}
