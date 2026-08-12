// ARCHITECTURE.md §8a — the entire subscription flow this milestone wires
// up: ask for the native permission (only after the user has already
// opted in via the in-app explainer, `NotificationPrompt` — §8a: "that
// native dialog can only be asked cleanly once"), subscribe via the Push
// API against the already-registered service worker (frontend/src/sw.ts
// handles the resulting `push`/`notificationclick` events), then hand the
// subscription to the backend. Nothing else — per §8a, subscribing *is*
// the entire configuration surface; there's no notifications settings page
// to build here.
import { subscribePush as postSubscribePush, unsubscribePush as postUnsubscribePush } from "./api";

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

/**
 * The Push API wants the VAPID public key as a raw `Uint8Array`
 * (`applicationServerKey`), not the base64url string the env var/backend
 * carry it as — standard conversion (same one MDN's Push API guide uses).
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(new ArrayBuffer(rawData.length));
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

/** Best-effort only (§11: `device_label` is "best-effort/optional") — never
 * blocks or fails the subscribe flow if it can't tell what this device is. */
function guessDeviceLabel(): string | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android device";
  return "Browser";
}

export type EnablePushResult = "subscribed" | "denied" | "unsupported" | "error";

/**
 * The "Enable notifications" button's full flow (NotificationPrompt.tsx).
 * Resolves with an outcome rather than throwing — the caller always just
 * dismisses the prompt afterward regardless of outcome (§8a has no
 * settings surface to retry from), so there's nothing for a thrown error to
 * usefully interrupt.
 */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !VAPID_PUBLIC_KEY) {
    return "unsupported";
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  try {
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }

    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "error";

    await postSubscribePush({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      deviceLabel: guessDeviceLabel(),
    });
    return "subscribed";
  } catch (err) {
    console.error("[push] enable failed:", err);
    return "error";
  }
}

/**
 * Not wired to any UI yet (§8a has no notifications settings page in v1 —
 * there's nothing to tap to reach an "unsubscribe" action), but kept here
 * as the natural counterpart to `enablePushNotifications` for whenever a
 * "turn off notifications" affordance is ever wanted, and so a future
 * caller doesn't have to re-derive "unsubscribe locally, then tell the
 * backend" from scratch.
 */
export async function disablePushNotifications(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await postUnsubscribePush(endpoint);
}
