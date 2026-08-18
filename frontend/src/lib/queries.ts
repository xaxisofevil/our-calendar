import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { CreateEventInput, CreateTodoInput, TodoRecord, UpdateEventInput, UpdateTodoInput } from "../types";

// Monotonically decreasing negative counter for optimistic to-do temp ids —
// real ids are always positive (SQLite autoincrement), so negative ids can
// never collide with a real one, and a plain decrementing counter (not
// Date.now()-based) guarantees uniqueness even for several adds fired in
// the same millisecond. Module-level on purpose: must stay unique for the
// life of the tab, not reset per-render/per-hook-instance.
let nextOptimisticTodoId = -1;

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

// Direct request, post-launch latency diagnosis: "adding a short text blurb
// should have zero latency, as fast as a text message." The previous
// invalidate-on-success pattern (still used for events, see above) made
// every todo mutation wait a full round-trip, then throw its own perfectly
// good response away and do a *second* round-trip (a refetch) just to
// redraw the list. These three hooks instead write directly into the
// ["todos"] cache — optimistically in onMutate (so the UI updates before
// the network request even resolves), reconciled with the server's real
// response in onSuccess, rolled back to an exact snapshot in onError. A
// failed save now visibly reverts rather than either silently lying that
// it worked or leaving a ghost row behind — the same class of bug this
// session spent real time chasing as an accident is not something to
// reintroduce on purpose. `pending: true` (types.ts) marks an
// unconfirmed row so the UI can show it's not final yet, same reasoning.
//
// cancelQueries first in every onMutate: without it, an in-flight refetch
// from a moment earlier (e.g. this tab's own SSE-triggered background
// invalidate — see useLiveSync.ts) could resolve *after* the optimistic
// write and silently clobber it with stale pre-mutation data.
export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTodoInput) => api.createTodo(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      const previous = queryClient.getQueryData<TodoRecord[]>(["todos"]);
      const tempId = nextOptimisticTodoId--;
      const optimistic: TodoRecord = {
        id: tempId,
        text: input.text,
        notes: input.notes ?? null,
        dueAt: input.dueAt ?? null,
        completed: false,
        list: input.list ?? "household",
        personId: input.personId ?? null,
        alsoShared: input.alsoShared ?? false,
        position: previous?.length ?? 0,
        pending: true,
      };
      queryClient.setQueryData<TodoRecord[]>(["todos"], (old) => [...(old ?? []), optimistic]);
      return { previous, tempId };
    },
    onError: (error, _input, context) => {
      logMutationError("create todo")(error);
      if (context) queryClient.setQueryData(["todos"], context.previous);
    },
    onSuccess: (created, _input, context) => {
      queryClient.setQueryData<TodoRecord[]>(["todos"], (old) =>
        (old ?? []).map((t) => (t.id === context.tempId ? created : t)),
      );
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateTodoInput }) => api.updateTodo(id, input),
    onMutate: async ({ id, input }) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      const previous = queryClient.getQueryData<TodoRecord[]>(["todos"]);
      queryClient.setQueryData<TodoRecord[]>(["todos"], (old) =>
        (old ?? []).map((t) => (t.id === id ? { ...t, ...input, pending: true } : t)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      logMutationError("update todo")(error);
      if (context) queryClient.setQueryData(["todos"], context.previous);
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<TodoRecord[]>(["todos"], (old) =>
        (old ?? []).map((t) => (t.id === updated.id ? updated : t)),
      );
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteTodo(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: ["todos"] });
      const previous = queryClient.getQueryData<TodoRecord[]>(["todos"]);
      queryClient.setQueryData<TodoRecord[]>(["todos"], (old) => (old ?? []).filter((t) => t.id !== id));
      return { previous };
    },
    onError: (error, _id, context) => {
      logMutationError("delete todo")(error);
      if (context) queryClient.setQueryData(["todos"], context.previous);
    },
    // No onSuccess reconciliation needed — the optimistic removal already
    // matches server truth once the delete actually succeeds.
  });
}
