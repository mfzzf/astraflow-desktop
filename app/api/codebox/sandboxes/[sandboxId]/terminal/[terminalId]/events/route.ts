import { subscribeCodeBoxTerminalSession } from "@/lib/codebox-runtime"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type TerminalEventsRouteContext = {
  params: Promise<{ sandboxId: string; terminalId: string }>
}

const encoder = new TextEncoder()

function encodeEvent(event: string, data: unknown) {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
}

export async function GET(
  _request: Request,
  context: TerminalEventsRouteContext
) {
  const { sandboxId, terminalId } = await context.params
  const decodedSandboxId = decodeURIComponent(sandboxId)
  const decodedTerminalId = decodeURIComponent(terminalId)

  try {
    let unsubscribe: (() => void) | null = null
    let heartbeat: ReturnType<typeof setInterval> | null = null
    let closed = false
    function cleanup() {
      closed = true
      unsubscribe?.()
      if (heartbeat) {
        clearInterval(heartbeat)
      }
    }

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        function enqueue(chunk: Uint8Array) {
          if (closed) {
            return
          }

          try {
            controller.enqueue(chunk)
          } catch {
            cleanup()
          }
        }

        enqueue(encoder.encode(": connected\n\n"))
        unsubscribe = subscribeCodeBoxTerminalSession({
          sandboxId: decodedSandboxId,
          terminalId: decodedTerminalId,
          onEvent: (event) => {
            enqueue(
              encodeEvent(event.type === "error" ? "failure" : event.type, event)
            )
          },
        })
        heartbeat = setInterval(() => {
          enqueue(encoder.encode(": keep-alive\n\n"))
        }, 15_000)
      },
      cancel() {
        cleanup()
      },
    })

    return new Response(stream, {
      headers: {
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream; charset=utf-8",
        "X-Accel-Buffering": "no",
      },
    })
  } catch (error) {
    return Response.json(
      {
        ok: false,
        message:
          error instanceof Error
            ? error.message
            : "Terminal event stream failed.",
      },
      { status: error instanceof Error ? 400 : 500 }
    )
  }
}
