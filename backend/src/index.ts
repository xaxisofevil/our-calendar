import express from "express";
import { seed } from "./db/seed.js";
import { eventsRouter } from "./routes/events.js";
import { peopleRouter } from "./routes/people.js";
import { todosRouter } from "./routes/todos.js";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "our-calendar-backend" });
});

app.use("/api/events", eventsRouter);
app.use("/api/todos", todosRouter);
app.use("/api/people", peopleRouter);

// Minimal error handler so a thrown/rejected handler returns JSON, not an
// HTML stack trace, to a frontend that only ever expects JSON.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

// Runs on every boot; idempotent per-table (see db/seed.ts).
seed();

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
