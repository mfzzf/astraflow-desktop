import { tool } from "@langchain/core/tools"
import { z } from "zod"

import { createMobileChannelFileReference } from "@/lib/mobile-channels/file-transfer"

export function createSendFileToMobileTool({
  rootDir,
}: {
  rootDir: string
}) {
  return tool(
    async ({ path, fileName }) =>
      createMobileChannelFileReference({
        path,
        fileName,
        rootDir,
      }),
    {
      name: "studio_send_file",
      description:
        "Send one existing local computer file to the user through the active mobile bot conversation. Use this after locating the exact file whenever the mobile user asks to receive, download, or be sent a file. Pass an absolute path when possible. This reads and attaches the file without modifying it.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Absolute local path, file URL, or path relative to rootDir."),
        fileName: z
          .string()
          .trim()
          .min(1)
          .max(180)
          .optional()
          .describe("Optional attachment name shown to the mobile user."),
      }),
    }
  )
}
