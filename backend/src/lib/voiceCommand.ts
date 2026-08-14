import { getBatch, mintBatchId } from "../actions/batches.js";
import { listPeople } from "../actions/people.js";
import { voiceLlmOutputSchema, type ProposedDestructiveAction, type VoiceLlmOutput } from "./validation.js";
import { ClaudeCliConfigError, ClaudeCliError, runClaudeCommand, type ClaudeCliSpawnFn } from "./claudeCli.js";

// ARCHITECTURE.md §10/§12 (M8) — the command layer itself: takes a
// transcript, runs it through the haiku/sonnet mechanism §10's own
// prototyping rounds confirmed empirically, and turns the result into
// something POST /api/voice/command can hand back to the frontend. This is
// the one place that knows this app's specific voice-command schema,
// prompts, and tool allowlists — lib/claudeCli.ts below it is generic
// "run one structured claude -p call"; actions/batches.ts above it is the
// shared primitive this wires together.
//
// Direct request, post-launch-prep: this used to also write an audit-trail
// row (transcript + full parsed result) to a voice_commands table on every
// invocation. Removed entirely — nothing in the app ever read it back (no
// history UI, no route), so it was pure indefinite retention of raw
// household speech/interpreted-activity content for zero product benefit,
// exactly the kind of thing the pre-merge security audit exists to catch.
// If a misfire needs debugging in the future, that's a live-logs-at-the-
// time question, not something worth a permanent database table for.
//
// ============================================================================
// SECURITY: the tool allowlists below are the actual enforcement point for
// this whole feature's core safety property — "no LLM in this pipeline
// ever gets direct tool access to delete or modify an existing event/todo"
// (see ARCHITECTURE.md §10's Implementation section for the full
// reasoning). delete_event/update_event/delete_todo/update_todo must NEVER
// be added to HAIKU_ALLOWED_TOOLS or SONNET_ALLOWED_TOOLS, and neither
// tier is ever given Agent/Task (which could otherwise be used to spawn a
// subagent that itself gets a *different* allowlist, quietly reintroducing
// exactly what this is meant to prevent — see §10's own prototyping note
// that Agent/Task really does work in headless mode and really does
// inherit MCP tools). If a future change needs to widen either list,
// treat that as a security-review-worthy change, not a routine edit.
// ============================================================================
const HAIKU_ALLOWED_TOOLS = [
  "mcp__our-calendar__list_events",
  "mcp__our-calendar__list_todos",
  "mcp__our-calendar__list_people",
  "mcp__our-calendar__create_event",
  "mcp__our-calendar__add_todo",
];

const SONNET_ALLOWED_TOOLS = [
  "WebSearch",
  "WebFetch",
  ...HAIKU_ALLOWED_TOOLS,
];

// Plain JSON Schema (not zod — this is what `--json-schema` actually
// takes), property-for-property the same shape lib/validation.ts's
// `voiceLlmOutputSchema` re-validates the result against server-side. The
// schema only constrains *types*; the "exactly one of these three" rule is
// stated in prose here (for the model) and enforced for real by
// `voiceLlmOutputSchema.refine()` (never trusted from the model's own
// internal consistency — see that schema's own comment).
const VOICE_LLM_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    needsResearch: {
      type: ["string", "null"],
      description:
        "Set this (and leave the other two null) if fulfilling the command needs real-world facts you can't reliably know — a sports schedule, a business's hours, an event's actual date, etc. Describe exactly what needs researching. Never guess a verifiable fact.",
    },
    actionTaken: {
      type: ["string", "null"],
      description:
        "Set this (and leave the other two null) once you've either directly called create_event or add_todo to fulfill the request, or decided no tool call is appropriate (the transcript doesn't describe an actionable calendar/to-do request). Plainly describe what you did, or why you did nothing.",
    },
    proposedDestructiveAction: {
      type: ["object", "null"],
      description:
        "Set this (and leave the other two null) if the command asks to delete or change an EXISTING event or todo. You do not have a tool that can do this — use list_events/list_todos/list_people to identify exactly which row is meant, then describe the proposed change here for a household member to confirm.",
      properties: {
        type: { type: "string", enum: ["delete_event", "update_event", "delete_todo", "update_todo"] },
        targetId: { type: "number", description: "The id of the existing event or todo row this targets." },
        summary: {
          type: "string",
          description:
            'One clear sentence a household member can read to decide whether to confirm this, e.g. "Delete \'Dentist appointment\' on Friday, Aug 14".',
        },
        details: {
          type: "object",
          description:
            "For update_event/update_todo: the partial field changes to apply (e.g. { \"startAt\": \"...\", \"endAt\": \"...\" } or { \"text\": \"...\" }). Empty object for delete_event/delete_todo.",
        },
      },
      required: ["type", "targetId", "summary", "details"],
    },
  },
  required: ["needsResearch", "actionTaken", "proposedDestructiveAction"],
};

// Speed fix, direct request: the household's real person ids (not just
// names) go straight into the system prompt now, so haiku can pass
// personId to create_event directly instead of needing its own
// list_people tool call first to resolve "Gavin" -> an id — one fewer
// sequential MCP round-trip on every "add X for <person>" command, which
// measurably added to real observed latency. This is a plain local DB
// read (actions/people.ts's listPeople, same one list_people the MCP
// server itself calls), not a network/LLM round-trip, so it's
// effectively free to do on every buildSystemPrompt call rather than
// caching it — household membership changes so rarely that a cache would
// only risk serving stale ids for no real benefit. list_people stays in
// both tools' allowedTools regardless, for the genuinely ambiguous case
// (a nickname, "the other Gavin," etc.) — this only removes the *need*
// to call it for the common, unambiguous case, never the ability to.
function householdMembersLine(): string {
  const people = listPeople();
  return people.map((p) => `${p.label} (id ${p.id})`).join(", ");
}

function buildSystemPrompt(tier: "haiku" | "sonnet"): string {
  const now = new Date();
  const dateLine = `Today is ${now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })} (${now.toISOString()}), timezone ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;

  const shared = `You are the voice command triage assistant for "Our Calendar", a shared household calendar/to-do app. You will receive one voice transcript as the user's message — it may be informal, mis-transcribed, or ambiguous; do your best to interpret it charitably, but never guess a verifiable fact you could instead look up or ask to have researched.

Household members: ${householdMembersLine()}. ${dateLine}

Respond only via the required structured output — no free-form prose outside it. Set exactly one of needsResearch / actionTaken / proposedDestructiveAction; leave the other two null.

Rules:
- A straightforward creation (a new calendar event or to-do item) you have enough information for: call create_event or add_todo directly, then set actionTaken describing what you added. If it's for a specific household member, pass their id (given above) as personId directly — don't call list_people first just to look up an id you already have; only call it if the person meant is genuinely unclear (a nickname, "the other one," etc.).
- A request that needs real-world facts you can't reliably know: set needsResearch, don't guess.
- A request to delete or change an EXISTING event or todo: you have no tool that can do this. Use list_events/list_todos/list_people to find the specific row, then set proposedDestructiveAction — never attempt the change yourself.
- Not an actionable calendar/to-do request at all: don't call any tool, set actionTaken explaining that plainly.`;

  if (tier === "haiku") {
    return `${shared}

You are the fast, first-pass tier. If you set needsResearch, a separate research-capable pass will take over from there — you don't need to (and can't) do that research yourself.`;
  }

  return `${shared}

You are the research-escalation tier, invoked because a first-pass triage already determined this needs real-world research. You have WebSearch/WebFetch — cross-check sources rather than trusting a single one, the same standard this household's calendar-add skill already holds itself to. You are the last tier: if you still can't determine what's needed after researching, don't set needsResearch again — set actionTaken explaining what you couldn't determine and why.`;
}

export type VoiceModelTier = "haiku" | "haiku+sonnet-research";

export interface VoiceCommandResult {
  outcome: "executed" | "needs_confirmation" | "no_action" | "error";
  modelTier: VoiceModelTier;
  batchId?: string;
  summary?: string;
  proposedAction?: ProposedDestructiveAction;
  error?: string;
}

/**
 * Runs one triage pass at a given model tier and validates its structured
 * output. `extraEnv` carries `VOICE_COMMAND_BATCH_ID` through to the
 * spawned process (and from there, to mcp/server.ts — see this function's
 * caller for the full reconciliation reasoning). Throws `ClaudeCliError`/
 * `ClaudeCliConfigError` (from lib/claudeCli.ts) on an invocation failure,
 * or a plain `Error` if the result didn't match `voiceLlmOutputSchema`.
 */
async function triage(
  transcript: string,
  tier: "haiku" | "sonnet",
  batchId: string,
  spawnImpl?: ClaudeCliSpawnFn,
): Promise<VoiceLlmOutput> {
  const raw = await runClaudeCommand(
    transcript,
    {
      model: tier,
      jsonSchema: VOICE_LLM_JSON_SCHEMA,
      allowedTools: tier === "haiku" ? HAIKU_ALLOWED_TOOLS : SONNET_ALLOWED_TOOLS,
      systemPrompt: buildSystemPrompt(tier),
      extraEnv: { VOICE_COMMAND_BATCH_ID: batchId },
      timeoutMs: tier === "haiku" ? 45_000 : 90_000, // §10's own observed latency: research escalation runs 16-20s+, needs real headroom
    },
    spawnImpl,
  );

  const parsed = voiceLlmOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Model response didn't match the expected schema: ${JSON.stringify(parsed.error.flatten())}`);
  }
  return parsed.data;
}

/**
 * Runs a full voice command: haiku triage, escalating to sonnet research
 * if requested, resolving to exactly one outcome. Never throws for a
 * failure that happens *inside* the LLM invocation (a denied tool call, a
 * malformed response, a timeout, ...) — those all resolve to
 * `{ outcome: "error" }` instead. The one thing this still throws is
 * `ClaudeCliConfigError` (CLAUDE_CODE_OAUTH_TOKEN missing) — a deployment
 * configuration problem, not a per-command outcome, mirroring how
 * routes/voice.ts already treats `DeepgramConfigError` for §9's
 * transcription endpoint (a distinct 500, not folded into the normal
 * per-request response shape).
 *
 * `spawnImpl` is threaded straight through to lib/claudeCli.ts's
 * `runClaudeCommand` — the same injectable-function pattern
 * lib/deepgram.ts uses for `fetchImpl`, so a test can substitute a fake
 * child process instead of a real (slow, costly, nondeterministic)
 * `claude` invocation. Defaults to the real spawn when omitted.
 */
export async function runVoiceCommand(transcript: string, spawnImpl?: ClaudeCliSpawnFn): Promise<VoiceCommandResult> {
  // Minted up front regardless of what the model ends up doing — cheap
  // (a UUID), and every create this command makes (at either tier) gets
  // tagged with it via VOICE_COMMAND_BATCH_ID (see mcp/server.ts). If
  // nothing gets created, the id is simply never associated with any row —
  // `getBatch`/`undoBatch` on an id nothing was ever tagged with is
  // already a documented graceful no-op (actions/batches.ts), so there's
  // no cleanup needed for the common "nothing was created" case.
  const batchId = mintBatchId("voice");

  let tier: VoiceModelTier = "haiku";
  let result: VoiceLlmOutput;
  try {
    result = await triage(transcript, "haiku", batchId, spawnImpl);

    if (result.needsResearch) {
      tier = "haiku+sonnet-research";
      // ARCHITECTURE.md §10's own design note on this choice: rather than
      // giving haiku the Agent/Task tool and letting *it* spawn a sonnet
      // subagent internally (which §10's prototyping proved genuinely
      // works, but would mean auditing/allowlisting a second, dynamically-
      // spawned invocation we don't control the shape of), this backend
      // orchestrates the escalation itself as a second, independent
      // top-level `claude -p --model sonnet` invocation. Same outcome
      // ("sonnet finishes the job"), but the tool allowlist for *every*
      // invocation in this pipeline stays something this file states
      // explicitly and completely, not something delegated to a nested
      // spawn decision made by the model itself.
      const researchPrompt = `Original voice command: "${transcript}"\n\nA first-pass triage determined this needs research: ${result.needsResearch}\n\nResearch what's needed and complete the request.`;
      result = await triage(researchPrompt, "sonnet", batchId, spawnImpl);
      // Sonnet is the last tier (see its own system prompt) — if it still
      // came back asking for more research, that's treated as a failed
      // triage rather than looping forever.
      if (result.needsResearch) {
        throw new Error("Research escalation still couldn't resolve the command.");
      }
    }
  } catch (err) {
    // ClaudeCliConfigError (CLAUDE_CODE_OAUTH_TOKEN missing) is NOT a
    // per-command outcome — it's a deployment configuration problem, the
    // same distinction routes/voice.ts already draws for
    // DeepgramConfigError. Re-thrown here (not folded into the generic
    // 'error' outcome below) so it reaches routes/voice.ts's own explicit
    // handler and comes back as a clear, distinct 500 rather than a
    // misleadingly generic "couldn't understand that" 200.
    if (err instanceof ClaudeCliConfigError) throw err;

    const message =
      err instanceof ClaudeCliError
        ? claudeCliErrorMessage(err)
        : "Couldn't understand or act on that voice command.";
    return { outcome: "error", modelTier: tier, error: message };
  }

  const outcome = resultToOutcome(result, batchId);
  return { ...outcome, modelTier: tier };
}

function claudeCliErrorMessage(err: ClaudeCliError): string {
  switch (err.reason) {
    case "permission_denied":
      return "Voice command couldn't complete — it tried to do something it isn't allowed to do.";
    case "timeout":
      return "Voice command took too long to complete. Please try again.";
    default:
      return "Couldn't understand or act on that voice command.";
  }
}

/**
 * Turns a validated LLM result into a client-facing outcome. Deliberately
 * does NOT trust `actionTaken`'s own prose to mean "something was
 * created" — it re-derives that from the real database via `getBatch`
 * (actions/batches.ts), the same "the row is the source of truth, not a
 * free-text claim" principle §10a-2 already established for the batch
 * mechanism itself. This is also what makes the executed-vs-no_action
 * distinction robust against `VOICE_COMMAND_BATCH_ID` somehow not
 * reaching mcp/server.ts (see that file's own comment) — if nothing is
 * actually tagged with this batch id, the honest answer is "no_action",
 * not a claimed success the household can't actually undo.
 */
function resultToOutcome(result: VoiceLlmOutput, batchId: string): Omit<VoiceCommandResult, "modelTier"> {
  if (result.proposedDestructiveAction) {
    return {
      outcome: "needs_confirmation",
      proposedAction: result.proposedDestructiveAction,
      summary: result.proposedDestructiveAction.summary,
    };
  }

  const batch = getBatch(batchId);
  const createdCount = batch.events.length + batch.todos.length;
  if (createdCount > 0) {
    return { outcome: "executed", batchId, summary: result.actionTaken ?? undefined };
  }

  return { outcome: "no_action", summary: result.actionTaken ?? "No action was taken." };
}
