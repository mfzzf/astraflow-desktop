import "server-only"

import { Buffer } from "node:buffer"
import { timingSafeEqual } from "node:crypto"

export type AdminUIAuthResult = "authorized" | "unauthorized" | "unconfigured"

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left)
  const rightBytes = Buffer.from(right)

  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  )
}

export function verifyAdminUIAuthorization(
  authorization: string | null
): AdminUIAuthResult {
  const expectedUsername = process.env.ASTRAFLOW_ADMIN_UI_USERNAME
  const expectedPassword = process.env.ASTRAFLOW_ADMIN_UI_PASSWORD

  if (!expectedUsername || !expectedPassword) {
    return "unconfigured"
  }
  if (!authorization?.startsWith("Basic ")) {
    return "unauthorized"
  }

  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString(
      "utf8"
    )
    const separator = decoded.indexOf(":")
    if (separator < 0) return "unauthorized"

    const username = decoded.slice(0, separator)
    const password = decoded.slice(separator + 1)
    const usernameMatches = safeEqual(username, expectedUsername)
    const passwordMatches = safeEqual(password, expectedPassword)
    return usernameMatches && passwordMatches
      ? "authorized"
      : "unauthorized"
  } catch {
    return "unauthorized"
  }
}
