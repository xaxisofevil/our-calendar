import { randomUUID } from "node:crypto";
import { listEvents } from "../actions/events.js";
import { listTodos } from "../actions/todos.js";
import { ActionNotFoundError, ActionValidationError } from "../actions/errors.js";
import {
  updateEventSchema,
  updateTodoSchema,
  type ProposedDestructiveAction,
} from "./validation.js";

const CONFIRMATION_TTL_MS = 2 * 60_000;

interface PendingConfirmation {
  action: ProposedDestructiveAction;
  sessionKey: string;
  targetSnapshot: string;
  expiresAt: number;
}

const pending = new Map<string, PendingConfirmation>();

export class VoiceConfirmationInvalidError extends Error {}
export class VoiceConfirmationStaleError extends Error {}

function targetFor(action: ProposedDestructiveAction) {
  if (action.type.endsWith("_event")) {
    const event = listEvents().find((item) => item.id === action.targetId);
    if (!event) throw new ActionNotFoundError("Event not found");
    return event;
  }
  const todo = listTodos().find((item) => item.id === action.targetId);
  if (!todo) throw new ActionNotFoundError("Todo not found");
  return todo;
}

function normalizeAction(action: ProposedDestructiveAction): ProposedDestructiveAction {
  if (action.targetId <= 0) throw new VoiceConfirmationInvalidError("Invalid confirmation target");

  let details: Record<string, unknown> = {};
  if (action.type === "update_event") {
    const parsed = updateEventSchema.safeParse(action.details);
    if (!parsed.success) throw new ActionValidationError(parsed.error);
    details = parsed.data;
  } else if (action.type === "update_todo") {
    const parsed = updateTodoSchema.safeParse(action.details);
    if (!parsed.success) throw new ActionValidationError(parsed.error);
    details = parsed.data;
  } else if (Object.keys(action.details).length > 0) {
    throw new VoiceConfirmationInvalidError("Delete confirmations cannot contain update fields");
  }

  if (action.type.startsWith("update_") && Object.keys(details).length === 0) {
    throw new VoiceConfirmationInvalidError("Update confirmation contains no changes");
  }
  return { ...action, details };
}

function trustedSummary(action: ProposedDestructiveAction, target: ReturnType<typeof targetFor>): string {
  if (action.type === "delete_event" && "title" in target) {
    const series = target.recurrenceRule ? " (entire recurring series)" : "";
    return `Delete event “${target.title}” at ${target.startAt}${series}.`;
  }
  if (action.type === "update_event" && "title" in target) {
    return `Update event “${target.title}” at ${target.startAt}: ${JSON.stringify(action.details)}.`;
  }
  if (action.type === "delete_todo" && "text" in target) {
    return `Delete to-do “${target.text}”.`;
  }
  if (action.type === "update_todo" && "text" in target) {
    return `Update to-do “${target.text}”: ${JSON.stringify(action.details)}.`;
  }
  throw new VoiceConfirmationInvalidError("Confirmation target type mismatch");
}

function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, item] of pending) if (item.expiresAt <= now) pending.delete(id);
}

export function issueVoiceConfirmation(
  proposed: ProposedDestructiveAction,
  sessionKey: string,
): { confirmationId: string; action: ProposedDestructiveAction } {
  purgeExpired();
  const normalized = normalizeAction(proposed);
  const target = targetFor(normalized);
  const action = { ...normalized, summary: trustedSummary(normalized, target) };
  const confirmationId = randomUUID();
  pending.set(confirmationId, {
    action,
    sessionKey,
    targetSnapshot: snapshot(target),
    expiresAt: Date.now() + CONFIRMATION_TTL_MS,
  });
  return { confirmationId, action };
}

/** Consumes once, before execution. A retry can never replay a destructive action. */
export function consumeVoiceConfirmation(confirmationId: string, sessionKey: string): ProposedDestructiveAction {
  purgeExpired();
  const item = pending.get(confirmationId);
  pending.delete(confirmationId);
  if (!item || item.sessionKey !== sessionKey) {
    throw new VoiceConfirmationInvalidError("Confirmation is invalid or expired");
  }
  if (snapshot(targetFor(item.action)) !== item.targetSnapshot) {
    throw new VoiceConfirmationStaleError("The target changed; request a new voice confirmation");
  }
  return item.action;
}
