import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as api from "./api";
import type { CreateEventInput, CreateTodoInput, UpdateEventInput, UpdateTodoInput } from "../types";

// No SSE yet (that's explicitly M2 scope per ARCHITECTURE.md — the
// household-shared to-do list + settings sync milestone). For now every
// mutation just invalidates the relevant query key and React Query
// refetches. Good enough for a single device exercising the UI; multi-device
// live sync is the thing M2 adds on top of this same data layer.

export function useEventsQuery(start: string, end: string) {
  return useQuery({
    queryKey: ["events", start, end],
    queryFn: () => api.fetchEvents(start, end),
  });
}

export function useTodosQuery() {
  return useQuery({
    queryKey: ["todos"],
    queryFn: api.fetchTodos,
  });
}

export function usePeopleQuery() {
  return useQuery({
    queryKey: ["people"],
    queryFn: api.fetchPeople,
    staleTime: 5 * 60_000, // rarely changes — no UI to edit people yet
  });
}

export function useCreateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateEventInput) => api.createEvent(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateEventInput }) => api.updateEvent(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTodoInput) => api.createTodo(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: UpdateTodoInput }) => api.updateTodo(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.deleteTodo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["todos"] });
    },
  });
}
