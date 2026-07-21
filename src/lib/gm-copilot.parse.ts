/**
 * Parses story outcome lines from the model's Markdown so the UI can render
 * per-option "Select" buttons without asking the model for structured JSON.
 *
 * Must stay in sync with the "## 2–3 Possible Story Outcomes" format in
 * SYSTEM_PROMPT (`gm-copilot.functions.ts`).
 */
/** One parsed story outcome, backing a single "Select" button in the UI. */
export interface StoryOption {
  /** 1-based option number pulled from "Option 1", "Option 2", etc. */
  number: number;
  /** Short human name for the path, e.g. "Market backlash". */
  name: string;
  /** The 1–2 sentence outcome text (without the "Later consequence" part). */
  description: string;
  /** Ripple that may show up later in the campaign for this path. */
  consequence: string;
  /** Display label, e.g. "Option 1 — Market backlash" */
  label: string;
}

// Matches the section header, tolerating an en/em dash between 2 and 3, an
// optional trailing colon, and extra whitespace: "## 2–3 Possible Story Outcomes".
const STORY_OUTCOMES_HEADING = /^##\s*2\s*[–-]\s*3\s+Possible\s+Story\s+Outcomes:?\s*$/i;

// Splits an option's text into [description, consequence] on the inline
// "**Later consequence:**" marker the model is asked to include.
const LATER_CONSEQUENCE_SPLIT = /\s+\*\*Later consequence:\*\*\s*/i;
// Matches a "Later consequence" that the model put on its own line instead of
// inline (used when parsing the multi-line "### Option" heading format).
const LATER_CONSEQUENCE_LINE = /^(?:\*\*Later consequence:\*\*|\*Later consequence:\*)\s*(.+)$/i;

/** Sections omitted from the suggestions view until the GM selects a path. */
const HIDDEN_SUGGESTIONS_SECTIONS = [
  "Narration the GM Could Say Aloud",
  "A Consequence That Matters Later",
  "Safety & Age-Appropriateness Notes",
] as const;

// The model doesn't always format options identically, so we try several
// single-line shapes in order. Each captures three groups: (number, name, body).
// The `body` still contains the inline "Later consequence" text, split out later.
const OPTION_LINE_PATTERNS: RegExp[] = [
  // Preferred: "- **Option 1 — Name:** description..." (bullet + bold + dash)
  /^(?:[-*•]|\d+\.)\s*(?:\(Optional\)\s+)?\*\*Option\s+(\d+)\s+[—–-]\s+([^:*]+):\*\*\s*(.+)$/i,
  // Variant: "- **Option 1: Name** description..." (colon inside the bold)
  /^(?:[-*•]|\d+\.)\s*(?:\(Optional\)\s+)?\*\*Option\s+(\d+):\s*([^*]+)\*\*:?\s*(.+)$/i,
  // Variant: "**Option 1 — Name:** description..." (bold, no leading bullet)
  /^\*\*Option\s+(\d+)\s+[—–-]\s+([^:*]+):\*\*\s*(.+)$/i,
  // Variant: "- Option 1 — Name: description..." (no bold at all)
  /^(?:[-*•]|\d+\.)\s*(?:\(Optional\)\s+)?Option\s+(\d+)\s+[—–-]\s+([^:]+):\s*(.+)$/i,
];

// Matches an option written as its own markdown heading, e.g. "### Option 1 — Name"
// or "## Option 1: Name". The description then lives on the following lines.
const OPTION_HEADING_PATTERN =
  /^#{1,3}\s*(?:\(Optional\)\s+)?Option\s+(\d+)\s*(?:[—–-]\s+([^:\n]+)|:\s*(.+))\s*$/i;

/** Splits an option body into its outcome text and its "Later consequence" ripple. */
function splitBody(body: string): { description: string; consequence: string } {
  // If there's no marker, the whole body is the description and consequence is "".
  const [description = "", consequence = ""] = body.split(LATER_CONSEQUENCE_SPLIT);
  return { description: description.trim(), consequence: consequence.trim() };
}

/** Assembles a StoryOption from the three captured pieces of a matched line. */
function buildOption(num: string, name: string, body: string): StoryOption {
  const trimmedName = name.trim();
  const { description, consequence } = splitBody(body);
  return {
    number: Number(num),
    name: trimmedName,
    description,
    consequence,
    label: `Option ${num} — ${trimmedName}`,
  };
}

/**
 * Tries to parse a single line as an option using the inline patterns.
 * Returns null for blank lines, bare "##", or any other section heading.
 */
function parseInlineOptionLine(line: string): StoryOption | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "##" || /^##\s/.test(trimmed)) return null;

  // First matching pattern wins; order in OPTION_LINE_PATTERNS is the priority.
  for (const pattern of OPTION_LINE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    return buildOption(match[1], match[2], match[3]);
  }

  return null;
}

/**
 * True when a line marks the start of a new block, so the multi-line heading
 * parser knows where the current option's description ends: another section
 * ("## ..."), a new inline option, or a new "### Option" heading.
 */
function isSectionBoundary(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^##\s/.test(trimmed) ||
    !!parseInlineOptionLine(line) ||
    OPTION_HEADING_PATTERN.test(trimmed)
  );
}

/**
 * Parses the "heading" format where an option is a markdown heading
 * ("### Option 1 — Name") followed by its description (and optionally a
 * "Later consequence" line) on subsequent lines, up to the next boundary.
 */
function parseHeadingOptionBlock(lines: string[], startIndex: number): StoryOption | null {
  const headingMatch = lines[startIndex].trim().match(OPTION_HEADING_PATTERN);
  if (!headingMatch) return null;

  // The name is either after a dash or after a colon, depending on which
  // alternative in OPTION_HEADING_PATTERN matched.
  const [, num, dashName, colonName] = headingMatch;
  const name = (dashName ?? colonName ?? "").trim();
  if (!name) return null;

  let description = "";
  let consequence = "";

  // Walk forward collecting body lines until we hit the next option/section.
  for (let i = startIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (isSectionBoundary(lines[i])) break;

    // A standalone "Later consequence" line is captured separately.
    const consequenceMatch = trimmed.match(LATER_CONSEQUENCE_LINE);
    if (consequenceMatch) {
      consequence = consequenceMatch[1].trim();
      continue;
    }

    // Otherwise append to the description (stripping any leading bullet marker).
    description += `${description ? " " : ""}${trimmed.replace(/^[-*•]\s*/, "")}`;
  }

  // Re-attach the inline marker so buildOption/splitBody can separate them uniformly.
  return buildOption(num, name, description + (consequence ? ` **Later consequence:** ${consequence}` : ""));
}

/**
 * Collapses soft-wrapped model output into one logical line per option.
 * Drops blank lines, and merges a line into the previous one when it's a
 * "Later consequence" line or an indented continuation (not a new option/heading).
 */
function normalizeMarkdownLines(lines: string[]): string[] {
  const normalized: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const isContinuation =
      normalized.length > 0 &&
      (LATER_CONSEQUENCE_LINE.test(trimmed) ||
        (/^\s{2,}/.test(line) &&
          !OPTION_HEADING_PATTERN.test(trimmed) &&
          !parseInlineOptionLine(trimmed) &&
          !/^##\s/.test(trimmed)));

    if (isContinuation) {
      // Append to the last kept line instead of starting a new one.
      normalized[normalized.length - 1] += ` ${trimmed}`;
      continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

/** Keeps the last option seen per number and returns them sorted by number. */
function dedupeByNumber(options: StoryOption[]): StoryOption[] {
  const byNumber = new Map<number, StoryOption>();
  for (const option of options) {
    if (!Number.isNaN(option.number)) {
      byNumber.set(option.number, option);
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

/**
 * Runs both parsers (inline line, then heading block) over a set of lines and
 * returns the de-duplicated, ordered options found.
 */
function parseOptionsFromLines(lines: string[]): StoryOption[] {
  const options: StoryOption[] = [];
  const normalized = normalizeMarkdownLines(lines);

  for (let i = 0; i < normalized.length; i++) {
    // Prefer the single-line form; fall back to the multi-line heading form.
    const inline = parseInlineOptionLine(normalized[i]);
    if (inline) {
      options.push(inline);
      continue;
    }

    const headingOption = parseHeadingOptionBlock(normalized, i);
    if (headingOption) {
      options.push(headingOption);
    }
  }

  return dedupeByNumber(options);
}

/**
 * Isolates just the "## 2–3 Possible Story Outcomes" section so option parsing
 * ignores unrelated sections. Splits on top-level "## " headings and returns the
 * one whose first line matches the outcomes heading, or null if none.
 */
function getStoryOutcomesSection(markdown: string): string | null {
  const sections = markdown.split(/\n(?=## )/);
  return (
    sections.find((section) => {
      const firstLine = section.trim().split("\n")[0] ?? "";
      return STORY_OUTCOMES_HEADING.test(firstLine);
    }) ?? null
  );
}

/**
 * Pull story outcome options from the model's Markdown for per-option Select actions.
 *
 * Strategy: parse within the outcomes section first (most reliable); if that
 * finds nothing (e.g. the heading was reworded), fall back to scanning the
 * entire document so a malformed heading doesn't drop the Select buttons.
 */
export function parseStoryOptions(markdown: string): StoryOption[] {
  if (!markdown.trim()) return [];

  const section = getStoryOutcomesSection(markdown);
  const sectionOptions = section ? parseOptionsFromLines(section.split("\n")) : [];
  if (sectionOptions.length > 0) return sectionOptions;

  return parseOptionsFromLines(markdown.split("\n"));
}

/**
 * Strips sections that belong only on the focused drill-down view (narration,
 * consequence, safety notes) so the Step 2 suggestions screen shows only the
 * options. Each regex removes a "## Heading" block up to the next "## " or EOF.
 */
export function getSuggestionsDisplayMarkdown(markdown: string): string {
  let result = markdown;
  for (const heading of HIDDEN_SUGGESTIONS_SECTIONS) {
    result = result.replace(new RegExp(`## ${heading}\\n[\\s\\S]*?(?=\\n## |$)`), "");
  }
  return result.trim();
}

/**
 * Flattens an option into the plain-text string sent to the server as the
 * GM's selected path (used by the "focus"/"reviseFocus" actions).
 */
export function formatSelectedOption(option: StoryOption): string {
  if (option.consequence) {
    return `${option.label}: ${option.description} Later consequence: ${option.consequence}`;
  }
  return `${option.label}: ${option.description}`;
}
