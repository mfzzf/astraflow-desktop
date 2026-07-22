type PlanDisplaySource = {
  code: string
  planCode: string
  planName: string
  displayName: string
}

type PlanCatalogSource = {
  code: string
  name: string
}

function normalizePlanName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

export function resolveCompSharePlanLabel(
  plan: PlanDisplaySource,
  catalogPlans: readonly PlanCatalogSource[]
) {
  const planName = plan.planName.trim()
  const displayName = plan.displayName.trim()
  if (!displayName) {
    return planName || plan.code
  }

  const normalizedDisplayName = normalizePlanName(displayName)
  const isStaleDefaultName =
    normalizedDisplayName !== normalizePlanName(planName) &&
    catalogPlans.some(
      (catalogPlan) =>
        catalogPlan.code !== plan.planCode &&
        normalizePlanName(catalogPlan.name) === normalizedDisplayName
    )

  return isStaleDefaultName ? planName || plan.code : displayName
}
