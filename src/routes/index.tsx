/**
 * Home page: GM Co-Pilot session UI.
 *
 * Session flow (state machine):
 *   describe → suggestions → (optional) focused
 *
 * - Prompt tuning: `@/lib/gm-copilot.functions.ts` (SYSTEM_PROMPT)
 * - Option parsing: `@/lib/gm-copilot.parse.ts` (Select buttons)
 * - This file: form, demo scenario, session state, Markdown rendering
 */
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { type CopilotAction, generateSuggestion } from "@/lib/gm-copilot.functions";
import { formatSelectedOption, getSuggestionsDisplayMarkdown, parseStoryOptions } from "@/lib/gm-copilot.parse";

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

/**
 * Demo scenario for "Load demo scenario". Should mirror what a real GM would type:
 * context, player choice, and what they need help with.
 *
 * Update this when you add Quest Craft modules, settings, or example age bands.
 * It is not sent to the model until the user clicks Generate.
 */
const EXAMPLE = `The students defeated the Stormbristle Boar. Instead of accepting Artemis' blessing or treating the boar as sacred, they want to sell the tusks at the market, divide up the meat, and keep the profits. I need 2–3 possible story outcomes that respect their choice, create an interesting consequence, and keep the quest moving for ages 9–12.`;

/**
 * Session phases shown in the step indicator and used to decide which UI to render:
 *
 * - describe     — GM enters situation; no suggestions yet
 * - suggestions  — full multi-option response; Regenerate / Revise / Select available
 * - focused      — drill-down for one chosen option; "Back to all options" returns
 */
type SessionView = "describe" | "suggestions" | "focused";

function Index() {
  const generate = useServerFn(generateSuggestion);

  // Original table situation — kept editable and sent on every server call.
  const [situation, setSituation] = useState("");
  // Latest full suggestions (multi-option Markdown from initial / regenerate / revise).
  const [suggestions, setSuggestions] = useState("");
  // Drill-down response after the GM clicks Select on one story option.
  const [focusedOutput, setFocusedOutput] = useState("");
  const [selectedOptionLabel, setSelectedOptionLabel] = useState<string | null>(null);
  const [view, setView] = useState<SessionView>("describe");
  // Revise is a two-step UX: toggle form, then submit feedback to the model.
  const [showReviseForm, setShowReviseForm] = useState(false);
  const [revisionNotes, setRevisionNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const storyOptions = parseStoryOptions(suggestions);
  const activeMarkdown =
    view === "focused" ? focusedOutput : getSuggestionsDisplayMarkdown(suggestions);
  const showResults = view === "focused" ? !!focusedOutput.trim() : !!suggestions.trim();

  /**
   * Single entry point for all co-pilot actions. Routes to the server with the
   * right `action` payload, then updates session state for the next UI step.
   */
  async function runAction(
    action: CopilotAction,
    extras?: { revisionNotes?: string; selectedOption?: string },
  ) {
    if (!situation.trim() || loading) return;
    if (action === "reviseFocus" && !focusedOutput.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const res = await generate({
        data: {
          action,
          situation: situation.trim(),
          previousOutput:
            action === "initial"
              ? undefined
              : action === "reviseFocus"
                ? focusedOutput
                : suggestions,
          revisionNotes: extras?.revisionNotes,
          selectedOption:
            action === "focus" || action === "reviseFocus"
              ? (extras?.selectedOption ?? selectedOptionLabel ?? undefined)
              : extras?.selectedOption,
        },
      });

      if (action === "focus" || action === "reviseFocus") {
        setFocusedOutput(res.text);
        if (action === "focus") {
          setSelectedOptionLabel(extras?.selectedOption ?? null);
        }
        setView("focused");
        setRevisionNotes("");
        setShowReviseForm(false);
      } else {
        setSuggestions(res.text);
        setFocusedOutput("");
        setSelectedOptionLabel(null);
        setView("suggestions");
        if (action === "revise" || action === "regenerate") {
          setRevisionNotes("");
          setShowReviseForm(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  async function onDescribeSubmit(e: React.FormEvent) {
    e.preventDefault();
    await runAction("initial");
  }

  function resetSession() {
    // Clears follow-up state but leaves the situation textarea as-is.
    setSuggestions("");
    setFocusedOutput("");
    setSelectedOptionLabel(null);
    setView("describe");
    setShowReviseForm(false);
    setRevisionNotes("");
    setError(null);
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <header className="mb-8">
          <h1 className="text-3xl font-bold tracking-tight">Quest Craft GM Co-Pilot</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Describe your table situation, review suggestions, then regenerate, revise, or
            develop one story path further.
          </p>
        </header>

        <section className="mb-6 rounded-lg border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium">
              {view === "describe" && "Step 1 — Describe the situation"}
              {view === "suggestions" && "Step 2 — Review suggestions"}
              {view === "focused" && "Step 3 — Develop one path"}
            </p>
            {view !== "describe" && (
              <Button type="button" variant="ghost" size="sm" onClick={resetSession}>
                New situation
              </Button>
            )}
          </div>
        </section>

        <form onSubmit={onDescribeSubmit} className="space-y-3">
          <label htmlFor="situation" className="block text-sm font-medium">
            GM situation
          </label>
          <Textarea
            id="situation"
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            placeholder="Describe what just happened at the table…"
            rows={7}
            disabled={loading}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={loading || !situation.trim()}>
              {loading && view === "describe" ? "Generating…" : "Generate suggestions"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setSituation(EXAMPLE)}
              disabled={loading}
            >
              Load demo scenario
            </Button>
          </div>
        </form>

        {error && (
          <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}

        {showResults && (
          <section className="mt-8 space-y-4 rounded-lg border border-border bg-card p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">
                  {view === "focused" ? "Focused path" : "Suggestions"}
                </h2>
                {view === "focused" && selectedOptionLabel && (
                  <p className="mt-1 text-sm text-muted-foreground">{selectedOptionLabel}</p>
                )}
              </div>

              {/* Regenerate / Revise only apply to the multi-option suggestions view. */}
              {view === "suggestions" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => runAction("regenerate")}
                  >
                    {loading ? "Working…" : "Regenerate"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => setShowReviseForm((open) => !open)}
                  >
                    Revise
                  </Button>
                </div>
              )}

              {view === "focused" && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => setShowReviseForm((open) => !open)}
                  >
                    Revise
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={loading}
                    onClick={() => {
                      setShowReviseForm(false);
                      setRevisionNotes("");
                      setView("suggestions");
                    }}
                  >
                    Back to all options
                  </Button>
                </div>
              )}
            </div>

            {activeMarkdown && (
              <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:mt-4 prose-headings:mb-2 prose-p:my-2 prose-ul:my-2 prose-blockquote:my-2">
                <ReactMarkdown>{activeMarkdown}</ReactMarkdown>
              </div>
            )}

            {view === "suggestions" && (
              <p className="border-t border-border pt-4 text-sm text-muted-foreground">
                Use what helps, skip what doesn&apos;t — you know your players best. Regenerate,
                revise, or select a path below to develop it further giving you narration and deeper details.
              </p>
            )}

            {view === "suggestions" && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-sm font-medium">Develop one path further</p>
                {storyOptions.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {storyOptions.map((option) => (
                      <div
                        key={option.number}
                        className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium">{option.label}</p>
                          <p className="text-sm text-muted-foreground">{option.description}</p>
                          {option.consequence && (
                            <p className="mt-1 text-sm text-muted-foreground">
                              <span className="font-medium text-foreground">
                                Later consequence:
                              </span>{" "}
                              {option.consequence}
                            </p>
                          )}
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          disabled={loading}
                          onClick={() =>
                            runAction("focus", {
                              selectedOption: formatSelectedOption(option),
                            })
                          }
                        >
                          Select
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Path buttons couldn&apos;t be read from this response. Try{" "}
                    <button
                      type="button"
                      className="font-medium text-foreground underline-offset-2 hover:underline"
                      disabled={loading}
                      onClick={() => runAction("regenerate")}
                    >
                      Regenerate
                    </button>{" "}
                    to get selectable options.
                  </p>
                )}
              </div>
            )}

            {/* Inline revision form — toggled by Revise on suggestions or focused path. */}
            {showReviseForm && (view === "suggestions" || view === "focused") && (
              <form
                className="space-y-3 border-t border-border pt-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!revisionNotes.trim()) return;
                  void runAction(view === "focused" ? "reviseFocus" : "revise", {
                    revisionNotes: revisionNotes.trim(),
                    selectedOption: selectedOptionLabel ?? undefined,
                  });
                }}
              >
                <label htmlFor="revision" className="block text-sm font-medium">
                  What would you like changed?
                </label>
                <Textarea
                  id="revision"
                  value={revisionNotes}
                  onChange={(e) => setRevisionNotes(e.target.value)}
                  placeholder={
                    view === "focused"
                      ? "e.g. Shorten the narration, soften the consequence, add a clearer next step for the players…"
                      : "e.g. Make option 2 less punitive, keep the market scene moving, tone down Artemis' anger…"
                  }
                  rows={4}
                  disabled={loading}
                />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={loading || !revisionNotes.trim()}>
                    {loading ? "Revising…" : "Submit revision"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={loading}
                    onClick={() => {
                      setShowReviseForm(false);
                      setRevisionNotes("");
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
