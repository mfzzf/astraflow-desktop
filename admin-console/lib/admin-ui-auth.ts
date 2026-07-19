import "server-only"

import { headers } from "next/headers"

import { verifyAdminUIAuthorization } from "@/lib/admin-ui-auth-shared"

export async function requireAdminUIAccess() {
  const requestHeaders = await headers()
  const result = verifyAdminUIAuthorization(requestHeaders.get("authorization"))

  if (result === "unconfigured") {
    throw new Error("Admin UI authentication is not configured.")
  }
  if (result !== "authorized") {
    throw new Error("Admin UI authorization failed.")
  }
}
