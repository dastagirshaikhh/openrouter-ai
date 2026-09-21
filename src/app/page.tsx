import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">OpenRouter fallback chat</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        A Next.js chat app that streams from an OpenRouter model and, if that model rate-limits or
        goes down, transparently hops to the next one in a fallback chain. All switching happens on
        the server — the client just consumes an SSE stream.
      </p>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-700 dark:text-zinc-300">
        <li>
          Copy <code>.env.local.example</code> to <code>.env.local</code> and set{" "}
          <code>OPENROUTER_API_KEY</code>.
        </li>
        <li>
          Run <code>pnpm dev</code> and open the test page.
        </li>
        <li>
          Change any model id in the chain to a bogus one (e.g. add <code>-broken</code>) to force a
          fallback and watch the status line switch.
        </li>
      </ol>
      <div>
        <Link
          href="/test"
          className="inline-flex rounded bg-black px-4 py-2 text-sm text-white dark:bg-white dark:text-black"
        >
          Open test page →
        </Link>
      </div>
    </main>
  );
}
