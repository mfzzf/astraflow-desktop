import { randomUUID } from "node:crypto"

import { tool } from "langchain"
import { z } from "zod"

import {
  type AgentEvent,
  type AgentUserInputAnswer,
  type AgentUserInputQuestion,
} from "@/lib/agent/events"
import { requestUserInput } from "@/lib/agent/user-input-broker"

type RequestUserInputToolOptions = {
  emit: (event: AgentEvent) => void
  sessionId: string
  signal: AbortSignal
}

const requestUserInputOptionSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe("Short display text for this choice (1-5 words)."),
  description: z
    .string()
    .trim()
    .max(240)
    .optional()
    .describe("What choosing this option means or implies."),
})

const requestUserInputQuestionSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .describe("Stable identifier for matching the answer, such as 'style'."),
  header: z
    .string()
    .trim()
    .min(1)
    .max(24)
    .describe("Very short chip label shown above the question."),
  question: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .describe("The complete question, ending with a question mark."),
  isOther: z
    .boolean()
    .optional()
    .describe(
      "Allow a free-form answer in addition to the options. Defaults to true."
    ),
  isSecret: z
    .boolean()
    .optional()
    .describe("Mask the typed answer, for API keys or other secrets."),
  options: z
    .array(requestUserInputOptionSchema)
    .max(5)
    .nullable()
    .optional()
    .describe(
      "1-5 mutually exclusive choices with the recommended option first, or [] for a free-form answer."
    ),
})

function normalizeOptionId(label: string, index: number) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48)

  return slug || `option_${index + 1}`
}

function normalizeQuestions(
  questions: z.infer<typeof requestUserInputQuestionSchema>[]
) {
  return questions.map((question) => {
    const seen = new Set<string>()
    const options = (question.options ?? []).map((option, index) => {
      const baseId = normalizeOptionId(option.label, index)
      let optionId = baseId
      let suffix = 2

      while (seen.has(optionId)) {
        optionId = `${baseId}_${suffix}`
        suffix += 1
      }

      seen.add(optionId)

      return {
        optionId,
        label: option.label,
        description: option.description ?? "",
      }
    })

    return {
      id: question.id,
      header: question.header,
      question: question.question,
      options,
      allowOther: options.length === 0 ? true : (question.isOther ?? true),
      isSecret: question.isSecret ?? false,
    } satisfies AgentUserInputQuestion
  })
}

function answersByQuestion(answers: AgentUserInputAnswer[]) {
  return Object.fromEntries(
    answers.map((answer) => [
      answer.questionId,
      {
        optionId: answer.optionId,
        label: answer.label,
        text: answer.text,
      },
    ])
  )
}

export function createRequestUserInputTool({
  emit,
  sessionId,
  signal,
}: RequestUserInputToolOptions) {
  return tool(
    async ({ questions, autoResolutionMs }) => {
      const requestId = randomUUID()
      const normalizedQuestions = normalizeQuestions(questions)

      emit({
        type: "user_input_request",
        requestId,
        questions: normalizedQuestions,
        autoResolutionMs,
        status: "pending",
      })

      const decision = await requestUserInput({
        autoResolutionMs,
        questions: normalizedQuestions,
        requestId,
        sessionId,
        signal,
      })

      if ("cancelled" in decision) {
        emit({
          type: "user_input_request",
          requestId,
          questions: normalizedQuestions,
          answers: [],
          autoResolutionMs,
          status: "resolved",
        })

        return JSON.stringify({ status: "cancelled", answers: {} })
      }

      emit({
        type: "user_input_request",
        requestId,
        questions: normalizedQuestions,
        answers: decision.answers,
        autoResolutionMs,
        status: "resolved",
      })

      return JSON.stringify({
        status: "answered",
        answers: answersByQuestion(decision.answers),
      })
    },
    {
      name: "request_user_input",
      description:
        "Ask the user a concise structured question before continuing. Use when a user preference materially changes the result, such as which model, style, output format, or execution path to use. For multiple choice, provide the recommended option first and include 1-5 clear options. For a short free-form answer, set options to [] and isOther to true.",
      schema: z.object({
        questions: z
          .array(requestUserInputQuestionSchema)
          .min(1)
          .max(3)
          .describe("One to three short questions for the user."),
        autoResolutionMs: z
          .number()
          .int()
          .min(1_000)
          .max(10 * 60 * 1_000)
          .nullable()
          .optional()
          .describe(
            "Optional timeout. If provided, AstraFlow continues with the first option after this many milliseconds."
          ),
      }),
    }
  )
}
