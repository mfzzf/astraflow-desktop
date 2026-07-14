#!/usr/bin/env node
import { ndJsonStream } from "@agentclientprotocol/sdk"
import { Readable, Writable } from "node:stream"

import { createAstraflowAcpApp } from "./agent.mjs"

const input = Writable.toWeb(process.stdout)
const output = Readable.toWeb(process.stdin)
const stream = ndJsonStream(input, output)
const { app, runtime } = createAstraflowAcpApp()
const connection = app.connect(stream)
let closing = false

async function close() {
  if (closing) {
    return
  }

  closing = true
  runtime.shutdown()
  connection.close()
  await connection.closed.catch(() => undefined)
}

process.once("SIGINT", () => void close())
process.once("SIGTERM", () => void close())
connection.closed.finally(() => runtime.shutdown())
