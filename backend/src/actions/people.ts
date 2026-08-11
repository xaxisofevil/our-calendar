import { db } from "../db/client.js";
import { people } from "../db/schema.js";

// Shared action layer (ARCHITECTURE.md §10a). Read-only by design — fixed
// household of 4, managed by the seed script rather than an editing UI (see
// routes/people.ts). Called by both the REST route and the MCP server.

export interface PersonDTO {
  id: number;
  label: string;
  color: string;
}

export function listPeople(): PersonDTO[] {
  return db.select().from(people).all();
}
