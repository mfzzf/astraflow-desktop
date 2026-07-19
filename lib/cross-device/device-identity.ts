import { generateKeyPairSync, randomUUID } from "node:crypto"
import { hostname } from "node:os"

import { readSecretSetting, writeSecretSetting } from "@/lib/studio-db/helpers"

const DEVICE_IDENTITY_SETTING = "cross_device.desktop_identity.v1"

export type DesktopDeviceIdentity = {
  deviceId: string
  name: string
  publicKey: string
  privateKey: string
  createdAt: string
}

export function getOrCreateDesktopDeviceIdentity(): DesktopDeviceIdentity {
  const existing = readSecretSetting(DEVICE_IDENTITY_SETTING)
  if (existing?.value) {
    try {
      const parsed = JSON.parse(
        existing.value
      ) as Partial<DesktopDeviceIdentity>
      if (
        parsed.deviceId &&
        parsed.name &&
        parsed.publicKey &&
        parsed.privateKey &&
        parsed.createdAt
      ) {
        return parsed as DesktopDeviceIdentity
      }
    } catch {
      // Replace malformed identity state with a fresh key pair below.
    }
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519")
  const identity: DesktopDeviceIdentity = {
    deviceId: randomUUID(),
    name: hostname().trim() || "AstraFlow Mac",
    publicKey: publicKey
      .export({ type: "spki", format: "der" })
      .toString("base64"),
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    createdAt: new Date().toISOString(),
  }
  writeSecretSetting(DEVICE_IDENTITY_SETTING, JSON.stringify(identity))
  return identity
}
