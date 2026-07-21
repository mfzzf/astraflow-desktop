package main

import "testing"

func TestCleanTitle(t *testing.T) {
	got := cleanTitle("“单卡部署 ASR 与标题模型”\n额外解释", 12)
	if got != "单卡部署 ASR 与标题" {
		t.Fatalf("cleanTitle() = %q", got)
	}
}

func TestHostAllowedRequiresConfiguredSuffix(t *testing.T) {
	if hostAllowed("bucket.example.com", nil) {
		t.Fatal("hostAllowed() accepted a host without an allowlist")
	}
	if !hostAllowed("bucket.example.com", []string{"example.com"}) {
		t.Fatal("hostAllowed() rejected a subdomain of an allowed suffix")
	}
	if hostAllowed("example.com.attacker.test", []string{"example.com"}) {
		t.Fatal("hostAllowed() accepted a suffix confusion host")
	}
}

func TestSplitRunesPreservesUnicode(t *testing.T) {
	got := splitRunes("甲乙丙丁戊", 2)
	if len(got) != 3 || got[0] != "甲乙" || got[2] != "戊" {
		t.Fatalf("splitRunes() = %#v", got)
	}
}
