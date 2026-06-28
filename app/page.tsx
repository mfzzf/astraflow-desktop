import { redirect } from "next/navigation"

import { getAppAuthState } from "@/lib/app-auth"

export default async function Page() {
  const auth = await getAppAuthState()

  redirect(auth.authenticated ? "/explore" : "/login")
}
