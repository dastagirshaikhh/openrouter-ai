"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import type { FallbackModel } from "@/lib/models";

type Frame =
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

type Props = {
  defaultChain: FallbackModel[];
  forceSwitchChain: FallbackModel[];
  defaultPrompt: string;
};

type StatusEvent = { stage: string; message: string; ts: number };

function chainToText(chain: FallbackModel[]): string {
  return chain.map((m) => `${m.id}||${m.label}`).join("\n");
}

function parseChain(text: string): FallbackModel[] {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [id, label] = l.split("||");
      return { id: id.trim(), label: (label ?? id).trim() };
    });
}

export function Playground({ defaultChain, forceSwitchChain, defaultPrompt }: Props) {
  const defaultChainText = useMemo(() => chainToText(defaultChain), [defaultChain]);
  const forceSwitchChainText = useMemo(() => chainToText(forceSwitchChain), [forceSwitchChain]);

  const [prompt, setPrompt] = useState(defaultPrompt);
  const [chainText, setChainText] = useState(defaultChainText);
  const [running, setRunning] = useState(false);
  const [activeModel, setActiveModel] = useState("");
  const [activeModelId, setActiveModelId] = useState("");
  const [statusLine, setStatusLine] = useState("idle");
  const [statusHistory, setStatusHistory] = useState<StatusEvent[]>([]);
  const [reasoning, setReasoning] = useState("");
  const [response, setResponse] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const handleFrame = useCallback((frame: Frame) => {
    switch (frame.type) {
      case "status":
        setStatusLine(frame.message);
        setStatusHistory((h) => [...h, { stage: frame.stage, message: frame.message, ts: Date.now() }]);
        setLog((l) => [...l, `[${frame.stage}] ${frame.message}`]);
        break;
      case "model":
        setActiveModel(frame.label);
        setActiveModelId(frame.model);
        setStatusLine(`Streaming from ${frame.label}`);
        setLog((l) => [...l, `[model] ${frame.label} (${frame.model}) attempt #${frame.attempt}`]);
        break;
      case "content":
        setResponse((r) => r + frame.delta);
        break;
      case "reasoning":
        setReasoning((r) => r + frame.delta);
        setLog((l) => [...l, `[reasoning] +${frame.delta.length} chars`]);
        break;
      case "reset":
        setResponse("");
        setReasoning("");
        setLog((l) => [...l, `[reset] ${frame.reason}`]);
        break;
      case "usage":
        setLog((l) => [...l, `[usage] ${JSON.stringify(frame.usage)}`]);
        break;
      case "error":
        setStatusLine(`Error: ${frame.message}`);
        setLog((l) => [...l, `[error] ${frame.message}`]);
        break;
      case "done":
        setLog((l) => [...l, `[done]`]);
        break;
    }
  }, []);

  const send = useCallback(async () => {
    if (running) return;
    setResponse("");
    setReasoning("");
    setActiveModel("");
    setActiveModelId("");
    setStatusLine("Connecting…");
    setStatusHistory([]);
    setLog([]);
    setRunning(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
          models: parseChain(chainText),
        }),
        signal: ctrl.signal,
      });
      if (!res.body) throw new Error("no response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split(/\r?\n\r?\n/);
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          for (const line of part.split(/\r?\n/)) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            try {
              handleFrame(JSON.parse(data) as Frame);
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setStatusLine(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      setRunning(false);
    }
  }, [chainText, handleFrame, prompt, running]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setRunning(false);
    setStatusLine("Stopped by user");
  }, []);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label htmlFor="prompt" className="block text-sm font-medium">
          Prompt
        </label>
        <textarea
          id="prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full min-h-24 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent p-2 text-sm"
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="chain" className="block text-sm font-medium">
            Fallback chain — one per line, format <code>model-id||Label</code>
          </label>
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => setChainText(defaultChainText)}
              className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={() => setChainText(forceSwitchChainText)}
              className="rounded border border-zinc-300 dark:border-zinc-700 px-2 py-1"
            >
              Load forced-switch preset
            </button>
          </div>
        </div>
        <textarea
          id="chain"
          value={chainText}
          onChange={(e) => setChainText(e.target.value)}
          className="w-full min-h-40 rounded border border-zinc-300 dark:border-zinc-700 bg-transparent p-2 text-xs font-mono"
        />
      </section>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={send}
          disabled={running}
          className="rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-40 dark:bg-white dark:text-black"
        >
          {running ? "Streaming…" : "Send"}
        </button>
        <button
          type="button"
          onClick={stop}
          disabled={!running}
          className="rounded border border-zinc-300 dark:border-zinc-700 px-4 py-2 text-sm disabled:opacity-40"
        >
          Stop
        </button>
      </div>

      <section className="space-y-3 rounded border border-zinc-200 dark:border-zinc-800 p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
          <div>
            <span className="font-medium">Active model: </span>
            <span>{activeModel ? `${activeModel} (${activeModelId})` : "—"}</span>
          </div>
          <div
            className={`text-sm ${
              running ? "animate-pulse text-zinc-500" : "text-zinc-600 dark:text-zinc-400"
            }`}
          >
            {statusLine}
          </div>
        </div>
        {statusHistory.length > 0 && (
          <ol className="space-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            {statusHistory.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="uppercase tracking-wide text-zinc-400">{s.stage}</span>
                <span>{s.message}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {reasoning && (
        <section className="space-y-1">
          <h2 className="text-sm font-medium">Reasoning</h2>
          <div className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-sm whitespace-pre-wrap font-mono">
            {reasoning}
          </div>
        </section>
      )}

      <section className="space-y-1">
        <h2 className="text-sm font-medium">Response</h2>
        <div className="rounded border border-zinc-200 dark:border-zinc-800 p-3 text-sm min-h-24 whitespace-pre-wrap">
          {response || <span className="text-zinc-400">(no output yet)</span>}
        </div>
      </section>

      <section className="space-y-1">
        <h2 className="text-sm font-medium">Event log</h2>
        <pre className="rounded border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 p-3 text-xs max-h-64 overflow-auto">
          {log.join("\n") || "(empty)"}
        </pre>
      </section>
    </div>
  );
}
