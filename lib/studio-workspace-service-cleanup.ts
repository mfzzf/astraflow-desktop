import type { CodeBoxWorkspaceService } from "@/lib/codebox-runtime"

type WorkspaceServiceCleanupFailure = {
  serviceId: string
  message: string
}

const UNRESOLVED_SERVICE_FAILURE_CODES = new Set([
  "GATEWAY_RESTART_UNVERIFIED",
  "SERVICE_REAP_FAILED",
])

export async function stopActiveWorkspaceServicesBestEffort({
  services,
  stopService,
}: {
  services: CodeBoxWorkspaceService[]
  stopService: (service: CodeBoxWorkspaceService) => Promise<unknown>
}) {
  const activeServices = services.filter(
    (service) => !["failed", "stopped"].includes(service.status)
  )
  const unresolvedServices = services.filter(
    (service) =>
      service.status === "failed" &&
      service.failureCode !== null &&
      UNRESOLVED_SERVICE_FAILURE_CODES.has(service.failureCode)
  )
  const results = await Promise.allSettled(
    activeServices.map((service) => stopService(service))
  )
  const rejectedCount = results.filter(
    (result) => result.status === "rejected"
  ).length
  const failures: WorkspaceServiceCleanupFailure[] = [
    ...unresolvedServices.map((service) => ({
      serviceId: service.serviceId,
      message:
        service.failure ||
        `Workspace service has unresolved failure ${service.failureCode}.`,
    })),
    ...results.flatMap((result, index) =>
      result.status === "rejected"
        ? [
            {
              serviceId: activeServices[index].serviceId,
              message:
                result.reason instanceof Error
                  ? result.reason.message
                  : String(result.reason),
            },
          ]
        : []
    ),
  ]

  return {
    attempted: activeServices.length + unresolvedServices.length,
    stopped: activeServices.length - rejectedCount,
    failures,
  }
}
