import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { afterAll, beforeEach, expect, mock, test } from "bun:test"

const ISOLATED_RUN_ENV = "COMPSHARE_CLI_CREDENTIALS_ISOLATED"

if (process.env[ISOLATED_RUN_ENV] === "1") {
  mock.module("server-only", () => ({}))
  mock.module("@/lib/compshare/config", () => ({
    isCompShareChannel: () => true,
  }))

  let requestedCredentials: unknown = null
  let requestedParams: unknown = null
  let responseAccessKeys: unknown[] = []
  mock.module("@/lib/compshare/control-plane", () => ({
    callCompShareAction: async (input: {
      credentials: unknown
      params: unknown
    }) => {
      requestedCredentials = input.credentials
      requestedParams = input.params
      return { AccessKey: responseAccessKeys, RetCode: 0 }
    },
  }))

  const testRoot = mkdtempSync(join(tmpdir(), "compshare-cli-credentials-"))
  const configPath = join(testRoot, "nested", "config.json")
  process.env.COMPSHARE_CONFIG_FILE = configPath
  const credentials = await import("@/lib/compshare/cli-credentials")

  beforeEach(() => {
    requestedCredentials = null
    requestedParams = null
    responseAccessKeys = []
    credentials.clearCompShareCliCredentials()
  })

  afterAll(() => {
    delete process.env.COMPSHARE_CONFIG_FILE
    chmodSync(testRoot, 0o700)
    rmSync(testRoot, { recursive: true, force: true })
  })

  test("selects the most recently active, unexpired access key", () => {
    expect(
      credentials.selectCompShareCliAccessKey(
        [
          {
            AccessKeyID: "inactive-id",
            AccessKeySecret: "inactive-secret",
            Status: "Inactive",
            LastUsedAt: 999,
          },
          {
            AccessKeyID: "expired-id",
            AccessKeySecret: "expired-secret",
            Status: "Active",
            ExpiredAt: 100,
            LastUsedAt: 998,
          },
          {
            AccessKeyID: "older-id",
            AccessKeySecret: "older-secret",
            Status: "Active",
            ExpiredAt: 0,
            LastUsedAt: 200,
          },
          {
            AccessKeyID: "newer-id",
            AccessKeySecret: "newer-secret",
            Status: "Active",
            ExpiredAt: 0,
            LastUsedAt: 300,
          },
        ],
        500
      )
    ).toEqual({
      publicKey: "newer-id",
      privateKey: "newer-secret",
    })
  })

  test("fetches keys with OAuth and writes a private CLI profile", async () => {
    responseAccessKeys = [
      {
        AccessKeyID: "selected-id",
        AccessKeySecret: "selected-secret",
        Status: "Active",
        ExpiredAt: 0,
      },
    ]

    await credentials.syncCompShareCliCredentials("oauth-access-token")

    expect(requestedCredentials).toEqual({
      accessToken: "oauth-access-token",
    })
    expect(requestedParams).toEqual({
      Action: "ListUserAccessKeys",
      UserName: "root",
    })
    expect(JSON.parse(readFileSync(configPath, "utf8"))).toEqual({
      current_profile: "default",
      profiles: {
        default: {
          public_key: "selected-id",
          private_key: "selected-secret",
        },
      },
    })

    if (process.platform !== "win32") {
      expect(statSync(configPath).mode & 0o777).toBe(0o600)
      expect(statSync(join(testRoot, "nested")).mode & 0o777).toBe(0o700)
    }
  })

  test("removes stale CLI credentials when no usable key is returned", async () => {
    responseAccessKeys = [
      {
        AccessKeyID: "selected-id",
        AccessKeySecret: "selected-secret",
        Status: "Active",
        ExpiredAt: 0,
      },
    ]
    await credentials.syncCompShareCliCredentials("oauth-access-token")

    responseAccessKeys = [
      {
        AccessKeyID: "expired-id",
        AccessKeySecret: "expired-secret",
        Status: "Inactive",
        ExpiredAt: 1,
      },
    ]

    await expect(
      credentials.syncCompShareCliCredentials("oauth-access-token")
    ).rejects.toThrow("active, unexpired access key")
    expect(() => readFileSync(configPath, "utf8")).toThrow()
  })
} else {
  test("passes the isolated CompShare CLI credential suite", () => {
    const result = spawnSync(
      process.execPath,
      ["test", fileURLToPath(import.meta.url)],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          [ISOLATED_RUN_ENV]: "1",
        },
      }
    )

    assert.equal(result.status, 0, result.stderr || result.stdout)
  })
}
