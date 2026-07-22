import "server-only"

import {
  callCompShareAction,
  type CompShareCredentials,
} from "@/lib/compshare/control-plane"

type RawCompShareAccount = {
  Nickname?: unknown
  CompanyId?: unknown
  Level?: unknown
}

type GetCompShareAccountResponse = {
  Account?: RawCompShareAccount | null
}

export type CompShareAccount = {
  nickname: string
  companyId: number | null
  level: number | null
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function readNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value !== "string" || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export async function getCompShareAccount(
  credentials: CompShareCredentials
): Promise<CompShareAccount> {
  const response = await callCompShareAction<GetCompShareAccountResponse>({
    credentials,
    params: { Action: "GetCompShareAccount" },
  })
  const account = response.Account ?? {}

  return {
    nickname: readString(account.Nickname),
    companyId: readNumber(account.CompanyId),
    level: readNumber(account.Level),
  }
}
