import { z } from "zod";

export const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4000).nullable().optional(),
  location: z.string().trim().max(200).nullable().optional(),
  startAt: z.string().min(1),
  endAt: z.string().min(1),
  allDay: z.boolean().optional().default(false),
  personId: z.number().int().nullable().optional(),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = createEventSchema.partial();
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const createTodoSchema = z.object({
  text: z.string().trim().min(1).max(500),
  notes: z.string().trim().max(2000).nullable().optional(),
  list: z.string().trim().min(1).max(50).optional().default("household"),
});
export type CreateTodoInput = z.infer<typeof createTodoSchema>;

export const updateTodoSchema = z.object({
  text: z.string().trim().min(1).max(500).optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  completed: z.boolean().optional(),
  position: z.number().int().optional(),
  list: z.string().trim().min(1).max(50).optional(),
});
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
