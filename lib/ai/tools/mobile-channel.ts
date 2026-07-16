import { z } from "zod"

import { createAstraFlowTool } from "@/lib/ai/tools/tool"
import {
  createMobileChannelFileReference,
  registerMobileChannelFileReference,
} from "@/lib/mobile-channels/file-transfer"

export function createSendFileToMobileTool({
  rootDir,
  sessionId,
}: {
  rootDir: string
  sessionId: string
}) {
  return createAstraFlowTool(
    async ({ path, fileName }) => {
      const reference = createMobileChannelFileReference({
        path,
        fileName,
        rootDir,
      })
      registerMobileChannelFileReference(sessionId, reference)
      return reference
    },
    {
      name: "studio_send_file",
      description:
        "Send one existing workspace file to the user through the active mobile bot conversation. Use this after locating the exact file whenever the mobile user asks to receive, download, or be sent a file. Pass an absolute workspace path when possible. This reads and attaches the file without modifying it.",
      schema: z.object({
        path: z
          .string()
          .trim()
          .min(1)
          .describe("Absolute workspace path or path relative to the workspace root."),
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
