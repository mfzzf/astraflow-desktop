package server

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"astraflow-api/internal/biz"

	kerrors "github.com/go-kratos/kratos/v3/errors"
	"github.com/gorilla/websocket"
)

const (
	deviceRelayProtocolVersion = 1
	deviceRelayWriteTimeout    = 10 * time.Second
	deviceRelayReadTimeout     = 60 * time.Second
	deviceRelayAccessCheck     = 5 * time.Second
)

type DeviceRelayHandler struct {
	logger   *slog.Logger
	usecase  *biz.CrossDeviceUsecase
	upgrader websocket.Upgrader
}

type relayClientMessage struct {
	Type      string         `json:"type"`
	Signature string         `json:"signature,omitempty"`
	CommandID string         `json:"commandId,omitempty"`
	Status    string         `json:"status,omitempty"`
	Result    map[string]any `json:"result,omitempty"`
}

func NewDeviceRelayHandler(logger *slog.Logger, usecase *biz.CrossDeviceUsecase) *DeviceRelayHandler {
	return &DeviceRelayHandler{
		logger:  logger,
		usecase: usecase,
		upgrader: websocket.Upgrader{
			HandshakeTimeout: 10 * time.Second,
			CheckOrigin: func(request *http.Request) bool {
				return strings.TrimSpace(request.Header.Get("Origin")) == ""
			},
		},
	}
}

func (handler *DeviceRelayHandler) ServeHTTP(response http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(response, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := deviceTokenFromRequest(request)
	if token == "" {
		http.Error(response, "device authorization is required", http.StatusUnauthorized)
		return
	}
	identity, err := handler.usecase.ConsumeDeviceConnectionToken(request.Context(), token)
	if err != nil {
		http.Error(response, "device authorization is invalid", http.StatusUnauthorized)
		return
	}
	connection, err := handler.upgrader.Upgrade(response, request, nil)
	if err != nil {
		return
	}
	defer connection.Close()
	connection.SetReadLimit(64 << 10)
	if err := handler.authenticate(connection, identity); err != nil {
		handler.logger.Warn("device relay challenge failed", "device_id", identity.DeviceID, "error", err)
		_ = connection.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "device challenge failed"), time.Now().Add(time.Second))
		return
	}
	// Kratos applies the ordinary request timeout to custom handlers as well.
	// After the authenticated upgrade, the relay lifetime is governed by
	// WebSocket read/write deadlines, so preserve request values but detach the
	// short request deadline.
	ctx, cancel := newDeviceRelayContext(request.Context())
	defer cancel()
	if err := handler.usecase.TouchDevice(ctx, identity); err != nil {
		if deviceAccessRevoked(err) {
			writeDeviceRevokedClose(connection)
		}
		return
	}

	writesDone := make(chan error, 1)
	go func() {
		err := handler.writeLoop(ctx, connection, identity)
		if err != nil {
			_ = connection.Close()
		}
		writesDone <- err
	}()
	for {
		connection.SetReadDeadline(time.Now().Add(deviceRelayReadTimeout))
		message := relayClientMessage{}
		if err := connection.ReadJSON(&message); err != nil {
			cancel()
			<-writesDone
			return
		}
		switch message.Type {
		case "client.heartbeat":
			if err := handler.usecase.TouchDevice(ctx, identity); deviceAccessRevoked(err) {
				writeDeviceRevokedClose(connection)
				cancel()
				<-writesDone
				return
			}
		case "client.command_status":
			if err := handler.usecase.UpdateDeviceCommand(ctx, identity, message.CommandID, message.Status, message.Result); err != nil {
				handler.logger.Warn("device command status rejected", "device_id", identity.DeviceID, "command_id", message.CommandID, "error", err)
			}
		default:
			handler.logger.Warn("unsupported device relay message", "device_id", identity.DeviceID, "type", message.Type)
		}
	}
}

func newDeviceRelayContext(requestContext context.Context) (context.Context, context.CancelFunc) {
	return context.WithCancel(context.WithoutCancel(requestContext))
}

func (handler *DeviceRelayHandler) authenticate(connection *websocket.Conn, identity *biz.DeviceConnectionIdentity) error {
	challengeBytes := make([]byte, 32)
	if _, err := rand.Read(challengeBytes); err != nil {
		return err
	}
	challenge := base64.RawURLEncoding.EncodeToString(challengeBytes)
	connection.SetWriteDeadline(time.Now().Add(deviceRelayWriteTimeout))
	if err := connection.WriteJSON(map[string]any{
		"type": "server.challenge", "protocolVersion": deviceRelayProtocolVersion,
		"deviceId": identity.DeviceID, "challenge": challenge, "issuedAt": time.Now().UTC(),
	}); err != nil {
		return err
	}
	connection.SetReadDeadline(time.Now().Add(10 * time.Second))
	message := relayClientMessage{}
	if err := connection.ReadJSON(&message); err != nil {
		return err
	}
	if message.Type != "client.authenticate" || message.Signature == "" {
		return fmt.Errorf("client authentication response is missing")
	}
	if err := verifyDeviceChallenge(identity.PublicKey, identity.DeviceID, challenge, message.Signature); err != nil {
		return err
	}
	connection.SetWriteDeadline(time.Now().Add(deviceRelayWriteTimeout))
	return connection.WriteJSON(map[string]any{
		"type": "server.ready", "protocolVersion": deviceRelayProtocolVersion,
		"deviceId": identity.DeviceID, "heartbeatIntervalMs": 20_000,
	})
}

func verifyDeviceChallenge(encodedPublicKey, deviceID, challenge, encodedSignature string) error {
	publicKeyDER, err := base64.StdEncoding.DecodeString(encodedPublicKey)
	if err != nil {
		return fmt.Errorf("invalid registered public key: %w", err)
	}
	parsed, err := x509.ParsePKIXPublicKey(publicKeyDER)
	if err != nil {
		return fmt.Errorf("invalid registered public key: %w", err)
	}
	publicKey, ok := parsed.(ed25519.PublicKey)
	if !ok {
		return fmt.Errorf("registered public key is not Ed25519")
	}
	signature, err := base64.StdEncoding.DecodeString(encodedSignature)
	if err != nil {
		return fmt.Errorf("invalid challenge signature: %w", err)
	}
	signed := []byte("astraflow-device-relay-v1:" + deviceID + ":" + challenge)
	if !ed25519.Verify(publicKey, signed, signature) {
		return fmt.Errorf("challenge signature does not match registered device")
	}
	return nil
}

func (handler *DeviceRelayHandler) writeLoop(ctx context.Context, connection *websocket.Conn, identity *biz.DeviceConnectionIdentity) error {
	commandTicker := time.NewTicker(time.Second)
	accessTicker := time.NewTicker(deviceRelayAccessCheck)
	heartbeatTicker := time.NewTicker(20 * time.Second)
	defer commandTicker.Stop()
	defer accessTicker.Stop()
	defer heartbeatTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return nil
		case <-commandTicker.C:
			commands, err := handler.usecase.ClaimDeviceCommands(ctx, identity, 10)
			if err != nil {
				continue
			}
			for _, command := range commands {
				connection.SetWriteDeadline(time.Now().Add(deviceRelayWriteTimeout))
				if err := connection.WriteJSON(map[string]any{
					"type": "server.command",
					"command": map[string]any{
						"id": command.ID, "runId": command.RunID, "type": command.Type,
						"payload": command.Payload, "attempt": command.Attempts, "createdAt": command.CreatedAt,
					},
				}); err != nil {
					return err
				}
			}
		case <-accessTicker.C:
			if err := handler.usecase.TouchDevice(ctx, identity); deviceAccessRevoked(err) {
				writeDeviceRevokedClose(connection)
				return err
			}
		case <-heartbeatTicker.C:
			connection.SetWriteDeadline(time.Now().Add(deviceRelayWriteTimeout))
			if err := connection.WriteJSON(map[string]any{
				"type": "server.heartbeat", "sentAt": time.Now().UTC(),
			}); err != nil {
				return err
			}
		}
	}
}

func deviceAccessRevoked(err error) bool {
	return err != nil && kerrors.FromError(err).Code == 404
}

func writeDeviceRevokedClose(connection *websocket.Conn) {
	_ = connection.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.ClosePolicyViolation, "device access revoked"),
		time.Now().Add(time.Second),
	)
}

func deviceTokenFromRequest(request *http.Request) string {
	authorization := strings.TrimSpace(request.Header.Get("Authorization"))
	if len(authorization) <= len("Device ") || !strings.EqualFold(authorization[:len("Device ")], "Device ") {
		return ""
	}
	return strings.TrimSpace(authorization[len("Device "):])
}
