import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import test from "node:test"
import targetUtil from "app-builder-lib/out/targets/targetUtil.js"
import { parse as parseYaml } from "yaml"

import { getDeveloperRuntimeLayout } from "../scripts/developer-runtime-packages.mjs"
import {
  fetchDownloadWithRetry,
  fetchGitHubReleaseAssetWithRetry,
} from "../scripts/download-with-retry.mjs"
import { findPackagedExecutable } from "../scripts/packaged-electron-layout.mjs"
import { parseReleaseVersion } from "../scripts/release-version.mjs"
import {
  removeSmokeSandboxRoot,
  stageSmokeNodeModuleClosure,
} from "../scripts/smoke-runtime-node.mjs"

const repositoryRoot = resolve(import.meta.dirname, "..")

function read(relativePath) {
  return readFileSync(join(repositoryRoot, relativePath), "utf8")
}

const runtimeTargets = [
  {
    expected: ["macOS arm64", "macos-26", "agent-runtime-darwin-arm64"],
  },
  {
    expected: ["macOS Intel", "macos-26-intel", "agent-runtime-darwin-x64"],
  },
  {
    expected: ["Windows arm64", "windows-11-arm", "agent-runtime-win32-arm64"],
  },
  {
    expected: ["Windows x64", "windows-2022", "agent-runtime-win32-x64"],
  },
  {
    expected: ["Linux arm64", "ubuntu-24.04-arm", "agent-runtime-linux-arm64"],
  },
  {
    expected: ["Linux x64", "ubuntu-24.04", "agent-runtime-linux-x64"],
  },
]

const electronTargets = [
  ["macOS arm64", "macos-26", "--mac dmg zip --arm64"],
  ["macOS Intel", "macos-26-intel", "--mac dmg zip --x64"],
  ["Windows x64", "windows-2022", "--win nsis --x64"],
  ["Linux x64", "ubuntu-24.04", "--linux AppImage --x64"],
]

test("CI workflows use the pinned Bun setup with an npm registry fallback", () => {
  const workflowPaths = [
    ".github/workflows/agent-acp-smoke.yml",
    ".github/workflows/agent-runtime-packages.yml",
    ".github/workflows/agent-runtime-updates.yml",
    ".github/workflows/developer-runtime-packages.yml",
    ".github/workflows/electron-package.yml",
  ]

  for (const workflowPath of workflowPaths) {
    const workflow = read(workflowPath)
    assert.match(workflow, /uses: \.\/\.github\/actions\/setup-bun/)
    assert.doesNotMatch(workflow, /uses: oven-sh\/setup-bun@/)
  }

  const setupAction = read(".github/actions/setup-bun/action.yml")
  assert.match(setupAction, /default: "1\.3\.14"/)
  assert.match(
    setupAction,
    /uses: oven-sh\/setup-bun@v2[\s\S]*continue-on-error: true|continue-on-error: true[\s\S]*uses: oven-sh\/setup-bun@v2/
  )
  assert.match(setupAction, /npm install[\s\S]*"bun@\$\{BUN_VERSION\}"/)
  assert.match(setupAction, /actual_version="\$\(bun --version\)"/)
})

test("runtime workflows cover all architectures while Electron releases cover shipped installers", () => {
  const runtimeWorkflow = read(".github/workflows/agent-runtime-packages.yml")
  const developerRuntimeWorkflow = read(
    ".github/workflows/developer-runtime-packages.yml"
  )
  const electronWorkflow = read(".github/workflows/electron-package.yml")

  for (const target of runtimeTargets) {
    for (const expected of target.expected) {
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

  }

  for (const target of electronTargets) {
    for (const expected of target) {
      assert.ok(electronWorkflow.includes(expected), `Electron workflow is missing ${expected}`)
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
  assert.match(electronWorkflow, /Expected 4 Electron package artifacts/)
  assert.match(
    electronWorkflow,
    /Smoke packaged Electron runtime[\s\S]*runner\.os == 'macOS'/
  )
  assert.match(
    electronWorkflow,
    /CompShare Basic 2C4G[\s\S]*template_name: astraflow-desktop-compshare-2c4g[\s\S]*cpu_count: "2"[\s\S]*memory_mb: "4096"/
  )
  assert.match(
    electronWorkflow,
    /CompShare Pro\+ 8C8G[\s\S]*template_name: astraflow-code-compshare-pro-8c8g[\s\S]*cpu_count: "8"[\s\S]*memory_mb: "8192"/
  )
  assert.match(
    electronWorkflow,
    /UCLOUD_SANDBOX_TEMPLATE_NAME: \$\{\{ matrix\.template_name \}\}/
  )
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
  assert.match(
    workflow,
    /const expectedVersion = process\.env\.TAG_NAME\.replace\([\s\S]*?\^\(\?:compshare-\)\?v/
  )
  assert.match(workflow, /TAG_NAME: \$\{\{ github\.ref_name \}\}/)
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

test("CompShare packages use an identity isolated from AstraFlow", () => {
  const builderConfig = parseYaml(read("electron-builder.yml"))
  const electronMain = read("electron/main.cjs")
  const preparedApp = read("scripts/prepare-electron-app.mjs")
  const executableName = builderConfig.win.executableName

  assert.equal(builderConfig.appId, "cn.compshare.desktop")
  assert.equal(executableName, "compshare")
  assert.equal(builderConfig.linux.executableName, "compshare")
  assert.match(preparedApp, /name: "compshare-desktop"/)
  assert.match(electronMain, /const APP_ID = "cn\.compshare\.desktop"/)
  assert.match(electronMain, /app\.setAppUserModelId\(APP_ID\)/)
  assert.match(
    electronMain,
    /const managedWorkspacesDir = join\(app\.getPath\("home"\), "CompShare"\)/
  )
  assert.equal(
    targetUtil.getWindowsInstallationDirName(
      {
        productFilename: executableName,
        sanitizedName: "compshare-desktop",
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

  assert.equal(packageJson.version, "1.7.1")

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

test("packaged Electron smoke resolves every product and architecture layout", () => {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "astraflow-packaged-layout-")
  )
  const fixtures = [
    {
      builderConfig: [
        "productName: AstraFlow",
        "linux:",
        "  executableName: astraflow",
        "",
      ].join("\n"),
      executable: join(
        temporaryRoot,
        "linux-arm64-unpacked",
        "astraflow"
      ),
      platform: "linux",
    },
    {
      builderConfig: [
        "productName: 优云智算",
        "win:",
        "  executableName: compshare",
        "",
      ].join("\n"),
      executable: join(
        temporaryRoot,
        "win-arm64-unpacked",
        "compshare.exe"
      ),
      platform: "win32",
    },
    {
      builderConfig: ["productName: 优云智算", ""].join("\n"),
      executable: join(
        temporaryRoot,
        "优云智算.app",
        "Contents",
        "MacOS",
        "优云智算"
      ),
      platform: "darwin",
    },
  ]

  try {
    fixtures.forEach((fixture, index) => {
      const distDir = join(temporaryRoot, `dist-${index}`)
      const executable = fixture.executable.replace(
        temporaryRoot,
        distDir
      )
      const builderConfigPath = join(
        temporaryRoot,
        `electron-builder-${index}.yml`
      )

      mkdirSync(dirname(executable), { recursive: true })
      writeFileSync(executable, "")
      if (fixture.platform === "darwin") {
        mkdirSync(
          join(dirname(executable), "..", "Resources"),
          { recursive: true }
        )
        writeFileSync(
          join(dirname(executable), "..", "Resources", "app.asar"),
          ""
        )
      } else {
        mkdirSync(join(dirname(executable), "resources"), {
          recursive: true,
        })
        writeFileSync(join(dirname(executable), "resources", "app.asar"), "")
      }
      writeFileSync(builderConfigPath, fixture.builderConfig)

      assert.equal(
        findPackagedExecutable({
          builderConfigPath,
          distDir,
          platform: fixture.platform,
        }),
        executable
      )
    })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test("Windows packaged smoke validates ASAR in place through Electron", () => {
  const smokeSource = read("scripts/smoke-electron-package.mjs")

  assert.match(
    smokeSource,
    /process\.platform === "win32"[\s\S]*ASTRAFLOW_PACKAGED_SMOKE_VIRTUAL_ASAR: "1"[\s\S]*ELECTRON_RUN_AS_NODE: "1"/
  )
  assert.match(
    smokeSource,
    /if \(virtualAsarSmoke\) \{\s*return archivePath\s*\}/
  )
  assert.match(
    smokeSource,
    /delete appLaunchEnv\.ELECTRON_RUN_AS_NODE/
  )
})

test("Windows ACP smoke cleanup retries transient executable locks", async () => {
  const attempts = []
  const waits = []

  await removeSmokeSandboxRoot("C:\\Temp\\astraflow-smoke", {
    platform: "win32",
    removeSync(path, options) {
      attempts.push({ options, path })
      if (attempts.length < 3) {
        throw Object.assign(new Error("file is still mapped"), {
          code: "EACCES",
        })
      }
    },
    wait(delayMs) {
      waits.push(delayMs)
      return Promise.resolve()
    },
  })

  assert.equal(attempts.length, 3)
  assert.deepEqual(waits, [200, 200])
  assert.deepEqual(attempts[0], {
    options: { force: true, recursive: true },
    path: "C:\\Temp\\astraflow-smoke",
  })
})

test("Windows ACP smoke stages JavaScript dependencies below its disposable runtime root", () => {
  const temporaryRoot = mkdtempSync(
    join(tmpdir(), "astraflow-smoke-node-modules-")
  )
  const sourceNodeModules = join(temporaryRoot, "source", "node_modules")
  const smokeRoot = join(temporaryRoot, "smoke")

  try {
    const packages = [
      {
        name: "@example/adapter",
        packageJson: {
          dependencies: { "@example/sdk": "1.0.0" },
          optionalDependencies: { "@example/native": "1.0.0" },
          version: "1.0.0",
        },
      },
      {
        name: "@example/sdk",
        packageJson: { version: "1.0.0" },
      },
      {
        name: "@example/native",
        packageJson: { version: "1.0.0" },
      },
    ]

    for (const fixture of packages) {
      const packageRoot = join(
        sourceNodeModules,
        ...fixture.name.split("/")
      )
      mkdirSync(packageRoot, { recursive: true })
      writeFileSync(
        join(packageRoot, "package.json"),
        JSON.stringify(fixture.packageJson)
      )
      writeFileSync(join(packageRoot, "index.js"), fixture.name)
    }

    const stagedNodeModules = stageSmokeNodeModuleClosure({
      nodeModulesDir: sourceNodeModules,
      packageNames: ["@example/adapter"],
      root: smokeRoot,
    })

    assert.equal(basename(stagedNodeModules), "node_modules")
    assert.equal(
      readFileSync(
        join(stagedNodeModules, "@example", "adapter", "index.js"),
        "utf8"
      ),
      "@example/adapter"
    )
    assert.equal(
      readFileSync(
        join(stagedNodeModules, "@example", "sdk", "index.js"),
        "utf8"
      ),
      "@example/sdk"
    )
    assert.equal(
      existsSync(
        join(stagedNodeModules, "@example", "native", "index.js")
      ),
      false
    )
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
})

test("runtime downloads retry transient HTTP and transport failures only", async () => {
  const attempts = []
  const waits = []
  const retries = []
  const responses = [
    { ok: false, status: 504 },
    new Error("socket reset"),
    { ok: true, status: 200 },
  ]
  const response = await fetchDownloadWithRetry(
    "https://downloads.example/runtime.tar.gz",
    {
      async fetchImpl(url, request) {
        attempts.push({ request, url })
        const result = responses.shift()

        if (result instanceof Error) {
          throw result
        }

        return result
      },
      onRetry(retry) {
        retries.push(retry)
      },
      retryDelaysMs: [10, 20],
      async wait(delayMs) {
        waits.push(delayMs)
      },
    }
  )

  assert.equal(response.status, 200)
  assert.equal(attempts.length, 3)
  assert.deepEqual(waits, [10, 20])
  assert.deepEqual(
    retries.map(({ attempt, delayMs, error }) => ({
      attempt,
      delayMs,
      message: error.message,
    })),
    [
      {
        attempt: 1,
        delayMs: 10,
        message:
          "Failed to download https://downloads.example/runtime.tar.gz: HTTP 504",
      },
      {
        attempt: 2,
        delayMs: 20,
        message: "socket reset",
      },
    ]
  )

  let nonRetryableAttempts = 0
  await assert.rejects(
    fetchDownloadWithRetry("https://downloads.example/missing.tar.gz", {
      async fetchImpl() {
        nonRetryableAttempts += 1
        return { ok: false, status: 404 }
      },
      onRetry() {
        assert.fail("HTTP 404 must not be retried")
      },
      retryDelaysMs: [10, 20],
      async wait() {
        assert.fail("HTTP 404 must not wait")
      },
    }),
    /HTTP 404/
  )
  assert.equal(nonRetryableAttempts, 1)
})

test("GitHub release downloads fall back to the independent release API path", async () => {
  const requests = []
  const fallbackAttempts = []
  const releaseAssetUrl =
    "https://github.com/example/runtime/releases/download/v1.2.3/runtime%2Bportable.tar.gz"
  const apiAssetUrl =
    "https://api.github.com/repos/example/runtime/releases/assets/42"
  const downloadedAsset = { ok: true, status: 200 }

  const response = await fetchGitHubReleaseAssetWithRetry(releaseAssetUrl, {
    apiToken: "",
    async fetchImpl(url, request) {
      requests.push({ request, url })

      if (url === releaseAssetUrl) {
        return {
          body: { async cancel() {} },
          ok: false,
          status: 504,
        }
      }

      if (
        url ===
        "https://api.github.com/repos/example/runtime/releases/tags/v1.2.3"
      ) {
        return {
          async json() {
            return {
              assets: [
                {
                  name: "runtime+portable.tar.gz",
                  url: apiAssetUrl,
                },
              ],
            }
          },
          ok: true,
          status: 200,
        }
      }

      assert.equal(url, apiAssetUrl)
      return downloadedAsset
    },
    onFallback(fallback) {
      fallbackAttempts.push(fallback)
    },
    retryDelaysMs: [],
    async wait() {
      assert.fail("A single attempt per independent route should not wait")
    },
  })

  assert.equal(response, downloadedAsset)
  assert.equal(fallbackAttempts.length, 1)
  assert.match(fallbackAttempts[0].error.message, /HTTP 504/)
  assert.equal(fallbackAttempts[0].strategy, "the GitHub release API")
  assert.equal(requests.length, 3)
  assert.deepEqual(requests[2].request, {
    headers: {
      Accept: "application/octet-stream",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "follow",
  })
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

test("Windows Electron packages stage and verify an executable srt-win helper", () => {
  const prepareSandboxTools = read("scripts/prepare-sandbox-tools.mjs")
  const electronMain = read("electron/main.cjs")
  const windowsSandboxEnvironment = read(
    "electron/windows-sandbox-environment.cjs"
  )
  const packageSmoke = read("scripts/smoke-electron-package.mjs")

  assert.match(
    prepareSandboxTools,
    /vendor",\s*"srt-win",\s*process\.arch,\s*"srt-win\.exe"/
  )
  assert.match(prepareSandboxTools, /copyFileSync\(srtWinSource, srtWinTarget\)/)
  assert.match(electronMain, /ASTRAFLOW_SRT_WIN_PATH:/)
  assert.match(
    windowsSandboxEnvironment,
    /resolveSrtWin\(\{ path: getSrtWinPath\(\) \}\)/
  )
  assert.match(windowsSandboxEnvironment, /installWindowsSandbox\(\{ srtWin \}\)/)
  const bootstrap = electronMain.slice(
    electronMain.indexOf("async function bootstrap()")
  )
  assert.ok(
    bootstrap.indexOf(
      "getWindowsSandboxEnvironmentManager().ensureReady()"
    ) < bootstrap.indexOf("await startNextServer()"),
    "Windows sandbox provisioning must finish before the ACP server starts."
  )
  assert.match(
    packageSmoke,
    /`win32-\$\{process\.arch\}`,\s*"bin",\s*"srt-win\.exe"/
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
    ["windows-x64", "latest.yml", "AstraFlow-1.2.3-win-x64.exe"],
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

    const macManifest = readFileSync(join(targetDir, "latest-mac.yml"), "utf8")
    assert.equal((macManifest.match(/^  - url:/gm) ?? []).length, 2)
    assert.match(macManifest, /arm64/)
    assert.match(macManifest, /x64/)

    const windowsManifest = readFileSync(join(targetDir, "latest.yml"), "utf8")
    assert.equal((windowsManifest.match(/^  - url:/gm) ?? []).length, 1)
    assert.match(windowsManifest, /win-x64/)

    assert.match(
      readFileSync(join(targetDir, "latest-linux.yml"), "utf8"),
      /linux-x64/
    )
    const releaseManifest = JSON.parse(
      readFileSync(join(targetDir, "latest.json"), "utf8")
    )
    assert.equal(releaseManifest.files.length, 4)
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
