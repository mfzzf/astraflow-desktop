import { resolve as resolveTypeScriptAlias } from "./typescript-alias-loader.mjs"
import { resolve as resolvePath } from "node:path"
import { pathToFileURL } from "node:url"

const emptyServerOnlyModule = "data:text/javascript,export default undefined;"

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "server-only") {
    return { url: emptyServerOnlyModule, shortCircuit: true }
  }
  if (specifier === "ajv/dist/2020") {
    return {
      url: pathToFileURL(
        resolvePath(process.cwd(), "node_modules/ajv/dist/2020.js")
      ).href,
      shortCircuit: true,
    }
  }

  return resolveTypeScriptAlias(specifier, context, nextResolve)
}
