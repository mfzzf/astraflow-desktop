import * as AuthSession from "expo-auth-session"
import * as Crypto from "expo-crypto"
import * as SecureStore from "expo-secure-store"
import * as WebBrowser from "expo-web-browser"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react"

import {
  crossDeviceServiceExchangeNativeOAuthCode,
  crossDeviceServiceGetCurrentAccount,
  crossDeviceServiceGetNativeOAuthConfig,
  crossDeviceServiceRefreshNativeOAuthToken,
  type AstraflowV1Account,
  type AstraflowV1NativeOAuthTokens,
} from "@/generated/astraflow-api"
import { authorizationHeaders, requireApiData } from "@/lib/api"
import { disablePushEndpoint } from "@/lib/notifications"

WebBrowser.maybeCompleteAuthSession()

const tokenStorageKey = "astraflow.mobile.oauth.v1"
const deviceStorageKey = "astraflow.mobile.device-id.v1"
const refreshSkewMs = 5 * 60_000

type StoredTokens = {
  accessToken: string
  refreshToken: string | null
  tokenType: string
  expiresAt: number | null
  idToken: string | null
}

type AuthStatus = "loading" | "signed_out" | "signed_in"

type AuthContextValue = {
  status: AuthStatus
  account: AstraflowV1Account | null
  error: string | null
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  getAuthorization: () => Promise<string>
  refreshAccount: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

function normalizeTokens(
  value: AstraflowV1NativeOAuthTokens,
  previous?: StoredTokens | null
): StoredTokens {
  const expiresIn = Number(value.expiresIn ?? 0)
  return {
    accessToken: value.accessToken ?? "",
    refreshToken: value.refreshToken || previous?.refreshToken || null,
    tokenType: value.tokenType || previous?.tokenType || "Bearer",
    expiresAt:
      Number.isFinite(expiresIn) && expiresIn > 0
        ? Date.now() + expiresIn * 1000
        : (previous?.expiresAt ?? null),
    idToken: value.idToken || previous?.idToken || null,
  }
}

async function readStoredTokens() {
  const value = await SecureStore.getItemAsync(tokenStorageKey)
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as StoredTokens
    return parsed.accessToken ? parsed : null
  } catch {
    await SecureStore.deleteItemAsync(tokenStorageKey)
    return null
  }
}

async function saveTokens(tokens: StoredTokens | null) {
  if (!tokens) {
    await SecureStore.deleteItemAsync(tokenStorageKey)
    return
  }
  await SecureStore.setItemAsync(tokenStorageKey, JSON.stringify(tokens), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
}

export async function getOrCreateMobileDeviceId() {
  const current = await SecureStore.getItemAsync(deviceStorageKey)
  if (current) return current
  const id = `mobile_${Crypto.randomUUID()}`
  await SecureStore.setItemAsync(deviceStorageKey, id, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
  return id
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("loading")
  const [account, setAccount] = useState<AstraflowV1Account | null>(null)
  const [error, setError] = useState<string | null>(null)
  const tokenRef = useRef<StoredTokens | null>(null)
  const refreshPromise = useRef<Promise<StoredTokens> | null>(null)

  const getAuthorization = useCallback(async () => {
    let tokens = tokenRef.current ?? (await readStoredTokens())
    if (!tokens) throw new Error("请先登录 UCloud。")
    tokenRef.current = tokens

    if (tokens.expiresAt && tokens.expiresAt <= Date.now() + refreshSkewMs) {
      if (!tokens.refreshToken) {
        throw new Error("登录已过期，请重新登录。")
      }
      if (!refreshPromise.current) {
        const previous = tokens
        refreshPromise.current = crossDeviceServiceRefreshNativeOAuthToken({
          body: { refreshToken: tokens.refreshToken },
        })
          .then((result) =>
            normalizeTokens(
              requireApiData(result, "刷新 UCloud 登录失败。"),
              previous
            )
          )
          .then(async (next) => {
            tokenRef.current = next
            await saveTokens(next)
            return next
          })
          .finally(() => {
            refreshPromise.current = null
          })
      }
      tokens = await refreshPromise.current
    }
    return `${tokens.tokenType} ${tokens.accessToken}`
  }, [])

  const refreshAccount = useCallback(async () => {
    const authorization = await getAuthorization()
    const current = requireApiData(
      await crossDeviceServiceGetCurrentAccount({
        headers: authorizationHeaders(authorization),
      }),
      "无法读取账号信息。"
    )
    setAccount(current)
    setStatus("signed_in")
  }, [getAuthorization])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        tokenRef.current = await readStoredTokens()
        if (!tokenRef.current) {
          if (!cancelled) setStatus("signed_out")
          return
        }
        await refreshAccount()
      } catch (caught) {
        tokenRef.current = null
        await saveTokens(null)
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "登录已失效。")
          setStatus("signed_out")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [refreshAccount])

  const signIn = useCallback(async () => {
    setError(null)
    const config = requireApiData(
      await crossDeviceServiceGetNativeOAuthConfig(),
      "服务端尚未配置移动端 OAuth。"
    )
    if (!config.clientId || !config.authorizationEndpoint) {
      throw new Error("服务端返回的 OAuth 配置不完整。")
    }
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: "astraflow",
      path: "oauth/callback",
    })
    const request = new AuthSession.AuthRequest({
      clientId: config.clientId,
      redirectUri,
      responseType: AuthSession.ResponseType.Code,
      scopes: config.scopes ?? ["openid", "email", "offline_access"],
      usePKCE: true,
    })
    const result = await request.promptAsync({
      authorizationEndpoint: config.authorizationEndpoint,
    })
    if (result.type !== "success" || !result.params.code) {
      if (result.type === "dismiss" || result.type === "cancel") return
      throw new Error("UCloud 登录未完成。")
    }
    if (!request.codeVerifier) {
      throw new Error("PKCE 校验器未生成。")
    }
    const exchanged = requireApiData(
      await crossDeviceServiceExchangeNativeOAuthCode({
        body: {
          code: result.params.code,
          redirectUri,
          codeVerifier: request.codeVerifier,
        },
      }),
      "UCloud 授权码交换失败。"
    )
    const tokens = normalizeTokens(exchanged)
    if (!tokens.accessToken) throw new Error("服务端未返回访问令牌。")
    tokenRef.current = tokens
    await saveTokens(tokens)
    await refreshAccount()
  }, [refreshAccount])

  const signOut = useCallback(async () => {
    try {
      const tokens = tokenRef.current ?? (await readStoredTokens())
      if (tokens?.accessToken) {
        const deviceId = await getOrCreateMobileDeviceId()
        await disablePushEndpoint(
          `${tokens.tokenType} ${tokens.accessToken}`,
          deviceId
        )
      }
    } catch {
      // Logout must still complete offline or when the endpoint is unavailable.
    } finally {
      tokenRef.current = null
      setAccount(null)
      setError(null)
      setStatus("signed_out")
      await saveTokens(null)
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      account,
      error,
      signIn: async () => {
        try {
          await signIn()
        } catch (caught) {
          const message =
            caught instanceof Error ? caught.message : "登录失败。"
          setError(message)
          throw caught
        }
      },
      signOut,
      getAuthorization,
      refreshAccount,
    }),
    [account, error, getAuthorization, refreshAccount, signIn, signOut, status]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
