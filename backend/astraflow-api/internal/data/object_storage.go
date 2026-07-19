package data

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"

	"astraflow-api/internal/biz"
)

const (
	awsAlgorithm     = "AWS4-HMAC-SHA256"
	awsRequestType   = "aws4_request"
	awsService       = "s3"
	emptyPayloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
)

type artifactObjectStore struct {
	endpoint      *url.URL
	bucket        string
	region        string
	accessKey     string
	secretKey     string
	sessionToken  string
	publicAPIBase string
	httpClient    *http.Client
	now           func() time.Time
	configured    bool
}

// NewArtifactObjectStore returns an S3-compatible object store. Storage is
// optional at process startup so API instances that do not expose artifact
// endpoints remain usable; artifact operations fail closed until every
// required storage setting is present.
func NewArtifactObjectStore() (biz.ArtifactObjectStore, error) {
	endpointValue := strings.TrimSpace(os.Getenv("ASTRAFLOW_OBJECT_STORAGE_ENDPOINT"))
	bucket := strings.TrimSpace(os.Getenv("ASTRAFLOW_OBJECT_STORAGE_BUCKET"))
	region := strings.TrimSpace(os.Getenv("ASTRAFLOW_OBJECT_STORAGE_REGION"))
	accessKey := strings.TrimSpace(os.Getenv("ASTRAFLOW_OBJECT_STORAGE_ACCESS_KEY"))
	secretKey := strings.TrimSpace(os.Getenv("ASTRAFLOW_OBJECT_STORAGE_SECRET_KEY"))
	publicAPIBase := strings.TrimRight(strings.TrimSpace(os.Getenv("ASTRAFLOW_PUBLIC_API_BASE_URL")), "/")

	store := &artifactObjectStore{
		bucket: bucket, region: region, accessKey: accessKey, secretKey: secretKey,
		sessionToken:  strings.TrimSpace(os.Getenv("ASTRAFLOW_OBJECT_STORAGE_SESSION_TOKEN")),
		publicAPIBase: publicAPIBase,
		httpClient:    &http.Client{Timeout: 30 * time.Second},
		now:           time.Now,
	}
	values := []string{endpointValue, bucket, region, accessKey, secretKey}
	nonEmpty := 0
	for _, value := range values {
		if value != "" {
			nonEmpty++
		}
	}
	if nonEmpty == 0 {
		return store, nil
	}
	if nonEmpty != len(values) {
		return nil, errors.New("object storage configuration is incomplete")
	}
	endpoint, err := url.Parse(endpointValue)
	if err != nil || endpoint.Host == "" || endpoint.RawQuery != "" || endpoint.Fragment != "" {
		return nil, errors.New("object storage endpoint is invalid")
	}
	if endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && isLoopbackHost(endpoint.Hostname())) {
		return nil, errors.New("object storage endpoint must use HTTPS outside localhost")
	}
	if strings.ContainsAny(bucket, "/\\\x00\r\n") {
		return nil, errors.New("object storage bucket is invalid")
	}
	if publicAPIBase != "" {
		publicURL, err := url.Parse(publicAPIBase)
		if err != nil || publicURL.Host == "" || (publicURL.Scheme != "https" && !(publicURL.Scheme == "http" && isLoopbackHost(publicURL.Hostname()))) {
			return nil, errors.New("public API base URL must use HTTPS outside localhost")
		}
	}
	endpoint.Path = strings.TrimRight(endpoint.Path, "/")
	endpoint.RawPath = ""
	store.endpoint = endpoint
	store.configured = true
	return store, nil
}

func (store *artifactObjectStore) PresignUpload(_ context.Context, objectKey, mimeType, sha string, size int64, ttl time.Duration) (*biz.ObjectPresign, error) {
	if err := store.requireConfigured(); err != nil {
		return nil, err
	}
	headers := map[string]string{
		"content-type":      mimeType,
		"x-amz-meta-sha256": strings.ToLower(sha),
		"x-amz-meta-size":   strconv.FormatInt(size, 10),
	}
	signedURL, expiresAt, err := store.presign(http.MethodPut, objectKey, headers, nil, ttl)
	if err != nil {
		return nil, err
	}
	return &biz.ObjectPresign{
		URL: signedURL,
		Headers: map[string]string{
			"Content-Type":      mimeType,
			"x-amz-meta-sha256": strings.ToLower(sha),
			"x-amz-meta-size":   strconv.FormatInt(size, 10),
		},
		ExpiresAt: expiresAt,
	}, nil
}

func (store *artifactObjectStore) VerifyUpload(ctx context.Context, objectKey string, expectedSize int64, expectedSHA string) error {
	if err := store.requireConfigured(); err != nil {
		return err
	}
	requestURL := store.objectURL(objectKey)
	now := store.now().UTC()
	request, err := http.NewRequestWithContext(ctx, http.MethodHead, requestURL.String(), nil)
	if err != nil {
		return err
	}
	payloadHash := emptyPayloadHash
	request.Header.Set("x-amz-content-sha256", payloadHash)
	request.Header.Set("x-amz-date", now.Format("20060102T150405Z"))
	if store.sessionToken != "" {
		request.Header.Set("x-amz-security-token", store.sessionToken)
	}
	signedHeaders, canonicalHeaders := canonicalHeaders(request.Host, request.Header)
	canonicalRequest := strings.Join([]string{
		request.Method,
		canonicalPath(requestURL),
		canonicalQuery(requestURL.Query()),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")
	date := now.Format("20060102")
	scope := date + "/" + store.region + "/" + awsService + "/" + awsRequestType
	stringToSign := awsAlgorithm + "\n" + now.Format("20060102T150405Z") + "\n" + scope + "\n" + sha256Hex(canonicalRequest)
	signature := hex.EncodeToString(hmacSHA256(store.signingKey(date), stringToSign))
	request.Header.Set("Authorization", awsAlgorithm+" Credential="+store.accessKey+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)

	response, err := store.httpClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
		return fmt.Errorf("object verification returned HTTP %d", response.StatusCode)
	}
	if response.ContentLength != expectedSize {
		return fmt.Errorf("object size mismatch: got %d, want %d", response.ContentLength, expectedSize)
	}
	actualSHA := strings.TrimSpace(response.Header.Get("x-amz-meta-sha256"))
	if actualSHA == "" || !strings.EqualFold(actualSHA, expectedSHA) {
		return errors.New("object SHA-256 metadata mismatch")
	}
	return nil
}

func (store *artifactObjectStore) PresignDownload(_ context.Context, objectKey, fileName string, ttl time.Duration) (*biz.ObjectPresign, error) {
	if err := store.requireConfigured(); err != nil {
		return nil, err
	}
	fileName = strings.ReplaceAll(fileName, `"`, `\"`)
	query := url.Values{"response-content-disposition": {`attachment; filename="` + fileName + `"`}}
	signedURL, expiresAt, err := store.presign(http.MethodGet, objectKey, nil, query, ttl)
	if err != nil {
		return nil, err
	}
	return &biz.ObjectPresign{URL: signedURL, ExpiresAt: expiresAt}, nil
}

func (store *artifactObjectStore) PublicShareURL(token string) string {
	path := "/v1/public/artifacts/" + url.PathEscape(token)
	if store.publicAPIBase == "" {
		return path
	}
	return store.publicAPIBase + path
}

func (store *artifactObjectStore) presign(method, objectKey string, headers map[string]string, extraQuery url.Values, ttl time.Duration) (string, time.Time, error) {
	if ttl <= 0 || ttl > 7*24*time.Hour {
		return "", time.Time{}, errors.New("object URL lifetime is invalid")
	}
	now := store.now().UTC()
	requestURL := store.objectURL(objectKey)
	query := requestURL.Query()
	for key, values := range extraQuery {
		for _, value := range values {
			query.Add(key, value)
		}
	}
	date := now.Format("20060102")
	scope := date + "/" + store.region + "/" + awsService + "/" + awsRequestType
	headerValues := make(http.Header, len(headers))
	for key, value := range headers {
		headerValues.Set(key, value)
	}
	signedHeaders, canonicalHeaderBlock := canonicalHeaders(requestURL.Host, headerValues)
	query.Set("X-Amz-Algorithm", awsAlgorithm)
	query.Set("X-Amz-Credential", store.accessKey+"/"+scope)
	query.Set("X-Amz-Date", now.Format("20060102T150405Z"))
	query.Set("X-Amz-Expires", strconv.FormatInt(int64(ttl/time.Second), 10))
	query.Set("X-Amz-SignedHeaders", signedHeaders)
	if store.sessionToken != "" {
		query.Set("X-Amz-Security-Token", store.sessionToken)
	}
	canonicalRequest := strings.Join([]string{
		method,
		canonicalPath(requestURL),
		canonicalQuery(query),
		canonicalHeaderBlock,
		signedHeaders,
		"UNSIGNED-PAYLOAD",
	}, "\n")
	stringToSign := awsAlgorithm + "\n" + now.Format("20060102T150405Z") + "\n" + scope + "\n" + sha256Hex(canonicalRequest)
	query.Set("X-Amz-Signature", hex.EncodeToString(hmacSHA256(store.signingKey(date), stringToSign)))
	requestURL.RawQuery = canonicalQuery(query)
	return requestURL.String(), now.Add(ttl), nil
}

func (store *artifactObjectStore) signingKey(date string) []byte {
	dateKey := hmacSHA256([]byte("AWS4"+store.secretKey), date)
	regionKey := hmacSHA256(dateKey, store.region)
	serviceKey := hmacSHA256(regionKey, awsService)
	return hmacSHA256(serviceKey, awsRequestType)
}

func (store *artifactObjectStore) objectURL(objectKey string) *url.URL {
	result := *store.endpoint
	segments := append([]string{store.bucket}, strings.Split(strings.TrimLeft(objectKey, "/"), "/")...)
	escaped := make([]string, 0, len(segments))
	for _, segment := range segments {
		escaped = append(escaped, url.PathEscape(segment))
	}
	result.RawPath = strings.TrimRight(store.endpoint.EscapedPath(), "/") + "/" + strings.Join(escaped, "/")
	decoded, err := url.PathUnescape(result.RawPath)
	if err == nil {
		result.Path = decoded
	}
	return &result
}

func (store *artifactObjectStore) requireConfigured() error {
	if store == nil || !store.configured || store.endpoint == nil {
		return errors.New("object storage is not configured")
	}
	return nil
}

func canonicalHeaders(host string, headers http.Header) (string, string) {
	values := map[string]string{"host": strings.TrimSpace(host)}
	for key, entries := range headers {
		name := strings.ToLower(strings.TrimSpace(key))
		if name == "authorization" || name == "" {
			continue
		}
		joined := strings.Join(entries, ",")
		values[name] = strings.Join(strings.Fields(joined), " ")
	}
	names := make([]string, 0, len(values))
	for name := range values {
		names = append(names, name)
	}
	sort.Strings(names)
	var block strings.Builder
	for _, name := range names {
		block.WriteString(name)
		block.WriteByte(':')
		block.WriteString(values[name])
		block.WriteByte('\n')
	}
	return strings.Join(names, ";"), block.String()
}

func canonicalPath(value *url.URL) string {
	path := value.EscapedPath()
	if path == "" {
		return "/"
	}
	return path
}

func canonicalQuery(values url.Values) string {
	return strings.ReplaceAll(values.Encode(), "+", "%20")
}

func sha256Hex(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func hmacSHA256(key []byte, value string) []byte {
	digest := hmac.New(sha256.New, key)
	_, _ = digest.Write([]byte(value))
	return digest.Sum(nil)
}

func isLoopbackHost(host string) bool {
	if strings.EqualFold(host, "localhost") {
		return true
	}
	address := net.ParseIP(host)
	return address != nil && address.IsLoopback()
}
