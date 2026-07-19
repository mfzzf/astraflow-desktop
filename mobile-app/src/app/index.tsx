import { Redirect } from "expo-router"

import { LoadingState, Screen } from "@/components/ui"
import { useAuth } from "@/lib/auth"

export default function IndexRoute() {
  const { status } = useAuth()
  if (status === "loading") {
    return (
      <Screen scroll={false}>
        <LoadingState label="正在恢复安全会话…" />
      </Screen>
    )
  }
  return <Redirect href={status === "signed_in" ? "/models" : "/login"} />
}
