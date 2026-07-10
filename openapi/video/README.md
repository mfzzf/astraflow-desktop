# Video OpenAPI profiles

The OpenAPI documents in this directory are the source of truth for Studio
video generation. Every supported submit operation must declare an
operation-level `x-astraflow-profile`; the frontend and server must not infer
media roles from a model name or attachment index.

Run the full generator and contract checks after changing a document:

```bash
bun run codegen:video-openapi
```

That command regenerates the OpenAPI TypeScript declarations and
`lib/generated/video-openapi-fields.ts`, then verifies every profile, every
documented submit example, and a generated request fixture for every available
input mode.

## Profile shape

```yaml
x-astraflow-profile:
  version: 1
  defaultMode: reference-images
  modes:
    - id: reference-images
      promptRequired: true
      label: { zh: 多图参考, en: Reference images }
      media:
        - id: images
          field: input.content
          mediaKind: image
          serializer: tagged-content-array
          acceptedSources: [url, data-url, file]
          minItems: 1
          roles: { kind: repeat, value: reference_image }
  constraints: []
```

Use modes to describe distinct provider capabilities such as text-to-video,
first-frame, first-and-last-frame, reference media, video editing, lip sync,
and multi-shot generation. A mode can declare image, video, audio, or mixed
media fields, structured JSON fields, prompt requirements, MIME and size
limits, and an unavailable gate when the upstream request shape is not known.

Supported media serializers are:

- `direct-url`
- `url-array`
- `tagged-content-array`
- `array-object`
- `base64-object`
- `raw-base64-or-url`
- `multipart-file`

Use constraints for `required-any`, field dependencies, mutually exclusive
media roles, conditional allowed values and ranges, required parameters, and
fields that must be set or omitted for a mode. Structured fields retain their
dereferenced OpenAPI schema and are validated with JSON Schema before submit.

## Adding or changing a model

1. Keep the submit request, submit response, status response, and examples
   accurate in the OpenAPI document.
2. Add or update the complete `x-astraflow-profile`; do not add model-specific
   branches to the React workbench or video submit service.
3. Ensure every media field points to a real request-schema path and has an
   explicit serializer and source policy.
4. Represent conditional provider behavior with profile modes and constraints,
   not prose parsing.
5. Run `bun run codegen:video-openapi`, `bun run typecheck`, and `bun run lint`.

The UI remains a single generic workbench. If one marketplace model maps to
multiple OpenAPI submit operations, the generated metadata exposes them as
capabilities in the same model selector.
