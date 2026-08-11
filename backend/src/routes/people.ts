import { Router } from "express";
import { listPeople } from "../actions/index.js";

export const peopleRouter = Router();

// Read-only by design — fixed household of 4 (confirmed, not a placeholder),
// managed by the seed script rather than an editing UI. No dynamic
// people-management planned; if that ever changes, revisit this.
peopleRouter.get("/", (_req, res) => {
  res.json(listPeople());
});
