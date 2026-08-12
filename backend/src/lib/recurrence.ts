import rrulePkg from "rrule";

const { RRule } = rrulePkg;

export interface Occurrence {
  start: Date;
  end: Date;
}

// rrule.js computes weekday/date-of-month matching using each Date's *UTC*
// getters internally (a documented rrule.js convention, not a bug in that
// library) — but the RRULE's BYDAY here is authored from the event's
// *local* weekday (frontend/src/lib/recurrence.ts's ruleFromRepeatValue
// uses anchor.getDay(), a local getter). For a late-evening event, the
// real UTC instant can already be on the *next* UTC calendar day/weekday
// than the local one — e.g. 10pm EDT is past midnight UTC — so rrule.js's
// UTC-based weekday check disagrees with the weekday the rule was written
// against, and it silently skips the true first occurrence, starting the
// whole series a week late.
//
// Fix: convert every Date crossing into/out of rrule.js to/from a
// "floating" representation — a Date whose *UTC* component values are set
// to this Date's *local* component values, so rrule.js's UTC-based
// internals end up reasoning in local wall-clock terms, matching how the
// rule was authored. (This assumes the server and the household's devices
// share one timezone — true for this single-home deployment, same
// assumption already implicit everywhere else in this app that no
// timezone is ever passed client->server.)
function toFloating(date: Date): Date {
  return new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), date.getMilliseconds()),
  );
}

function fromFloating(date: Date): Date {
  return new Date(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
    date.getUTCMilliseconds(),
  );
}

/**
 * Read-time RRULE expansion — ARCHITECTURE.md §7a: "occurrences are computed
 * at read time... using the `rrule` npm package, not hand-rolled date math."
 * `ruleText` is the bare RRULE (no DTSTART/RRULE: prefix, see
 * lib/validation.ts); `dtstart` is the master event's own `start_at`.
 * Returns every occurrence whose start falls within [rangeStart, rangeEnd]
 * (inclusive), each paired with an end computed from the master's own
 * duration. Malformed rules (should already be rejected at write time by
 * validation.ts, but defend anyway) expand to nothing rather than throwing,
 * so one bad row can't 500 the whole calendar view.
 */
export function expandOccurrences(
  ruleText: string,
  dtstart: Date,
  durationMs: number,
  rangeStart: Date,
  rangeEnd: Date,
): Occurrence[] {
  let rule: InstanceType<typeof RRule>;
  try {
    rule = new RRule({ ...RRule.parseString(ruleText), dtstart: toFloating(dtstart) });
  } catch {
    return [];
  }
  // rangeStart/rangeEnd must be converted into the same floating frame as
  // dtstart above, or comparing floating occurrence dates against real-UTC
  // range bounds would be internally inconsistent.
  const starts = rule.between(toFloating(rangeStart), toFloating(rangeEnd), true).map(fromFloating);
  return starts.map((start) => ({ start, end: new Date(start.getTime() + durationMs) }));
}
