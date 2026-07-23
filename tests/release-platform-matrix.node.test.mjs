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
import targetUtil from "app-builder-lib/out/targets/targetUtil.js"
import { parse as parseYaml } from "yaml"

import { getDeveloperRuntimeLayout } from "../scripts/developer-runtime-packages.mjs"
import { parseReleaseVersion } from "../scripts/release-version.mjs"

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
  const developerRuntimeWorkflow = read(
    ".github/workflows/developer-runtime-packages.yml"
  )
  const electronWorkflow = read(".github/workflows/electron-package.yml")

  for (const target of targets) {
    for (const expected of target.runtime) {
      assert.match(runtimeWorkflow, new RegExp(expected.replaceAll("-", "\\-")))
      assert.match(
        developerRuntimeWorkflow,
        new RegExp(
          expected
            .replace("agent-runtime-", "developer-runtime-")
            .replaceAll("-", "\\-")
        )
      )
    }

    for (const expected of target.electron) {
      assert.ok(
        electronWorkflow.includes(expected),
        `Electron workflow is missing ${expected}`
      )
    }
  }

  assert.match(
    runtimeWorkflow,
    /needs: package[\s\S]*pattern: agent-runtime-\*/
  )
  assert.match(
    developerRuntimeWorkflow,
    /needs: package[\s\S]*pattern: developer-runtime-\*/
  )
  assert.match(
    developerRuntimeWorkflow,
    /Verify published developer runtime manifests[\s\S]*US3_PUBLIC_BASE_URL/
  )
  assert.match(electronWorkflow, /publish-assets:[\s\S]*needs: package/)
  assert.match(electronWorkflow, /Expected 6 Electron package artifacts/)
  assert.match(electronWorkflow, /Verify macOS signing and capabilities/)
  assert.match(electronWorkflow, /codesign --verify --deep --strict/)
  assert.match(electronWorkflow, /Authority=Developer ID Application:/)
  assert.match(electronWorkflow, /TeamIdentifier=\[A-Z0-9\]\{10\}/)
  assert.match(
    electronWorkflow,
    /PlistBuddy -c "Print :com\.apple\.security\.device\.audio-input"/
  )
  assert.match(
    electronWorkflow,
    /codesign -d --entitlements "\$main_entitlements" --xml "\$app_path"/
  )
  assert.doesNotMatch(electronWorkflow, /--entitlements\s+:-/)
})

test("release version parser accepts native and CompShare tags", () => {
  assert.equal(parseReleaseVersion("1.6.6"), "1.6.6")
  assert.equal(parseReleaseVersion("v1.6.6"), "1.6.6")
  assert.equal(parseReleaseVersion("compshare-v1.6.6"), "1.6.6")
  assert.equal(
    parseReleaseVersion("compshare-v1.6.6-rc.1+build.2"),
    "1.6.6-rc.1+build.2"
  )
  assert.throws(
    () => parseReleaseVersion("other-v1.6.6"),
    /Release tag\/version must be semver/
  )
})

test("CompShare releases use an isolated US3 updater namespace", () => {
  const workflow = read(".github/workflows/electron-package.yml")
  const builderConfig = read("electron-builder.yml")
  const builderRunner = read("scripts/run-electron-builder.mjs")

  assert.ok(workflow.includes('- "compshare-v*"'))
  assert.equal(
    workflow.match(/if: startsWith\(github\.ref, 'refs\/tags\/'\)/g)?.length,
    3
  )
  assert.ok(
    workflow.includes("ASTRAFLOW_RELEASE_TAG_NAME: ${{ github.ref_name }}")
  )
  assert.ok(workflow.includes("ASTRAFLOW_RELEASE_PRODUCT_NAME: 优云智算"))
  assert.ok(
    workflow.includes(
      "US3_RELEASE_PREFIX: ${{ (startsWith(github.ref_name, 'compshare-v') || (inputs.channel_slug || vars.ASTRAFLOW_CHANNEL_SLUG || 'compshare') == 'compshare') && 'compshare' || '' }}"
    )
  )
  assert.ok(
    workflow.includes(
      'asset_prefix="${US3_RELEASE_PREFIX:+${US3_RELEASE_PREFIX}/}"'
    )
  )
  assert.ok(workflow.includes('key="${asset_prefix}${basename}"'))
  assert.ok(
    workflow.includes(
      'key="${US3_RELEASE_PREFIX:+${US3_RELEASE_PREFIX}/}${file#dist/publish/}"'
    )
  )
  assert.ok(
    workflow.includes(
      "fetch(`${process.env.ASTRAFLOW_RELEASE_BASE_URL}/latest.json`"
    )
  )
  assert.match(
    builderConfig,
    /^\s+url:\s+\$\{env\.ASTRAFLOW_RELEASE_BASE_URL\}$/m
  )
  assert.match(
    builderRunner,
    /releaseChannelSlug === "compshare"\s+\? `\$\{releaseRootUrl\}\/compshare`\s+: releaseRootUrl/
  )
})

test("CompShare Windows installer defaults to the compshare directory", () => {
  const builderConfig = parseYaml(read("electron-builder.yml"))
  const executableName = builderConfig.win.executableName

  assert.equal(executableName, "compshare")
  assert.equal(
    targetUtil.getWindowsInstallationDirName(
      {
        productFilename: executableName,
        sanitizedName: "astraflow-desktop",
      },
      true
    ),
    "compshare"
  )
})

test("CompShare logos are emitted as packaged Next.js static assets", () => {
  const logoComponent = read("components/astraflow-logo.tsx")
  const preparedApp = read("scripts/prepare-electron-app.mjs")

  for (const [assetName, sourceName] of [
    ["brand-light-zh.png", "logo-浅色底-中英-cn@4x.png"],
    ["brand-dark-zh.png", "logo-深色底-中英-cn@4x.png"],
    ["brand-light-en.png", "logo-浅色底-英@4x.png"],
    ["brand-dark-en.png", "logo-深色底-英@4x.png"],
  ]) {
    assert.ok(
      logoComponent.includes(`@/public/compshare/${assetName}`),
      `Missing static import for ${assetName}`
    )
    assert.deepEqual(
      readFileSync(join(repositoryRoot, "public", "compshare", assetName)),
      readFileSync(join(repositoryRoot, "public", "compshare", sourceName))
    )
  }
  assert.doesNotMatch(logoComponent, /src:\s*"\/compshare\/logo-/)
  assert.match(
    preparedApp,
    /copy\(join\(root, "\.next", "static"\), join\(appDir, "\.next", "static"\)\)/
  )
})

test("custom edition packages as 优云智算 with dedicated icons", () => {
  const builderConfig = read("electron-builder.yml")
  const electronMain = read("electron/main.cjs")
  const preparedApp = read("scripts/prepare-electron-app.mjs")
  const packageJson = JSON.parse(read("package.json"))

  assert.equal(packageJson.version, "1.6.6")

  assert.match(builderConfig, /^productName:\s+优云智算$/m)
  assert.match(
    read(".github/workflows/electron-package.yml"),
    /-name '优云智算\.app'/
  )
  assert.match(
    builderConfig,
    /^artifactName:\s+CompShare-\$\{version\}-\$\{os\}-\$\{arch\}\.\$\{ext\}$/m
  )
  assert.match(builderConfig, /^\s+icon:\s+public\/compshare\/icon\.icns$/m)
  assert.equal(
    builderConfig.match(/^\s+icon:\s+public\/compshare\/icon\.png$/gm)?.length,
    2
  )
  assert.match(electronMain, /const APP_NAME = "优云智算"/)
  assert.match(preparedApp, /desktopName: "优云智算"/)
  assert.notDeepEqual(
    readFileSync(join(repositoryRoot, "public/compshare/icon.png")),
    readFileSync(join(repositoryRoot, "public/icon/icon.png"))
  )
  assert.doesNotThrow(() =>
    readFileSync(join(repositoryRoot, "public/compshare/icon.icns"))
  )
})

test("Windows developer runtime exposes pip through its generated command launcher", () => {
  assert.equal(
    getDeveloperRuntimeLayout("win32-x64").python.commands.pip,
    "Scripts/pip.cmd"
  )
  assert.match(
    read("scripts/prepare-bundled-python.mjs"),
    /prepareWindowsPipLauncher\(outputDirectory\)/
  )
})

test("electron-builder enables x64 and arm64 for macOS, Windows, and Linux", () => {
  const config = read("electron-builder.yml")

  for (const section of ["mac", "win", "linux"]) {
    const nextSection =
      section === "mac" ? "dmg" : section === "win" ? "nsis" : "artifactName"
    const match = config.match(
      new RegExp(`^${section}:([\\s\\S]*?)^${nextSection}:`, "m")
    )

    assert.ok(match, `Missing ${section} builder section`)
    assert.match(match[1], /- x64/)
    assert.match(match[1], /- arm64/)
  }
})

test("macOS release signing grants audio input to the app and helpers", () => {
  const config = read("electron-builder.yml")
  const mainEntitlements = read("electron/entitlements.mac.plist")
  const inheritedEntitlements = read("electron/entitlements.mac.inherit.plist")

  assert.match(
    config,
    /^\s+entitlements:\s+electron\/entitlements\.mac\.plist$/m
  )
  assert.match(
    config,
    /^\s+entitlementsInherit:\s+electron\/entitlements\.mac\.inherit\.plist$/m
  )
  assert.match(config, /^\s+NSMicrophoneUsageDescription:\s+\S.+$/m)

  for (const entitlements of [mainEntitlements, inheritedEntitlements]) {
    assert.match(
      entitlements,
      /<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\/>/
    )
    assert.match(
      entitlements,
      /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/
    )
  }
})

test("Windows NSIS uses the extractor matching its differential package", () => {
  const config = read("electron-builder.yml")
  const nsisSection = config.match(/^nsis:([\s\S]*?)^linux:/m)

  assert.ok(nsisSection, "Missing NSIS builder section")
  assert.doesNotMatch(
    nsisSection[1],
    /^\s+useZip:\s*true\s*$/m,
    "electron-builder 26 emits a differential 7z payload that useZip tries to extract as ZIP"
  )
})

test("Windows NSIS grants install-file access to Chromium sandbox capabilities", () => {
  const config = read("electron-builder.yml")
  const installer = read("packaging/windows/installer.nsh")
  const capabilitySids = [
    "S-1-15-3-1024-3424233489-972189580-2057154623-747635277-1604371224-316187997-3786583170-1043257646",
    "S-1-15-3-1024-2302894289-466761758-1166120688-1039016420-2430351297-4240214049-4028510897-3317428798",
  ]

  assert.match(
    config,
    /^\s+include:\s+packaging\/windows\/installer\.nsh$/m
  )
  assert.match(installer, /!macro customInstall/)
  assert.match(installer, /nsExec::Exec `"\$SYSDIR\\icacls\.exe"/)
  assert.match(installer, /"\$INSTDIR"/)
  assert.match(installer, /:\(OI\)\(CI\)\(RX\)/)
  assert.match(installer, /\/T \/C \/Q/)

  for (const sid of capabilitySids) {
    assert.ok(installer.includes(sid), `Missing Chromium capability SID ${sid}`)
  }

  assert.doesNotMatch(installer, /S-1-15-2-[12]/)
  assert.doesNotMatch(
    `${config}\n${installer}`,
    /--no-sandbox|--disable-gpu-sandbox/
  )
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
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          ASTRAFLOW_RELEASE_BASE_URL:
            "https://astraflow-desktop.cn-sh2.ufileos.com/compshare",
          ASTRAFLOW_RELEASE_PRODUCT_NAME: "优云智算",
          ASTRAFLOW_RELEASE_TAG_NAME: "compshare-v1.2.3",
        },
        stdio: "pipe",
      }
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
    assert.equal(releaseManifest.name, "优云智算")
    assert.equal(releaseManifest.version, "1.2.3")
    assert.equal(releaseManifest.tagName, "compshare-v1.2.3")
    assert.equal(releaseManifest.releaseName, "优云智算 compshare-v1.2.3")
    assert.match(
      releaseManifest.releaseUrl,
      /\/releases\/tag\/compshare-v1\.2\.3$/
    )
    assert.deepEqual(
      new Set(releaseManifest.files.map((file) => file.platform)),
      new Set(["mac", "windows", "linux"])
    )
    assert.ok(
      releaseManifest.files.every((file) =>
        file.url.startsWith(
          "https://astraflow-desktop.cn-sh2.ufileos.com/compshare/"
        )
      )
    )
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})
