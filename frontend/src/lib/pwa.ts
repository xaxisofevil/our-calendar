/**
 * Best-effort installed-PWA detection. Browsers do not provide a
 * server-verifiable installation attestation: this is a product/privacy
 * gate that prevents accidental voice use from an ordinary tab, not an
 * authorization boundary. The capture hook repeats this check so hiding
 * the button is not the only enforcement point.
 */
export function isStandalonePwa(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;

  const displayModeStandalone =
    typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return displayModeStandalone || iosStandalone;
}
