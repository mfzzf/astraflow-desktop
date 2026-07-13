import { existsSync, statSync } from "node:fs"
import { extname, resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repositoryRoot = resolvePath(
  fileURLToPath(new URL("../..", import.meta.url))
)

function resolveTypeScriptCandidate(path) {
  const candidates = extname(path)
    ? [path]
    : [`${path}.ts`, `${path}.tsx`, resolvePath(path, "index.ts")]

  return candidates.find((candidate) => {
    try {
      return existsSync(candidate) && statSync(candidate).isFile()
    } catch {
      return false
    }
  })
}

export async function resolve(specifier, context, nextResolve) {
  let candidate = null

  if (specifier.startsWith("@/")) {
    candidate = resolvePath(repositoryRoot, specifier.slice(2))
  } else if (
    (specifier.startsWith("./") || specifier.startsWith("../")) &&
    context.parentURL?.startsWith("file:")
  ) {
    candidate = fileURLToPath(new URL(specifier, context.parentURL))
  }

  if (candidate) {
    const resolved = resolveTypeScriptCandidate(candidate)

    if (resolved) {
      return {
        url: pathToFileURL(resolved).href,
        shortCircuit: true,
      }
    }
  }

  return nextResolve(specifier, context)
}
