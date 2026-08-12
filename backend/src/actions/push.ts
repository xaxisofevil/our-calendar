import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { pushSubscriptions } from "../db/schema.js";
import { subscribePushSchema, unsubscribePushSchema } from "../lib/validation.js";
import { ActionValidationError } from "./errors.js";

// Shared action layer (ARCHITECTURE.md §10a) — push-subscription CRUD, the
// entire configuration surface for §8a's push notifications. Called by
// `routes/push.ts` (REST) today; not yet wired into the MCP server (§10a)
// since there's no real CLI use case for it, but it's trivial to add later
// because it already lives here rather than inline in the route handler.

type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

export interface PushSubscriptionDTO {
  id: number;
  endpoint: string;
  deviceLabel: string | null;
  createdAt: string;
}

function serialize(row: PushSubscriptionRow): PushSubscriptionDTO {
  return {
    id: row.id,
    endpoint: row.endpoint,
    deviceLabel: row.deviceLabel,
    createdAt: row.createdAt,
  };
}

/**
 * Registers a device's Web Push subscription. `endpoint` is UNIQUE (§11) —
 * re-subscribing the same device (e.g. after a browser rotates its push
 * endpoint's key material, or the user re-enables after disabling) upserts
 * the existing row's keys/label rather than accumulating duplicates.
 * Validates with `subscribePushSchema`, throws `ActionValidationError` on
 * bad input.
 */
export function subscribePush(input: unknown): PushSubscriptionDTO {
  const parsed = subscribePushSchema.safeParse(input);
  if (!parsed.success) throw new ActionValidationError(parsed.error);

  const now = new Date().toISOString();
  db.insert(pushSubscriptions)
    .values({
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      deviceLabel: parsed.data.deviceLabel ?? null,
      createdAt: now,
    })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        p256dh: parsed.data.keys.p256dh,
        auth: parsed.data.keys.auth,
        deviceLabel: parsed.data.deviceLabel ?? null,
      },
    })
    .run();

  const row = db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint)).get();
  return serialize(row!);
}

/**
 * Removes a device's subscription (e.g. it uninstalled the PWA). Idempotent
 * by design — unsubscribing an endpoint that isn't (or is no longer)
 * subscribed is a no-op success, not a `404`, since the caller's desired
 * end state ("this endpoint should not receive pushes") is already true.
 * Validates with `unsubscribePushSchema`, throws `ActionValidationError` on
 * bad input.
 */
export function unsubscribePush(input: unknown): void {
  const parsed = unsubscribePushSchema.safeParse(input);
  if (!parsed.success) throw new ActionValidationError(parsed.error);

  db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, parsed.data.endpoint)).run();
}
