// A tiny stand-in for Deepgram's pre-recorded transcription REST endpoint
// (ARCHITECTURE.md §9), used only by e2e/voice.spec.ts. There is no real
// DEEPGRAM_API_KEY available yet (see §9's own "Implementation" note), so
// the isolated e2e backend's DEEPGRAM_API_URL (playwright.config.ts) points
// here instead of at the real Deepgram API — never a real account, never
// real network egress.
//
// Behavior is driven entirely by the request body's raw bytes, decoded as
// UTF-8 text — voice.spec.ts's "audio" blobs are just plain text standing
// in for real audio, since this is a mock and backend/src/lib/deepgram.ts
// only ever forwards whatever bytes it's given. That keeps deepgram.ts
// itself free of any test-only headers/branches:
//
//   - body === "SILENT_CLIP"          -> 200, empty transcript (a valid
//                                         "didn't catch any speech" result
//                                         per §9, not an error)
//   - body starts "TRIGGER_DEEPGRAM_ERROR" -> 500 with a raw-looking
//                                         upstream error body, so
//                                         voice.spec.ts can assert the real
//                                         backend sanitizes it rather than
//                                         relaying it to the client
//   - anything else                   -> 200, that text echoed back as the
//                                         transcript, wrapped in Deepgram's
//                                         real response shape
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 4402);

const server = createServer((req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");

    if (body.startsWith("TRIGGER_DEEPGRAM_ERROR")) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          err_code: "INTERNAL_SERVER_ERROR",
          err_msg: "mock upstream failure detail — must never reach the client",
        }),
      );
      return;
    }

    const transcript = body === "SILENT_CLIP" ? "" : body;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript }] }] } }));
  });
});

server.listen(PORT, () => {
  console.log(`[mock-deepgram] listening on http://localhost:${PORT}`);
});
