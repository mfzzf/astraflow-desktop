import { createHash } from "node:crypto"
import {
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import { join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"

const scriptDirectory = resolve(fileURLToPath(new URL(".", import.meta.url)))
const root = resolve(scriptDirectory, "..")
const bundleRoot = join(root, "bundled-skills")
const manifestPath = join(bundleRoot, "manifest.json")
const checkOnly = process.argv.includes("--check")
const skills = [
  ...["pptx", "xlsx", "docx", "pdf"].map((slug) => ({
    slug,
    version: "1.0.0",
    source: "User-provided AstraFlow built-in skill",
    license: "User-provided proprietary",
  })),
  {
    slug: "compshare-cli",
    version: "0.3.5",
    source:
      "compshare-cn/compshare-cli v0.3.5 (e7b0932eb6ca4f19aaceea236969110199c655f6)",
    license: "Apache-2.0",
  },
]

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function listFiles(skillRoot) {
  const files = []

  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name)
      const stat = lstatSync(absolutePath)

      if (stat.isSymbolicLink()) {
        throw new Error(`Bundled skills cannot contain symlinks: ${absolutePath}`)
      }

      if (stat.isDirectory()) {
        // Python bytecode caches appear when a bundled skill runs; they are
        // runtime artifacts, not bundle content.
        if (entry.name === "__pycache__") {
          continue
        }

        walk(absolutePath)
      } else if (stat.isFile()) {
        if (entry.name.endsWith(".pyc")) {
          continue
        }

        files.push(relative(skillRoot, absolutePath).split(sep).join("/"))
      }
    }
  }

  walk(skillRoot)
  return files.sort()
}

function buildSkillManifest(metadata) {
  const skillRoot = join(bundleRoot, metadata.slug)
  const files = Object.fromEntries(
    listFiles(skillRoot).map((path) => [
      path,
      sha256(readFileSync(join(skillRoot, ...path.split("/")))),
    ])
  )

  for (const requiredPath of ["SKILL.md"]) {
    if (!files[requiredPath]) {
      throw new Error(
        `Bundled skill ${metadata.slug} is missing ${requiredPath}.`
      )
    }
  }

  const bundlePayload = Object.entries(files)
    .map(([path, hash]) => `${hash}  ${path}\n`)
    .join("")

  return {
    ...metadata,
    bundleHash: sha256(bundlePayload),
    files,
  }
}

const manifest = {
  schemaVersion: 1,
  skills: skills.map(buildSkillManifest),
}
const serialized = `${JSON.stringify(manifest, null, 2)}\n`

if (checkOnly) {
  const existing = readFileSync(manifestPath, "utf8")

  if (existing !== serialized) {
    throw new Error(
      "bundled-skills/manifest.json is stale. Run bun run codegen:bundled-skills."
    )
  }

  console.log("Bundled skill manifest is current.")
} else {
  writeFileSync(manifestPath, serialized)
  console.log(
    `Generated bundled skill manifest for ${manifest.skills.length} skills.`
  )
}
