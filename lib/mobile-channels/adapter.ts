import type {
  MobileChannelConnectionRecord,
  MobileChannelInboundMessage,
  MobileChannelOutboundTarget,
} from "./types"

export type MobileChannelMessageHandler = (
  message: MobileChannelInboundMessage
) => Promise<void>

export type MobileChannelAdapter = {
  connect: () => Promise<void>
  disconnect: () => Promise<void> | void
  sendText: (target: MobileChannelOutboundTarget, text: string) => Promise<void>
}

export type MobileChannelAdapterFactoryInput = {
  connection: MobileChannelConnectionRecord
  onMessage: MobileChannelMessageHandler
  onConnected: () => void
  onReconnecting: () => void
  onConnectionError: (error: unknown) => void
}
