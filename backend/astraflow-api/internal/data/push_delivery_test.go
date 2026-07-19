package data

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"testing"
)

func TestPushTokenEncryptionRoundTrip(t *testing.T) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		t.Fatalf("generate key: %v", err)
	}
	t.Setenv("ASTRAFLOW_PUSH_TOKEN_SECRET_KEY", base64.StdEncoding.EncodeToString(key))
	ciphertext, nonce, err := encryptPushToken("ExponentPushToken[private]")
	if err != nil {
		t.Fatalf("encryptPushToken() error = %v", err)
	}
	if bytes.Contains(ciphertext, []byte("private")) {
		t.Fatal("ciphertext contains plaintext token")
	}
	token, err := decryptPushToken(ciphertext, nonce)
	if err != nil {
		t.Fatalf("decryptPushToken() error = %v", err)
	}
	if token != "ExponentPushToken[private]" {
		t.Fatalf("decryptPushToken() = %q", token)
	}
}

func TestPushTokenEncryptionRejectsInvalidKey(t *testing.T) {
	t.Setenv("ASTRAFLOW_PUSH_TOKEN_SECRET_KEY", "not-a-key")
	if _, _, err := encryptPushToken("token"); err == nil {
		t.Fatal("encryptPushToken() error = nil, want invalid key error")
	}
}
