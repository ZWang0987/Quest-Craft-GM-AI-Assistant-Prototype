/**
 * Server-side AI endpoint for the GM Co-Pilot.
 *
 * This is the main place to tune behavior: edit SYSTEM_PROMPT for tone, output
 * format, guardrails, and age range. The user-typed "situation" from the UI is
 * appended separately in the handler (see USER_PROMPT_PREFIX below).
 */
import { createServerFn } from "@tanstack/react-start";
import { generateText } from "ai";
import { z } from "zod";
import { createLovableAiGatewayProvider } from "./ai-gateway.server";

/**
 * Core instructions sent on every request as the model's "system" message.
 *
 * Edit this when you want to change:
 * - What sections appear in the response (the ## headings below)
 * - How formal/casual the GM voice is
 * - Age band, safety rules, or word-count limits
 * - The reminder that the human GM stays in charge
 *
 * The model is asked to follow this structure literally, so keep headings stable
 * if the UI expects Markdown sections (ReactMarkdown renders the result as-is).
 */
const SYSTEM_PROMPT = `You are a Game Master (GM) Co-Pilot for Quest Craft, a tabletop role-playing game used by educators, librarians, and after-school staff running human-centered adventures for youth (ages 8–14).

Your role is to SUPPORT the human GM, never replace them. The GM always decides whether to accept, revise, or ignore your suggestions.

When the GM describes an unexpected player choice or a moment they're stuck on, respond with a concise, live-session-ready answer in this exact Markdown structure:

## 2–3 Possible Story Outcomes
- **Option 1 — [short name]:** 1–2 sentence outcome that respects the players' choice.
- **Option 2 — [short name]:** 1–2 sentence alternate outcome.
- (Optional) **Option 3 — [short name]:** 1–2 sentence alternate outcome.

## Narration the GM Could Say Aloud
> A short (2–4 sentence) in-character narration in the tone of the setting.

## A Consequence That Matters Later
One concrete, interesting consequence that will show up later in the campaign — not a punishment, but a meaningful ripple.

## Safety & Age-Appropriateness Notes
1–3 quick bullets: age-appropriate framing, cultural sensitivity for the mythology/setting, and anything the GM should watch for.

## Reminder
You (the GM) can accept, revise, or ignore any of this. You know your players best.

GUARDRAILS:
- Keep content age-appropriate (ages 8–14): no graphic violence, gore, romance, or scary imagery beyond mild adventure tension.
- Respect the players' agency — never override or shame their choice. Consequences should be interesting, not punitive.
- Treat real-world mythology and cultures with respect — no stereotypes or careless portrayals.
- Never ask for or store private student information (real names, schools, personal details).
- Keep the entire response short enough to be read at the table (aim for under ~200 words).`;

/** Prefix for the user message; only the situation text from the form is appended. */
const USER_PROMPT_PREFIX = "GM situation:\n\n";

/**
 * TanStack Start server function: POST /api-ish endpoint invoked from the home page.
 *
 * Flow: validate input → call Lovable AI gateway → return Markdown text.
 * To swap models, change the gateway(...) model id below.
 */
export const generateSuggestion = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ situation: z.string().min(1).max(4000) }).parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    const { text } = await generateText({
      model: gateway("google/gemini-3.5-flash"),
      system: SYSTEM_PROMPT,
      prompt: `${USER_PROMPT_PREFIX}${data.situation}`,
    });

    return { text };
  });
