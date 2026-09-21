import type { NextRequest } from "next/server";
import { DEFAULT_FALLBACK_CHAIN, type FallbackModel } from "@/lib/models";
import { streamWithFallback, type ChatMessage, type StreamFrame } from "@/lib/openrouter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MESSAGES = 64;
const MAX_MESSAGE_CHARS = 32_000;
const MAX_CHAIN = 12;
const ROLES = new Set<ChatMessage["role"]>(["system", "user", "assistant"]);

type RawBody = {
  messages?: unknown;
  models?: unknown;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return sseError(
      "OPENROUTER_API_KEY is not set on the server. Add it to .env.local (dev) or the deployment environment (prod) and restart.",
    );
  }

  let raw: RawBody;
  try {
    raw = (await req.json()) as RawBody;
  } catch {
    return sseError("Invalid JSON body.");
  }

  const messages = validateMessages(raw.messages);
  if (typeof messages === "string") return sseError(messages);

  const chain = validateChain(raw.models);
  if (typeof chain === "string") return sseError(chain);

  const referer = process.env.OPENROUTER_HTTP_REFERER;
  const title = process.env.OPENROUTER_APP_TITLE ?? "OpenRouter Fallback Chat";

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (frame: StreamFrame) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
        } catch {
          closed = true;
        }
      };
      try {
        await streamWithFallback({
          apiKey,
          messages,
          chain,
          send,
          signal: req.signal,
          referer,
          title,
        });
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        send({ type: "done" });
        if (!closed) {
          closed = true;
          try {
            controller.close();
          } catch {
            /* noop */
          }
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function validateMessages(raw: unknown): ChatMessage[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return "`messages` must be a non-empty array.";
  if (raw.length > MAX_MESSAGES) return `Too many messages (max ${MAX_MESSAGES}).`;
  const out: ChatMessage[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") return `messages[${i}] is not an object.`;
    const m = item as { role?: unknown; content?: unknown };
    if (typeof m.role !== "string" || !ROLES.has(m.role as ChatMessage["role"])) {
      return `messages[${i}].role must be "system", "user", or "assistant".`;
    }
    if (typeof m.content !== "string") return `messages[${i}].content must be a string.`;
    if (m.content.length > MAX_MESSAGE_CHARS) return `messages[${i}].content exceeds ${MAX_MESSAGE_CHARS} chars.`;
    out.push({ role: m.role as ChatMessage["role"], content: m.content });
  }
  return out;
}

function validateChain(raw: unknown): FallbackModel[] | string {
  if (raw === undefined || raw === null) return DEFAULT_FALLBACK_CHAIN;
  if (!Array.isArray(raw)) return "`models` must be an array of { id, label }.";
  if (raw.length === 0) return DEFAULT_FALLBACK_CHAIN;
  if (raw.length > MAX_CHAIN) return `Too many models in chain (max ${MAX_CHAIN}).`;
  const out: FallbackModel[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== "object") return `models[${i}] is not an object.`;
    const m = item as { id?: unknown; label?: unknown };
    if (typeof m.id !== "string" || m.id.trim() === "") return `models[${i}].id must be a non-empty string.`;
    const label = typeof m.label === "string" && m.label.trim() !== "" ? m.label : m.id;
    out.push({ id: m.id, label });
  }
  return out;
}

function sseError(message: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const frames: StreamFrame[] = [
        { type: "error", message },
        { type: "done" },
      ];
      for (const f of frames) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(f)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
