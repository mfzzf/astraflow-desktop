package data

import (
	"strings"
	"testing"

	"astraflow-api/internal/biz"
)

func TestExpertWhereSearchEscapesLikePercents(t *testing.T) {
	where, args := expertWhere(biz.ExpertListFilter{
		Query: "aa",
	})

	if where != "WHERE search_text ILIKE '%' || $1 || '%'" {
		t.Fatalf("unexpected where clause: %q", where)
	}
	if len(args) != 1 || args[0] != "aa" {
		t.Fatalf("unexpected args: %#v", args)
	}
	if strings.Contains(where, "%!") {
		t.Fatalf("where clause contains fmt error marker: %q", where)
	}
}

func TestExpertWhereSearchPlaceholderAfterFilters(t *testing.T) {
	where, args := expertWhere(biz.ExpertListFilter{
		CategoryID: "engineering",
		Type:       "agent",
		Status:     "downloaded",
		Query:      "aa",
	})

	expected := "WHERE category_id = $1 AND type = $2 AND status = $3 AND search_text ILIKE '%' || $4 || '%'"
	if where != expected {
		t.Fatalf("unexpected where clause:\nwant %q\n got %q", expected, where)
	}
	if len(args) != 4 || args[3] != "aa" {
		t.Fatalf("unexpected args: %#v", args)
	}
	if strings.Contains(where, "%!") {
		t.Fatalf("where clause contains fmt error marker: %q", where)
	}
}
