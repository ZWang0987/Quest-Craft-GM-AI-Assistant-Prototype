/**
 * Server-side AI endpoint for the GM Co-Pilot.
 *
 * This is the main place to tune behavior: edit SYSTEM_PROMPT for tone, output
 * format, guardrails, and age range. The user-typed "situation" from the UI is
 * appended separately in the handler (see buildUserPrompt below).
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

Your role is to SUPPORT the human GM, never replace them. The GM always decides what to use at the table.

When the GM describes an unexpected player choice or a moment they're stuck on, respond with a concise, live-session-ready answer in this exact Markdown structure:

## **2–3 Possible Story Outcomes:**
Use one markdown bullet per option in exactly this shape (keep each option on a single line):
- **Option 1 — [short name]:** 1–2 sentence outcome that respects the players' choice and moves the story forward with low-stakes consequences (not a rejection or reversal of their decision). **Later consequence:** one concrete ripple that could show up later in the campaign (reward, complication, or NPC memory — not a sidetrack).
- **Option 2 — [short name]:** 1–2 sentence alternate outcome with a more consequential path that still moves the story forward. **Later consequence:** one concrete ripple specific to this path.
- (Optional) **Option 3 — [short name]:** 1–2 sentence alternate outcome offering a different narrative angle (e.g., a new NPC reaction or social consequence) rather than just a different stakes level. **Later consequence:** one concrete ripple specific to this path.

Do NOT include narration, read-aloud text, or safety notes in this response — the GM gets those after they choose one path to develop.

GUARDRAILS:
- Keep content age-appropriate (ages 9–12): no graphic violence, gore, romance, or scary imagery beyond mild adventure tension.
- Respect the players' agency — never override or shame their choice. Consequences should be interesting, not punishing or sidetrack the main story.
- Treat real-world mythology and cultures with respect — no stereotypes or careless portrayals.
- Never ask for or store private student information (real names, schools, personal details(gender,age,race,etc)).
- Keep the entire response short enough to be read at the table (aim for under ~200 words).`;

/**
 * Extra system instructions when the GM picks one story outcome via "Select".
 * Uses a different Markdown shape (no multi-option list) so the UI can show a
 * drill-down view without confusing it with the main suggestions screen.
 */
const FOCUS_SYSTEM_ADDENDUM = `

The GM selected one story outcome to develop further. Respond in this exact Markdown structure, focused entirely on that chosen path:

## **Selected Story Outcome:**
2–3 sentences refining the chosen path giving a bit more context and detail without adding too much new information.

## **Narration To Be Said Aloud:**
> A short (2–4 sentence) in-character narration for this path for the GM to say aloud, keep the language simple and easy to understand for ages 9–12.

## **A Consequence That Matters Later:**
1-2 sentences that will explore the consequence of the chosen path, this should be a bit more detailed than the later consequence in the initial suggestions.

## **Next Steps at the Table:**
2–3 brief bullets for what the GM can do right now to keep the scene moving.

## **Safety & Age-Appropriateness Notes:**
1–3 quick bullets for this path to remind the GM of saftey and age precussions for the players due to the 9-12 age range.

Keep the response table-ready and under ~200 words.`;

/**
 * Request body for every co-pilot call. The UI drives a small state machine via
 * `action`:
 *
 * - initial     — first pass from the situation textarea
 * - regenerate  — new options for the same situation (needs previousOutput)
 * - revise      — GM feedback applied to prior suggestions (needs revisionNotes)
 * - focus       — expand one chosen option (needs selectedOption)
 */
const requestSchema = z
  .object({
    action: z.enum(["initial", "regenerate", "revise", "focus"]),
    situation: z.string().min(1).max(4000),
    previousOutput: z.string().max(8000).optional(),
    revisionNotes: z.string().max(2000).optional(),
    selectedOption: z.string().max(500).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.action !== "initial" && !data.previousOutput?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "previousOutput is required for this action",
        path: ["previousOutput"],
      });
    }
    if (data.action === "revise" && !data.revisionNotes?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "revisionNotes is required for revise",
        path: ["revisionNotes"],
      });
    }
    if (data.action === "focus" && !data.selectedOption?.trim()) {
      ctx.addIssue({
        code: "custom",
        message: "selectedOption is required for focus",
        path: ["selectedOption"],
      });
    }
  });

export type CopilotAction = z.infer<typeof requestSchema>["action"];
export type CopilotRequest = z.infer<typeof requestSchema>;

/** Builds the user message sent to the model; each action carries different context. */
function buildUserPrompt(data: CopilotRequest): string {
  const situation = data.situation.trim();

  switch (data.action) {
    case "initial":
      return `GM situation:\n\n${situation}`;

    case "regenerate":
      return `GM situation:\n\n${situation}\n\nProvide a fresh set of 2–3 different story outcomes. Do not repeat these previous suggestions:\n\n${data.previousOutput!.trim()}`;

    case "revise":
      return `GM situation:\n\n${situation}\n\nPrevious suggestions:\n\n${data.previousOutput!.trim()}\n\nGM revision request:\n\n${data.revisionNotes!.trim()}\n\nUpdate your suggestions based on the GM's feedback. Keep the same Markdown structure.`;

    case "focus":
      return `GM situation:\n\n${situation}\n\nFull suggestions (for context):\n\n${data.previousOutput!.trim()}\n\nThe GM selected this outcome to develop further:\n\n${data.selectedOption!.trim()}`;

    default: {
      const _exhaustive: never = data.action;
      return _exhaustive;
    }
  }
}

/**
 * TanStack Start server function: POST /api-ish endpoint invoked from the home page.
 *
 * Flow: validate input → call Lovable AI gateway → return Markdown text.
 * To swap models, change the gateway(...) model id below.
 */
export const generateSuggestion = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => requestSchema.parse(input))
  .handler(async ({ data }) => {
    const key = process.env.LOVABLE_API_KEY;
    if (!key) throw new Error("Missing LOVABLE_API_KEY");

    const gateway = createLovableAiGatewayProvider(key);
    // Focus responses use a different section layout, so swap in the addendum.
    const system =
      data.action === "focus" ? SYSTEM_PROMPT + FOCUS_SYSTEM_ADDENDUM : SYSTEM_PROMPT;

    const { text } = await generateText({
      model: gateway("google/gemini-3.5-flash"),
      system,
      prompt: buildUserPrompt(data),
    });

    return { text };
  });
