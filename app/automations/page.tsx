import { connection } from "next/server"

import { AutomationsPage } from "@/components/automations-page"

export default async function AutomationsRoute() {
  await connection()

  return <AutomationsPage />
}
