import { resolve as resolvePath } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const repositoryRoot = resolvePath(
  fileURLToPath(new URL("../..", import.meta.url))
)

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return {
      url: "data:text/javascript,export {}",
      shortCircuit: true,
    }
  }

  if (specifier === "next/server" || specifier === "next/navigation") {
    return {
      url: pathToFileURL(
        resolvePath(repositoryRoot, "node_modules", `${specifier}.js`)
      ).href,
      shortCircuit: true,
    }
  }

  return nextResolve(specifier, context)
}
