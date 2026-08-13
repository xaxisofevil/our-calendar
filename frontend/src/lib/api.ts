import type {
  CreateEventInput,
  CreateTodoInput,
  EventRecord,
  PersonRecord,
  PushSubscriptionRecord,
  SubscribePushInput,
  TodoRecord,
  UpdateEventInput,
  UpdateTodoInput,
} from "../types";
import { notifyUnauthorized } from "./auth";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    credentials: "same-origin",
    ...init,
  });
  if (res.status === 401) {
    // ARCHITECTURE.md §5/§12 — a session that's missing/invalid/expired.
    // Flip the app back to the passcode screen (see lib/auth.ts's
    // useAuthGate) rather than surfacing this as just another failed
    // mutation; the caller's own error handling still runs below too.
    notifyUnauthorized();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Resolves on a correct passcode (the session cookie is set as a response
 * header — nothing to read from the body), rejects on a wrong one. */
export function login(passcode: string): Promise<void> {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ passcode }) });
}

export function logout(): Promise<void> {
  return request("/api/auth/logout", { method: "POST" });
}

export function fetchEvents(startDate: string, endDate: string): Promise<EventRecord[]> {
  return request(`/api/events?start=${startDate}&end=${endDate}`);
}

export function fetchPeople(): Promise<PersonRecord[]> {
  return request("/api/people");
}

export function createEvent(input: CreateEventInput): Promise<EventRecord> {
  return request("/api/events", { method: "POST", body: JSON.stringify(input) });
}

export function updateEvent(id: number, input: UpdateEventInput): Promise<EventRecord> {
  return request(`/api/events/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteEvent(id: number): Promise<void> {
  return request(`/api/events/${id}`, { method: "DELETE" });
}

export function fetchTodos(): Promise<TodoRecord[]> {
  return request("/api/todos");
}

export function createTodo(input: CreateTodoInput): Promise<TodoRecord> {
  return request("/api/todos", { method: "POST", body: JSON.stringify(input) });
}

export function updateTodo(id: number, input: UpdateTodoInput): Promise<TodoRecord> {
  return request(`/api/todos/${id}`, { method: "PATCH", body: JSON.stringify(input) });
}

export function deleteTodo(id: number): Promise<void> {
  return request(`/api/todos/${id}`, { method: "DELETE" });
}

// ARCHITECTURE.md §8a/§12 — the whole "Enable notifications" flow's two
// backend calls (see lib/push.ts's enablePushNotifications).
export function subscribePush(input: SubscribePushInput): Promise<PushSubscriptionRecord> {
  return request("/api/push/subscribe", { method: "POST", body: JSON.stringify(input) });
}

export function unsubscribePush(endpoint: string): Promise<void> {
  return request("/api/push/subscribe", { method: "DELETE", body: JSON.stringify({ endpoint }) });
}

// ARCHITECTURE.md §9 (M7) — uploads one push-to-talk audio clip (see
// lib/useVoiceCapture.ts). Deliberately not built on request() above: the
// body is a raw audio Blob, not JSON (request() always sets
// "Content-Type: application/json" and JSON.stringify()s its body), and
// request()'s error path always JSON.stringify()s `body.error` before
// throwing — fine for the zod `fieldErrors` shape every other route
// returns, but routes/voice.ts's errors are already a single plain,
// human-readable string ("Voice transcription isn't set up yet.", etc.),
// so this throws that string directly rather than re-wrapping it in extra
// quotes friendlyErrorMessage was never meant to unwrap.
export async function transcribeVoice(blob: Blob): Promise<{ transcript: string }> {
  let res: Response;
  try {
    res = await fetch("/api/voice/transcribe", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": blob.type || "application/octet-stream" },
      body: blob,
    });
  } catch {
    throw new Error("Couldn't reach the server — check your connection and try again.");
  }

  if (res.status === 401) {
    notifyUnauthorized();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(typeof body?.error === "string" ? body.error : "Couldn't transcribe that — please try again.");
  }
  return res.json() as Promise<{ transcript: string }>;
}
