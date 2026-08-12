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

export const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  allDay: z.boolean().optional().default(false),
  personId: z.number().int().nullable().optional(),
  recurrenceRule: recurrenceRuleField,
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = createEventSchema.partial();
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
