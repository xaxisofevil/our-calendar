import { Router } from "express";
import { ActionValidationError, subscribePush, unsubscribePush } from "../actions/index.js";

export const pushRouter = Router();

// ARCHITECTURE.md §8a/§12. Body is a `PushSubscription.toJSON()` shape
// (`{ endpoint, keys: { p256dh, auth } }`), optionally with a best-effort
// `deviceLabel` — see lib/validation.ts's subscribePushSchema. Upserts on
// `endpoint`, so calling this again for an already-subscribed device just
// refreshes its keys/label rather than erroring.
pushRouter.post("/subscribe", (req, res) => {
  try {
    const subscription = subscribePush(req.body);
    res.status(201).json(subscription);
  } catch (err) {
    if (err instanceof ActionValidationError) {
      res.status(400).json({ error: err.issues });
      return;
    }
    throw err;
  }
});

// Body: `{ endpoint }` — e.g. the device uninstalled the PWA. Idempotent:
// unsubscribing an endpoint that was never (or is no longer) subscribed
// still returns 204, since the caller's desired end state already holds
// (see actions/push.ts's unsubscribePush).
pushRouter.delete("/subscribe", (req, res) => {
  try {
    unsubscribePush(req.body);
    res.status(204).end();
  } catch (err) {
    if (err instanceof ActionValidationError) {
      res.status(400).json({ error: err.issues });
      return;
    }
    throw err;
  }
});
