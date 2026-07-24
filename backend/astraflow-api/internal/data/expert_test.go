package data

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"astraflow-api/internal/biz"
)

func TestExpertRepoListExpertsCallsPublicUCloudMarket(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", request.Method)
		}
		if authorization := request.Header.Get("Authorization"); authorization != "" {
			t.Fatalf("Authorization header = %q, want empty", authorization)
		}

		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		for key, want := range map[string]any{
			"Action":  "DescribeExpertMarket",
			"Backend": "DevPortal",
			"Keyword": "terminal",
			"Offset":  float64(0),
			"Limit":   float64(2),
		} {
			if got := body[key]; got != want {
				t.Fatalf("%s = %#v, want %#v", key, got, want)
			}
		}
		for key, want := range map[string][]any{
			"Category":        {"developer"},
			"ExpertType":      {"agent"},
			"ExcludeKeywords": {},
		} {
			if got := body[key]; !reflect.DeepEqual(got, want) {
				t.Fatalf("%s = %#v, want %#v", key, got, want)
			}
		}
		if _, ok := body["_timestamp"].(float64); !ok {
			t.Fatalf("_timestamp = %#v, want number", body["_timestamp"])
		}
		if _, exists := body["ProjectId"]; exists {
			t.Fatal("ProjectId must not be sent for the public expert market action")
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"RetCode": 0,
			"TotalCount": 3,
			"Experts": [
				{
					"SourceId": "upstream-1",
					"Slug": "terminal-veteran",
					"Plugin": "developer-experts",
					"Version": "1.2.0",
					"Type": "agent",
					"Status": "complete",
					"DisplayName": {"Zh": "终端老兵", "En": "Terminal Veteran"},
					"Profession": {"Zh": "终端专家", "En": "Terminal specialist"},
					"Description": {"Zh": "处理终端任务", "En": "Handles terminal tasks"},
					"CategoryId": "developer",
					"Tags": [{"Zh": "终端", "En": "Terminal"}],
					"QuickPrompts": [{"Zh": "检查终端", "En": "Inspect terminal"}],
					"Skills": [{"Name": "shell-debug", "Path": "skills/shell-debug/SKILL.md"}],
					"Artifact": {
						"IconUrl": "https://example.com/terminal.png",
						"Checksum": "sha256:terminal"
					},
					"UpstreamUpdatedAt": 1784880000000
				},
				{
					"SourceId": "upstream-2",
					"Slug": "terminal-team",
					"Type": "team",
					"Status": "metadata_only",
					"DisplayName": {"En": "Terminal Team"},
					"MemberCount": 2
				}
			],
			"AllCategories": [{
				"Id": "developer",
				"Name": {"Zh": "开发", "En": "Development"},
				"Sort": 10,
				"UpdatedAt": 1784880000
			}]
		}`))
	}))
	defer server.Close()

	repo := NewExpertRepo(&Data{
		marketHTTPClient:     server.Client(),
		ucloudMarketEndpoint: server.URL,
	})
	result, err := repo.ListExperts(context.Background(), biz.ExpertListFilter{
		PageSize:   2,
		CategoryID: "developer",
		Type:       "agent",
		Query:      "terminal",
	})
	if err != nil {
		t.Fatalf("ListExperts: %v", err)
	}
	if result.TotalSize != 3 || len(result.Experts) != 2 || result.NextPageToken != "2" {
		t.Fatalf("result = %#v, want two of three experts and next token 2", result)
	}

	expert := result.Experts[0]
	if expert.ID != "terminal-veteran" || expert.Source != "upstream-1" {
		t.Fatalf("expert identity = %#v", expert)
	}
	if !expert.RuntimeAvailable || expert.PromptCount != 1 || expert.SkillCount != 1 {
		t.Fatalf("expert runtime metadata = %#v", expert)
	}
	if expert.AvatarPath != "https://example.com/terminal.png" || expert.RuntimeHash != "sha256:terminal" {
		t.Fatalf("expert artifact mapping = %#v", expert)
	}
	if result.CatalogHash == "" || result.CatalogVersion == "" {
		t.Fatalf("catalog metadata = %#v", result)
	}
}

func TestExpertRepoListCategoriesUsesMarketFacets(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["Action"] != "DescribeExpertMarket" || body["Limit"] != float64(1) {
			t.Fatalf("unexpected action payload: %#v", body)
		}

		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
			"RetCode": 0,
			"TotalCount": 20,
			"Experts": [],
			"AllCategories": [{
				"Id": "developer",
				"Name": {"Zh": "开发", "En": "Development"},
				"Description": {"Zh": "开发专家", "En": "Developer experts"},
				"Sort": 3,
				"UpdatedAt": 1784880000
			}]
		}`))
	}))
	defer server.Close()

	repo := NewExpertRepo(&Data{
		marketHTTPClient:     server.Client(),
		ucloudMarketEndpoint: server.URL,
	})
	categories, meta, err := repo.ListCategories(context.Background())
	if err != nil {
		t.Fatalf("ListCategories: %v", err)
	}
	if len(categories) != 1 || categories[0].ID != "developer" || categories[0].NameZh != "开发" {
		t.Fatalf("categories = %#v", categories)
	}
	if meta.Hash == "" || meta.Updated.IsZero() {
		t.Fatalf("catalog metadata = %#v", meta)
	}
}

func TestExpertRepoDetailAndRuntimeUseArtifactPackage(t *testing.T) {
	requestCount := 0
	artifactRequestCount := 0
	archive := testExpertArchive(t, map[string]string{
		"agents/lead.md":                      "# Lead\n\nCoordinate the review.",
		"agents/reviewer.md":                  "# Reviewer\n\nReview every command.",
		"skills/shell-debug/SKILL.md":         "# Shell Debug\n\nInspect shell failures.",
		"mcp/connectors/.mcp.json":            `{"mcpServers":{"terminal":{"command":"terminal"}}}`,
		"references/not-loaded-by-runtime.md": "ignored",
	})
	checksum := fmt.Sprintf("%x", sha256.Sum256(archive))
	var server *httptest.Server
	server = httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodGet {
			artifactRequestCount++
			writer.Header().Set("Content-Type", "application/zip")
			_, _ = writer.Write(archive)
			return
		}

		requestCount++
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["Action"] != "DescribeExpertDetail" || body["Backend"] != "DevPortal" {
			t.Fatalf("unexpected action payload: %#v", body)
		}
		if body["Slug"] != "terminal-team" {
			t.Fatalf("Slug = %#v, want terminal-team", body["Slug"])
		}

		writer.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(writer).Encode(map[string]any{
			"RetCode": 0,
			"Expert": map[string]any{
				"SourceId":          "upstream-team",
				"Slug":              "terminal-team",
				"Plugin":            "developer-experts",
				"Version":           "2.0.0",
				"Type":              "team",
				"Status":            "complete",
				"DisplayName":       map[string]string{"Zh": "终端团队", "En": "Terminal Team"},
				"Profession":        map[string]string{"Zh": "终端协作团队", "En": "Terminal team"},
				"DefaultInitPrompt": map[string]string{"Zh": "检查当前终端", "En": "Inspect the terminal"},
				"PrimaryAgent":      "lead",
				"Members": []map[string]any{
					{
						"Id":         "lead",
						"AgentName":  "lead",
						"Name":       map[string]string{"Zh": "召集人", "En": "Lead"},
						"Profession": map[string]string{"Zh": "团队召集", "En": "Team lead"},
						"Role":       "lead",
					},
					{
						"Id":         "member-1",
						"AgentName":  "reviewer",
						"Name":       map[string]string{"Zh": "审查员", "En": "Reviewer"},
						"Profession": map[string]string{"Zh": "命令审查", "En": "Command reviewer"},
						"Role":       "member",
						"AvatarUrl":  "https://example.com/reviewer.png",
						"PromptPath": "agents/reviewer.md",
					},
				},
				"Team": map[string]any{
					"LeadAgent":    "lead",
					"MemberAgents": []string{"reviewer"},
				},
				"Skills": []map[string]any{{
					"Name":        map[string]string{"En": "shell-debug"},
					"Path":        "skills/shell-debug",
					"Description": map[string]string{"Zh": "调试 shell", "En": "Debug shell"},
				}},
				"Artifact": map[string]any{
					"ArchiveUrl": server.URL + "/expert/terminal-team/revision/package.zip",
					"Checksum":   checksum,
					"SizeBytes":  len(archive),
				},
				"UpstreamUpdatedAt": 1784880000,
			},
			"ExpertMd": "# Terminal Team\n\nPublic expert summary.",
		})
	}))
	defer server.Close()

	repo := NewExpertRepo(&Data{
		marketHTTPClient:     server.Client(),
		ucloudMarketEndpoint: server.URL,
	}).(*expertRepo)
	repo.artifactURLAllowed = func(rawURL string) bool {
		return strings.HasPrefix(rawURL, server.URL+"/expert/")
	}
	detail, err := repo.GetExpert(context.Background(), "terminal-team")
	if err != nil {
		t.Fatalf("GetExpert: %v", err)
	}
	if len(detail.Agents) != 2 || detail.Agents[0].PromptMarkdown == "" || detail.Agents[0].Role != "lead" {
		t.Fatalf("agents = %#v", detail.Agents)
	}
	if strings.Contains(detail.Agents[0].PromptMarkdown, "Public expert summary") {
		t.Fatal("public EXPERT.md summary must not replace the packaged agent prompt")
	}
	if len(detail.Skills) != 1 || detail.Skills[0].SkillSlug != "shell-debug" || detail.Skills[0].SkillMarkdown == "" {
		t.Fatalf("skills = %#v", detail.Skills)
	}
	if len(detail.McpServers) != 1 || detail.McpServers[0].ServerCount != 1 {
		t.Fatalf("MCP servers = %#v", detail.McpServers)
	}
	if len(detail.TeamMembers) != 2 || detail.TeamMembers[1].AgentName != "reviewer" {
		t.Fatalf("team members = %#v", detail.TeamMembers)
	}

	runtime, err := repo.GetExpertRuntime(context.Background(), "terminal-team")
	if err != nil {
		t.Fatalf("GetExpertRuntime: %v", err)
	}
	if runtime.Team.LeadAgent != "lead" || !reflect.DeepEqual(runtime.Team.MemberAgents, []string{"reviewer"}) {
		t.Fatalf("runtime team = %#v", runtime.Team)
	}
	if runtime.Expert.RuntimeHash != checksum || len(runtime.Agents) != 2 {
		t.Fatalf("runtime = %#v", runtime)
	}
	if requestCount != 2 {
		t.Fatalf("request count = %d, want 2", requestCount)
	}
	if artifactRequestCount != 1 {
		t.Fatalf("artifact request count = %d, want cached single fetch", artifactRequestCount)
	}
}

func TestReadExpertArtifactZipRejectsTraversal(t *testing.T) {
	archive := testExpertArchive(t, map[string]string{
		"../agents/escape.md": "unsafe",
	})
	if _, err := readExpertArtifactZip(archive); err == nil {
		t.Fatal("readExpertArtifactZip unexpectedly accepted a traversal path")
	}
}

func TestVerifyExpertArtifactChecksumRejectsMismatch(t *testing.T) {
	if err := verifyExpertArtifactChecksum([]byte("artifact"), strings.Repeat("0", 64)); err == nil {
		t.Fatal("verifyExpertArtifactChecksum unexpectedly accepted a mismatched checksum")
	}
}

func testExpertArchive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for name, content := range files {
		file, err := writer.Create(name)
		if err != nil {
			t.Fatalf("create zip file %s: %v", name, err)
		}
		if _, err := file.Write([]byte(content)); err != nil {
			t.Fatalf("write zip file %s: %v", name, err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close zip: %v", err)
	}
	return buffer.Bytes()
}
