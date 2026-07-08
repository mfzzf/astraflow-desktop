#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto"
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
  mkdir,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative } from "node:path"
import process from "node:process"

const expectedFullImport = {
  categories: 13,
  experts: 299,
  downloaded: 244,
  metadataOnly: 55,
  agent: 256,
  team: 43,
  skillFiles: 439,
  mcpFiles: 2,
}

function parseArgs(argv) {
  const args = {
    source: "",
    databaseUrl: process.env.ASTRAFLOW_EXPERT_DATABASE_URL ?? "",
    dryRun: false,
    report: "",
    selfTest: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--source") {
      args.source = argv[++index] ?? ""
    } else if (arg === "--database-url") {
      args.databaseUrl = argv[++index] ?? ""
    } else if (arg === "--dry-run") {
      args.dryRun = true
    } else if (arg === "--report") {
      args.report = argv[++index] ?? ""
    } else if (arg === "--self-test") {
      args.selfTest = true
      args.dryRun = true
    } else if (arg === "--help" || arg === "-h") {
      printHelp()
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return args
}

function printHelp() {
  console.log(`Usage:
  node backend/astraflow-api/migration/0002_sync_workbuddy_expert_data.mjs --source <dir> --database-url <postgres-url>
  node backend/astraflow-api/migration/0002_sync_workbuddy_expert_data.mjs --source <dir> --dry-run
  node backend/astraflow-api/migration/0002_sync_workbuddy_expert_data.mjs --self-test
`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  if (args.selfTest) {
    await runSelfTest(args)
    return
  }

  if (!args.source) {
    throw new Error("--source is required")
  }
  if (!args.dryRun && !args.databaseUrl) {
    throw new Error("--database-url or ASTRAFLOW_EXPERT_DATABASE_URL is required")
  }

  const normalized = await normalizeSource(args.source)
  const report = buildReport(normalized, args.source)

  if (args.dryRun) {
    console.log(report)
    return
  }

  await importToPostgres(normalized, args.databaseUrl, args.source)

  const reportPath = args.report || join("docs", "expert-system", `import-report-${today()}.md`)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, report)
  console.log(`Imported ${normalized.experts.length} experts.`)
  console.log(`Report: ${reportPath}`)
}

async function runSelfTest(args = {}) {
  const root = await mkdtemp(join(tmpdir(), "astraflow-experts-"))
  try {
    await writeFixture(root)
    const normalized = await normalizeSource(root)
    assertEqual(normalized.categories.length, 1, "category count")
    assertEqual(normalized.experts.length, 3, "expert count")
    assertEqual(normalized.summary.downloaded, 2, "downloaded count")
    assertEqual(normalized.summary.metadataOnly, 1, "metadata-only count")
    assertEqual(normalized.summary.agent, 2, "agent count")
    assertEqual(normalized.summary.team, 1, "team count")
    assertEqual(normalized.summary.promptFiles, 3, "prompt count")
    assertEqual(normalized.summary.skillFiles, 1, "skill count")
    assertEqual(normalized.summary.mcpFiles, 1, "mcp count")

    const team = normalized.experts.find((expert) => expert.id === "TeamExpert")
    if (!team || team.teamMembers.length !== 2 || team.agents[0]?.role !== "lead") {
      throw new Error("team normalization failed")
    }

    if (args.databaseUrl) {
      await importToPostgres(normalized, args.databaseUrl, root)
      await assertSelfTestImport(args.databaseUrl)
    }

    console.log("Self-test passed")
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function assertSelfTestImport(databaseUrl) {
  const { Client } = await import("pg")
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()
  try {
    const { rows } = await client.query(`
      SELECT
        COUNT(*)::int AS expert_count,
        COUNT(*) FILTER (WHERE status = 'downloaded')::int AS downloaded_count,
        COUNT(*) FILTER (WHERE status = 'metadata_only')::int AS metadata_only_count,
        COUNT(*) FILTER (WHERE type = 'team')::int AS team_count
      FROM experts
      WHERE id IN ('SoloExpert', 'TeamExpert', 'MissingExpert')
    `)
    const counts = rows[0]
    assertEqual(counts.expert_count, 3, "database expert count")
    assertEqual(counts.downloaded_count, 2, "database downloaded count")
    assertEqual(counts.metadata_only_count, 1, "database metadata-only count")
    assertEqual(counts.team_count, 1, "database team count")

    const related = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM expert_agents WHERE expert_id IN ('SoloExpert', 'TeamExpert')) AS agent_count,
        (SELECT COUNT(*)::int FROM expert_skills WHERE expert_id = 'SoloExpert') AS skill_count,
        (SELECT COUNT(*)::int FROM expert_mcp_servers WHERE expert_id = 'SoloExpert') AS mcp_count,
        (SELECT COUNT(*)::int FROM expert_team_members WHERE expert_id = 'TeamExpert') AS member_count
    `)
    const relatedCounts = related.rows[0]
    assertEqual(relatedCounts.agent_count, 3, "database agent count")
    assertEqual(relatedCounts.skill_count, 1, "database skill count")
    assertEqual(relatedCounts.mcp_count, 1, "database mcp count")
    assertEqual(relatedCounts.member_count, 2, "database team member count")
  } finally {
    await client.end()
  }
}

async function normalizeSource(sourcePath) {
  await assertDirectory(sourcePath)

  const index = await readJsonOptional(join(sourcePath, "index.json"))
  const center = await readJsonOptional(join(sourcePath, "expert_center.json"))
  if (!index && !center) {
    throw new Error(`Missing index.json or expert_center.json in ${sourcePath}`)
  }

  const expertsDir = join(sourcePath, "experts")
  const expertFolders = await discoverExpertFolders(expertsDir)
  const rawCategories = collectCategoryRecords(index, center)
  const rawExperts = collectExpertRecords(index, center)

  if (rawExperts.length === 0 && expertFolders.size > 0) {
    for (const folder of expertFolders.values()) {
      rawExperts.push({
        id: folder.name.split("__")[0] || folder.name,
        slug: folder.name.split("__")[1] || slugify(folder.name),
        sourceFolder: folder.name,
      })
    }
  }

  const categories = normalizeCategories(rawCategories, rawExperts)
  const experts = []
  const errors = []

  for (const rawExpert of rawExperts) {
    try {
      experts.push(await normalizeExpert(rawExpert, expertFolders))
    } catch (error) {
      errors.push({
        id: readString(rawExpert.id ?? rawExpert.expertId ?? rawExpert.name),
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const categoryCounts = new Map()
  for (const expert of experts) {
    if (!expert.categoryId) {
      continue
    }
    categoryCounts.set(expert.categoryId, (categoryCounts.get(expert.categoryId) ?? 0) + 1)
  }
  for (const category of categories) {
    category.expertCount = categoryCounts.get(category.id) ?? 0
  }

  const summary = summarize(experts, categories, errors)
  return {
    sourceGeneratedAt: readString(index?.generatedAt ?? index?.generated_at ?? center?.generatedAt ?? ""),
    categories,
    experts,
    errors,
    summary,
  }
}

async function normalizeExpert(rawExpert, expertFolders) {
  const rawID = readString(rawExpert.id ?? rawExpert.expertId ?? rawExpert.name ?? rawExpert.key)
  const rawSlug = readString(rawExpert.slug ?? rawExpert.pluginSlug)
  const sourceFolder = readString(rawExpert.sourceFolder ?? rawExpert.folder ?? rawExpert.localFolder)
  const folder = findExpertFolder(expertFolders, { id: rawID, slug: rawSlug, sourceFolder })
  const manifestDir = folder ? join(folder.path, "manifest") : ""
  const plugin = manifestDir ? await readJsonOptional(join(manifestDir, "plugin.json")) : null

  const id = rawID || readString(plugin?.id ?? plugin?.name ?? plugin?.agentName) || sourceFolder.split("__")[0]
  if (!id) {
    throw new Error("expert id is missing")
  }

  const slug = rawSlug || readString(plugin?.slug) || slugify(id)
  const expertType = normalizeExpertType(
    readString(rawExpert.expertType ?? rawExpert.type ?? plugin?.expertType ?? plugin?.type),
    plugin
  )
  const status = folder && plugin ? "downloaded" : "metadata_only"
  const agents = status === "downloaded" ? await readAgents(folder.path, manifestDir, id, expertType, plugin) : []
  const skills = status === "downloaded" ? await readSkills(folder.path, manifestDir, id) : []
  const mcpServers = status === "downloaded" ? await readMcpServers(folder.path, manifestDir, id) : []
  const teamMembers = expertType === "team" ? buildTeamMembers(id, plugin, agents) : []
  const fileCount = status === "downloaded" ? await countFiles(folder.path) : 0

  const displayName = localizedText(
    rawExpert.displayName ?? rawExpert.title ?? plugin?.displayName ?? plugin?.title ?? id
  )
  const profession = localizedText(rawExpert.profession ?? plugin?.profession ?? rawExpert.name ?? id)
  const description = localizedText(rawExpert.description ?? plugin?.description ?? "")
  const tags = localizedArray(rawExpert.tags ?? rawExpert.labels ?? plugin?.tags ?? [])
  const quickPrompts = localizedArray(rawExpert.quickPrompts ?? rawExpert.quick_prompts ?? plugin?.quickPrompts ?? [])
  const defaultInitPrompt = localizedText(
    rawExpert.defaultInitPrompt ?? rawExpert.default_init_prompt ?? plugin?.defaultInitPrompt ?? plugin?.initPrompt ?? ""
  )
  const categoryId = readString(rawExpert.categoryId ?? rawExpert.category_id ?? rawExpert.category ?? plugin?.categoryId)
  const sourcePlugin = JSON.stringify(plugin ?? rawExpert)
  const runtimeMaterial = status === "downloaded"
    ? stableStringify({
        plugin,
        agents: agents.map((agent) => ({
          name: agent.agentName,
          role: agent.role,
          prompt: agent.promptMarkdown,
          frontmatter: agent.frontmatter,
        })),
        skills: skills.map((skill) => ({
          slug: skill.skillSlug,
          markdown: skill.skillMarkdown,
          metadata: skill.metadata,
        })),
        mcpServers: mcpServers.map((server) => server.mcp),
        teamMembers,
      })
    : ""

  return {
    id,
    slug,
    source: "workbuddy",
    sourceFolder: folder?.name ?? sourceFolder,
    sourcePlugin,
    type: expertType,
    status,
    categoryId,
    displayName,
    profession,
    description,
    avatarPath: readString(rawExpert.avatar ?? rawExpert.avatarPath ?? plugin?.avatar ?? plugin?.icon),
    tags,
    quickPrompts,
    defaultInitPrompt,
    downloadedFileCount: fileCount,
    promptCount: agents.length,
    skillFileCount: skills.length,
    mcpFileCount: mcpServers.length,
    memberCount: teamMembers.filter((member) => member.role === "member").length,
    runtimeHash: runtimeMaterial ? hash(runtimeMaterial) : "",
    searchText: buildSearchText({
      id,
      slug,
      displayName,
      profession,
      description,
      tags,
      quickPrompts,
      agents,
      skills,
    }),
    agents,
    skills,
    mcpServers,
    teamMembers,
  }
}

async function readAgents(expertDir, manifestDir, expertID, expertType, plugin) {
  const files = [
    ...(await findFiles(join(manifestDir, "agents"), (file) => file.endsWith(".md"))),
    ...(await findFiles(join(expertDir, "prompts"), (file) => file.endsWith(".md"))),
  ]
  const leadAgent = readString(plugin?.teamInfo?.leadAgent ?? plugin?.leadAgent ?? plugin?.agentName)
  const memberAgents = new Set(
    arrayValues(plugin?.teamInfo?.memberAgents ?? plugin?.memberAgents).map((value) => readString(value))
  )

  const agents = []
  const seenNames = new Set()
  for (const file of files) {
    const markdown = await readFile(file, "utf8")
    const parsed = parseFrontmatter(markdown)
    const name = readString(parsed.frontmatter.name ?? parsed.frontmatter.agentName) || basename(file, ".md")
    const nameKey = name.toLowerCase()
    if (seenNames.has(nameKey)) {
      continue
    }
    seenNames.add(nameKey)

    const index = agents.length
    let role = "single"
    if (expertType === "team") {
      role = name === leadAgent || (!leadAgent && index === 0) ? "lead" : "member"
      if (memberAgents.has(name)) {
        role = "member"
      }
    }

    agents.push({
      id: `${expertID}:${name}`,
      expertId: expertID,
      agentName: name,
      role,
      displayName: localizedText(parsed.frontmatter.displayName ?? parsed.frontmatter.title ?? name),
      profession: localizedText(parsed.frontmatter.profession ?? parsed.frontmatter.role ?? ""),
      description: readString(parsed.frontmatter.description ?? ""),
      promptMarkdown: parsed.body.trim(),
      frontmatter: parsed.frontmatter,
      skills: arrayValues(parsed.frontmatter.skills ?? plugin?.skills).map((value) => readString(value)).filter(Boolean),
      maxTurns: readInteger(parsed.frontmatter.maxTurns ?? parsed.frontmatter.max_turns),
      sortOrder: role === "lead" ? 0 : index + 1,
      contentHash: hash(markdown),
    })
  }
  return agents.sort((left, right) => left.sortOrder - right.sortOrder || left.agentName.localeCompare(right.agentName))
}

async function readSkills(expertDir, manifestDir, expertID) {
  const files = [
    ...(await findFiles(join(manifestDir, "skills"), (file) => basename(file) === "SKILL.md")),
    ...(await findFiles(join(expertDir, "skills"), (file) => basename(file) === "SKILL.md")),
  ]
  const skills = []
  const seenSlugs = new Set()

  for (const file of files) {
    const markdown = await readFile(file, "utf8")
    const parsed = parseFrontmatter(markdown)
    const relativePath = relative(expertDir, file)
    const slug = readString(parsed.frontmatter.name) || slugify(basename(dirname(file)))
    const slugKey = slug.toLowerCase()
    if (seenSlugs.has(slugKey)) {
      continue
    }
    seenSlugs.add(slugKey)

    skills.push({
      id: `${expertID}:${slug}:${hash(relativePath).slice(7, 19)}`,
      expertId: expertID,
      skillSlug: slug,
      relativePath,
      skillMarkdown: parsed.body.trim(),
      metadata: {
        ...parsed.frontmatter,
        title: readString(parsed.frontmatter.title ?? parsed.frontmatter.displayName ?? firstHeading(parsed.body)),
        description: readString(parsed.frontmatter.description ?? ""),
      },
      contentHash: hash(markdown),
    })
  }

  return skills
}

async function readMcpServers(expertDir, manifestDir, expertID) {
  const files = [
    ...(await findFiles(manifestDir, (file) => basename(file) === ".mcp.json")),
    ...(await findFiles(join(expertDir, "mcp"), (file) => basename(file) === ".mcp.json")),
  ]
  const servers = []
  const seenPaths = new Set()
  for (const file of files) {
    const relativePath = relative(expertDir, file)
    if (seenPaths.has(relativePath)) {
      continue
    }
    seenPaths.add(relativePath)

    const raw = await readFile(file, "utf8")
    const parsed = JSON.parse(raw)
    servers.push({
      id: `${expertID}:mcp:${hash(relativePath).slice(7, 19)}`,
      expertId: expertID,
      relativePath,
      mcp: parsed,
      serverCount: countMcpServers(parsed),
      contentHash: hash(raw),
    })
  }
  return servers
}

function buildTeamMembers(expertID, plugin, agents) {
  const members = []
  const pluginMembers = arrayValues(plugin?.members)
  const leadAgent = readString(plugin?.teamInfo?.leadAgent ?? plugin?.leadAgent ?? plugin?.agentName)

  for (const agent of agents) {
    const declared = pluginMembers.find((member) => {
      const name = readString(member.agentName ?? member.name)
      return name === agent.agentName
    })
    members.push({
      id: `${expertID}:${agent.agentName}`,
      expertId: expertID,
      agentName: agent.agentName,
      role: agent.agentName === leadAgent || agent.role === "lead" ? "lead" : "member",
      displayName: localizedText(declared?.displayName ?? agent.displayName),
      profession: localizedText(declared?.profession ?? agent.profession),
      avatarPath: readString(declared?.avatar ?? declared?.avatarPath ?? ""),
      sortOrder: agent.role === "lead" ? 0 : members.length + 1,
    })
  }

  return members
}

function collectCategoryRecords(index, center) {
  const records = []
  for (const source of [index, center]) {
    const categories = source?.categories ?? source?.expertCategories ?? source?.categoryList
    if (Array.isArray(categories)) {
      records.push(...categories)
    }
  }
  return records
}

function collectExpertRecords(index, center) {
  const records = []
  for (const source of [index, center]) {
    for (const key of ["experts", "expertList", "items", "data", "list"]) {
      const value = source?.[key]
      if (Array.isArray(value)) {
        records.push(...value)
      } else if (value && typeof value === "object") {
        records.push(...Object.values(value).flat().filter((item) => item && typeof item === "object"))
      }
    }

    const categories = source?.categories ?? source?.expertCategories
    if (Array.isArray(categories)) {
      for (const category of categories) {
        const categoryID = readString(category.id ?? category.categoryId ?? category.name)
        const experts = category.experts ?? category.items ?? category.children
        if (Array.isArray(experts)) {
          records.push(...experts.map((expert) => ({ ...expert, categoryId: expert.categoryId ?? categoryID })))
        }
      }
    }
  }

  const seen = new Set()
  return records.filter((record) => {
    const id = readString(record.id ?? record.expertId ?? record.name ?? record.slug)
    const key = id || JSON.stringify(record)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function normalizeCategories(rawCategories, rawExperts) {
  const categories = []
  const seen = new Set()

  for (let index = 0; index < rawCategories.length; index += 1) {
    const raw = rawCategories[index]
    const id = readString(raw.id ?? raw.categoryId ?? raw.name ?? raw.key)
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    const name = localizedText(raw.name ?? raw.displayName ?? raw.title ?? id)
    const description = localizedText(raw.description ?? "")
    categories.push({
      id,
      name,
      description,
      sortOrder: readInteger(raw.sortOrder ?? raw.sort_order ?? index),
      expertCount: 0,
    })
  }

  for (const rawExpert of rawExperts) {
    const id = readString(rawExpert.categoryId ?? rawExpert.category_id ?? rawExpert.category)
    if (!id || seen.has(id)) {
      continue
    }
    seen.add(id)
    categories.push({
      id,
      name: localizedText(id),
      description: localizedText(""),
      sortOrder: categories.length,
      expertCount: 0,
    })
  }

  return categories
}

async function discoverExpertFolders(expertsDir) {
  const folders = new Map()
  if (!(await exists(expertsDir))) {
    return folders
  }
  for (const entry of await readdir(expertsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }
    const path = join(expertsDir, entry.name)
    const [idPart, slugPart] = entry.name.split("__")
    const info = {
      name: entry.name,
      path,
      id: idPart || entry.name,
      slug: slugPart || slugify(entry.name),
    }
    for (const key of [info.name, info.id, info.slug]) {
      folders.set(key.toLowerCase(), info)
    }
  }
  return folders
}

function findExpertFolder(folders, { id, slug, sourceFolder }) {
  for (const key of [sourceFolder, id, slug]) {
    if (!key) {
      continue
    }
    const folder = folders.get(key.toLowerCase())
    if (folder) {
      return folder
    }
  }
  return null
}

async function importToPostgres(normalized, databaseUrl, sourcePath) {
  const { Client } = await import("pg")
  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  const runID = randomUUID()
  try {
    await client.query("BEGIN")
    await client.query(expertSchemaSQL)
    await client.query(
      `INSERT INTO expert_import_runs
        (id, source_path, source_generated_at, status)
       VALUES ($1, $2, $3, 'running')`,
      [runID, sourcePath, normalized.sourceGeneratedAt]
    )

    for (const category of normalized.categories) {
      await client.query(
        `INSERT INTO expert_categories
          (id, name_zh, name_en, description_zh, description_en, sort_order, expert_count, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT(id) DO UPDATE SET
          name_zh = excluded.name_zh,
          name_en = excluded.name_en,
          description_zh = excluded.description_zh,
          description_en = excluded.description_en,
          sort_order = excluded.sort_order,
          expert_count = excluded.expert_count,
          updated_at = now()`,
        [
          category.id,
          category.name.zh,
          category.name.en,
          category.description.zh,
          category.description.en,
          category.sortOrder,
          category.expertCount,
        ]
      )
    }

    for (const expert of normalized.experts) {
      await upsertExpert(client, expert)
    }

    await client.query(
      `UPDATE expert_import_runs SET
        finished_at = now(),
        status = $2,
        expert_count = $3,
        downloaded_count = $4,
        metadata_only_count = $5,
        prompt_count = $6,
        skill_count = $7,
        mcp_count = $8,
        error_message = $9
       WHERE id = $1`,
      [
        runID,
        normalized.errors.length > 0 ? "completed_with_errors" : "completed",
        normalized.summary.experts,
        normalized.summary.downloaded,
        normalized.summary.metadataOnly,
        normalized.summary.promptFiles,
        normalized.summary.skillFiles,
        normalized.summary.mcpFiles,
        normalized.errors.map((error) => `${error.id}: ${error.error}`).join("\n"),
      ]
    )
    await client.query("COMMIT")
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    await client.end()
  }
}

async function upsertExpert(client, expert) {
  await client.query(
    `INSERT INTO experts
      (
        id, slug, source, source_folder, source_plugin, type, status, category_id,
        display_name_zh, display_name_en, profession_zh, profession_en,
        description_zh, description_en, avatar_path, tags_json, quick_prompts_json,
        default_init_prompt_json, downloaded_file_count, prompt_count, skill_file_count,
        mcp_file_count, member_count, runtime_hash, search_text, updated_at
      )
     VALUES
      ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, $20, $21, $22, $23, $24, $25, now())
     ON CONFLICT(id) DO UPDATE SET
      slug = excluded.slug,
      source = excluded.source,
      source_folder = excluded.source_folder,
      source_plugin = excluded.source_plugin,
      type = excluded.type,
      status = excluded.status,
      category_id = excluded.category_id,
      display_name_zh = excluded.display_name_zh,
      display_name_en = excluded.display_name_en,
      profession_zh = excluded.profession_zh,
      profession_en = excluded.profession_en,
      description_zh = excluded.description_zh,
      description_en = excluded.description_en,
      avatar_path = excluded.avatar_path,
      tags_json = excluded.tags_json,
      quick_prompts_json = excluded.quick_prompts_json,
      default_init_prompt_json = excluded.default_init_prompt_json,
      downloaded_file_count = excluded.downloaded_file_count,
      prompt_count = excluded.prompt_count,
      skill_file_count = excluded.skill_file_count,
      mcp_file_count = excluded.mcp_file_count,
      member_count = excluded.member_count,
      runtime_hash = excluded.runtime_hash,
      search_text = excluded.search_text,
      updated_at = now()`,
    [
      expert.id,
      expert.slug,
      expert.source,
      expert.sourceFolder,
      expert.sourcePlugin,
      expert.type,
      expert.status,
      expert.categoryId,
      expert.displayName.zh,
      expert.displayName.en,
      expert.profession.zh,
      expert.profession.en,
      expert.description.zh,
      expert.description.en,
      expert.avatarPath,
      JSON.stringify(expert.tags),
      JSON.stringify(expert.quickPrompts),
      JSON.stringify(expert.defaultInitPrompt),
      expert.downloadedFileCount,
      expert.promptCount,
      expert.skillFileCount,
      expert.mcpFileCount,
      expert.memberCount,
      expert.runtimeHash,
      expert.searchText,
    ]
  )

  await client.query("DELETE FROM expert_agents WHERE expert_id = $1", [expert.id])
  await client.query("DELETE FROM expert_skills WHERE expert_id = $1", [expert.id])
  await client.query("DELETE FROM expert_mcp_servers WHERE expert_id = $1", [expert.id])
  await client.query("DELETE FROM expert_team_members WHERE expert_id = $1", [expert.id])

  for (const agent of expert.agents) {
    await client.query(
      `INSERT INTO expert_agents
        (id, expert_id, agent_name, role, display_name_zh, display_name_en,
         profession_zh, profession_en, description, prompt_markdown, frontmatter_json,
         skills_json, max_turns, sort_order, content_hash, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14, $15, now())`,
      [
        agent.id,
        agent.expertId,
        agent.agentName,
        agent.role,
        agent.displayName.zh,
        agent.displayName.en,
        agent.profession.zh,
        agent.profession.en,
        agent.description,
        agent.promptMarkdown,
        JSON.stringify(agent.frontmatter),
        JSON.stringify(agent.skills),
        agent.maxTurns,
        agent.sortOrder,
        agent.contentHash,
      ]
    )
  }

  for (const skill of expert.skills) {
    await client.query(
      `INSERT INTO expert_skills
        (id, expert_id, skill_slug, relative_path, skill_md, metadata_json, content_hash, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6::jsonb, $7, now())`,
      [
        skill.id,
        skill.expertId,
        skill.skillSlug,
        skill.relativePath,
        skill.skillMarkdown,
        JSON.stringify(skill.metadata),
        skill.contentHash,
      ]
    )
  }

  for (const server of expert.mcpServers) {
    await client.query(
      `INSERT INTO expert_mcp_servers
        (id, expert_id, relative_path, mcp_json, server_count, content_hash, updated_at)
       VALUES
        ($1, $2, $3, $4::jsonb, $5, $6, now())`,
      [
        server.id,
        server.expertId,
        server.relativePath,
        JSON.stringify(server.mcp),
        server.serverCount,
        server.contentHash,
      ]
    )
  }

  for (const member of expert.teamMembers) {
    await client.query(
      `INSERT INTO expert_team_members
        (id, expert_id, agent_name, role, display_name_zh, display_name_en,
         profession_zh, profession_en, avatar_path, sort_order, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())`,
      [
        member.id,
        member.expertId,
        member.agentName,
        member.role,
        member.displayName.zh,
        member.displayName.en,
        member.profession.zh,
        member.profession.en,
        member.avatarPath,
        member.sortOrder,
      ]
    )
  }
}

function buildReport(normalized, sourcePath) {
  const summary = normalized.summary
  const lines = [
    `# Expert Import Report ${today()}`,
    "",
    `- source path: ${sourcePath}`,
    `- source generatedAt: ${normalized.sourceGeneratedAt || "unknown"}`,
    `- categories: ${summary.categories}`,
    `- experts: ${summary.experts}`,
    `- downloaded: ${summary.downloaded}`,
    `- metadata-only: ${summary.metadataOnly}`,
    `- agent: ${summary.agent}`,
    `- team: ${summary.team}`,
    `- prompt files: ${summary.promptFiles}`,
    `- normalized SKILL.md files: ${summary.skillFiles}`,
    `- mcp files: ${summary.mcpFiles}`,
    `- expert errors: ${normalized.errors.length}`,
    "",
  ]

  const isFullImport = summary.experts === expectedFullImport.experts
  if (isFullImport) {
    lines.push("## Expected Full Import Checks", "")
    for (const [key, expected] of Object.entries(expectedFullImport)) {
      const actual = summary[key] ?? 0
      lines.push(`- ${key}: ${actual === expected ? "ok" : "mismatch"} (${actual}/${expected})`)
    }
    lines.push("")
  }

  if (normalized.errors.length > 0) {
    lines.push("## Errors", "")
    for (const error of normalized.errors) {
      lines.push(`- ${error.id || "unknown"}: ${error.error}`)
    }
    lines.push("")
  }

  const metadataOnly = normalized.experts.filter((expert) => expert.status === "metadata_only")
  if (metadataOnly.length > 0) {
    lines.push("## Metadata-only Experts", "")
    for (const expert of metadataOnly) {
      lines.push(`- ${expert.id}`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

function summarize(experts, categories, errors) {
  return {
    categories: categories.length,
    experts: experts.length,
    downloaded: experts.filter((expert) => expert.status === "downloaded").length,
    metadataOnly: experts.filter((expert) => expert.status === "metadata_only").length,
    agent: experts.filter((expert) => expert.type === "agent").length,
    team: experts.filter((expert) => expert.type === "team").length,
    promptFiles: experts.reduce((sum, expert) => sum + expert.promptCount, 0),
    skillFiles: experts.reduce((sum, expert) => sum + expert.skillFileCount, 0),
    mcpFiles: experts.reduce((sum, expert) => sum + expert.mcpFileCount, 0),
    errors: errors.length,
  }
}

function buildSearchText({ id, slug, displayName, profession, description, tags, quickPrompts, agents, skills }) {
  return [
    id,
    slug,
    displayName.zh,
    displayName.en,
    profession.zh,
    profession.en,
    description.zh,
    description.en,
    ...tags.flatMap((tag) => [tag.zh, tag.en]),
    ...quickPrompts.flatMap((prompt) => [prompt.zh, prompt.en]),
    ...agents.flatMap((agent) => [agent.agentName, agent.displayName.zh, agent.displayName.en, agent.profession.zh, agent.profession.en]),
    ...skills.flatMap((skill) => [skill.skillSlug, skill.metadata.title, skill.metadata.description]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

function parseFrontmatter(markdown) {
  if (!markdown.startsWith("---\n")) {
    return { frontmatter: {}, body: markdown }
  }
  const end = markdown.indexOf("\n---", 4)
  if (end === -1) {
    return { frontmatter: {}, body: markdown }
  }
  const raw = markdown.slice(4, end)
  return {
    frontmatter: parseSimpleYaml(raw),
    body: markdown.slice(markdown.indexOf("\n", end + 1) + 1),
  }
}

function parseSimpleYaml(raw) {
  const result = {}
  const lines = raw.split(/\r?\n/)
  let currentKey = ""
  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) {
      continue
    }
    const listMatch = line.match(/^\s*-\s*(.+)$/)
    if (listMatch && currentKey) {
      if (!Array.isArray(result[currentKey])) {
        result[currentKey] = []
      }
      result[currentKey].push(stripQuotes(listMatch[1].trim()))
      continue
    }
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) {
      continue
    }
    currentKey = match[1]
    result[currentKey] = parseYamlScalar(match[2])
  }
  return result
}

function parseYamlScalar(value) {
  const trimmed = value.trim()
  if (!trimmed) {
    return ""
  }
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => stripQuotes(item.trim()))
      .filter(Boolean)
  }
  if (/^\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10)
  }
  if (trimmed === "true") {
    return true
  }
  if (trimmed === "false") {
    return false
  }
  return stripQuotes(trimmed)
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, "")
}

async function findFiles(root, predicate) {
  if (!(await exists(root))) {
    return []
  }
  const files = []
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (!predicate || predicate(path)) {
        files.push(path)
      }
    }
  }
  await walk(root)
  return files.sort()
}

async function countFiles(root) {
  return (await findFiles(root)).length
}

async function readJsonOptional(path) {
  if (!(await exists(path))) {
    return null
  }
  return JSON.parse(await readFile(path, "utf8"))
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function assertDirectory(path) {
  let info
  try {
    info = await stat(path)
  } catch {
    throw new Error(`Source directory does not exist: ${path}`)
  }
  if (!info.isDirectory()) {
    throw new Error(`Source is not a directory: ${path}`)
  }
}

function localizedText(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return {
      zh: readString(value.zh ?? value.zhCN ?? value.cn ?? value.chinese ?? value.displayNameZh),
      en: readString(value.en ?? value.enUS ?? value.english ?? value.displayNameEn),
    }
  }
  const text = readString(value)
  return hasCJK(text) ? { zh: text, en: "" } : { zh: "", en: text }
}

function localizedArray(value) {
  return arrayValues(value).map(localizedText).filter((item) => item.zh || item.en)
}

function arrayValues(value) {
  if (!value) {
    return []
  }
  if (Array.isArray(value)) {
    return value
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean)
  }
  if (typeof value === "object") {
    return Object.values(value)
  }
  return []
}

function readString(value) {
  if (typeof value === "string") {
    return value.trim()
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value)
  }
  return ""
}

function readInteger(value) {
  const parsed = Number.parseInt(readString(value), 10)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeExpertType(value, plugin) {
  if (value.toLowerCase() === "team" || plugin?.teamInfo) {
    return "team"
  }
  return "agent"
}

function slugify(value) {
  return readString(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function hash(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`
}

function stableStringify(value) {
  return JSON.stringify(sortObject(value))
}

function sortObject(value) {
  if (Array.isArray(value)) {
    return value.map(sortObject)
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]))
  }
  return value
}

function hasCJK(value) {
  return /[\u3400-\u9fff]/.test(value)
}

function firstHeading(markdown) {
  return markdown.split(/\r?\n/).find((line) => line.startsWith("# "))?.slice(2).trim() ?? ""
}

function countMcpServers(value) {
  if (value?.mcpServers && typeof value.mcpServers === "object") {
    return Object.keys(value.mcpServers).length
  }
  if (value?.servers && typeof value.servers === "object") {
    return Object.keys(value.servers).length
  }
  return 0
}

function today() {
  return new Date().toISOString().slice(0, 10).replaceAll("-", "")
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`)
  }
}

async function writeFixture(root) {
  await writeJson(join(root, "index.json"), {
    generatedAt: "2026-07-08T00:00:00.000Z",
    categories: [
      {
        id: "Engineering",
        name: { zh: "工程", en: "Engineering" },
        description: { zh: "工程专家", en: "Engineering experts" },
      },
    ],
    experts: [
      {
        id: "SoloExpert",
        slug: "solo-expert",
        categoryId: "Engineering",
        sourceFolder: "SoloExpert__solo-expert",
        expertType: "agent",
        displayName: { zh: "独立专家", en: "Solo Expert" },
        profession: { zh: "架构顾问", en: "Architecture Advisor" },
        description: { zh: "提供架构建议", en: "Provides architecture advice" },
      },
      {
        id: "TeamExpert",
        slug: "team-expert",
        categoryId: "Engineering",
        sourceFolder: "TeamExpert__team-expert",
        expertType: "team",
        displayName: { zh: "专家团队", en: "Expert Team" },
      },
      {
        id: "MissingExpert",
        slug: "missing-expert",
        categoryId: "Engineering",
        expertType: "agent",
      },
    ],
  })

  await writeJson(join(root, "expert_center.json"), { experts: [] })
  await writeJson(join(root, "experts", "SoloExpert__solo-expert", "manifest", "plugin.json"), {
    expertType: "agent",
    agentName: "solo",
    defaultInitPrompt: { zh: "帮我审查架构", en: "Review my architecture" },
    quickPrompts: [{ zh: "审查这个系统", en: "Review this system" }],
    tags: [{ zh: "架构", en: "Architecture" }],
  })
  await writeText(
    join(root, "experts", "SoloExpert__solo-expert", "manifest", "agents", "solo.md"),
    `---
name: solo
displayName: 独立专家
profession: 架构顾问
skills: [review]
maxTurns: 20
---
# Solo prompt
Follow AstraFlow rules and review architecture.
When the user asks whether this expert is active, include EXPERT_SUMMON_OK and the display name 独立专家.
`
  )
  await writeText(
    join(root, "experts", "SoloExpert__solo-expert", "manifest", "skills", "review", "SKILL.md"),
    `---
name: review
description: Architecture review checklist
---
# Architecture Review
Check tradeoffs.
`
  )
  await writeJson(join(root, "experts", "SoloExpert__solo-expert", "manifest", "mcp", ".mcp.json"), {
    mcpServers: { docs: { command: "docs" } },
  })

  await writeJson(join(root, "experts", "TeamExpert__team-expert", "manifest", "plugin.json"), {
    expertType: "team",
    agentName: "lead",
    teamInfo: {
      leadAgent: "lead",
      memberAgents: ["member"],
    },
    members: [
      { agentName: "lead", displayName: { zh: "组长", en: "Lead" }, profession: { zh: "总控", en: "Lead" } },
      { agentName: "member", displayName: { zh: "成员", en: "Member" }, profession: { zh: "执行", en: "Executor" } },
    ],
  })
  await writeText(
    join(root, "experts", "TeamExpert__team-expert", "prompts", "lead.md"),
    `---
name: lead
displayName: 组长
---
Lead prompt.
`
  )
  await writeText(
    join(root, "experts", "TeamExpert__team-expert", "prompts", "member.md"),
    `---
name: member
displayName: 成员
---
Member prompt.
`
  )
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
}

const expertSchemaSQL = `
CREATE TABLE IF NOT EXISTS expert_categories (
  id TEXT PRIMARY KEY,
  name_zh TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  description_zh TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  expert_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS experts (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'workbuddy',
  source_folder TEXT NOT NULL DEFAULT '',
  source_plugin JSONB NOT NULL DEFAULT '{}'::jsonb,
  type TEXT NOT NULL DEFAULT 'agent',
  status TEXT NOT NULL DEFAULT 'metadata_only',
  category_id TEXT NOT NULL DEFAULT '',
  display_name_zh TEXT NOT NULL DEFAULT '',
  display_name_en TEXT NOT NULL DEFAULT '',
  profession_zh TEXT NOT NULL DEFAULT '',
  profession_en TEXT NOT NULL DEFAULT '',
  description_zh TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  avatar_path TEXT NOT NULL DEFAULT '',
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  quick_prompts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_init_prompt_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  downloaded_file_count INTEGER NOT NULL DEFAULT 0,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  skill_file_count INTEGER NOT NULL DEFAULT 0,
  mcp_file_count INTEGER NOT NULL DEFAULT 0,
  member_count INTEGER NOT NULL DEFAULT 0,
  runtime_hash TEXT NOT NULL DEFAULT '',
  search_text TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expert_agents (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'single',
  display_name_zh TEXT NOT NULL DEFAULT '',
  display_name_en TEXT NOT NULL DEFAULT '',
  profession_zh TEXT NOT NULL DEFAULT '',
  profession_en TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  prompt_markdown TEXT NOT NULL DEFAULT '',
  frontmatter_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  skills_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  max_turns INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expert_skills (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  skill_slug TEXT NOT NULL DEFAULT '',
  relative_path TEXT NOT NULL DEFAULT '',
  skill_md TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expert_mcp_servers (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL DEFAULT '',
  mcp_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  server_count INTEGER NOT NULL DEFAULT 0,
  content_hash TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expert_team_members (
  id TEXT PRIMARY KEY,
  expert_id TEXT NOT NULL REFERENCES experts(id) ON DELETE CASCADE,
  agent_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member',
  display_name_zh TEXT NOT NULL DEFAULT '',
  display_name_en TEXT NOT NULL DEFAULT '',
  profession_zh TEXT NOT NULL DEFAULT '',
  profession_en TEXT NOT NULL DEFAULT '',
  avatar_path TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS expert_import_runs (
  id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL DEFAULT '',
  source_generated_at TEXT NOT NULL DEFAULT '',
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  expert_count INTEGER NOT NULL DEFAULT 0,
  downloaded_count INTEGER NOT NULL DEFAULT 0,
  metadata_only_count INTEGER NOT NULL DEFAULT 0,
  prompt_count INTEGER NOT NULL DEFAULT 0,
  skill_count INTEGER NOT NULL DEFAULT 0,
  mcp_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_experts_slug ON experts(slug);
CREATE INDEX IF NOT EXISTS idx_experts_category_status ON experts(category_id, status);
CREATE INDEX IF NOT EXISTS idx_experts_type_status ON experts(type, status);
CREATE INDEX IF NOT EXISTS idx_experts_runtime_hash ON experts(runtime_hash);
CREATE INDEX IF NOT EXISTS idx_expert_agents_expert_sort ON expert_agents(expert_id, sort_order, agent_name);
CREATE INDEX IF NOT EXISTS idx_expert_skills_expert_slug ON expert_skills(expert_id, skill_slug);
CREATE INDEX IF NOT EXISTS idx_expert_mcp_expert ON expert_mcp_servers(expert_id);
CREATE INDEX IF NOT EXISTS idx_expert_team_members_expert_sort ON expert_team_members(expert_id, sort_order);
`

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
