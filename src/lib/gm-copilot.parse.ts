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

const STORY_OUTCOMES_HEADING = /^##\s*2\s*[–-]\s*3\s+Possible\s+Story\s+Outcomes:?\s*$/i;

const LATER_CONSEQUENCE_SPLIT = /\s+\*\*Later consequence:\*\*\s*/i;
const LATER_CONSEQUENCE_LINE = /^(?:\*\*Later consequence:\*\*|\*Later consequence:\*)\s*(.+)$/i;

/** Sections omitted from the suggestions view until the GM selects a path. */
const HIDDEN_SUGGESTIONS_SECTIONS = [
  "Narration the GM Could Say Aloud",
  "A Consequence That Matters Later",
  "Safety & Age-Appropriateness Notes",
] as const;

const OPTION_LINE_PATTERNS: RegExp[] = [
  /^(?:[-*•]|\d+\.)\s*(?:\(Optional\)\s+)?\*\*Option\s+(\d+)\s+[—–-]\s+([^:*]+):\*\*\s*(.+)$/i,
  /^(?:[-*•]|\d+\.)\s*(?:\(Optional\)\s+)?\*\*Option\s+(\d+):\s*([^*]+)\*\*:?\s*(.+)$/i,
  /^\*\*Option\s+(\d+)\s+[—–-]\s+([^:*]+):\*\*\s*(.+)$/i,
  /^(?:[-*•]|\d+\.)\s*(?:\(Optional\)\s+)?Option\s+(\d+)\s+[—–-]\s+([^:]+):\s*(.+)$/i,
];

const OPTION_HEADING_PATTERN =
  /^#{1,3}\s*(?:\(Optional\)\s+)?Option\s+(\d+)\s*(?:[—–-]\s+([^:\n]+)|:\s*(.+))\s*$/i;

function splitBody(body: string): { description: string; consequence: string } {
  const [description = "", consequence = ""] = body.split(LATER_CONSEQUENCE_SPLIT);
  return { description: description.trim(), consequence: consequence.trim() };
}

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

function parseInlineOptionLine(line: string): StoryOption | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed === "##" || /^##\s/.test(trimmed)) return null;

  for (const pattern of OPTION_LINE_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    return buildOption(match[1], match[2], match[3]);
  }

  return null;
}

function isSectionBoundary(line: string): boolean {
  const trimmed = line.trim();
  return (
    /^##\s/.test(trimmed) ||
    !!parseInlineOptionLine(line) ||
    OPTION_HEADING_PATTERN.test(trimmed)
  );
}

function parseHeadingOptionBlock(lines: string[], startIndex: number): StoryOption | null {
  const headingMatch = lines[startIndex].trim().match(OPTION_HEADING_PATTERN);
  if (!headingMatch) return null;

  const [, num, dashName, colonName] = headingMatch;
  const name = (dashName ?? colonName ?? "").trim();
  if (!name) return null;

  let description = "";
  let consequence = "";

  for (let i = startIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    if (isSectionBoundary(lines[i])) break;

    const consequenceMatch = trimmed.match(LATER_CONSEQUENCE_LINE);
    if (consequenceMatch) {
      consequence = consequenceMatch[1].trim();
      continue;
    }

    description += `${description ? " " : ""}${trimmed.replace(/^[-*•]\s*/, "")}`;
  }

  return buildOption(num, name, description + (consequence ? ` **Later consequence:** ${consequence}` : ""));
}

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
      normalized[normalized.length - 1] += ` ${trimmed}`;
      continue;
    }

    normalized.push(trimmed);
  }

  return normalized;
}

function dedupeByNumber(options: StoryOption[]): StoryOption[] {
  const byNumber = new Map<number, StoryOption>();
  for (const option of options) {
    if (!Number.isNaN(option.number)) {
      byNumber.set(option.number, option);
    }
  }
  return [...byNumber.values()].sort((a, b) => a.number - b.number);
}

function parseOptionsFromLines(lines: string[]): StoryOption[] {
  const options: StoryOption[] = [];
  const normalized = normalizeMarkdownLines(lines);

  for (let i = 0; i < normalized.length; i++) {
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

function getStoryOutcomesSection(markdown: string): string | null {
  const sections = markdown.split(/\n(?=## )/);
  return (
    sections.find((section) => {
      const firstLine = section.trim().split("\n")[0] ?? "";
      return STORY_OUTCOMES_HEADING.test(firstLine);
    }) ?? null
  );
}

/** Pull story outcome options from the model's Markdown for per-option Select actions. */
export function parseStoryOptions(markdown: string): StoryOption[] {
  if (!markdown.trim()) return [];

  const section = getStoryOutcomesSection(markdown);
  const sectionOptions = section ? parseOptionsFromLines(section.split("\n")) : [];
  if (sectionOptions.length > 0) return sectionOptions;

  return parseOptionsFromLines(markdown.split("\n"));
}

/** Strips sections that belong only on the focused drill-down view. */
export function getSuggestionsDisplayMarkdown(markdown: string): string {
  let result = markdown;
  for (const heading of HIDDEN_SUGGESTIONS_SECTIONS) {
    result = result.replace(new RegExp(`## ${heading}\\n[\\s\\S]*?(?=\\n## |$)`), "");
  }
  return result.trim();
}

export function formatSelectedOption(option: StoryOption): string {
  if (option.consequence) {
    return `${option.label}: ${option.description} Later consequence: ${option.consequence}`;
  }
  return `${option.label}: ${option.description}`;
}
