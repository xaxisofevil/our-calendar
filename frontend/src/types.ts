// Mirrors backend/src/routes/{events,todos}.ts serializers. Hand-kept in
// sync for M1 — see report-back notes re: a real shared-types workspace.

export interface PersonRecord {
  id: number;
  label: string;
  color: string; // hex, used directly (not a skin token) — person color is data, not design
}

export interface EventRecord {
  id: number;
  personId: number | null;
  title: string;
  description: string | null;
  location: string | null;
  startAt: string; // ISO 8601
  endAt: string; // ISO 8601
  allDay: boolean;
  // Bare RFC 5545 RRULE text (no DTSTART/RRULE: prefix), null for
  // non-recurring events — see ARCHITECTURE.md §7a. Set on every expanded
  // occurrence the same as on the master row.
  recurrenceRule: string | null;
}

export interface TodoRecord {
  id: number;
  text: string;
  notes: string | null;
  dueAt: string | null; // ISO 8601 date (YYYY-MM-DD), optional — §8/§11
  completed: boolean;
  list: string;
  // Direct request: person-scoped to-do lists. NULL = Shared (no single
  // owner); a set personId scopes to that person's own list, with
  // alsoShared independently controlling whether it also shows in Shared.
  personId: number | null;
  alsoShared: boolean;
  position: number;
  // Client-only, never sent by the server or to it — set while an
  // optimistic create/update/delete for this row is still in flight (see
  // lib/queries.ts's useCreateTodo/useUpdateTodo/useDeleteTodo). Exists so
  // the UI can show a visibly-pending row instead of pretending an
  // unconfirmed save is already final — a real, disclosed limitation is
  // better than a silent lie if the save actually fails.
  pending?: boolean;
}

export interface CreateEventInput {
  title: string;
  description?: string | null;
  location?: string | null;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  personId?: number | null;
  recurrenceRule?: string | null;
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  personId?: number | null;
  recurrenceRule?: string | null;
}

export interface CreateTodoInput {
  text: string;
  notes?: string | null;
  dueAt?: string | null;
  list?: string;
  personId?: number | null;
  alsoShared?: boolean;
}

export interface UpdateTodoInput {
  text?: string;
  notes?: string | null;
  dueAt?: string | null;
  completed?: boolean;
  position?: number;
  list?: string;
  personId?: number | null;
  alsoShared?: boolean;
}

// ARCHITECTURE.md §8a/§12 — mirrors backend/src/actions/push.ts's
// SubscribePushInput/PushSubscriptionDTO.
export interface SubscribePushInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  deviceLabel?: string | null;
}

export interface PushSubscriptionRecord {
  id: number;
  endpoint: string;
  deviceLabel: string | null;
  createdAt: string;
}

// ARCHITECTURE.md §10/§12 (M8) — mirrors backend/src/lib/validation.ts's
// `proposedDestructiveActionSchema`. Never executed directly by the
// frontend — this is exactly what gets echoed back to
// POST /api/voice/confirm unchanged (see lib/api.ts's `confirmVoiceAction`).
export interface ProposedDestructiveAction {
  type: "delete_event" | "update_event" | "delete_todo" | "update_todo";
  targetId: number;
  summary: string;
  details: Record<string, unknown>;
}

// Mirrors backend/src/lib/voiceCommand.ts's `VoiceCommandResult`.
export interface VoiceCommandResult {
  outcome: "executed" | "needs_confirmation" | "no_action" | "error";
  modelTier: "haiku" | "haiku+sonnet-research";
  batchId?: string;
  summary?: string;
  proposedAction?: ProposedDestructiveAction;
  confirmationId?: string;
  error?: string;
}

export interface UndoBatchResult {
  batchId: string;
  deletedEvents: number;
  deletedTodos: number;
}

export interface TranscribeVoiceResult {
  transcript: string;
}
