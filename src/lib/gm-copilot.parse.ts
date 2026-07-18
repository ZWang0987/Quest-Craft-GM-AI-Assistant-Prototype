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
  /** Display label, e.g. "Option 1 — Market backlash" */
  label: string;
}

/** Matches each bullet under "## 2–3 Possible Story Outcomes" (Option 3 may be prefixed with "(Optional)"). */
const OPTION_LINE =
  /^-\s*(?:\(Optional\)\s+)?\*\*Option\s+(\d+)\s+—\s+([^:*]+):\*\*\s*(.+)$/;

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
    const [, num, name, description] = match;
    const trimmedName = name.trim();
    options.push({
      number: Number(num),
      name: trimmedName,
      description: description.trim(),
      label: `Option ${num} — ${trimmedName}`,
    });
  }
  return options;
}
