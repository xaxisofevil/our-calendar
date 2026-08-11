import rrulePkg from "rrule";

const { RRule } = rrulePkg;

export interface Occurrence {
  start: Date;
  end: Date;
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
    rule = new RRule({ ...RRule.parseString(ruleText), dtstart });
  } catch {
    return [];
  }
  const starts = rule.between(rangeStart, rangeEnd, true);
  return starts.map((start) => ({ start, end: new Date(start.getTime() + durationMs) }));
}
