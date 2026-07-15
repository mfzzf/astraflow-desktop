import "server-only"

import { z } from "zod"

import { SUPPORTED_CHAT_REASONING_EFFORTS } from "@/lib/chat-models"

import { validateAutomationSchedule } from "./schedule"
import {
  automationConcurrencyPolicies,
  automationIntervalUnits,
  automationKinds,
  automationMisfirePolicies,
  automationPermissionModes,
  type AutomationTaskInput,
} from "./types"

const localDateTimeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/)
const clockTimeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)

export const automationScheduleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), localDateTime: localDateTimeSchema }),
  z.object({
    kind: z.literal("interval"),
    every: z.number().int().min(1).max(10_000),
    unit: z.enum(automationIntervalUnits),
    anchorAt: z.iso.datetime(),
  }),
  z.object({ kind: z.literal("daily"), time: clockTimeSchema }),
  z.object({
    kind: z.literal("weekly"),
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    time: clockTimeSchema,
  }),
  z.object({
    kind: z.literal("cron"),
    expression: z.string().trim().min(9).max(128),
  }),
])

export const automationAiPayloadSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  runtimeId: z.string().trim().min(1).max(64),
  model: z.string().trim().min(1).max(128),
  reasoningEffort: z.enum(SUPPORTED_CHAT_REASONING_EFFORTS).nullable(),
  permissionMode: z.enum(automationPermissionModes),
})

export const automationCommandPayloadSchema = z.object({
  command: z.string().trim().min(1).max(32_000),
  workingDirectory: z.string().trim().max(512).default("."),
  maxLogBytes: z
    .number()
    .int()
    .min(1024 * 1024)
    .max(100 * 1024 * 1024)
    .default(10 * 1024 * 1024),
})

export const automationTaskInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    kind: z.enum(automationKinds),
    enabled: z.boolean().default(true),
    workspaceId: z.string().trim().min(1).max(256).nullable(),
    schedule: automationScheduleSchema,
    timeZone: z.string().trim().min(1).max(128),
    payload: z.union([
      automationAiPayloadSchema,
      automationCommandPayloadSchema,
    ]),
    timeoutSeconds: z.number().int().min(10).max(86_400).default(3_600),
    concurrencyPolicy: z.enum(automationConcurrencyPolicies).default("skip"),
    misfirePolicy: z.enum(automationMisfirePolicies).default("run_once"),
    maxRetries: z.number().int().min(0).max(5).default(0),
    retryDelaySeconds: z.number().int().min(10).max(86_400).default(60),
  })
  .superRefine((value, context) => {
    if (value.kind === "ai") {
      const result = automationAiPayloadSchema.safeParse(value.payload)
      if (!result.success) {
        context.addIssue({
          code: "custom",
          path: ["payload"],
          message: "AI task payload is invalid.",
        })
      }
    } else {
      const result = automationCommandPayloadSchema.safeParse(value.payload)
      if (!result.success) {
        context.addIssue({
          code: "custom",
          path: ["payload"],
          message: "Command task payload is invalid.",
        })
      }
      if (!value.workspaceId) {
        context.addIssue({
          code: "custom",
          path: ["workspaceId"],
          message: "Command tasks require a local workspace.",
        })
      }
    }

    try {
      validateAutomationSchedule(value.schedule, value.timeZone)
    } catch (error) {
      context.addIssue({
        code: "custom",
        path: ["schedule"],
        message:
          error instanceof Error ? error.message : "Schedule is invalid.",
      })
    }
  })

export function parseAutomationTaskInput(value: unknown): AutomationTaskInput {
  return automationTaskInputSchema.parse(value) as AutomationTaskInput
}
