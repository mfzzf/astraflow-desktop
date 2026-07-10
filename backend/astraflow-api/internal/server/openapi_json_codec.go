package server

import (
	"encoding/json"

	"github.com/go-kratos/kratos/v3/encoding"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

// openAPIJSONCodec keeps application/json aligned with protobuf's canonical
// JSON mapping, which is also what protoc-gen-openapi publishes.
type openAPIJSONCodec struct{}

func init() {
	encoding.RegisterCodec(openAPIJSONCodec{})
}

func (openAPIJSONCodec) Name() string {
	return "json"
}

func (openAPIJSONCodec) Marshal(value any) ([]byte, error) {
	if message, ok := value.(proto.Message); ok {
		return (protojson.MarshalOptions{EmitUnpopulated: true}).Marshal(message)
	}

	return json.Marshal(value)
}

func (openAPIJSONCodec) Unmarshal(data []byte, value any) error {
	if len(data) == 0 {
		return nil
	}
	if message, ok := value.(proto.Message); ok {
		return (protojson.UnmarshalOptions{DiscardUnknown: true}).Unmarshal(data, message)
	}

	return json.Unmarshal(data, value)
}
