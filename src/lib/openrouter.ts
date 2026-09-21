import type { FallbackModel } from "./models";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type StreamFrame =
  | {
      type: "status";
      stage: "starting" | "switching" | "failed" | "exhausted";
      model?: string;
      label?: string;
      message: string;
    }
  | { type: "model"; model: string; label: string; attempt: number }
  | { type: "content"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "reset"; reason: string }
  | { type: "usage"; usage: unknown }
  | { type: "error"; message: string }
  | { type: "done" };

type Send = (frame: StreamFrame) => void;

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_DEAD_AIR_MS = 30_000;

type StreamArgs = {
  apiKey: string;
  messages: ChatMessage[];
  chain: FallbackModel[];
  send: Send;
  signal?: AbortSignal;
  referer?: string;
  title?: string;
  deadAirMs?: number;
};

type AttemptCallbacks = {
  onContent: (delta: string) => void;
  onReasoning: (delta: string) => void;
  onUsage: (usage: unknown) => void;
};

type AttemptOutcome =
  | { kind: "success" }
  | { kind: "http_error"; status: number; reason: string }
  | { kind: "stream_error"; reason: string }
  | { kind: "aborted"; upstream: boolean };

export async function streamWithFallback({
  apiKey,
  messages,
  chain,
  send,
  signal,
  referer,
  title,
  deadAirMs = DEFAULT_DEAD_AIR_MS,
}: StreamArgs): Promise<void> {
  let contentEmitted = false;

  for (let i = 0; i < chain.length; i++) {
    if (signal?.aborted) return;
    const model = chain[i];
    const isFirst = i === 0;

    if (isFirst) {
      send({
        type: "status",
        stage: "starting",
        model: model.id,
        label: model.label,
        message: `Contacting ${model.label}…`,
      });
    } else {
      send({
        type: "status",
        stage: "switching",
        model: model.id,
        label: model.label,
        message: `Switching to ${model.label}…`,
      });
      if (contentEmitted) {
        send({ type: "reset", reason: "model-switch" });
        contentEmitted = false;
      }
    }

    const outcome = await attemptModel({
      apiKey,
      model,
      messages,
      signal,
      referer,
      title,
      deadAirMs,
      callbacks: {
        onContent: (delta) => {
          contentEmitted = true;
          send({ type: "content", delta });
        },
        onReasoning: (delta) => send({ type: "reasoning", delta }),
        onUsage: (usage) => send({ type: "usage", usage }),
      },
    });

    if (outcome.kind === "success") return;
    if (outcome.kind === "aborted" && outcome.upstream) return;

    const reason = describeOutcome(outcome);
    logSwitch(model, reason, i, chain.length);
    send({
      type: "status",
      stage: "failed",
      model: model.id,
      label: model.label,
      message: `${model.label} unavailable: ${reason}. Falling back…`,
    });
  }

  send({
    type: "status",
    stage: "exhausted",
    message: "All models in the fallback chain failed.",
  });
}

type AttemptArgs = {
  apiKey: string;
  model: FallbackModel;
  messages: ChatMessage[];
  signal?: AbortSignal;
  referer?: string;
  title?: string;
  deadAirMs: number;
  callbacks: AttemptCallbacks;
};

async function attemptModel(args: AttemptArgs): Promise<AttemptOutcome> {
  const { apiKey, model, messages, signal, referer, title, deadAirMs, callbacks } = args;

  const attemptCtrl = new AbortController();
  const linkUpstream = () => attemptCtrl.abort();
  signal?.addEventListener("abort", linkUpstream);

  let stallHandle: ReturnType<typeof setTimeout> | null = null;
  let stalled = false;
  const bumpStall = () => {
    if (stallHandle) clearTimeout(stallHandle);
    stallHandle = setTimeout(() => {
      stalled = true;
      attemptCtrl.abort();
    }, deadAirMs);
  };
  const clearStall = () => {
    if (stallHandle) clearTimeout(stallHandle);
    stallHandle = null;
  };

  try {
    bumpStall();
    let res: Response;
    try {
      res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          ...(referer ? { "HTTP-Referer": referer } : {}),
          ...(title ? { "X-Title": title } : {}),
        },
        body: JSON.stringify({ model: model.id, messages, stream: true }),
        signal: attemptCtrl.signal,
      });
    } catch (e) {
      if (signal?.aborted) return { kind: "aborted", upstream: true };
      if (stalled) return { kind: "stream_error", reason: `no response within ${deadAirMs}ms` };
      return { kind: "stream_error", reason: e instanceof Error ? e.message : String(e) };
    }

    bumpStall();

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      return { kind: "http_error", status: res.status, reason: extractReason(res.status, text) };
    }

    return await pumpSSE(res.body, callbacks, bumpStall, signal, () => stalled);
  } finally {
    clearStall();
    signal?.removeEventListener("abort", linkUpstream);
  }
}

async function pumpSSE(
  body: ReadableStream<Uint8Array>,
  cb: AttemptCallbacks,
  bumpStall: () => void,
  upstream: AbortSignal | undefined,
  wasStalled: () => boolean,
): Promise<AttemptOutcome> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawDone = false;
  let sawAnyPayload = false;
  let streamError: string | null = null;

  try {
    outer: while (true) {
      let read: ReadableStreamReadResult<Uint8Array>;
      try {
        read = await reader.read();
      } catch (e) {
        if (upstream?.aborted) return { kind: "aborted", upstream: true };
        if (wasStalled()) return { kind: "stream_error", reason: "stalled (no data received)" };
        return { kind: "stream_error", reason: e instanceof Error ? e.message : String(e) };
      }
      const { value, done } = read;
      if (done) break;
      bumpStall();
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        for (const line of part.split(/\r?\n/)) {
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            sawDone = true;
            continue;
          }
          let json: {
            error?: { message?: string; code?: number };
            choices?: Array<{ delta?: { content?: string; reasoning?: string } }>;
            usage?: unknown;
          };
          try {
            json = JSON.parse(data);
          } catch {
            continue;
          }
          if (json.error) {
            streamError = json.error.message ?? "provider streamed an error";
            break outer;
          }
          sawAnyPayload = true;
          const delta = json.choices?.[0]?.delta ?? {};
          if (typeof delta.reasoning === "string" && delta.reasoning.length) {
            cb.onReasoning(delta.reasoning);
          }
          if (typeof delta.content === "string" && delta.content.length) {
            cb.onContent(delta.content);
          }
          if (json.usage) cb.onUsage(json.usage);
        }
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }

  if (streamError) return { kind: "stream_error", reason: streamError };
  if (sawDone || sawAnyPayload) return { kind: "success" };
  return { kind: "stream_error", reason: "empty stream" };
}

function describeOutcome(o: Exclude<AttemptOutcome, { kind: "success" }>): string {
  if (o.kind === "http_error") return `HTTP ${o.status} — ${o.reason}`;
  if (o.kind === "aborted") return "aborted";
  return o.reason;
}

function extractReason(status: number, text: string): string {
  if (!text) return `status ${status}`;
  try {
    const j = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return j.error?.message ?? j.message ?? text.slice(0, 200);
  } catch {
    return text.slice(0, 200);
  }
}

function logSwitch(model: FallbackModel, reason: string, index: number, total: number) {
  const nextIndex = index + 1;
  const suffix = nextIndex < total ? ` — trying ${nextIndex + 1}/${total}` : " — no more fallbacks";
  console.warn(`[openrouter] ${model.id} failed (${reason})${suffix}`);
}
