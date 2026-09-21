import type { Metadata } from "next";
import { DEFAULT_FALLBACK_CHAIN, DEFAULT_PROMPT, FORCE_SWITCH_CHAIN } from "@/lib/models";
import { Playground } from "./Playground";

export const metadata: Metadata = {
  title: "Fallback playground · OpenRouter",
  description: "Stream from OpenRouter with server-side model fallback and live status.",
  robots: { index: false, follow: false },
};

export default function TestPage() {
  return (
    <main className="mx-auto max-w-4xl p-6 sm:p-10 space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">OpenRouter fallback playground</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Streams from the first model in the chain. If it rate-limits or the provider goes down, the
          server hops to the next one automatically. Watch the status line and event log for the switch.
        </p>
      </header>

      <Playground
        defaultChain={DEFAULT_FALLBACK_CHAIN}
        forceSwitchChain={FORCE_SWITCH_CHAIN}
        defaultPrompt={DEFAULT_PROMPT}
      />

      <section className="space-y-2 rounded border border-zinc-200 dark:border-zinc-800 p-4 text-xs text-zinc-600 dark:text-zinc-400">
        <p className="font-medium text-zinc-800 dark:text-zinc-200">How to force a fallback</p>
        <ul className="list-disc pl-4 space-y-1">
          <li>
            Click <em>Load forced-switch preset</em> to load a chain whose first two ids are typos —
            OpenRouter responds with 404 and the server hops to the third entry.
          </li>
          <li>
            Or edit any single id and add <code>-broken</code>; watch the status line switch mid-request.
          </li>
          <li>
            All switching happens on the server. The browser only reads an SSE stream — no API key
            ever touches the client.
          </li>
        </ul>
      </section>
    </main>
  );
}
