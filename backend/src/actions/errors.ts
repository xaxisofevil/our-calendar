import type { ZodError } from "zod";

// Shared error types for the action layer (ARCHITECTURE.md §10a) — thrown by
// action functions on bad input or a missing row, caught once by each
// caller (Express routes, the MCP server) and translated into whatever
// shape that transport wants. Keeping the error *type* shared (rather than
// each caller re-deriving "was this a validation problem or a not-found?")
// is the same "one home for this logic" reasoning as the actions themselves.

// Thrown when a zod schema rejects an action's input. `issues` is the exact
// `.flatten()` shape the pre-extraction route handlers returned directly as
// `{ error: parsed.error.flatten() }` — carried through unchanged so the
// REST responses this replaces are byte-for-byte identical.
export class ActionValidationError extends Error {
  readonly issues: ReturnType<ZodError["flatten"]>;

  constructor(zodError: ZodError) {
    super("Validation failed");
    this.name = "ActionValidationError";
    this.issues = zodError.flatten();
  }
}

// Thrown when an action targets a row (by id) that doesn't exist.
export class ActionNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionNotFoundError";
  }
}
