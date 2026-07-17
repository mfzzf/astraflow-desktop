package biz

import (
	"reflect"
	"testing"
)

func TestNormalizeSkillMarketplaceFilterDefaultsToPopular(t *testing.T) {
	filter := normalizeSkillMarketplaceFilter(MarketplaceListFilter{
		Category:    " dev-programming ",
		SubCategory: " dev-bug-fix ",
	})

	if filter.OrderBy != "popular" {
		t.Fatalf("OrderBy = %q, want popular", filter.OrderBy)
	}
	if filter.Category != "dev-programming" || filter.SubCategory != "dev-bug-fix" {
		t.Fatalf("filter = %#v", filter)
	}
}

func TestNormalizeSkillMarketplaceFilterAcceptsV2Orderings(t *testing.T) {
	for _, orderBy := range []string{"popular", "recent", "stars", "name"} {
		filter := normalizeSkillMarketplaceFilter(MarketplaceListFilter{OrderBy: orderBy})
		if filter.OrderBy != orderBy {
			t.Fatalf("OrderBy = %q, want %q", filter.OrderBy, orderBy)
		}
	}
}

func TestNormalizeMcpMarketplaceFilterNormalizesSupportedFilters(t *testing.T) {
	filter := normalizeMcpMarketplaceFilter(MarketplaceListFilter{
		OrderBy:       "popular",
		RegistryTypes: []string{" npm ", "npm", "cargo"},
		Transports:    []string{"sse", "invalid"},
		Statuses:      []string{"active", "deleted", "unknown"},
	})

	if filter.OrderBy != "recent" {
		t.Fatalf("OrderBy = %q, want recent", filter.OrderBy)
	}
	if !reflect.DeepEqual(filter.RegistryTypes, []string{"npm", "cargo"}) {
		t.Fatalf("RegistryTypes = %#v", filter.RegistryTypes)
	}
	if !reflect.DeepEqual(filter.Transports, []string{"sse"}) {
		t.Fatalf("Transports = %#v", filter.Transports)
	}
	if !reflect.DeepEqual(filter.Statuses, []string{"active", "deleted"}) {
		t.Fatalf("Statuses = %#v", filter.Statuses)
	}
}
