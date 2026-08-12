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
  position: number;
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
}

export interface UpdateTodoInput {
  text?: string;
  notes?: string | null;
  dueAt?: string | null;
  completed?: boolean;
  position?: number;
  list?: string;
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
