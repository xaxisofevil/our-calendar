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
}

export interface TodoRecord {
  id: number;
  text: string;
  notes: string | null;
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
}

export interface UpdateEventInput {
  title?: string;
  description?: string | null;
  location?: string | null;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  personId?: number | null;
}

export interface CreateTodoInput {
  text: string;
  notes?: string | null;
  list?: string;
}

export interface UpdateTodoInput {
  text?: string;
  notes?: string | null;
  completed?: boolean;
  position?: number;
  list?: string;
}
