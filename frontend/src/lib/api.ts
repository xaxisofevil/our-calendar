import type {
  CreateEventInput,
  CreateTodoInput,
  EventRecord,
  PersonRecord,
  TodoRecord,
  UpdateEventInput,
  UpdateTodoInput,
} from "../types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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
