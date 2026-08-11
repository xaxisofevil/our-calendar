import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { CreateEventInput, CreateTodoInput, UpdateEventInput, UpdateTodoInput } from "../types";

// Every mutation invalidates the relevant query key on success, same as
// before M2 — the difference now is that OTHER clients also get invalidated
// live via the SSE channel (see lib/useLiveSync.ts), not just the one that
// made the change.
//
// onError here is deliberately just a console log for debugging visibility
// — react-query already tracks `.error`/`.isError` on every mutation
// automatically regardless of whether onError is defined, and that's what
// callers (App.tsx) read to actually surface a message to the user (see
// lib/errors.ts). This fixes the M2 bug report (ARCHITECTURE.md §14): a
// rejected mutation used to fail completely silently, with nothing in the
// console or the UI.
function logMutationError(context: string) {
  return (error: unknown) => {
    console.error(`[mutation] ${context} failed:`, error);
  };
}

// `enabled` (default true) lets App.tsx hold these off until the passcode
// gate (lib/auth.ts's useAuthGate) confirms a valid session — otherwise
// every one of these would fire (and 401) on first load, before the initial
// auth check even resolves.
export function useEventsQuery(start: string, end: string, enabled = true) {
  return useQuery({
    queryKey: ["events", start, end],
    queryFn: () => api.fetchEvents(start, end),
    enabled,
  });
}

export function useTodosQuery(enabled = true) {
  return useQuery({
    queryKey: ["todos"],
    queryFn: api.fetchTodos,
    enabled,
  });
}

export function usePeopleQuery(enabled = true) {
  return useQuery({
    queryKey: ["people"],
    queryFn: api.fetchPeople,
    staleTime: 5 * 60_000, // rarely changes — no UI to edit people yet
    enabled,
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => api.createEvent(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: logMutationError("create event"),
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateEventInput }) => api.updateEvent(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: logMutationError("update event"),
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
    onError: logMutationError("delete event"),
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTodoInput) => api.createTodo(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: logMutationError("create todo"),
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateTodoInput }) => api.updateTodo(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: logMutationError("update todo"),
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteTodo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
    onError: logMutationError("delete todo"),
  });
}
