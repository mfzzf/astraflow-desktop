package data

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"path"
	"sort"
	"strings"
	"sync"
)

const (
	maxExpertArchiveBytes            = 32 * 1024 * 1024
	maxExpertArchiveFiles            = 1024
	maxExpertArchiveUncompressed     = 128 * 1024 * 1024
	maxExpertRuntimeFileBytes        = 4 * 1024 * 1024
	maxCachedExpertArtifactRevisions = 128
	trustedExpertArtifactHost        = "devportal.cn-wlcb.ufileos.com"
)

type expertArtifactPrompt struct {
	Path      string
	AgentName string
	Markdown  string
}

type expertArtifactSkillFile struct {
	Path     string
	Markdown string
}

type expertArtifactMcpFile struct {
	Path string
	JSON string
}

type expertArtifactRuntime struct {
	AgentPrompts []expertArtifactPrompt
	SkillFiles   []expertArtifactSkillFile
	McpFiles     []expertArtifactMcpFile
}

type expertArtifactCache struct {
	mu      sync.Mutex
	entries map[string]*expertArtifactRuntime
}

func (cache *expertArtifactCache) get(key string) *expertArtifactRuntime {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	return cache.entries[key]
}

func (cache *expertArtifactCache) put(key string, artifact *expertArtifactRuntime) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if cache.entries == nil || len(cache.entries) >= maxCachedExpertArtifactRevisions {
		cache.entries = make(map[string]*expertArtifactRuntime)
	}
	cache.entries[key] = artifact
}

func (r *expertRepo) loadExpertArtifact(ctx context.Context, expert expertPO) (*expertArtifactRuntime, error) {
	archiveURL := strings.TrimSpace(expert.Artifact.ArchiveURL)
	if archiveURL == "" {
		return &expertArtifactRuntime{}, nil
	}
	if r.data == nil || r.data.marketHTTPClient == nil {
		return nil, fmt.Errorf("expert artifact HTTP client is not configured")
	}
	if r.artifactURLAllowed == nil || !r.artifactURLAllowed(archiveURL) {
		return nil, fmt.Errorf("expert artifact URL is not allowed")
	}
	if expert.Artifact.SizeBytes > maxExpertArchiveBytes {
		return nil, fmt.Errorf("expert artifact is too large")
	}

	cacheKey := firstNonEmpty(expert.Artifact.Checksum, expert.Artifact.Revision, archiveURL)
	if cached := r.artifactCache.get(cacheKey); cached != nil {
		return cached, nil
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodGet, archiveURL, nil)
	if err != nil {
		return nil, fmt.Errorf("create expert artifact request: %w", err)
	}
	request.Header.Set("Accept", "application/zip, application/octet-stream")

	response, err := r.data.marketHTTPClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("fetch expert artifact: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("fetch expert artifact: HTTP %d", response.StatusCode)
	}
	if response.Request == nil || response.Request.URL == nil || !r.artifactURLAllowed(response.Request.URL.String()) {
		return nil, fmt.Errorf("expert artifact redirect is not allowed")
	}

	raw, err := io.ReadAll(io.LimitReader(response.Body, maxExpertArchiveBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read expert artifact: %w", err)
	}
	if len(raw) > maxExpertArchiveBytes {
		return nil, fmt.Errorf("expert artifact is too large")
	}
	if err := verifyExpertArtifactChecksum(raw, expert.Artifact.Checksum); err != nil {
		return nil, err
	}

	artifact, err := readExpertArtifactZip(raw)
	if err != nil {
		return nil, err
	}
	r.artifactCache.put(cacheKey, artifact)
	return artifact, nil
}

func isTrustedExpertArtifactURL(rawURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return false
	}
	return parsed.Scheme == "https" &&
		parsed.User == nil &&
		strings.EqualFold(parsed.Hostname(), trustedExpertArtifactHost) &&
		(parsed.Port() == "" || parsed.Port() == "443") &&
		strings.HasPrefix(parsed.EscapedPath(), "/expert/")
}

func verifyExpertArtifactChecksum(raw []byte, expected string) error {
	expected = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(expected)), "sha256:")
	if expected == "" {
		return nil
	}
	if len(expected) != sha256.Size*2 {
		return fmt.Errorf("expert artifact checksum is invalid")
	}
	if _, err := hex.DecodeString(expected); err != nil {
		return fmt.Errorf("expert artifact checksum is invalid")
	}
	actual := sha256.Sum256(raw)
	if hex.EncodeToString(actual[:]) != expected {
		return fmt.Errorf("expert artifact checksum mismatch")
	}
	return nil
}

func readExpertArtifactZip(raw []byte) (*expertArtifactRuntime, error) {
	reader, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return nil, fmt.Errorf("open expert artifact: %w", err)
	}
	if len(reader.File) > maxExpertArchiveFiles {
		return nil, fmt.Errorf("expert artifact contains too many files")
	}

	var uncompressed uint64
	artifact := &expertArtifactRuntime{}
	for _, file := range reader.File {
		uncompressed += file.UncompressedSize64
		if uncompressed > maxExpertArchiveUncompressed {
			return nil, fmt.Errorf("expert artifact expands beyond the allowed size")
		}
		if file.FileInfo().IsDir() {
			continue
		}

		filePath, ok := safeExpertArtifactPath(file.Name)
		if !ok {
			return nil, fmt.Errorf("expert artifact contains an unsafe path")
		}
		kind := expertRuntimeFileKind(filePath)
		if kind == "" {
			continue
		}
		if file.UncompressedSize64 > maxExpertRuntimeFileBytes {
			return nil, fmt.Errorf("expert runtime file is too large: %s", filePath)
		}

		content, err := readExpertZipFile(file)
		if err != nil {
			return nil, fmt.Errorf("read expert runtime file %s: %w", filePath, err)
		}
		switch kind {
		case "agent":
			artifact.AgentPrompts = append(artifact.AgentPrompts, expertArtifactPrompt{
				Path:      filePath,
				AgentName: strings.TrimSuffix(path.Base(filePath), path.Ext(filePath)),
				Markdown:  content,
			})
		case "skill":
			artifact.SkillFiles = append(artifact.SkillFiles, expertArtifactSkillFile{
				Path:     filePath,
				Markdown: content,
			})
		case "mcp":
			artifact.McpFiles = append(artifact.McpFiles, expertArtifactMcpFile{
				Path: filePath,
				JSON: content,
			})
		}
	}

	sort.Slice(artifact.AgentPrompts, func(i, j int) bool {
		return artifact.AgentPrompts[i].Path < artifact.AgentPrompts[j].Path
	})
	sort.Slice(artifact.SkillFiles, func(i, j int) bool {
		return artifact.SkillFiles[i].Path < artifact.SkillFiles[j].Path
	})
	sort.Slice(artifact.McpFiles, func(i, j int) bool {
		return artifact.McpFiles[i].Path < artifact.McpFiles[j].Path
	})
	return artifact, nil
}

func safeExpertArtifactPath(value string) (string, bool) {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	cleaned := path.Clean(value)
	if cleaned == "." ||
		strings.HasPrefix(cleaned, "/") ||
		cleaned == ".." ||
		strings.HasPrefix(cleaned, "../") {
		return "", false
	}
	return cleaned, true
}

func expertRuntimeFileKind(filePath string) string {
	lower := strings.ToLower(filePath)
	if strings.HasSuffix(lower, ".md") &&
		(strings.HasPrefix(lower, "agents/") || strings.HasPrefix(lower, "prompts/")) {
		return "agent"
	}
	if strings.HasPrefix(lower, "skills/") && strings.HasSuffix(lower, "/skill.md") {
		return "skill"
	}
	if (strings.HasPrefix(lower, "mcp/") || strings.Contains(lower, "/mcp/")) &&
		strings.HasSuffix(lower, ".mcp.json") {
		return "mcp"
	}
	return ""
}

func readExpertZipFile(file *zip.File) (string, error) {
	reader, err := file.Open()
	if err != nil {
		return "", err
	}
	defer reader.Close()
	content, err := io.ReadAll(io.LimitReader(reader, maxExpertRuntimeFileBytes+1))
	if err != nil {
		return "", err
	}
	if len(content) > maxExpertRuntimeFileBytes {
		return "", fmt.Errorf("file exceeds the allowed size")
	}
	return string(content), nil
}

func artifactSkillMarkdown(artifact *expertArtifactRuntime, declaredPath, slug string) (string, string) {
	if artifact == nil {
		return "", ""
	}
	declaredPath = strings.TrimPrefix(path.Clean(strings.TrimSpace(declaredPath)), "./")
	for _, file := range artifact.SkillFiles {
		parent := path.Dir(file.Path)
		if declaredPath != "" && (parent == declaredPath || file.Path == declaredPath) {
			return file.Markdown, file.Path
		}
		if slug != "" && path.Base(parent) == slug {
			return file.Markdown, file.Path
		}
	}
	return "", ""
}
