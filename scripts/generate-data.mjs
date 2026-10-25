// Generates the demo portfolio once, with a fixed seed, and writes data.js.
// Run: node scripts/generate-data.mjs
// Six fictional practices, six weeks. Not real patient data, not Valerie Health's real performance.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SEED = 20261025;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pick2 = (arr) => { const a = pick(arr); let b = pick(arr); while (b === a) b = pick(arr); return [a, b]; };
const weighted = (pairs) => {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) { if ((r -= w) <= 0) return v; }
  return pairs[pairs.length - 1][0];
};

const WEEK_STARTS = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]; // Mondays

const HARBOR = "Harbor Orthopedics";
const CEDAR = "Cedar Valley Family Medicine";
const NORTHGATE = "Northgate Pediatrics";
const LAKESIDE = "Lakeside Cardiology";
const SUMMIT = "Summit Dermatology";
const RIVERBEND = "Riverbend Women's Health";
const PRACTICES = [[HARBOR, 55], [CEDAR, 60], [NORTHGATE, 45], [LAKESIDE, 40], [SUMMIT, 35], [RIVERBEND, 45]]; // tasks per week

const PAYERS = ["Coastline Health Plan", "Meridian Mutual", "Northshore Care", "Pacific Union Benefits", "Tidewater HMO"];
const DOC_TYPES = ["MRI report", "operative note", "progress note", "insurance card", "referral letter", "lab result"];

// Fixes shipped during the six weeks. The generator applies their effect; the page measures it.
const FIXES = [
  { id: "fx-payer-alias", week: 3, cause: "Payer not on eligibility list", practices: [CEDAR, LAKESIDE], owner: "Ops",
    title: "Payer alias list: 14 plan-name variants added", effect: 0.15 },
  { id: "fx-cover-sheet", week: 4, cause: "Document classified as wrong type", practices: "all", owner: "Engineering",
    title: "Split fax cover sheets before classification", effect: 0.62 },
  { id: "fx-auto-request", week: 4, cause: "Referral missing required fields", practices: [NORTHGATE], owner: "Ops",
    title: "Auto-request missing referral fields from referring office", effect: 0.88 },
];

// Per cause: base failure rate (share of a practice's tasks), adjustments by practice/week,
// share handed to staff, minutes, where it shows up, and preset agent notes.
const CAUSES = [
  {
    name: "Document classified as wrong type",
    rate: () => 0.13,
    staffShare: 0.2, staffMin: [6, 9], reviewMin: [2, 4],
    workflows: [["Classify Document", 8], ["Patient Intake", 1], ["Referral", 1]],
    channels: [["Fax", 6], ["Email", 3], ["Partner EMR portal", 1]],
    notes: [
      () => { const [a, b] = pick2(DOC_TYPES); return `Labelled ${a} as ${b}; confidence ${(0.5 + rand() * 0.2).toFixed(2)}, below 0.80 threshold.`; },
      () => `Cover sheet and ${pick(DOC_TYPES)} merged in one file; classified on page 1 only.`,
      () => { const [a, b] = pick2(DOC_TYPES); return `Two plausible types (${a} / ${b}); sent to review.`; },
      () => `Handwritten header overrode body text; type corrected by reviewer.`,
    ],
  },
  {
    name: "Fax unreadable after text extraction",
    // A new fax line at two practices degrades quality in week 6.
    rate: (p, w) => (w === 6 && (p === HARBOR || p === NORTHGATE) ? 0.13 : 0.035),
    staffShare: 0.75, staffMin: [15, 25], reviewMin: [8, 12],
    workflows: [["Referral", 6], ["Patient Intake", 3], ["Prior Authorization", 1]],
    channels: [["Fax", 1]],
    notes: [
      () => `OCR confidence ${(0.3 + rand() * 0.2).toFixed(2)} on page ${int(1, 4)}; reason for referral unreadable.`,
      () => `Low-resolution fax (${pick(["98", "100", "102"])} dpi); DOB and member ID not extracted.`,
      () => `Skewed scan; ${int(2, 6)} of ${int(7, 9)} required fields empty after extraction.`,
      () => `Fax arrived as ${int(2, 5)} partial transmissions; pages out of order.`,
      () => `Dark background on insurance card copy; member ID unreadable.`,
    ],
  },
  {
    name: "Referral missing required fields",
    rate: (p) => (p === NORTHGATE ? 0.07 : 0.045),
    staffShare: 0.5, staffMin: [10, 16], reviewMin: [5, 8],
    workflows: [["Referral", 8], ["Prior Authorization", 2]],
    channels: [["Fax", 4], ["Online form", 3], ["Partner EMR portal", 3]],
    notes: [
      () => `No ICD-10 code on referral; referring office called back.`,
      () => `Referring provider NPI missing; cannot route to a provider.`,
      () => `Missing ${pick(["imaging", "visit notes", "insurance card"])}; requested from referring office.`,
      () => `Urgency not stated; defaulted to routine and flagged.`,
    ],
  },
  {
    name: "Payer not on eligibility list",
    rate: (p) => (p === SUMMIT ? 0.01 : 0.045),
    staffShare: 0.6, staffMin: [10, 15], reviewMin: [5, 8],
    workflows: [["Eligibility Check", 8], ["Prior Authorization", 2]],
    channels: [["Online form", 4], ["Partner EMR portal", 3], ["Fax", 2], ["Email", 1]],
    notes: [
      () => `"${pick(PAYERS)}" plan variant not in payer list; checked on portal by staff.`,
      () => `Payer ID returned no match; likely new ${pick(["Medicare Advantage", "commercial"])} plan.`,
      () => `Payer name entered as abbreviation; no match above 0.85.`,
    ],
  },
  {
    name: "Provider/location not mapped in PMS",
    // Summit opens a new location in week 5.
    rate: (p, w) => (p === SUMMIT && w >= 5 ? 0.15 : 0.004),
    staffShare: 0.4, staffMin: [12, 18], reviewMin: [6, 9],
    workflows: [["Schedule", 6], ["Referral", 3], ["Welcome Call", 1]],
    channels: [["Partner EMR portal", 5], ["Online form", 3], ["Email", 2]],
    notes: [
      (p) => p === SUMMIT ? `Requested location "Summit Derm Eastside" has no PMS location ID.` : `Provider has no PMS provider ID at the requested location.`,
      (p) => p === SUMMIT ? `Eastside providers have no schedule templates in the PMS.` : `Provider schedule template missing for Thursday clinic.`,
    ],
  },
  {
    name: "Duplicate patient match",
    rate: () => 0.01,
    staffShare: 0.7, staffMin: [18, 28], reviewMin: [8, 12],
    workflows: [["Patient Intake", 6], ["Schedule", 2], ["Welcome Call", 2]],
    channels: [["Online form", 4], ["Fax", 3], ["Partner EMR portal", 3]],
    notes: [
      () => `${int(2, 3)} PMS records match name and DOB; addresses differ.`,
      () => `Possible duplicate: same phone, different last name; merge needs a staff decision.`,
    ],
  },
];

function rateFor(cause, practice, week) {
  let r = cause.rate(practice, week);
  for (const f of FIXES) {
    if (f.cause === cause.name && week >= f.week && (f.practices === "all" || f.practices.includes(practice))) r *= f.effect;
  }
  return r;
}

const AUTO_WORKFLOWS = [["Patient Intake", 18], ["Referral", 16], ["Classify Document", 22], ["Eligibility Check", 16], ["Prior Authorization", 6], ["Schedule", 14], ["Welcome Call", 8]];
const AUTO_CHANNELS = [["Fax", 45], ["Email", 15], ["Online form", 22], ["Partner EMR portal", 18]];

function dateInWeek(wi) {
  const d = new Date(WEEK_STARTS[wi] + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + int(0, 4)); // Mon–Fri
  return d.toISOString().slice(0, 10);
}

const rows = [];
WEEK_STARTS.forEach((_, wi) => {
  const week = wi + 1;
  for (const [practice, perWeek] of PRACTICES) {
    const total = perWeek + int(-3, 3);
    let failures = 0;
    for (const cause of CAUSES) {
      // Expected count with stochastic rounding: realistic wobble without coin-flip noise.
      const x = rateFor(cause, practice, week) * total;
      const n = Math.floor(x) + (rand() < x - Math.floor(x) ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const outcome = rand() < cause.staffShare ? "staff" : "review";
        const [lo, hi] = outcome === "staff" ? cause.staffMin : cause.reviewMin;
        rows.push({ week, date: dateInWeek(wi), practice, workflow: weighted(cause.workflows), channel: weighted(cause.channels),
          outcome, cause: cause.name, staff_minutes: int(lo, hi), agent_note: pick(cause.notes)(practice) });
      }
      failures += n;
    }
    for (let i = 0; i < total - failures; i++) {
      rows.push({ week, date: dateInWeek(wi), practice, workflow: weighted(AUTO_WORKFLOWS), channel: weighted(AUTO_CHANNELS),
        outcome: "automated", cause: null, staff_minutes: 0, agent_note: "" });
    }
  }
});

rows.forEach((r) => (r._k = rand()));
rows.sort((a, b) => a.date.localeCompare(b.date) || a._k - b._k);
const data = rows.map((r, i) => {
  const { _k, ...rest } = r;
  return { id: `T-${String(i + 1).padStart(5, "0")}`, ...rest };
});

const fixLog = FIXES.map(({ effect, ...f }) => f); // the page never sees the true effect, only the data

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data.js");
writeFileSync(out,
  `// Demo portfolio: six fictional practices, six weeks. Generated by scripts/generate-data.mjs, seed ${SEED}.\n` +
  `// Not real patient data and not Valerie Health's real performance.\n` +
  `window.DEMO_DATA = ${JSON.stringify(data)};\n` +
  `window.DEMO_FIXES = ${JSON.stringify(fixLog)};\n`);

// Summary so the story can be checked.
const auto = data.filter((r) => r.outcome === "automated").length;
console.log(`tasks ${data.length}, automated ${(100 * auto / data.length).toFixed(1)}%`);
for (let w = 1; w <= 6; w++) {
  const ws = data.filter((r) => r.week === w);
  console.log(`wk${w}: ${ws.length} tasks, ${(100 * ws.filter((r) => r.outcome === "automated").length / ws.length).toFixed(1)}% automated`);
}
for (const c of CAUSES) {
  const rs = data.filter((r) => r.cause === c.name);
  const w6 = rs.filter((r) => r.week === 6);
  const prior = rs.filter((r) => r.week < 6);
  const h = (xs) => (xs.reduce((s, r) => s + r.staff_minutes, 0) / 60);
  const prac = new Set(w6.map((r) => r.practice)).size;
  console.log(`${c.name.padEnd(38)} wk6 n=${String(w6.length).padStart(2)} ${h(w6).toFixed(1)}h | wk1-5 avg n=${(prior.length / 5).toFixed(1)} ${(h(prior) / 5).toFixed(1)}h | practices wk6 ${prac}`);
}
