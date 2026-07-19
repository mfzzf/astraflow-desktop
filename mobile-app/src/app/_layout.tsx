import {
  Fraunces_600SemiBold,
  Fraunces_600SemiBold_Italic,
} from "@expo-google-fonts/fraunces"
import {
  IBMPlexSans_400Regular,
  IBMPlexSans_500Medium,
  IBMPlexSans_600SemiBold,
} from "@expo-google-fonts/ibm-plex-sans"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useFonts } from "expo-font"
import * as Notifications from "expo-notifications"
import { Stack, useRouter } from "expo-router"
import * as SplashScreen from "expo-splash-screen"
import { StatusBar } from "expo-status-bar"
import { useEffect, useRef, useState } from "react"

import { AuthProvider } from "@/lib/auth"
import { CrossDeviceSyncProvider } from "@/lib/sync"
import { palette } from "@/lib/theme"

void SplashScreen.preventAutoHideAsync()

export default function RootLayout() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 2, staleTime: 5_000, gcTime: 24 * 60 * 60_000 },
          mutations: { retry: 0 },
        },
      })
  )
  const [fontsLoaded] = useFonts({
    Fraunces_600SemiBold,
    Fraunces_600SemiBold_Italic,
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
  })

  useEffect(() => {
    if (fontsLoaded) void SplashScreen.hideAsync()
  }, [fontsLoaded])

  if (!fontsLoaded) return null

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <CrossDeviceSyncProvider>
          <NotificationRouter />
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: palette.paper },
              headerTintColor: palette.ink,
              headerShadowVisible: false,
              contentStyle: { backgroundColor: palette.paper },
            }}
          >
            <Stack.Screen name="index" options={{ headerShown: false }} />
            <Stack.Screen name="login" options={{ headerShown: false }} />
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="new-task"
              options={{ presentation: "modal", title: "新建任务" }}
            />
            <Stack.Screen name="run/[runId]" options={{ title: "任务详情" }} />
            <Stack.Screen name="experts" options={{ title: "Experts" }} />
            <Stack.Screen
              name="expert/[expertId]"
              options={{ title: "专家详情" }}
            />
            <Stack.Screen
              name="skill/[slug]"
              options={{ title: "SKILL 详情" }}
            />
            <Stack.Screen
              name="automations"
              options={{ title: "Automations" }}
            />
            <Stack.Screen
              name="oauth/callback"
              options={{ headerShown: false }}
            />
          </Stack>
        </CrossDeviceSyncProvider>
      </AuthProvider>
    </QueryClientProvider>
  )
}

function NotificationRouter() {
  const router = useRouter()
  const handled = useRef(new Set<string>())
  useEffect(() => {
    const open = (response: Notifications.NotificationResponse | null) => {
      if (!response) return
      const identifier = response.notification.request.identifier
      if (handled.current.has(identifier)) return
      handled.current.add(identifier)
      const data = response.notification.request.content.data ?? {}
      const runId =
        typeof data.runId === "string"
          ? data.runId
          : typeof data.run_id === "string"
            ? data.run_id
            : ""
      if (runId) router.push({ pathname: "/run/[runId]", params: { runId } })
    }
    const subscription =
      Notifications.addNotificationResponseReceivedListener(open)
    void Notifications.getLastNotificationResponseAsync().then(open)
    return () => subscription.remove()
  }, [router])
  return null
}
