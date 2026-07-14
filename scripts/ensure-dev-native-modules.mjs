import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const betterSqliteDir = join(projectRoot, "node_modules", "better-sqlite3")
const prebuildInstallBin = join(
  projectRoot,
  "node_modules",
  "prebuild-install",
  "bin.js"
)
const nodeGypBin = join(
  projectRoot,
  "node_modules",
  "node-gyp",
  "bin",
  "node-gyp.js"
)
const probeSource = `
const Database = require("better-sqlite3");
const database = new Database(":memory:");
database.prepare("SELECT 1 AS value").get();
database.close();
`

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options,
  })
}

function probeBetterSqlite() {
  return runNode(["-e", probeSource])
}

function formatFailure(result) {
  return [result.stderr, result.stdout]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join("\n")
}

if (!existsSync(betterSqliteDir)) {
  throw new Error(
    "better-sqlite3 is not installed. Run bun install before starting the app."
  )
}

const initialProbe = probeBetterSqlite()

if (initialProbe.status === 0) {
  process.exit(0)
}

console.warn(
  `[electron-dev] better-sqlite3 does not match Node ${process.version} (ABI ${process.versions.modules}); repairing the native module.`
)

let repaired = false

if (existsSync(prebuildInstallBin)) {
  const prebuild = runNode(
    [
      prebuildInstallBin,
      "--runtime",
      "node",
      "--target",
      process.versions.node,
      "--arch",
      process.arch,
      "--platform",
      process.platform,
      "--force",
    ],
    { cwd: betterSqliteDir, stdio: "inherit" }
  )

  repaired = prebuild.status === 0 && probeBetterSqlite().status === 0
}

if (!repaired && existsSync(nodeGypBin)) {
  console.warn(
    "[electron-dev] No compatible prebuilt better-sqlite3 binary was available; compiling it locally."
  )
  const rebuild = runNode([nodeGypBin, "rebuild", "--release"], {
    cwd: betterSqliteDir,
    stdio: "inherit",
  })

  repaired = rebuild.status === 0 && probeBetterSqlite().status === 0
}

if (!repaired) {
  const finalProbe = probeBetterSqlite()
  const details = formatFailure(finalProbe) || formatFailure(initialProbe)

  throw new Error(
    [
      `Failed to prepare better-sqlite3 for Node ${process.version} (ABI ${process.versions.modules}).`,
      details,
    ]
      .filter(Boolean)
      .join("\n")
  )
}

console.log(
  `[electron-dev] better-sqlite3 is ready for Node ${process.version} (ABI ${process.versions.modules}).`
)
