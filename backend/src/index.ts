import express from "express";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", service: "our-calendar-backend" });
});

app.listen(PORT, () => {
  console.log(`Backend listening on http://localhost:${PORT}`);
});
