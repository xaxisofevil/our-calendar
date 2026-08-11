import { db, sqlite } from "./client.js";
import { events, people, todos } from "./schema.js";

function nowIso(): string {
  return new Date().toISOString();
}

function atOffset(daysFromToday: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/**
 * Idempotent dev-data seed: only inserts when a table is empty, so it's
 * safe to run on every backend boot. Mirrors the "mostly empty month, 2-3
 * days with events" pattern validated in the design mockup, but computed
 * relative to *today* (not hardcoded to a fixed month) so the sample data
 * never goes stale.
 */
export function seed(): void {
  const todoCount = (sqlite.prepare("select count(*) as c from todos").get() as { c: number }).c;
  if (todoCount === 0) {
    const now = nowIso();
    const items: Array<{ text: string; notes: string | null; completed: boolean }> = [
      { text: "Milk", notes: null, completed: false },
      { text: "Eggs", notes: null, completed: false },
      { text: "Take out recycling", notes: null, completed: true },
      { text: "Pick up dry cleaning", notes: "Ticket is on the fridge", completed: false },
      { text: "Renew car registration", notes: null, completed: true },
    ];
    items.forEach((item, index) => {
      db.insert(todos)
        .values({
          text: item.text,
          notes: item.notes,
          completed: item.completed,
          list: "household",
          position: index,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    });
  }

  // People: the four household members, hardcoded (confirmed: fixed
  // household of 4, no dynamic people-management UI planned — see
  // ARCHITECTURE.md). Decoupled from Google OAuth (google_accounts is M3,
  // not built yet). Colors are four hues spread around the wheel, chosen to
  // sit inside the Paper & Ink palette without colliding with its existing
  // meanings (brick accent = "today"/primary, herb green = "done"): steel
  // teal, dusty plum, warm ochre, and dusty indigo — all legible as small
  // swatches/dots in both light and dark mode.
  const peopleCount = (sqlite.prepare("select count(*) as c from people").get() as { c: number }).c;
  if (peopleCount === 0) {
    db.insert(people).values([
      { label: "Eric", color: "#5B8CA6" },
      { label: "Lindsay", color: "#A85A82" },
      { label: "Gavin", color: "#C08A2E" },
      { label: "Damien", color: "#6B5CA5" },
    ]).run();
  }
  const peopleRows = db.select().from(people).all();
  const ericId = peopleRows.find((p) => p.label === "Eric")?.id ?? null;
  const gavinId = peopleRows.find((p) => p.label === "Gavin")?.id ?? null;

  const eventCount = (sqlite.prepare("select count(*) as c from events").get() as { c: number }).c;
  if (eventCount === 0) {
    const now = nowIso();
    const samples = [
      {
        title: "Dentist",
        location: "Downtown Dental",
        description: "Bring the insurance card, use the north entrance.",
        start: atOffset(3, 15, 0),
        durationMinutes: 60,
        personId: ericId,
      },
      {
        title: "Soccer practice",
        location: "Fields behind the middle school",
        description: "Cleats and a water bottle.",
        start: atOffset(11, 17, 30),
        durationMinutes: 90,
        personId: gavinId,
      },
    ];
    samples.forEach((s) => {
      const end = new Date(s.start.getTime() + s.durationMinutes * 60_000);
      db.insert(events)
        .values({
          title: s.title,
          description: s.description,
          location: s.location,
          startAt: s.start.toISOString(),
          endAt: end.toISOString(),
          allDay: false,
          personId: s.personId,
          updatedAt: now,
        })
        .run();
    });
  }
}
