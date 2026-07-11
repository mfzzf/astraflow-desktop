import assert from "node:assert/strict"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import {
  consumeMobileChannelFileReferences,
  createMobileChannelFileReference,
  extractMobileChannelFileLinks,
  parseMobileChannelFileReference,
  registerMobileChannelFileReference,
  resolveMobileChannelOutboundFile,
} from "../lib/mobile-channels/file-transfer"

const directory = mkdtempSync(join(tmpdir(), "astraflow-mobile-file-"))
const filePath = join(directory, "invoice sample.pdf")
const secretPath = join(directory, ".env")
writeFileSync(filePath, Buffer.from("invoice"))
writeFileSync(secretPath, Buffer.from("SECRET=value"))

after(() => {
  rmSync(directory, { force: true, recursive: true })
})

test("mobile file references validate and load regular files", () => {
  const reference = createMobileChannelFileReference({ path: filePath })
  const parsed = parseMobileChannelFileReference(JSON.stringify(reference))
  const outbound = resolveMobileChannelOutboundFile(reference)

  assert.equal(reference.fileName, "invoice sample.pdf")
  assert.equal(reference.mimeType, "application/pdf")
  assert.equal(reference.size, 7)
  assert.equal(parsed?.path, reference.path)
  assert.equal(outbound.buffer.toString(), "invoice")
})

test("mobile file links extract local markdown targets only", () => {
  const references = extractMobileChannelFileLinks({
    content: [
      `[invoice](<${filePath}>)`,
      `[secret](<${secretPath}>)`,
      "[remote](https://example.com/report.pdf)",
      "[missing](/tmp/does-not-exist.pdf)",
    ].join("\n"),
  })

  assert.equal(references.length, 1)
  assert.equal(references[0].path, filePath)
})

test("mobile file tool references are delivered before activity snapshots persist", () => {
  const reference = createMobileChannelFileReference({ path: filePath })

  registerMobileChannelFileReference("session-file-delivery", reference)
  registerMobileChannelFileReference("session-file-delivery", reference)

  assert.deepEqual(
    consumeMobileChannelFileReferences("session-file-delivery"),
    [reference]
  )
  assert.deepEqual(
    consumeMobileChannelFileReferences("session-file-delivery"),
    []
  )
})
