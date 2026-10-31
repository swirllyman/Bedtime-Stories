// Picks tonight's 3 stories (one per age group) from stories/library.json
// and records them in stories/schedule.json. No API keys or packages needed.
//
// Each age group cycles through its stories: never-read stories first, then
// whichever was read longest ago. Safe to run more than once a day; it only
// adds one night per date.
//
//   node scripts/rotate.mjs              # today (US Pacific)
//   node scripts/rotate.mjs 2026-11-05   # a specific date

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const TIME_ZONE = process.env.STORY_TIME_ZONE || "America/Los_Angeles";
const AGE_GROUPS = ["1–2", "3–4", "5–6"];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const libraryPath = path.join(root, "stories", "library.json");
const schedulePath = path.join(root, "stories", "schedule.json");

const date = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
  new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

// Small stable hash so the first pass mixes authors up, the same way on every run.
function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const { stories } = JSON.parse(await readFile(libraryPath, "utf8"));
let schedule = { nights: [] };
try { schedule = JSON.parse(await readFile(schedulePath, "utf8")); } catch {}

if (schedule.nights.some((n) => n.date === date)) {
  console.log(`Already picked stories for ${date}.`);
  process.exit(0);
}

const lastShown = {};
for (const night of schedule.nights) {
  for (const id of night.ids) if (!lastShown[id] || night.date > lastShown[id]) lastShown[id] = night.date;
}

const picks = AGE_GROUPS.map((age) => {
  const pool = stories.filter((s) => s.age === age);
  pool.sort((a, b) =>
    (lastShown[a.id] || "").localeCompare(lastShown[b.id] || "") || hash(a.id) - hash(b.id));
  return pool[0];
}).filter(Boolean);

schedule.nights.push({ date, ids: picks.map((s) => s.id) });
schedule.nights.sort((a, b) => b.date.localeCompare(a.date));
await writeFile(schedulePath, JSON.stringify(schedule, null, 2) + "\n");

console.log(`Tonight's stories for ${date}:`);
for (const s of picks) console.log(`  [ages ${s.age}] ${s.title} (${s.author})`);
