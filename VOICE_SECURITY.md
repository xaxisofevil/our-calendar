# Voice security and production checklist

Voice is disabled outside installed standalone-PWA display mode as a product/privacy control. This is not server-verifiable authorization: a PWA and normal tab share an origin and may share microphone permission.

## Enforced in code

- Microphone capture starts only from press-and-hold; command results never open it.
- Capture stops on release, document hide, unmount, recorder failure, or a 15-second hard deadline.
- Production refuses to start without `AUTH_PASSCODE`.
- Voice endpoints have burst quotas, endpoint throttles, transcription concurrency limits, and one global Claude command slot.
- Audio bodies are limited to 2 MB and audio MIME types; Deepgram has a 30-second timeout.
- Research has `WebSearch` only and no private MCP/read/write tools. A separate non-web pass executes.
- Every failed command rolls back its batch. Non-executed destructive proposals cannot hide additive writes.
- Destructive confirmation uses a server-generated summary and a two-minute, session-bound, single-use opaque id with target-change detection.
- Production Claude invocations require a pinned strict MCP config.
- Claude output, tool-created item count, event timestamp semantics, and event date horizon are bounded.
- Caddy supplies CSP, anti-framing, no-referrer, and Permissions-Policy headers.
- Audio/transcripts are not durably stored or logged by this application; transcript component state is cleared after processing.

## Required operator verification before enabling voice

1. Verify the exact Deepgram account's audio retention, model-improvement/training opt-out, region, deletion, and human-access settings. Enable the least-retentive options available.
2. Verify the exact Anthropic/Claude Code subscription tier's transcript/tool-context retention and training terms. Do not assume API terms apply to subscription OAuth traffic.
3. Disclose both processors to household users before first microphone use.
4. Set `AUTH_PASSCODE`, `DEEPGRAM_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, and the pinned `CLAUDE_MCP_CONFIG_PATH`; restart PM2 with `--update-env` and save it.
5. Build the backend/MCP server and verify `deploy/claude-mcp.production.json` points to the intended production build/database.
6. Confirm the public Caddy response carries CSP and Permissions-Policy, not merely API Helmet headers.
7. On each real target device, test permission grant/denial, rapid release, 15-second timeout, app switching/backgrounding, screen lock, network loss, recorder failure where practical, manual destructive confirmation, and permission revocation.
8. Revoke any old microphone permission before rollout, then grant it only to the intended HTTPS production origin.
9. Keep runtime/crash telemetry configured not to collect request bodies, audio, transcripts, React state, child stdout, or secrets.

The application cannot revoke browser microphone permission programmatically. Users must use browser/OS site settings to revoke it.
