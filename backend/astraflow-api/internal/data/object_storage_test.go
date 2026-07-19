package data

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

func setObjectStorageEnv(t *testing.T, endpoint string) {
	t.Helper()
	t.Setenv("ASTRAFLOW_OBJECT_STORAGE_ENDPOINT", endpoint)
	t.Setenv("ASTRAFLOW_OBJECT_STORAGE_BUCKET", "artifacts")
	t.Setenv("ASTRAFLOW_OBJECT_STORAGE_REGION", "cn-bj2")
	t.Setenv("ASTRAFLOW_OBJECT_STORAGE_ACCESS_KEY", "test-access")
	t.Setenv("ASTRAFLOW_OBJECT_STORAGE_SECRET_KEY", "test-secret")
}

func TestArtifactObjectStoreRejectsPartialAndInsecureConfiguration(t *testing.T) {
	t.Setenv("ASTRAFLOW_OBJECT_STORAGE_ENDPOINT", "https://storage.example")
	if _, err := NewArtifactObjectStore(); err == nil || !strings.Contains(err.Error(), "incomplete") {
		t.Fatalf("NewArtifactObjectStore() partial error = %v", err)
	}

	setObjectStorageEnv(t, "http://storage.example")
	if _, err := NewArtifactObjectStore(); err == nil || !strings.Contains(err.Error(), "HTTPS") {
		t.Fatalf("NewArtifactObjectStore() insecure error = %v", err)
	}
}

func TestArtifactObjectStorePresignsUploadAndDownload(t *testing.T) {
	setObjectStorageEnv(t, "https://storage.example/base")
	t.Setenv("ASTRAFLOW_OBJECT_STORAGE_SESSION_TOKEN", "session-token")
	t.Setenv("ASTRAFLOW_PUBLIC_API_BASE_URL", "https://api.example")
	value, err := NewArtifactObjectStore()
	if err != nil {
		t.Fatalf("NewArtifactObjectStore() error = %v", err)
	}
	store := value.(*artifactObjectStore)
	store.now = func() time.Time { return time.Date(2026, 7, 19, 1, 2, 3, 0, time.UTC) }

	upload, err := store.PresignUpload(context.Background(), "accounts/a/file name.txt", "text/plain", strings.Repeat("a", 64), 42, 15*time.Minute)
	if err != nil {
		t.Fatalf("PresignUpload() error = %v", err)
	}
	parsed, err := url.Parse(upload.URL)
	if err != nil {
		t.Fatalf("url.Parse() error = %v", err)
	}
	if parsed.Path != "/base/artifacts/accounts/a/file name.txt" || parsed.Query().Get("X-Amz-Algorithm") != awsAlgorithm || parsed.Query().Get("X-Amz-Expires") != "900" || parsed.Query().Get("X-Amz-Security-Token") != "session-token" || parsed.Query().Get("X-Amz-Signature") == "" {
		t.Fatalf("PresignUpload() URL = %s", upload.URL)
	}
	if upload.Headers["x-amz-meta-size"] != "42" || upload.Headers["x-amz-meta-sha256"] != strings.Repeat("a", 64) {
		t.Fatalf("PresignUpload() headers = %#v", upload.Headers)
	}

	download, err := store.PresignDownload(context.Background(), "accounts/a/result.pdf", "result.pdf", 5*time.Minute)
	if err != nil {
		t.Fatalf("PresignDownload() error = %v", err)
	}
	if !strings.Contains(download.URL, "response-content-disposition=") {
		t.Fatalf("PresignDownload() URL = %s", download.URL)
	}
	if got := store.PublicShareURL("share token"); got != "https://api.example/v1/public/artifacts/share%20token" {
		t.Fatalf("PublicShareURL() = %q", got)
	}
}

func TestArtifactObjectStoreVerifiesObjectMetadata(t *testing.T) {
	var sawAuthorization bool
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		sawAuthorization = strings.HasPrefix(request.Header.Get("Authorization"), awsAlgorithm+" ")
		response.Header().Set("Content-Length", "7")
		response.Header().Set("x-amz-meta-sha256", strings.Repeat("b", 64))
		response.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	setObjectStorageEnv(t, server.URL)
	value, err := NewArtifactObjectStore()
	if err != nil {
		t.Fatalf("NewArtifactObjectStore() error = %v", err)
	}
	store := value.(*artifactObjectStore)
	store.now = func() time.Time { return time.Date(2026, 7, 19, 1, 2, 3, 0, time.UTC) }

	if err := store.VerifyUpload(context.Background(), "accounts/a/object", 7, strings.Repeat("b", 64)); err != nil {
		t.Fatalf("VerifyUpload() error = %v", err)
	}
	if !sawAuthorization {
		t.Fatal("VerifyUpload() did not sign the HEAD request")
	}
	if err := store.VerifyUpload(context.Background(), "accounts/a/object", 8, strings.Repeat("b", 64)); err == nil || !strings.Contains(err.Error(), "size mismatch") {
		t.Fatalf("VerifyUpload() size error = %v", err)
	}
	if err := store.VerifyUpload(context.Background(), "accounts/a/object", 7, strings.Repeat("c", 64)); err == nil || !strings.Contains(err.Error(), "SHA-256") {
		t.Fatalf("VerifyUpload() hash error = %v", err)
	}
}
