import {
  access,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises"
import { constants } from "node:fs"
import { homedir } from "node:os"
import { extname, resolve } from "node:path"

import {
  Type,
  type ImageContent,
  type TextContent,
} from "@earendil-works/pi-ai"
import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type BashOperations,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent"
import { z } from "zod"

import { ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS } from "@/lib/astraflow-sandbox-runtime"
import type { AstraFlowTool } from "@/lib/ai/tools/tool"
import {
  requestSandboxNetworkPermission,
  requestToolPermission,
  type PermissionGatewayContext,
} from "@/lib/agent/permission-gateway"
import {
  spawnLocalSandboxedCommand,
  terminateLocalSandboxedCommand,
} from "@/lib/agent/sandbox/local-command"
import {
  ensureLocalSandboxWorkspace,
  resolveLocalSandboxReadPath,
  resolveLocalSandboxWritePath,
} from "@/lib/agent/sandbox/local-policy"
import { createUnifiedFileDiff } from "@/lib/agent/unified-diff"
import { withStudioSessionLock } from "@/lib/studio-session-lock"

const BROAD_HOME_GREP_ERROR =
  "Grep search was not started because searching the entire home directory can hang the desktop client. Select or open a project folder, or retry with a narrower path or file glob."
const BROAD_HOME_FIND_ERROR =
  "Find search was not started because recursive ** searches from the home directory can hang the desktop client. Select or open a project folder, or retry with a narrower path or pattern."

export const PI_LOCAL_TOOL_NAMES = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
] as const

// Pi itself uses this erased generic shape for heterogeneous custom tool lists.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyPiToolDefinition = ToolDefinition<any, any, any>

function stringifyToolPayload(value: unknown) {
  if (typeof value === "string") {
    return value
  }

  if (value === null || value === undefined) {
    return ""
  }

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function getRecord(value: unknown) {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null
}

function isNotFoundError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  )
}

function astraFlowToolOutputToPiContent(
  value: unknown
): Array<TextContent | ImageContent> {
  const record = getRecord(value)
  const rawContent = record && "content" in record ? record.content : value

  if (Array.isArray(rawContent)) {
    const content = rawContent.flatMap<TextContent | ImageContent>((part) => {
      const item = getRecord(part)

      if (typeof item?.text === "string") {
        return [{ type: "text" as const, text: item.text }]
      }

      if (item?.type === "image" && typeof item.data === "string") {
        return [
          {
            type: "image" as const,
            data: item.data,
            mimeType:
              typeof item.mimeType === "string"
                ? item.mimeType
                : "application/octet-stream",
          },
        ]
      }

      return [{ type: "text" as const, text: stringifyToolPayload(part) }]
    })

    if (content.length) {
      return content
    }
  }

  return [{ type: "text" as const, text: stringifyToolPayload(rawContent) }]
}

export function adaptAstraFlowToolsToPi(
  tools: AstraFlowTool[]
): AnyPiToolDefinition[] {
  return tools.map((agentTool) => {
    const parameters =
      agentTool.inputJsonSchema ??
      z.toJSONSchema(agentTool.schema, {
        target: "draft-7",
        unrepresentable: "any",
      })

    return {
      name: agentTool.name,
      label: agentTool.name,
      description: agentTool.description,
      parameters: Type.Unsafe(parameters),
      async execute(_toolCallId, params, signal) {
        const output = await agentTool.invoke(params, { signal })

        return {
          content: astraFlowToolOutputToPiContent(output),
          details: undefined,
        }
      },
    }
  })
}

function wrapWithPermissionGateway(
  definition: AnyPiToolDefinition,
  context: PermissionGatewayContext
): AnyPiToolDefinition {
  const execute = definition.execute.bind(definition)

  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, extensionContext) {
      const permission = await requestToolPermission({
        context,
        input: params,
        toolName: definition.name,
      })

      if (!permission.allowed) {
        throw new Error(permission.message)
      }

      return execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        extensionContext
      )
    },
  }
}

function wrapWriteWithFileDiff(
  definition: AnyPiToolDefinition,
  resolveWritePath: (path: string) => string
): AnyPiToolDefinition {
  const execute = definition.execute.bind(definition)

  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, extensionContext) {
      const record = getRecord(params)
      const path = typeof record?.path === "string" ? record.path : null
      const content =
        typeof record?.content === "string" ? record.content : null

      if (!path || content === null) {
        return execute(
          toolCallId,
          params,
          signal,
          onUpdate,
          extensionContext
        )
      }

      const safePath = resolveWritePath(path)
      let previousContent: string | null | undefined

      try {
        previousContent = await readFile(safePath, "utf8")
      } catch (error) {
        previousContent = isNotFoundError(error) ? null : undefined
      }

      const result = await execute(
        toolCallId,
        params,
        signal,
        onUpdate,
        extensionContext
      )
      const diff =
        previousContent === undefined
          ? null
          : createUnifiedFileDiff({
              path,
              previousContent,
              nextContent: content,
            })

      return {
        ...result,
        details: {
          ...(getRecord(result.details) ?? {}),
          diff,
          patch: diff,
          kind: previousContent === null ? "create" : "edit",
        },
      }
    },
  }
}

function detectImageMimeType(path: string) {
  switch (extname(path).toLowerCase()) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg"
    case ".png":
      return "image/png"
    case ".gif":
      return "image/gif"
    case ".webp":
      return "image/webp"
    case ".bmp":
      return "image/bmp"
    default:
      return null
  }
}

function wrapFindWithPathPolicy(
  definition: AnyPiToolDefinition,
  resolveRead: (path: string) => string
): AnyPiToolDefinition {
  return {
    ...definition,
    async execute(toolCallId, params, signal, onUpdate, context) {
      const input = getRecord(params) ?? {}
      const requestedPath =
        typeof input.path === "string" && input.path.trim()
          ? input.path
          : "."
      const pattern =
        typeof input.pattern === "string" ? input.pattern : ""
      const safePath = resolveRead(requestedPath)

      if (
        safePath === resolve(homedir()) &&
        pattern.replaceAll("\\", "/").includes("**")
      ) {
        throw new Error(BROAD_HOME_FIND_ERROR)
      }

      return definition.execute(
        toolCallId,
        { ...input, path: safePath },
        signal,
        onUpdate,
        context
      )
    },
  }
}

function createSandboxedBashOperations({
  permissionContext,
  rootDir,
  sessionId,
}: {
  permissionContext: PermissionGatewayContext
  rootDir: string
  sessionId: string
}): BashOperations {
  return {
    exec(command, _cwd, options) {
      return withStudioSessionLock(sessionId, () =>
        new Promise<{ exitCode: number | null }>((resolvePromise, reject) => {
          const timeoutSeconds = Math.min(
            Math.max(
              options.timeout ?? ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS,
              1
            ),
            ASTRAFLOW_SANDBOX_DEFAULT_RUN_TIMEOUT_SECONDS
          )
          let child: ReturnType<typeof spawnLocalSandboxedCommand>
          let timedOut = false
          let settled = false

          const finish = (
            result:
              | { ok: true; exitCode: number | null }
              | { ok: false; error: Error }
          ) => {
            if (settled) {
              return
            }

            settled = true
            clearTimeout(timer)
            options.signal?.removeEventListener("abort", onAbort)

            if (result.ok) {
              resolvePromise({ exitCode: result.exitCode })
            } else {
              reject(result.error)
            }
          }
          const onAbort = () => {
            terminateLocalSandboxedCommand(child)
          }

          try {
            child = spawnLocalSandboxedCommand({
              command,
              onNetworkPermissionRequest: ({ host, port }) =>
                requestSandboxNetworkPermission({
                  context: permissionContext,
                  host,
                  ...(port === undefined ? {} : { port }),
                }),
              rootDir,
              sessionId,
            })
          } catch (error) {
            reject(
              new Error(
                `Sandbox initialization failed: ${
                  error instanceof Error ? error.message : String(error)
                }`
              )
            )
            return
          }

          const timer = setTimeout(() => {
            timedOut = true
            terminateLocalSandboxedCommand(child)
          }, timeoutSeconds * 1_000)
          timer.unref?.()

          if (options.signal?.aborted) {
            onAbort()
          } else {
            options.signal?.addEventListener("abort", onAbort, { once: true })
          }

          child.stdout?.on("data", (data: Buffer) => options.onData(data))
          child.stderr?.on("data", (data: Buffer) =>
            options.onData(
              Buffer.from(
                data
                  .toString()
                  .split("\n")
                  .map((line) => (line ? `[stderr] ${line}` : line))
                  .join("\n")
              )
            )
          )
          child.on("error", (error) => finish({ ok: false, error }))
          child.on("close", (code) => {
            if (timedOut) {
              finish({
                ok: false,
                error: new Error(`timeout:${timeoutSeconds}`),
              })
              return
            }

            if (options.signal?.aborted) {
              finish({ ok: false, error: new Error("aborted") })
              return
            }

            finish({ ok: true, exitCode: code })
          })
        })
      )
    },
  }
}

export function createPiLocalTools({
  permissionContext,
  rootDir,
  sessionId,
}: {
  permissionContext: PermissionGatewayContext
  rootDir: string
  sessionId: string
}) {
  const resolvedRoot = resolve(rootDir)
  const workspaceDir = ensureLocalSandboxWorkspace(sessionId)
  const resolveRead = (path: string) =>
    resolveLocalSandboxReadPath(resolvedRoot, path)
  const resolveWrite = (path: string) =>
    resolveLocalSandboxWritePath(resolvedRoot, path, [workspaceDir])
  const writeDefinition = wrapWriteWithFileDiff(
    createWriteToolDefinition(resolvedRoot, {
      operations: {
        mkdir: async (path) => {
          await mkdir(resolveWrite(path), { recursive: true })
        },
        writeFile: (path, content) => writeFile(resolveWrite(path), content),
      },
    }),
    resolveWrite
  )
  const definitions: AnyPiToolDefinition[] = [
    createReadToolDefinition(resolvedRoot, {
      operations: {
        access: async (path) => access(resolveRead(path), constants.R_OK),
        readFile: (path) => readFile(resolveRead(path)),
        detectImageMimeType: async (path) =>
          detectImageMimeType(resolveRead(path)),
      },
    }),
    createBashToolDefinition(resolvedRoot, {
      operations: createSandboxedBashOperations({
        permissionContext,
        rootDir: resolvedRoot,
        sessionId,
      }),
    }),
    createEditToolDefinition(resolvedRoot, {
      operations: {
        access: async (path) =>
          access(resolveWrite(path), constants.R_OK | constants.W_OK),
        readFile: (path) => readFile(resolveRead(path)),
        writeFile: (path, content) => writeFile(resolveWrite(path), content),
      },
    }),
    writeDefinition,
    createGrepToolDefinition(resolvedRoot, {
      operations: {
        isDirectory: async (path) => {
          const resolvedPath = resolveRead(path)

          if (resolvedPath === resolve(homedir())) {
            throw new Error(BROAD_HOME_GREP_ERROR)
          }

          return (await stat(resolvedPath)).isDirectory()
        },
        readFile: (path) => readFile(resolveRead(path), "utf8"),
      },
    }),
    wrapFindWithPathPolicy(
      createFindToolDefinition(resolvedRoot),
      resolveRead
    ),
    createLsToolDefinition(resolvedRoot, {
      operations: {
        exists: async (path) => {
          try {
            await access(resolveRead(path), constants.R_OK)
            return true
          } catch {
            return false
          }
        },
        stat: (path) => stat(resolveRead(path)),
        readdir: (path) => readdir(resolveRead(path)),
      },
    }),
  ]

  return definitions.map((definition) =>
    wrapWithPermissionGateway(definition, permissionContext)
  )
}

export function createPiPlanTool(
  emit: (todos: Array<{
    text: string
    status: "pending" | "in_progress" | "completed"
    priority?: string | null
  }>) => void
): AnyPiToolDefinition {
  return {
    name: "write_todos",
    label: "update plan",
    description:
      "Create or update the task plan. Keep exactly one item in progress and mark finished work completed.",
    parameters: Type.Object({
      todos: Type.Array(
        Type.Object({
          content: Type.String(),
          status: Type.Union([
            Type.Literal("pending"),
            Type.Literal("in_progress"),
            Type.Literal("completed"),
          ]),
          priority: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        })
      ),
    }),
    async execute(_toolCallId, params) {
      const { todos } = params as {
        todos: Array<{
          content: string
          status: "pending" | "in_progress" | "completed"
          priority?: string | null
        }>
      }
      const normalized = todos.map((todo) => ({
        text: todo.content,
        status: todo.status,
        ...(todo.priority === undefined ? {} : { priority: todo.priority }),
      }))
      emit(normalized)

      return {
        content: [{ type: "text", text: "Plan updated." }],
        details: { todos: normalized },
      }
    },
  }
}
