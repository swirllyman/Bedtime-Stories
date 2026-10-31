// Generates today's 3 bedtime stories with Claude and adds them to stories/.
//
// Usage:
//   ANTHROPIC_API_KEY=... node scripts/generate.mjs            # today's date (US Pacific)
//   node scripts/generate.mjs 2026-11-05                       # a specific date
//   node scripts/generate.mjs --force                          # replace an existing day
//
// For local testing without an API key, set STORIES_FAKE_RESPONSE to a JSON file
// shaped like the model's output ({ "stories": [...] }).

import Anthropic from "@anthropic-ai/sdk";
import { readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const MODEL = process.env.STORY_MODEL || "claude-sonnet-5-5";
const TIME_ZONE = process.env.STORY_TIME_ZONE || "America/Los_Angeles";
const AGE_GROUPS = ["1-2", "3-4", "5-6"];
const WORDS_PER_MINUTE = 130; // reading aloud, slowly
const RECENT_DAYS = 30;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const storiesDir = path.join(root, "stories");
const indexPath = path.join(storiesDir, "index.json");

const args = process.argv.slice(2);
const force = args.includes("--force");
const dateArg = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const date = dateArg || todayIn(TIME_ZONE);

function todayIn(timeZone) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

const SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          age_group: { type: "string", enum: AGE_GROUPS },
          title: { type: "string" },
          summary: { type: "string" },
          paragraphs: { type: "array", items: { type: "string" } },
        },
        required: ["age_group", "title", "summary", "paragraphs"],
        additionalProperties: false,
      },
    },
  },
  required: ["stories"],
  additionalProperties: false,
};

const SYSTEM = `You write original bedtime stories that a parent reads aloud to young children at the end of the day.

The goal is a calm, warm few minutes that helps a child settle toward sleep. Write stories that:
- feel safe and cozy from start to finish: no villains, danger, peril, scary moments, injuries, or sad losses
- wind down as they go, with the energy getting softer and slower toward a sleepy, content ending
- read well out loud: natural rhythm, simple sentences, gentle repetition, sounds that are fun to say
- use concrete, familiar images (blankets, moonlight, rain on a window, warm milk, a favorite toy) alongside a little gentle wonder
- show small kindnesses, curiosity, sharing, and comfort, without preaching or stating a moral
- are original: invent your own characters and settings rather than retelling existing stories or using known characters

Each story's paragraphs are plain text, a few sentences each, with no headings, markdown, or emoji.`;

function buildPrompt(recent) {
  const avoid = recent.length
    ? `\n\nRecent stories, so you can pick fresh characters, settings, and themes (avoid repeating these):\n${recent.map((s) => `- ${s.title}: ${s.summary}`).join("\n")}`
    : "";
  return `Write tonight's 3 bedtime stories, one for each age group:

1. age_group "1-2": about 120 to 180 words. Very simple words, lots of repetition and sound words, a soothing pattern that repeats, almost no plot.
2. age_group "3-4": about 250 to 350 words. A simple story with one small, gentle problem that resolves warmly.
3. age_group "5-6": about 400 to 550 words. A small, cozy adventure with a little wonder, ending back home and sleepy.

Make the three stories different from each other in characters, setting, and mood. For each, give a short title and a one-sentence summary a parent can skim when choosing.${avoid}`;
}

function validate(data) {
  const problems = [];
  const stories = data?.stories;
  if (!Array.isArray(stories) || stories.length !== 3) problems.push("expected exactly 3 stories");
  else {
    const groups = stories.map((s) => s.age_group).sort().join(",");
    if (groups !== AGE_GROUPS.join(",")) problems.push(`expected one story per age group, got ${groups}`);
    stories.forEach((s, i) => {
      if (!s.title?.trim()) problems.push(`story ${i + 1} has no title`);
      if (!s.summary?.trim()) problems.push(`story ${i + 1} has no summary`);
      const paras = (s.paragraphs || []).filter((p) => typeof p === "string" && p.trim());
      if (paras.length < 2) problems.push(`story ${i + 1} is too short`);
    });
  }
  if (problems.length) throw new Error("Invalid stories: " + problems.join("; "));
  return stories;
}

async function askClaude(prompt) {
  if (process.env.STORIES_FAKE_RESPONSE) {
    return JSON.parse(await readFile(process.env.STORIES_FAKE_RESPONSE, "utf8"));
  }
  const client = new Anthropic(); // reads ANTHROPIC_API_KEY
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    // If a request is ever declined by a safety classifier, re-run it on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`Request was declined (${response.stop_details?.category ?? "no category"})`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("Response was cut off before it finished");
  }
  const text = response.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  return JSON.parse(text);
}

function minutesFor(paragraphs) {
  const words = paragraphs.join(" ").split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

async function main() {
  const dayPath = path.join(storiesDir, `${date}.json`);
  if (!force && (await exists(dayPath))) {
    console.log(`Stories for ${date} already exist. Nothing to do.`);
    return;
  }

  const index = (await exists(indexPath))
    ? JSON.parse(await readFile(indexPath, "utf8"))
    : { stories: [] };
  const others = index.stories.filter((s) => s.date !== date);
  const recentDates = [...new Set(others.map((s) => s.date))].slice(0, RECENT_DAYS);
  const recent = others.filter((s) => recentDates.includes(s.date));

  const prompt = buildPrompt(recent);
  let raw;
  let stories;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      raw = await askClaude(prompt);
      stories = validate(raw);
      break;
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) {
        throw new Error("The ANTHROPIC_API_KEY secret is missing or invalid.");
      }
      if (err instanceof Anthropic.BadRequestError || attempt === 2) throw err;
      console.warn(`Attempt ${attempt} failed (${err.message}). Retrying once.`);
    }
  }

  // Order stories youngest to oldest so ids are stable and predictable.
  stories.sort((a, b) => AGE_GROUPS.indexOf(a.age_group) - AGE_GROUPS.indexOf(b.age_group));
  const full = stories.map((s, i) => {
    const paragraphs = s.paragraphs.map((p) => p.trim()).filter(Boolean);
    return {
      id: `${date}-${i + 1}`,
      title: s.title.trim(),
      age: s.age_group.replace("-", "–"),
      minutes: minutesFor(paragraphs),
      summary: s.summary.trim(),
      paragraphs,
    };
  });

  await writeFile(dayPath, JSON.stringify({ date, model: MODEL, stories: full }, null, 2) + "\n");

  const entries = full.map(({ paragraphs, ...meta }) => ({ ...meta, date }));
  const merged = [...entries, ...others].sort((a, b) =>
    a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date));
  await writeFile(indexPath, JSON.stringify({ updated: new Date().toISOString(), stories: merged }, null, 2) + "\n");

  console.log(`Added ${full.length} stories for ${date}:`);
  for (const s of full) console.log(`  ${s.id}  [ages ${s.age}, ${s.minutes} min]  ${s.title}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
