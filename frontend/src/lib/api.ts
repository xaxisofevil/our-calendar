import type {
  CreateEventInput,
  CreateTodoInput,
  EventRecord,
  PersonRecord,
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
