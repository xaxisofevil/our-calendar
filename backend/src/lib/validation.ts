import { z } from "zod";
import rrulePkg from "rrule";

const { RRule } = rrulePkg;

// Bare RFC 5545 RRULE text, no "DTSTART" / "RRULE:" prefix — the event's own
// startAt column is the DTSTART (see ARCHITECTURE.md §7a). Validated by
// actually parsing it with the `rrule` package rather than a hand-rolled
// regex, so anything the expansion code in lib/recurrence.ts couldn't
// handle is rejected up front instead of silently producing zero occurrences.
const recurrenceRuleField = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .nullable()
  .optional()
  .refine(
    (value) => {
      if (value == null) return true;
      try {
        RRule.fromString(`RRULE:${value}`);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid recurrence rule" },
  );

const eventDateTime = z.string().datetime({ offset: true });
const eventFieldsSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  startAt: eventDateTime,
  endAt: eventDateTime,
  allDay: z.boolean().optional().default(false),
  personId: z.number().int().positive().nullable().optional(),
  recurrenceRule: recurrenceRuleField,
});

function validEventRange(value: { startAt: string; endAt: string }, ctx: z.RefinementCtx): void {
  const start = new Date(value.startAt).getTime();
  const end = new Date(value.endAt).getTime();
  const horizon = 10 * 365.25 * 24 * 60 * 60_000;
  if (end <= start) ctx.addIssue({ code: "custom", path: ["endAt"], message: "End must be after start" });
  if (Math.abs(start - Date.now()) > horizon) {
    ctx.addIssue({ code: "custom", path: ["startAt"], message: "Event must be within 10 years" });
  }
}

export const createEventSchema = eventFieldsSchema.superRefine(validEventRange);
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = eventFieldsSchema.partial();
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

// Optional ISO 8601 date (YYYY-MM-DD) — see ARCHITECTURE.md §8/§11.
const dueAtField = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .nullable()
  .optional();

export const createTodoSchema = z.object({
  text: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).nullable().optional(),
  dueAt: dueAtField,
  list: z.string().trim().min(1).max(50).optional().default("household"),
});
export type CreateTodoInput = z.infer<typeof createTodoSchema>;

export const updateTodoSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  dueAt: dueAtField,
  completed: z.boolean().optional(),
  position: z.number().int().optional(),
  list: z.string().trim().min(1).max(50).optional(),
});
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;

// ARCHITECTURE.md §8a/§12 — POST /api/push/subscribe's body is a
// `PushSubscription.toJSON()` object (endpoint + a `keys` object), the
// standard shape the browser's Push API hands back from
// `pushManager.subscribe()`. `deviceLabel` is optional/best-effort (§11).
export const subscribePushSchema = z.object({
  endpoint: z.string().trim().min(1).max(2000),
  keys: z.object({
    p256dh: z.string().trim().min(1).max(500),
    auth: z.string().trim().min(1).max(500),
  }),
  deviceLabel: z.string().trim().max(100).nullable().optional(),
});
export type SubscribePushInput = z.infer<typeof subscribePushSchema>;

// DELETE /api/push/subscribe just needs to know which subscription to
// remove (e.g. the device uninstalled the PWA) — the same `endpoint` a
// subscribe call registered it under.
export const unsubscribePushSchema = z.object({
  endpoint: z.string().trim().min(1).max(2000),
});
export type UnsubscribePushInput = z.infer<typeof unsubscribePushSchema>;

// ARCHITECTURE.md §10/§12 (M8) — POST /api/voice/command's request body.
// The transcript comes straight from POST /api/voice/transcribe's own
// output (§9), untrusted user speech-to-text — this is the one and only
// place it's validated as plain data before it's ever handed to
// lib/claudeCli.ts, which passes it to `spawn()` as its own argv element
// (never shell-interpolated — see that file's own comment on why that
// distinction is the actual security boundary, not this schema).
export const voiceCommandRequestSchema = z.object({
  transcript: z.string().trim().min(1).max(2000),
});
export type VoiceCommandRequestInput = z.infer<typeof voiceCommandRequestSchema>;

// The one shape an LLM invocation in the voice command layer is ever
// allowed to *propose* touching an existing event/todo with — never
// executed by the LLM itself (see ARCHITECTURE.md §10's security note: no
// invocation in this pipeline is ever given delete_event/update_event/
// delete_todo/update_todo as a callable tool). `targetId` + `type` say
// which row and what kind of change; `summary` is what a household member
// reads to decide whether to confirm it; `details` is the partial-update
// payload for update_event/update_todo (validated for real against
// updateEventSchema/updateTodoSchema at confirm time, in routes/voice.ts —
// not here, since at propose time it's just an LLM's draft of what it
// wants, not yet something being executed against a real row).
//
// Reused twice: as one of voiceLlmOutputSchema's three branches below (what
// the LLM is allowed to say it wants), and as POST /api/voice/confirm's own
// request body schema (routes/voice.ts) — the frontend echoes back exactly
// this shape (ARCHITECTURE.md's stateless-confirm design), so validating
// both ends against the same zod object means there's no second, silently
// drifting definition of "what a proposed destructive action looks like."
export const proposedDestructiveActionSchema = z.object({
  type: z.enum(["delete_event", "update_event", "delete_todo", "update_todo"]),
  targetId: z.number().int().positive(),
  summary: z.string().trim().min(1).max(500),
  details: z.record(z.string(), z.unknown()).default({}),
});
export type ProposedDestructiveAction = z.infer<typeof proposedDestructiveActionSchema>;

// The client confirms only an opaque, short-lived, single-use server-issued
// id. It never echoes executable type/target/details back to the mutation
// endpoint; see lib/voiceConfirmations.ts.
export const voiceConfirmationRequestSchema = z.object({
  confirmationId: z.string().uuid(),
});

// The extended structured-output contract every voice-command-layer LLM
// invocation (haiku triage, and the on-demand sonnet research escalation —
// see lib/voiceCommand.ts) is forced to produce via `claude -p`'s
// `--json-schema` flag (lib/claudeCli.ts). Three branches, exactly one
// meaningfully set at a time — enforced here with `.refine()` rather than
// trusted from the model's own internal consistency, because a
// `--json-schema`-conforming *shape* is only a guarantee about types, not
// about the model actually respecting "set only one of these" the way its
// system prompt asks it to (see lib/voiceCommand.ts's system prompt text).
// A response that sets zero, two, or three branches is treated as a
// malformed result (lib/voiceCommand.ts's 'error' outcome), not silently
// coerced into picking one.
export const voiceLlmOutputSchema = z
  .object({
    // Set when fulfilling the command needs real-world facts this tier
    // can't reliably know (a sports schedule, a business's hours, ...) —
    // describes what needs researching. Never acted on directly; it's what
    // triggers lib/voiceCommand.ts's sonnet escalation.
    needsResearch: z.string().trim().min(1).max(2000).nullable(),
    // Set once the model has either directly called create_event/add_todo
    // to fulfill the request, or decided no tool call was appropriate (an
    // unintelligible or non-actionable transcript) — a plain description of
    // what happened either way. lib/voiceCommand.ts never trusts this
    // string to mean "something was created" — it re-derives that from the
    // real database via `getBatch(batchId)` instead (see that file's own
    // comment on why).
    actionTaken: z.string().trim().min(1).max(2000).nullable(),
    // Set when the command asks to delete/modify an EXISTING event or
    // todo — the model has no tool that can do this itself (see this
    // schema's own comment above), so this is the only way it can express
    // that intent; a human confirms it via POST /api/voice/confirm.
    proposedDestructiveAction: proposedDestructiveActionSchema.nullable(),
  })
  .refine(
    (value) => {
      const setCount = [value.needsResearch, value.actionTaken, value.proposedDestructiveAction].filter(
        (v) => v != null,
      ).length;
      return setCount === 1;
    },
    { message: "Exactly one of needsResearch / actionTaken / proposedDestructiveAction must be set" },
  );
export type VoiceLlmOutput = z.infer<typeof voiceLlmOutputSchema>;

// POST /api/voice/undo's request body — the one minimal HTTP surface for
// actions/batches.ts's `undoBatch` (ARCHITECTURE.md §10a-2 deliberately
// left this unbuilt until a real caller needed it; §10/M8's "what was
// created" undo button is that caller). No length/shape assumption beyond
// "some non-empty string" — `undoBatch` itself already treats an unknown
// batch id as a graceful no-op rather than an error.
export const undoBatchRequestSchema = z.object({
  batchId: z.string().trim().min(1).max(200),
});
export type UndoBatchRequestInput = z.infer<typeof undoBatchRequestSchema>;
