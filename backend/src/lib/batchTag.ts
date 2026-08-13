// Small human-readable provenance trace appended to a batch-created row's
// own free-text field (events.description / todos.notes) — see
// ARCHITECTURE.md's batch-undo subsection (near §10a-1) for the full
// reasoning. This is deliberately NOT part of the undo mechanism: undoing a
// batch (backend/src/actions/batches.ts's `undoBatch`) finds rows via the
// real, indexed `batch_id` column, never by parsing this string back out.
// It exists purely so a household member looking at an event/todo and
// wondering "why is this here" has a visible answer in the UI they're
// already looking at — the same value the calendar-add skill's own
// `[calendar-add:<id>]` tag already proved out in practice, generalized
// here to a plain `[batch:<id>]` since this is no longer calendar-add-
// specific (calendar-add itself is untouched and keeps writing its own
// tag directly — see the architecture note on why that skill wasn't
// migrated to this).
//
// Lives here (lib/, not actions/) specifically so actions/events.ts and
// actions/todos.ts can both import it without either importing from
// actions/batches.ts — batches.ts imports deleteEvent/deleteTodo from
// those two modules, so having them import back from batches.ts too would
// create a real circular dependency between actions/ modules for no
// reason; this one pure string-formatting helper doesn't need to live
// next to mintBatchId/undoBatch to make sense.
export function appendBatchTag(text: string | null | undefined, batchId: string | null | undefined): string | null {
  if (!batchId) return text ?? null;
  const tag = `[batch:${batchId}]`;
  return text && text.trim().length > 0 ? `${text}\n\n${tag}` : tag;
}
