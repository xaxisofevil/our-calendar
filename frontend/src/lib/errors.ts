// Turns the Error thrown by lib/api.ts's request() into a short, readable
// message safe to show inline near whatever triggered it. Fixes the M2 bug
// report (ARCHITECTURE.md §14, QA bugs #2/#3): a rejected mutation (e.g. an
// over-200-char event title, an over-500-char todo) used to fail with no
// visible feedback at all — the sheet/input just cleared as if it worked.
export function friendlyErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Something went wrong. Please try again.";

  try {
    const parsed = JSON.parse(error.message) as { fieldErrors?: Record<string, string[]> };
    const entry = parsed.fieldErrors && Object.entries(parsed.fieldErrors).find(([, msgs]) => msgs?.length);
    if (entry) {
      const [field, messages] = entry;
      const label = field.charAt(0).toUpperCase() + field.slice(1);
      return `${label}: ${friendlyZodMessage(messages[0])}`;
    }
  } catch {
    // Not a JSON validation-error body (e.g. a network failure or a plain
    // "Request failed: 500") — fall through to a generic message below.
  }

  return error.message.startsWith("Request failed") ? "Couldn't save — please try again." : error.message;
}

// zod v4's default messages ("Too big: expected string to have <=200
// characters") are accurate but not something to put in front of a
// non-technical user verbatim. Rephrase the shapes we actually hit
// (min/max length on the fields this app validates) into plain language;
// anything else falls back to the raw zod message rather than guessing.
function friendlyZodMessage(message: string): string {
  const tooBig = message.match(/Too big.*?<=(\d+)/);
  if (tooBig) return `too long (max ${tooBig[1]} characters).`;
  const tooSmall = message.match(/Too small.*?>=(\d+)/);
  if (tooSmall) return "can't be blank.";
  return message;
}
