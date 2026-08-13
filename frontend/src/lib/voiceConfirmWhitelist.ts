import type { TranscribedWord } from "../types";

// ARCHITECTURE.md §10b (M9) — the auto-listen confirm feature's whole
// safety property lives here: a spoken yes/no only ever auto-triggers
// confirmAction/cancelAction when BOTH of these gates pass —
//
//   1. the transcript contains one of these exact, unambiguous phrases
//      (word-boundary matched, not a substring search — "sunny" doesn't
//      match "no"), and
//   2. Deepgram's own per-word confidence score for every word in that
//      phrase is at or above CONFIDENCE_THRESHOLD.
//
// Matching the whitelist without high confidence, or a high-confidence
// transcript that doesn't match the whitelist, is not enough on its own —
// see useAutoListenConfirm.ts's own comment for why that matters more here
// than in the general voice-command pipeline: this is the one path in the
// whole app that can auto-trigger a *destructive* action with no tap at
// all, so both gates are deliberately required, not just one.
const AFFIRMATIVE_PHRASES = ["yes", "yeah", "yep", "confirm", "correct", "do it"];
const NEGATIVE_PHRASES = ["no", "nope", "cancel", "don't"];

// Deepgram's own word confidence is a 0-1 double (confirmed against
// developers.deepgram.com/reference/speech-to-text/listen-pre-recorded,
// not assumed). 0.8 is deliberately conservative, not the midpoint: a
// clearly-spoken common word like "yes"/"no" typically scores well above
// 0.9 in practice, while a misheard/ambiguous/background-noise word tends
// to fall well below this line — the gap between those two cases is wide
// enough that 0.8 comfortably separates "clearly said" from "guessed,"
// which is the whole point of gating on it at all. Since this decides
// whether to auto-fire a destructive action with nobody's finger on a
// button, erring toward requiring a cleaner signal (and falling back to
// the always-available manual buttons on anything murkier) is the right
// trade-off, not a compromise.
const CONFIDENCE_THRESHOLD = 0.8;

function normalizeToken(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z']/g, "");
}

/** Looks for `phrase` (one or two words) as a contiguous run inside
 * `words`, matched by normalized text. Returns the minimum confidence
 * across the matched words (a multi-word phrase like "do it" is only as
 * trustworthy as its least-confident word), or null if the phrase doesn't
 * appear at all. */
function phraseConfidence(words: TranscribedWord[], phrase: string): number | null {
  const phraseTokens = phrase.split(" ").map(normalizeToken);
  const tokens = words.map((w) => normalizeToken(w.word));

  for (let i = 0; i <= tokens.length - phraseTokens.length; i++) {
    let matched = true;
    let minConfidence = 1;
    for (let j = 0; j < phraseTokens.length; j++) {
      if (tokens[i + j] !== phraseTokens[j]) {
        matched = false;
        break;
      }
      minConfidence = Math.min(minConfidence, words[i + j].confidence);
    }
    if (matched) return minConfidence;
  }
  return null;
}

function hasHighConfidenceMatch(words: TranscribedWord[], phrases: string[]): boolean {
  return phrases.some((phrase) => {
    const confidence = phraseConfidence(words, phrase);
    return confidence !== null && confidence >= CONFIDENCE_THRESHOLD;
  });
}

/**
 * Evaluates a spoken confirmation clip's transcribed words against the
 * whitelist. Returns "confirm"/"cancel" only when exactly one side matches
 * with high confidence; returns null for everything else — no match at
 * all, a low-confidence match, or (the rare case where both an affirmative
 * and a negative phrase somehow appear) an ambiguous result. null always
 * means "do nothing, leave the manual Confirm/Cancel buttons exactly as
 * they are" — this function never throws and never has a "partial credit"
 * outcome.
 */
export function evaluateConfirmTranscript(words: TranscribedWord[]): "confirm" | "cancel" | null {
  if (words.length === 0) return null;

  const affirmative = hasHighConfidenceMatch(words, AFFIRMATIVE_PHRASES);
  const negative = hasHighConfidenceMatch(words, NEGATIVE_PHRASES);

  if (affirmative && !negative) return "confirm";
  if (negative && !affirmative) return "cancel";
  return null;
}
