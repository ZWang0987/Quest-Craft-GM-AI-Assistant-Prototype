/**
 * Parses story outcome lines from the model's Markdown so the UI can render
 * per-option "Select" buttons without asking the model for structured JSON.
 *
 * Must stay in sync with the "## 2–3 Possible Story Outcomes" format in
 * SYSTEM_PROMPT (`gm-copilot.functions.ts`).
 */
export interface StoryOption {
  number: number;
  name: string;
  description: string;
  /** Ripple that may show up later in the campaign for this path. */
  consequence: string;
  /** Display label, e.g. "Option 1 — Market backlash" */
  label: string;
}

/** Matches each bullet under "## 2–3 Possible Story Outcomes" (Option 3 may be prefixed with "(Optional)"). */
const OPTION_LINE =
  /^-\s*(?:\(Optional\)\s+)?\*\*Option\s+(\d+)\s+—\s+([^:*]+):\*\*\s*(.+)$/;

const LATER_CONSEQUENCE_SPLIT = /\s+\*\*Later consequence:\*\*\s*/i;

/** Sections omitted from the suggestions view until the GM selects a path. */
const HIDDEN_SUGGESTIONS_SECTIONS = [
  "Narration the GM Could Say Aloud",
  "A Consequence That Matters Later",
  "Safety & Age-Appropriateness Notes",
] as const;

/** Pull story outcome options from the model's Markdown for per-option Select actions. */
export function parseStoryOptions(markdown: string): StoryOption[] {
  const sectionMatch = markdown.match(
    /## 2–3 Possible Story Outcomes\n([\s\S]*?)(?=\n## |$)/,
  );
  if (!sectionMatch) return [];

  const options: StoryOption[] = [];
  for (const line of sectionMatch[1].split("\n")) {
    const match = line.trim().match(OPTION_LINE);
    if (!match) continue;
    const [, num, name, body] = match;
    const trimmedName = name.trim();
    const [description = "", consequence = ""] = body.split(LATER_CONSEQUENCE_SPLIT);
    options.push({
      number: Number(num),
      name: trimmedName,
      description: description.trim(),
      consequence: consequence.trim(),
      label: `Option ${num} — ${trimmedName}`,
    });
  }
  return options;
}

/** Strips sections that belong only on the focused drill-down view. */
export function getSuggestionsDisplayMarkdown(markdown: string): string {
  let result = markdown;
  for (const heading of HIDDEN_SUGGESTIONS_SECTIONS) {
    result = result.replace(new RegExp(`## ${heading}\\n[\\s\\S]*?(?=\\n## |$)`), "");
  }
  return result.trim();
}
