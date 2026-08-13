import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { voiceCommands } from "../db/schema.js";

// Shared action layer (ARCHITECTURE.md §10a's "one home for this logic"
// pattern, extended to the voice command layer, §10/M8). A thin,
// deliberately dumb insert — unlike events/todos, there is no update/delete
// surface here: a voice_commands row is a fact about what happened at the
// time it happened, never edited afterward (even the batch it created can
// later be undone via `undoBatch`, but the row recording that it *was*
// created stays as-is — the audit trail describes history, it doesn't
// track current state).

export type VoiceModelTier = "haiku" | "haiku+sonnet-research";
export type VoiceCommandStatus = "accepted" | "rejected" | "error";

export interface VoiceCommandDTO {
  id: number;
  transcript: string;
  modelTier: VoiceModelTier;
  parsedAction: string | null;
  batchId: string | null;
  status: VoiceCommandStatus;
  createdAt: string;
}

function serialize(row: typeof voiceCommands.$inferSelect): VoiceCommandDTO {
  return {
    id: row.id,
    transcript: row.transcript,
    modelTier: row.modelTier as VoiceModelTier,
    parsedAction: row.parsedAction,
    batchId: row.batchId,
    status: row.status as VoiceCommandStatus,
    createdAt: row.createdAt,
  };
}

export interface RecordVoiceCommandInput {
  transcript: string;
  modelTier: VoiceModelTier;
  /** Pre-stringified JSON (or a plain description for an 'error' row) —
   * the caller (lib/voiceCommand.ts) owns deciding what's worth recording,
   * this function just persists it verbatim. */
  parsedAction: string | null;
  batchId: string | null;
  status: VoiceCommandStatus;
}

/** Not wrapped in the actions/errors.ts validation machinery like
 * events/todos — this is only ever called with a value lib/voiceCommand.ts
 * itself already constructed and trusts, never directly from an untrusted
 * request body (there's no REST/MCP route that writes voice_commands rows
 * directly). */
export function recordVoiceCommand(input: RecordVoiceCommandInput): VoiceCommandDTO {
  const now = new Date().toISOString();
  const result = db
    .insert(voiceCommands)
    .values({
      transcript: input.transcript,
      modelTier: input.modelTier,
      parsedAction: input.parsedAction,
      batchId: input.batchId,
      status: input.status,
      createdAt: now,
    })
    .run();

  const row = db
    .select()
    .from(voiceCommands)
    .where(eq(voiceCommands.id, Number(result.lastInsertRowid)))
    .get();
  return serialize(row!);
}
