package biz

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strconv"
	"strings"
	"time"

	kerrors "github.com/go-kratos/kratos/v3/errors"
)

const (
	ExpertStatusDownloaded   = "downloaded"
	ExpertStatusComplete     = "complete"
	ExpertStatusMetadataOnly = "metadata_only"
)

type LocalizedText struct {
	Zh string
	En string
}

type ExpertCategory struct {
	ID            string
	NameZh        string
	NameEn        string
	DescriptionZh string
	DescriptionEn string
	SortOrder     int32
	ExpertCount   int32
	UpdatedAt     time.Time
}

type ExpertListItem struct {
	ID                string
	Slug              string
	Source            string
	SourceFolder      string
	Type              string
	Status            string
	CategoryID        string
	DisplayNameZh     string
	DisplayNameEn     string
	ProfessionZh      string
	ProfessionEn      string
	DescriptionZh     string
	DescriptionEn     string
	AvatarPath        string
	Tags              []LocalizedText
	QuickPrompts      []LocalizedText
	PromptCount       int32
	SkillCount        int32
	McpCount          int32
	MemberCount       int32
	RuntimeHash       string
	RuntimeAvailable  bool
	UnavailableReason string
	UpdatedAt         time.Time
}

type ExpertListFilter struct {
	PageSize   int32
	PageToken  string
	CategoryID string
	Type       string
	Status     string
	Query      string
	OrderBy    string
	Locale     string
}

type ExpertListResult struct {
	Experts        []*ExpertListItem
	NextPageToken  string
	TotalSize      int32
	CatalogVersion string
	CatalogHash    string
	UpdatedAt      time.Time
}

type ExpertDetail struct {
	Summary           *ExpertListItem
	DefaultInitPrompt LocalizedText
	Agents            []*ExpertAgent
	Skills            []*ExpertSkill
	McpServers        []*ExpertMcpServer
	TeamMembers       []*ExpertTeamMember
	SourcePlugin      string
	CatalogHash       string
}

type ExpertAgent struct {
	ID              string
	ExpertID        string
	AgentName       string
	Role            string
	DisplayNameZh   string
	DisplayNameEn   string
	ProfessionZh    string
	ProfessionEn    string
	Description     string
	PromptMarkdown  string
	FrontmatterJSON string
	Skills          []string
	MaxTurns        int32
	SortOrder       int32
	ContentHash     string
}

type ExpertSkill struct {
	ID            string
	ExpertID      string
	SkillSlug     string
	RelativePath  string
	Title         string
	Description   string
	SkillMarkdown string
	MetadataJSON  string
	ContentHash   string
}

type ExpertMcpServer struct {
	ID           string
	ExpertID     string
	RelativePath string
	McpJSON      string
	ServerCount  int32
	ContentHash  string
}

type ExpertTeamMember struct {
	ID            string
	ExpertID      string
	AgentName     string
	Role          string
	DisplayNameZh string
	DisplayNameEn string
	ProfessionZh  string
	ProfessionEn  string
	AvatarPath    string
	SortOrder     int32
}

type ExpertRuntime struct {
	Expert     ExpertRuntimeSummary
	Agents     []*ExpertAgent
	Team       ExpertTeam
	Skills     []*ExpertSkill
	McpServers []*ExpertMcpServer
	Policy     ExpertRuntimePolicy
}

type ExpertRuntimeSummary struct {
	ID                string
	Type              string
	RuntimeHash       string
	DisplayName       LocalizedText
	Profession        LocalizedText
	DefaultInitPrompt LocalizedText
}

type ExpertTeam struct {
	LeadAgent    string
	MemberAgents []string
}

type ExpertRuntimePolicy struct {
	AllowRawPromptDisplay bool
	ToolScope             string
}

type ExpertCatalogMeta struct {
	Version string
	Hash    string
	Updated time.Time
}

type ExpertRepo interface {
	ListCategories(context.Context) ([]*ExpertCategory, *ExpertCatalogMeta, error)
	ListExperts(context.Context, ExpertListFilter) (*ExpertListResult, error)
	GetExpert(context.Context, string) (*ExpertDetail, error)
	GetExpertRuntime(context.Context, string) (*ExpertRuntime, error)
}

type ExpertUsecase struct {
	repo ExpertRepo
}

func NewExpertUsecase(repo ExpertRepo) *ExpertUsecase {
	return &ExpertUsecase{repo: repo}
}

func (uc *ExpertUsecase) ListCategories(ctx context.Context) ([]*ExpertCategory, *ExpertCatalogMeta, error) {
	return uc.repo.ListCategories(ctx)
}

func (uc *ExpertUsecase) ListExperts(ctx context.Context, filter ExpertListFilter) (*ExpertListResult, error) {
	filter.PageSize = normalizePageSize(filter.PageSize)
	filter.Locale = normalizeLocale(filter.Locale)
	return uc.repo.ListExperts(ctx, filter)
}

func (uc *ExpertUsecase) GetExpert(ctx context.Context, expertID string) (*ExpertDetail, error) {
	expertID = strings.TrimSpace(expertID)
	if expertID == "" {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "expert_id is required")
	}
	return uc.repo.GetExpert(ctx, expertID)
}

func (uc *ExpertUsecase) GetExpertRuntime(ctx context.Context, expertID string) (*ExpertRuntime, error) {
	expertID = strings.TrimSpace(expertID)
	if expertID == "" {
		return nil, kerrors.BadRequest("INVALID_ARGUMENT", "expert_id is required")
	}
	return uc.repo.GetExpertRuntime(ctx, expertID)
}

func Localize(text LocalizedText, locale string) string {
	if normalizeLocale(locale) == "en" {
		if text.En != "" {
			return text.En
		}
		return text.Zh
	}
	if text.Zh != "" {
		return text.Zh
	}
	return text.En
}

func LocalizeList(items []LocalizedText, locale string) []string {
	values := make([]string, 0, len(items))
	for _, item := range items {
		value := strings.TrimSpace(Localize(item, locale))
		if value != "" {
			values = append(values, value)
		}
	}
	return values
}

func CatalogHash(parts []string) string {
	sum := sha256.Sum256([]byte(strings.Join(parts, "\n")))
	return "sha256:" + hex.EncodeToString(sum[:])
}

func OffsetFromPageToken(token string) (int32, error) {
	token = strings.TrimSpace(token)
	if token == "" {
		return 0, nil
	}
	offset, err := strconv.ParseInt(token, 10, 32)
	if err != nil || offset < 0 {
		return 0, fmt.Errorf("invalid page token")
	}
	return int32(offset), nil
}

func normalizePageSize(pageSize int32) int32 {
	if pageSize <= 0 {
		return 10
	}
	if pageSize > 50 {
		return 50
	}
	return pageSize
}

func normalizeLocale(locale string) string {
	if strings.EqualFold(strings.TrimSpace(locale), "en") {
		return "en"
	}
	return "zh"
}
