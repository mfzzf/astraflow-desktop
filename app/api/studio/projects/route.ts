import { NextResponse } from "next/server"
import { z } from "zod"

import { isCompShareChannel } from "@/lib/compshare/config"
import { getCompShareAccount } from "@/lib/compshare/account"
import { CompShareApiError } from "@/lib/compshare/control-plane"
import { listCompShareUserPlans } from "@/lib/compshare/packages"
import { summarizeCompShareQuota } from "@/lib/compshare/quota"
import { getCompShareControlCredentials } from "@/lib/studio-db/compshare"
import { requireAuthenticatedRequest } from "@/lib/app-auth"
import {
  getSelectedUCloudProjectId,
  getStudioModelverseApiKey,
  saveSelectedUCloudProjectId,
} from "@/lib/studio-db"
import {
  getDefaultUCloudProject,
  listUCloudProjects,
} from "@/lib/modelverse-api-keys"
import { getUCloudUserInfo } from "@/lib/ucloud-user"
import { getUCloudCredentials } from "@/lib/ucloud-credentials"
import { UCloudApiError } from "@/lib/ucloud"

export const runtime = "nodejs"

const selectProjectSchema = z.object({
  projectId: z.string().trim().min(1),
})

function toErrorResponse(error: unknown) {
  if (error instanceof CompShareApiError) {
    return NextResponse.json(
      { ok: false, message: error.message, retCode: error.retCode },
      { status: error.status }
    )
  }

  if (error instanceof UCloudApiError) {
    return NextResponse.json(
      { ok: false, message: error.message, retCode: error.retCode },
      { status: error.status }
    )
  }

  if (error instanceof Error) {
    return NextResponse.json(
      { ok: false, message: error.message },
      { status: 400 }
    )
  }

  return NextResponse.json(
    { ok: false, message: "Unexpected project request failure." },
    { status: 500 }
  )
}

export async function GET() {
  if (isCompShareChannel()) {
    const credentials = getCompShareControlCredentials()

    if (!credentials) {
      return NextResponse.json(
        { ok: false, message: "CompShare credentials are required." },
        { status: 403 }
      )
    }

    try {
      const [account, personalPlans, teamPlans] = await Promise.all([
        getCompShareAccount(credentials),
        listCompShareUserPlans({ isTeam: false }).catch(() => null),
        listCompShareUserPlans({ isTeam: true }).catch(() => null),
      ])

      return NextResponse.json({
        ok: true,
        data: {
          items: [],
          selectedProjectId: null,
          user: {
            userName: account.nickname,
            displayName: account.nickname,
            companyName: "",
            userEmail: "",
            companyId: account.companyId,
            level: account.level,
            quotas: {
              personal: summarizeCompShareQuota(personalPlans?.userPlans ?? []),
              team: summarizeCompShareQuota(teamPlans?.userPlans ?? []),
            },
          },
        },
      })
    } catch (error) {
      return toErrorResponse(error)
    }
  }

  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 403 }
    )
  }

  try {
    const [projects, user] = await Promise.all([
      listUCloudProjects({ credentials }),
      getUCloudUserInfo({ credentials }).catch(() => null),
    ])
    const selectedProjectId = getSelectedUCloudProjectId()
    const savedProjectId = getStudioModelverseApiKey()?.projectId ?? ""
    const credentialProjectId = credentials.projectId
    const resolvedProjectId =
      projects.find((project) => project.id === selectedProjectId)?.id ??
      projects.find((project) => project.id === savedProjectId)?.id ??
      projects.find((project) => project.id === credentialProjectId)?.id ??
      getDefaultUCloudProject(projects)?.id ??
      null

    return NextResponse.json({
      ok: true,
      data: {
        items: projects,
        selectedProjectId: resolvedProjectId,
        user,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}

export async function POST(request: Request) {
  const authError = await requireAuthenticatedRequest(request)

  if (authError) {
    return authError
  }

  const credentials = await getUCloudCredentials()

  if (!credentials) {
    return NextResponse.json(
      { ok: false, message: "UCloud OAuth is required." },
      { status: 403 }
    )
  }

  try {
    const parsed = selectProjectSchema.safeParse(await request.json())

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          message: "Select a UCloud project.",
          error: parsed.error.flatten(),
        },
        { status: 400 }
      )
    }

    const [projects, user] = await Promise.all([
      listUCloudProjects({ credentials }),
      getUCloudUserInfo({ credentials }).catch(() => null),
    ])
    const selected = projects.find(
      (project) => project.id === parsed.data.projectId
    )

    if (!selected) {
      return NextResponse.json(
        {
          ok: false,
          message: "The selected UCloud project was not found.",
        },
        { status: 404 }
      )
    }

    saveSelectedUCloudProjectId(selected.id)

    return NextResponse.json({
      ok: true,
      data: {
        items: projects,
        selectedProjectId: selected.id,
        user,
      },
    })
  } catch (error) {
    return toErrorResponse(error)
  }
}
