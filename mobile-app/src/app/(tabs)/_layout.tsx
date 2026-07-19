import { Redirect } from "expo-router"
import { NativeTabs } from "expo-router/unstable-native-tabs"

import { LoadingState, Screen } from "@/components/ui"
import { useAuth } from "@/lib/auth"
import { font, palette } from "@/lib/theme"

export default function TabsLayout() {
  const auth = useAuth()
  if (auth.status === "loading") {
    return (
      <Screen scroll={false}>
        <LoadingState />
      </Screen>
    )
  }
  if (auth.status !== "signed_in") return <Redirect href="/login" />

  return (
    <NativeTabs
      backgroundColor={palette.paperRaised}
      indicatorColor={palette.signal}
      iconColor={{ default: palette.textMuted, selected: palette.ink }}
      tintColor={palette.ink}
      labelStyle={{
        default: { fontFamily: font.body, fontSize: 11, color: palette.textMuted },
        selected: { fontFamily: font.semibold, fontSize: 11, color: palette.ink },
      }}
      labelVisibilityMode="labeled"
      tabBarRespectsIMEInsets
    >
      <NativeTabs.Trigger name="models">
        <NativeTabs.Trigger.Icon md="deployed_code" sf="cube.transparent" />
        <NativeTabs.Trigger.Label>Models</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="skills">
        <NativeTabs.Trigger.Icon md="extension" sf="puzzlepiece.extension" />
        <NativeTabs.Trigger.Label>SKILLS</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <NativeTabs.Trigger.Icon md="bolt" sf="bolt.fill" />
        <NativeTabs.Trigger.Label>任务</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="devices">
        <NativeTabs.Trigger.Icon md="devices" sf="macbook.and.iphone" />
        <NativeTabs.Trigger.Label>设备</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon md="tune" sf="slider.horizontal.3" />
        <NativeTabs.Trigger.Label>设置</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  )
}
