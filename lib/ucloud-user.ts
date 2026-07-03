import { callUCloudAction, type UCloudCredentials } from "@/lib/ucloud"

export type UCloudUserInfo = {
  userName: string
  displayName: string
  companyName: string
  userEmail: string
  companyId: number | null
}

type RawUCloudUserInfo = {
  UserName?: string
  DisplayName?: string
  CompanyName?: string
  UserEmail?: string
  CompanyId?: number | string
}

type GetUserInfoResponse = RawUCloudUserInfo & {
  Action?: string
  RetCode?: number
  Message?: string
  Data?: RawUCloudUserInfo
  DataSet?: RawUCloudUserInfo[]
}

function normalizeCompanyId(value: RawUCloudUserInfo["CompanyId"]) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string") {
    const parsed = Number(value)

    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function normalizeUserInfo(value: RawUCloudUserInfo): UCloudUserInfo {
  return {
    userName: value.UserName?.trim() ?? "",
    displayName: value.DisplayName?.trim() ?? "",
    companyName: value.CompanyName?.trim() ?? "",
    userEmail: value.UserEmail?.trim() ?? "",
    companyId: normalizeCompanyId(value.CompanyId),
  }
}

export async function getUCloudUserInfo({
  credentials,
}: {
  credentials: UCloudCredentials
}) {
  const response = await callUCloudAction<GetUserInfoResponse>({
    credentials,
    params: {
      Action: "GetUserInfo",
    },
  })

  return normalizeUserInfo(response.Data ?? response.DataSet?.[0] ?? response)
}
