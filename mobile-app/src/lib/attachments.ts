import { sha256 } from "@noble/hashes/sha2.js"
import { bytesToHex } from "@noble/hashes/utils.js"
import * as DocumentPicker from "expo-document-picker"
import { Directory, File, FileMode, Paths, UploadType } from "expo-file-system"
import * as ImagePicker from "expo-image-picker"

import {
  artifactServiceCompleteUpload,
  artifactServiceCreateUpload,
  type AstraflowV1Artifact,
} from "@/generated/astraflow-api"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { createId } from "@/lib/ids"

const attachmentDirectory = new Directory(Paths.document, "task-attachments")
const maxAttachmentBytes = 2 * 1024 * 1024 * 1024
const hashChunkBytes = 1024 * 1024

export type LocalAttachment = {
  id: string
  uri: string
  name: string
  mimeType: string
  size: number
  kind: "attachment" | "image" | "video" | "audio"
}

export async function pickTaskDocuments() {
  const result = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: true,
    copyToCacheDirectory: true,
  })
  if (result.canceled) return []
  return Promise.all(
    result.assets.map((asset) =>
      persistAttachment({
        uri: asset.uri,
        name: asset.name,
        mimeType: asset.mimeType || "application/octet-stream",
        size: asset.size,
      })
    )
  )
}

export async function captureTaskPhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync()
  if (!permission.granted) {
    throw new Error("需要相机权限才能拍摄任务附件。")
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    quality: 0.9,
  })
  if (result.canceled) return []
  return Promise.all(
    result.assets.map((asset) =>
      persistAttachment({
        uri: asset.uri,
        name: asset.fileName || `photo-${Date.now()}.jpg`,
        mimeType: asset.mimeType || "image/jpeg",
        size: asset.fileSize,
      })
    )
  )
}

export async function persistVoiceRecording(uri: string) {
  return persistAttachment({
    uri,
    name: `voice-${new Date().toISOString().replace(/[:.]/g, "-")}.m4a`,
    mimeType: "audio/mp4",
  })
}

export async function uploadTaskAttachments(
  authorization: string,
  input: {
    taskId: string
    sessionId: string
    runId: string
    sourceDeviceId: string
    attachments: LocalAttachment[]
  }
) {
  const artifacts: AstraflowV1Artifact[] = []
  for (const attachment of input.attachments) {
    artifacts.push(
      await uploadAttachment(authorization, {
        ...input,
        attachment,
      })
    )
  }
  return artifacts
}

export async function cleanupTaskAttachments(attachments: LocalAttachment[]) {
  for (const attachment of attachments) {
    try {
      const file = new File(attachment.uri)
      if (file.exists && isManagedAttachment(file.uri)) file.delete()
    } catch {
      // Uploaded artifacts are durable; cleanup failures can be reclaimed by the OS/user later.
    }
  }
}

async function persistAttachment(input: {
  uri: string
  name: string
  mimeType: string
  size?: number
}): Promise<LocalAttachment> {
  attachmentDirectory.create({ idempotent: true, intermediates: true })
  const source = new File(input.uri)
  if (!source.exists) throw new Error("选择的附件已不可访问，请重新选择。")
  const sourceSize = input.size ?? source.size
  if (
    !Number.isFinite(sourceSize) ||
    sourceSize < 0 ||
    sourceSize > maxAttachmentBytes
  ) {
    throw new Error("单个附件不能超过 2 GB。")
  }
  const id = createId("attachment")
  const name = safeFileName(input.name)
  const destination = new File(attachmentDirectory, `${id}-${name}`)
  await source.copy(destination)
  const size = destination.size
  if (!Number.isFinite(size) || size < 0 || size > maxAttachmentBytes) {
    destination.delete()
    throw new Error("单个附件不能超过 2 GB。")
  }
  return {
    id,
    uri: destination.uri,
    name,
    mimeType: input.mimeType || source.type || "application/octet-stream",
    size,
    kind: artifactKind(input.mimeType),
  }
}

async function uploadAttachment(
  authorization: string,
  input: {
    taskId: string
    sessionId: string
    runId: string
    sourceDeviceId: string
    attachment: LocalAttachment
  }
) {
  const file = new File(input.attachment.uri)
  if (!file.exists) {
    throw new Error(`${input.attachment.name} 已不在本机，请重新添加。`)
  }
  if (file.size !== input.attachment.size) {
    throw new Error(`${input.attachment.name} 在发送前发生了变化。`)
  }
  const digest = await sha256File(file)
  const headers = authorizationHeaders(authorization)
  const upload = requireApiData(
    await artifactServiceCreateUpload({
      headers,
      body: {
        uploadId: input.attachment.id,
        artifactId: createId("artifact"),
        sessionId: input.sessionId,
        runId: input.runId,
        kind: input.attachment.kind,
        fileName: input.attachment.name,
        mimeType: input.attachment.mimeType,
        size: String(input.attachment.size),
        sha256: digest,
        sourceDeviceId: input.sourceDeviceId,
        clientMutationId: `${input.taskId}:upload:${input.attachment.id}`,
      },
    }),
    `无法准备附件 ${input.attachment.name}。`
  )
  if (!upload.uploadUrl) throw new Error("后端没有返回附件上传地址。")
  const result = await file.upload(upload.uploadUrl, {
    httpMethod: "PUT",
    uploadType: UploadType.BINARY_CONTENT,
    headers: upload.uploadHeaders,
    mimeType: input.attachment.mimeType,
    sessionType: "background",
  })
  if (result.status < 200 || result.status >= 300) {
    throw new Error(
      `${input.attachment.name} 上传失败（HTTP ${result.status}）。`
    )
  }
  return requireApiData(
    await artifactServiceCompleteUpload({
      headers,
      path: { uploadId: upload.id! },
      body: {
        uploadId: upload.id,
        sourceDeviceId: input.sourceDeviceId,
        clientMutationId: `${input.taskId}:complete:${input.attachment.id}`,
      },
    }),
    `无法完成附件 ${input.attachment.name}。`
  )
}

async function sha256File(file: File) {
  const hasher = sha256.create()
  const handle = file.open(FileMode.ReadOnly)
  try {
    let remaining = file.size
    while (remaining > 0) {
      const bytes = handle.readBytes(Math.min(hashChunkBytes, remaining))
      if (!bytes.length) throw new Error("读取附件时意外结束。")
      hasher.update(bytes)
      remaining -= bytes.length
    }
    return bytesToHex(hasher.digest())
  } finally {
    handle.close()
  }
}

function artifactKind(mimeType: string): LocalAttachment["kind"] {
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return "attachment"
}

function safeFileName(value: string) {
  const normalized = value
    .trim()
    .replace(/[\\/\u0000\r\n]/g, "-")
    .slice(0, 180)
  return normalized || `attachment-${Date.now()}`
}

function isManagedAttachment(uri: string) {
  return uri.startsWith(attachmentDirectory.uri)
}
