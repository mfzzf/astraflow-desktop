import { redirect } from "next/navigation"

import { ADMIN_BASE_PATH } from "@/lib/admin-base-path"

export default function Page() {
  redirect(`${ADMIN_BASE_PATH}/dashboard`)
}
