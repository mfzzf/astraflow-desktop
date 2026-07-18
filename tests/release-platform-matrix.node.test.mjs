import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import test from "node:test"

const repositoryRoot = resolve(import.meta.dirname, "..")

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8")
}

const targets = [
  {
    runtime: ["macOS arm64", "macos-26", "agent-runtime-darwin-arm64"],
    electron: ["macOS arm64", "macos-26", "--mac dmg zip --arm64"],
  },
  {
    runtime: ["macOS Intel", "macos-26-intel", "agent-runtime-darwin-x64"],
    electron: ["macOS Intel", "macos-26-intel", "--mac dmg zip --x64"],
  },
  {
    runtime: ["Windows arm64", "windows-11-arm", "agent-runtime-win32-arm64"],
    electron: ["Windows arm64", "windows-11-arm", "--win nsis --arm64"],
  },
  {
    runtime: ["Windows x64", "windows-2022", "agent-runtime-win32-x64"],
    electron: ["Windows x64", "windows-2022", "--win nsis --x64"],
  },
  {
    runtime: ["Linux arm64", "ubuntu-24.04-arm", "agent-runtime-linux-arm64"],
    electron: ["Linux arm64", "ubuntu-24.04-arm", "--linux AppImage --arm64"],
  },
  {
    runtime: ["Linux x64", "ubuntu-24.04", "agent-runtime-linux-x64"],
    electron: ["Linux x64", "ubuntu-24.04", "--linux AppImage --x64"],
  },
]

test("runtime and Electron release workflows cover every supported platform architecture", () => {
  const runtimeWorkflow = read(".github/workflows/agent-runtime-packages.yml")
  const electronWorkflow = read(".github/workflows/electron-package.yml")

  for (const target of targets) {
    for (const expected of target.runtime) {
      assert.match(runtimeWorkflow, new RegExp(expected.replaceAll("-", "\\-")))
    }

    for (const expected of target.electron) {
      assert.ok(
        electronWorkflow.includes(expected),
        `Electron workflow is missing ${expected}`
      )
    }
  }

  assert.match(runtimeWorkflow, /needs: package[\s\S]*pattern: agent-runtime-\*/)
  assert.match(electronWorkflow, /publish-assets:[\s\S]*needs: package/)
  assert.match(electronWorkflow, /Expected 6 Electron package artifacts/)
})

test("electron-builder enables x64 and arm64 for macOS, Windows, and Linux", () => {
  const config = read("electron-builder.yml")

  for (const section of ["mac", "win", "linux"]) {
    const nextSection = section === "mac" ? "dmg" : section === "win" ? "nsis" : "artifactName"
    const match = config.match(
      new RegExp(`^${section}:([\\s\\S]*?)^${nextSection}:`, "m")
    )

    assert.ok(match, `Missing ${section} builder section`)
    assert.match(match[1], /- x64/)
    assert.match(match[1], /- arm64/)
  }
})

function updateManifest({ fileName, releaseDate, url }) {
  return [
    "version: 1.2.3",
    "files:",
    `  - url: ${url}`,
    `    sha512: sha-${fileName}-${url}`,
    "    size: 123",
    `path: ${url}`,
    `sha512: sha-${fileName}-${url}`,
    `releaseDate: '${releaseDate}'`,
    "",
  ].join("\n")
}

test("release staging preserves architecture-correct update manifests", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "astraflow-release-matrix-"))
  const sourceDir = join(temporaryRoot, "source")
  const targetDir = join(temporaryRoot, "target")
  const fixtures = [
    ["macos-arm64", "latest-mac.yml", "AstraFlow-1.2.3-mac-arm64.zip"],
    ["macos-x64", "latest-mac.yml", "AstraFlow-1.2.3-mac-x64.zip"],
    ["windows-arm64", "latest.yml", "AstraFlow-1.2.3-win-arm64.exe"],
    ["windows-x64", "latest.yml", "AstraFlow-1.2.3-win-x64.exe"],
    [
      "linux-arm64",
      "latest-linux-arm64.yml",
      "AstraFlow-1.2.3-linux-arm64.AppImage",
    ],
    ["linux-x64", "latest-linux.yml", "AstraFlow-1.2.3-linux-x64.AppImage"],
  ]

  try {
    fixtures.forEach(([directory, fileName, url], index) => {
      const fixtureDir = join(sourceDir, directory)
      mkdirSync(fixtureDir, { recursive: true })
      writeFileSync(
        join(fixtureDir, fileName),
        updateManifest({
          fileName,
          releaseDate: `2026-07-18T00:00:0${index}.000Z`,
          url,
        })
      )
    })

    execFileSync(
      process.execPath,
      ["scripts/stage-electron-release-assets.mjs", sourceDir, targetDir],
      { cwd: repositoryRoot, stdio: "pipe" }
    )

    for (const fileName of ["latest-mac.yml", "latest.yml"]) {
      const manifest = readFileSync(join(targetDir, fileName), "utf8")
      assert.equal((manifest.match(/^  - url:/gm) ?? []).length, 2)
      assert.match(manifest, /arm64/)
      assert.match(manifest, /x64/)
    }

    assert.match(
      readFileSync(join(targetDir, "latest-linux.yml"), "utf8"),
      /linux-x64/
    )
    assert.match(
      readFileSync(join(targetDir, "latest-linux-arm64.yml"), "utf8"),
      /linux-arm64/
    )

    const releaseManifest = JSON.parse(
      readFileSync(join(targetDir, "latest.json"), "utf8")
    )
    assert.equal(releaseManifest.files.length, 6)
    assert.deepEqual(
      new Set(releaseManifest.files.map((file) => file.platform)),
      new Set(["mac", "windows", "linux"])
    )
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
