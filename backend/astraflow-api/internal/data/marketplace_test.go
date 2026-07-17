package data

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"astraflow-api/internal/biz"
)

func TestMarketplaceRepoListMcpsCallsUnauthenticatedUCloudAction(t *testing.T) {
	t.Helper()

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
			"Action":  "DescribeMcpMarket",
			"Backend": "DevPortal",
			"Keyword": "paybond",
			"OrderBy": "recent",
		} {
			if got := body[key]; got != want {
				t.Fatalf("%s = %#v, want %#v", key, got, want)
			}
		}
		if _, ok := body["_timestamp"].(float64); !ok {
			t.Fatalf("_timestamp = %#v, want number", body["_timestamp"])
		}
		if _, exists := body["ProjectId"]; exists {
			t.Fatal("ProjectId must not be sent for the public marketplace action")
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
          "RetCode": 0,
          "Message": "Success",
          "TotalCount": 1,
          "Mcps": [{
            "Name": "io.github.nonameuserd/paybond",
            "Title": "Paybond MCP Server",
            "Version": "0.12.7",
            "Transports": ["stdio"],
            "IsLatest": true,
            "ServerJsonUrl": "https://devportal.cn-wlcb.ufileos.com/mcp/io.github.nonameuserd/paybond/0.12.7/server.json"
          }],
          "AllRegistryTypes": ["npm"],
          "AllTransports": ["stdio"]
        }`))
	}))
	defer server.Close()

	repo := NewMarketplaceRepo(&Data{
		marketHTTPClient:     server.Client(),
		ucloudMarketEndpoint: server.URL,
	})
	result, err := repo.ListMcps(context.Background(), biz.MarketplaceListFilter{
		Keyword: "paybond",
		OrderBy: "recent",
		Offset:  0,
		Limit:   20,
	})
	if err != nil {
		t.Fatalf("ListMcps: %v", err)
	}
	if result.TotalCount != 1 || len(result.Mcps) != 1 {
		t.Fatalf("result = %#v, want one MCP", result)
	}
	if result.Mcps[0].Name != "io.github.nonameuserd/paybond" || !result.Mcps[0].IsLatest {
		t.Fatalf("MCP = %#v", result.Mcps[0])
	}
}

func TestMarketplaceRepoGetMcpDetailUsesDevPortalWithoutCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "" {
			t.Fatal("public DevPortal action must not contain Authorization")
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["Action"] != "DescribeMcpDetail" || body["Backend"] != "DevPortal" {
			t.Fatalf("unexpected action payload: %#v", body)
		}
		if body["Name"] != "io.github.nonameuserd/paybond" {
			t.Fatalf("unexpected MCP identity: %#v", body)
		}
		if _, exists := body["ProjectId"]; exists {
			t.Fatal("ProjectId must not be sent for the public marketplace action")
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
          "RetCode": 0,
          "Message": "Success",
          "Mcp": {
            "Name": "io.github.nonameuserd/paybond",
            "Title": "Paybond MCP Server",
            "IconUrl": "https://paybond.ai/icon.png",
            "RegistryTypes": ["npm", "pypi"]
          },
          "ServerJson": "{\"name\":\"io.github.nonameuserd/paybond\",\"packages\":[]}"
        }`))
	}))
	defer server.Close()

	repo := NewMarketplaceRepo(&Data{
		marketHTTPClient:     server.Client(),
		ucloudMarketEndpoint: server.URL,
	})
	detail, err := repo.GetMcpDetail(context.Background(), "io.github.nonameuserd/paybond")
	if err != nil {
		t.Fatalf("GetMcpDetail: %v", err)
	}
	if detail.Mcp.Title != "Paybond MCP Server" || detail.Mcp.IconURL == "" || detail.ServerJSON == "" {
		t.Fatalf("detail = %#v", detail)
	}
}

func TestMarketplaceRepoGetSkillDetailUsesSkillLabWithoutCredentials(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "" {
			t.Fatal("public SkillLab action must not contain Authorization")
		}
		var body map[string]any
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if body["Action"] != "DescribeSkillDetail" || body["Backend"] != "SkillLab" {
			t.Fatalf("unexpected action payload: %#v", body)
		}
		if body["Slug"] != "demo-skill" || body["Version"] != "1.2.3" {
			t.Fatalf("unexpected skill identity: %#v", body)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{
          "RetCode": 0,
          "Message": "Success",
          "Skill": {"Slug": "demo-skill", "Version": "1.2.3", "Name": "Demo"},
          "SkillMd": "---\nname: Demo\n---\n"
        }`))
	}))
	defer server.Close()

	repo := NewMarketplaceRepo(&Data{
		marketHTTPClient:     server.Client(),
		ucloudMarketEndpoint: server.URL,
	})
	detail, err := repo.GetSkillDetail(context.Background(), "demo-skill", "1.2.3")
	if err != nil {
		t.Fatalf("GetSkillDetail: %v", err)
	}
	if detail.Skill.Slug != "demo-skill" || detail.SkillMd == "" {
		t.Fatalf("detail = %#v", detail)
	}
}
