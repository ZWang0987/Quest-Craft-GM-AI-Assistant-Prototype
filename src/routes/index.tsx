import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { generateSuggestion } from "@/lib/gm-copilot.functions";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Quest Craft GM Co-Pilot" },
      {
        name: "description",
        content:
          "An AI co-pilot that helps Quest Craft Game Masters respond to unexpected player choices during live tabletop role-playing sessions.",
      },
      { property: "og:title", content: "Quest Craft GM Co-Pilot" },
      {
        property: "og:description",
        content:
          "AI-assisted suggestions for Quest Craft GMs — story outcomes, narration, and consequences for unexpected player choices.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const EXAMPLE = `The students defeated the Stormbristle Boar. Instead of accepting Artemis' blessing or treating the boar as sacred, they want to sell the tusks at the market, divide up the meat, and keep the profits. I need 2–3 possible story outcomes that respect their choice, create an interesting consequence, and keep the quest moving for ages 9–12.`;

function Index() {
  const generate = useServerFn(generateSuggestion);
  const [situation, setSituation] = useState("");
  const [output, setOutput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!situation.trim() || loading) return;
    setLoading(true);
    setError(null);
    setOutput("");
    try {
      const res = await generate({ data: { situation: situation.trim() } });
      setOutput(res.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Quest Craft GM Co-Pilot</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Stuck on an unexpected player choice? Describe the situation and get quick,
            table-ready suggestions. You always decide whether to accept, revise, or ignore.
          </p>
        </header>

        <form onSubmit={onSubmit} className="space-y-3">
          <label htmlFor="situation" className="block text-sm font-medium">
            GM situation
          </label>
          <textarea
            id="situation"
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            placeholder="Describe what just happened at the table…"
            rows={7}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="submit"
              disabled={loading || !situation.trim()}
              className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? "Generating…" : "Generate"}
            </button>
            <button
              type="button"
              onClick={() => setSituation(EXAMPLE)}
              className="inline-flex items-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent"
            >
              Load demo scenario
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {output && (
          <section className="mt-8 rounded-lg border border-border bg-card p-6">
            <h2 className="mb-3 text-lg font-semibold">Suggestions</h2>
            <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-blockquote:my-2">
              <ReactMarkdown>{output}</ReactMarkdown>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
