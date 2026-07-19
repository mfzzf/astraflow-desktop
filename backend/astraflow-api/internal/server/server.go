package server

import (
	"github.com/google/wire"
)

// ProviderSet is server providers.
var ProviderSet = wire.NewSet(NewDeviceRelayHandler, NewSyncStreamHandler, NewPushDispatcher, NewAutomationScheduler, NewGRPCServer, NewHTTPServer)
