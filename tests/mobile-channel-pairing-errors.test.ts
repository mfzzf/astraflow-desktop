import assert from "node:assert/strict"
import test from "node:test"

import { errorMessage } from "../lib/mobile-channels/error-message"

test("pairing errors preserve SDK code and description objects", () => {
  assert.equal(
    errorMessage({ code: "access_denied", description: "用户拒绝授权" }),
    "用户拒绝授权 (access_denied)"
  )
  assert.equal(
    errorMessage({ code: "expired_token", message: "二维码已过期" }),
    "二维码已过期 (expired_token)"
  )
})

test("pairing errors do not stringify unknown objects with credentials", () => {
  assert.equal(
    errorMessage({ bot_token: "secret-value", nested: { secret: "hidden" } }),
    "平台返回了未识别的错误。"
  )
})
