// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { toMcpRegistryServer, toSkillMeta } from "@/lib/marketplace-mappers"

describe("marketplace DTO mappers", () => {
  test("maps the generated UCloud MCP proxy DTO to the registry model", () => {
    const server = toMcpRegistryServer(
      {
        name: "io.github.nonameuserd/paybond",
        title: "Paybond MCP Server",
        version: "0.12.7",
        transports: ["stdio", "unknown"],
        isLatest: true,
        updatedAt: "2026-07-14T15:42:21.741571Z",
        serverJsonUrl:
          "https://devportal.cn-wlcb.ufileos.com/mcp/io.github.nonameuserd/paybond/0.12.7/server.json",
        iconUrl: "https://paybond.ai/icon.png",
        websiteUrl: "https://paybond.ai/docs/kit/mcp-server",
        repository: {
          url: "https://github.com/nonameuserd/paybond-kit",
          source: "github",
        },
      },
      {
        packages: [{ registryType: "npm", identifier: "@paybond/kit" }],
      }
    )

    expect(server).not.toBeNull()
    expect(server?.id).toBe("io.github.nonameuserd/paybond@0.12.7")
    expect(server?.transports).toEqual(["stdio"])
    expect(server?.latest).toBe(true)
    expect(server?.serverJsonUrl).toEndWith("/server.json")
    expect(server?.serverJson.packages).toHaveLength(1)
    expect(server?.registryMeta).toMatchObject({
      iconUrl: "https://paybond.ai/icon.png",
      websiteUrl: "https://paybond.ai/docs/kit/mcp-server",
      repository: {
        url: "https://github.com/nonameuserd/paybond-kit",
        source: "github",
      },
    })
  })

  test("maps generated string int64 fields to numeric skill metadata", () => {
    expect(
      toSkillMeta({
        slug: "demo",
        downloads: "1234",
        sizeBytes: "4096",
        upstreamUpdatedAt: "1784277851456",
        iconUrl: "https://example.com/skill.png",
        stars: "42",
        subCategories: [{ key: "dev-bug-fix", name: "Bug 修复" }],
      })
    ).toMatchObject({
      Slug: "demo",
      Downloads: 1234,
      SizeBytes: 4096,
      UpStreamUpdatedAt: 1784277851456,
      IconUrl: "https://example.com/skill.png",
      Stars: 42,
      SubCategories: [{ key: "dev-bug-fix", name: "Bug 修复" }],
    })
  })
})
