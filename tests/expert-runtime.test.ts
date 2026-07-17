// @ts-expect-error Bun provides this module at test runtime; the app tsconfig does not load Bun's ambient types.
import { describe, expect, test } from "bun:test"

import { createExpertRuntimeSystemPrompt } from "@/lib/agent/expert-runtime"

describe("expert runtime prompt", () => {
  test("preserves production-sized single-agent instructions", () => {
    const longPrompt = `# Compliance expert\n${"detailed rule\n".repeat(1_500)}`
    const prompt = createExpertRuntimeSystemPrompt({
      expert: {
        id: "HealthcareMarketingComplianceExpert",
        type: "agent",
        displayName: { zh: "医疗营销合规专家" },
      },
      agents: [
        {
          agentName: "compliance-expert",
          role: "primary",
          promptMarkdown: longPrompt,
        },
      ],
    })

    expect(longPrompt.length).toBeGreaterThan(12_000)
    expect(prompt).toContain(longPrompt)
    expect(prompt).not.toContain("...[truncated]")
  })

  test("separates a team lead prompt from member delegation profiles", () => {
    const prompt = createExpertRuntimeSystemPrompt({
      expert: { id: "ContentTeam", type: "team" },
      team: {
        leadAgent: "team-lead",
        memberAgents: ["researcher"],
      },
      agents: [
        {
          agentName: "team-lead",
          role: "lead",
          promptMarkdown: "Coordinate the answer.",
        },
        {
          agentName: "researcher",
          role: "member",
          maxTurns: 12,
          promptMarkdown: "Research source-backed evidence.",
        },
      ],
    })

    expect(prompt).toContain('<expert_lead_prompt agent="team-lead"')
    expect(prompt).toContain('<expert_member_profile agent="researcher"')
    expect(prompt).toContain("member_agents: researcher")
    expect(prompt).toContain("call the task tool")
    expect(prompt).toContain("max_turns: 12")
  })

  test("exposes connector requirements without leaking connector config", () => {
    const prompt = createExpertRuntimeSystemPrompt({
      expert: { id: "DesignToCodeExpert", type: "agent" },
      agents: [
        {
          agentName: "designer",
          promptMarkdown: "Convert designs to code.",
        },
      ],
      mcpServers: [
        {
          id: "design-converter",
          mcpJson: JSON.stringify({
            mcpServers: {
              "design-converter": {
                command: "converter",
                env: { SECRET_TOKEN: "must-not-reach-model" },
              },
            },
          }),
        },
      ],
    })

    expect(prompt).toContain("<expert_connector_requirements>")
    expect(prompt).toContain("design-converter")
    expect(prompt).toContain("does not auto-enable")
    expect(prompt).not.toContain("must-not-reach-model")
    expect(prompt).not.toContain("SECRET_TOKEN")
  })
})
