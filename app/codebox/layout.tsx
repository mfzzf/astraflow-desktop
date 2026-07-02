import type { ReactNode } from "react"
import { connection } from "next/server"

import { requireAppAuth } from "@/lib/app-auth"

export default async function CodeBoxLayout({
  children,
}: {
  children: ReactNode
}) {
  await connection()
  await requireAppAuth()

  return children
}
