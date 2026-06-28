import type { ReactNode } from "react"

import { requireAppAuth } from "@/lib/app-auth"

export default async function StudioLayout({
  children,
}: {
  children: ReactNode
}) {
  await requireAppAuth()

  return children
}
