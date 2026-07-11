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
  sendImage: (
    target: MobileChannelOutboundTarget,
    image: MobileChannelOutboundImage
  ) => Promise<void>
  sendVideo: (
    target: MobileChannelOutboundTarget,
    video: MobileChannelOutboundVideo
  ) => Promise<void>
  sendFile: (
    target: MobileChannelOutboundTarget,
    file: MobileChannelOutboundFile
  ) => Promise<void>
  setTyping?: (
    target: MobileChannelOutboundTarget,
    typing: boolean
  ) => Promise<void>
}

export type MobileChannelOutboundImage = {
  buffer: Buffer
  fileName: string
  mimeType: string
}

export type MobileChannelOutboundVideo = {
  buffer: Buffer
  fileName: string
  mimeType: string
  durationSeconds?: number | null
}

export type MobileChannelOutboundFile = {
  buffer: Buffer
  fileName: string
  mimeType: string
  size: number
}

export type MobileChannelAdapterFactoryInput = {
  connection: MobileChannelConnectionRecord
  onMessage: MobileChannelMessageHandler
  onConnected: () => void
  onReconnecting: () => void
  onConnectionError: (error: unknown) => void
}
