// Generates the demo dataset once, with a fixed seed, and writes data.js.
// Run: node scripts/generate-data.mjs
// All values are fictional (Harbor Orthopedics is not a real practice).
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

const WEEK_STARTS = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"]; // Mondays
const WEEK_TOTALS = [98, 102, 97, 103]; // 400 tasks

const LOCATIONS = ["Harbor Orthopedics – Bayview", "Harbor Orthopedics – Westport"];
const PAYERS = ["Coastline Health Plan", "Meridian Mutual", "Northshore Care", "Pacific Union Benefits", "Tidewater HMO"];
const DOC_TYPES = ["MRI report", "operative note", "PT progress note", "insurance card", "referral letter", "X-ray report"];
const PROVIDERS = ["Dr. A. Okafor", "Dr. L. Brennan", "Dr. S. Patel", "Dr. M. Ruiz", "PA J. Chen"];

// Per cause: failures per week, share handed to staff, minutes (staff / review),
// which workflows and channels it shows up on, and preset agent notes.
const CAUSES = [
  {
    name: "Document classified as wrong type",
    weekly: [12, 11, 12, 13],
    staffShare: 0.2,
    staffMin: [6, 9], reviewMin: [2, 4],
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
    weekly: [5, 5, 5, 11],
    staffShare: 0.75,
    staffMin: [16, 26], reviewMin: [8, 12],
    workflows: [["Referral", 6], ["Patient Intake", 3], ["Prior Authorization", 1]],
    channels: [["Fax", 1]],
    notes: [
      () => `OCR confidence ${(0.3 + rand() * 0.2).toFixed(2)} on page ${int(1, 4)}; reason for referral unreadable.`,
      () => `Low-resolution fax (${pick(["98", "100", "102"])} dpi); DOB and member ID not extracted.`,
      () => `Skewed scan, ${int(2, 6)} of ${int(7, 9)} required fields empty after extraction.`,
      () => `Fax arrived as ${int(2, 5)} partial transmissions; pages out of order.`,
      () => `Dark background on insurance card copy; member ID unreadable.`,
    ],
  },
  {
    name: "Referral missing required fields",
    weekly: [5, 6, 4, 5],
    staffShare: 0.5,
    staffMin: [10, 16], reviewMin: [5, 8],
    workflows: [["Referral", 8], ["Prior Authorization", 2]],
    channels: [["Fax", 4], ["Online form", 3], ["Partner EMR portal", 3]],
    notes: [
      () => `No ICD-10 code on referral; referring office called back.`,
      () => `Referring provider NPI missing; cannot route to ${pick(LOCATIONS)}.`,
      () => `Missing ${pick(["imaging", "visit notes", "insurance card"])}; requested from referring office.`,
      () => `Urgency not stated; defaulted to routine and flagged.`,
    ],
  },
  {
    name: "Payer not on eligibility list",
    weekly: [3, 3, 3, 3],
    staffShare: 0.6,
    staffMin: [10, 15], reviewMin: [5, 8],
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
    weekly: [2, 1, 2, 2],
    staffShare: 0.4,
    staffMin: [12, 18], reviewMin: [6, 9],
    workflows: [["Schedule", 6], ["Referral", 3], ["Welcome Call", 1]],
    channels: [["Partner EMR portal", 5], ["Online form", 3], ["Email", 2]],
    notes: [
      () => `${pick(PROVIDERS)} has no PMS provider ID at ${pick(LOCATIONS)}.`,
      () => `Requested location "Harbor Ortho Downtown" does not map to a PMS location.`,
      () => `Provider schedule template missing for ${pick(["Tuesday", "Thursday"])} clinic.`,
    ],
  },
  {
    name: "Duplicate patient match",
    weekly: [1, 1, 1, 1],
    staffShare: 0.7,
    staffMin: [18, 28], reviewMin: [8, 12],
    workflows: [["Patient Intake", 6], ["Schedule", 2], ["Welcome Call", 2]],
    channels: [["Online form", 4], ["Fax", 3], ["Partner EMR portal", 3]],
    notes: [
      () => `${int(2, 3)} PMS records match name and DOB; addresses differ.`,
      () => `Possible duplicate: same phone, different last name; merge needs staff decision.`,
    ],
  },
];

// Automated tasks are spread across all workflows and channels.
const AUTO_WORKFLOWS = [["Patient Intake", 18], ["Referral", 16], ["Classify Document", 22], ["Eligibility Check", 16], ["Prior Authorization", 6], ["Schedule", 14], ["Welcome Call", 8]];
const AUTO_CHANNELS = [["Fax", 45], ["Email", 15], ["Online form", 22], ["Partner EMR portal", 18]];

function dateInWeek(weekIndex) {
  const d = new Date(WEEK_STARTS[weekIndex] + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + int(0, 4)); // Mon–Fri
  return d.toISOString().slice(0, 10);
}

const rows = [];
WEEK_TOTALS.forEach((total, wi) => {
  let failures = 0;
  for (const c of CAUSES) {
    for (let i = 0; i < c.weekly[wi]; i++) {
      const outcome = rand() < c.staffShare ? "staff" : "review";
      const [lo, hi] = outcome === "staff" ? c.staffMin : c.reviewMin;
      rows.push({
        week: wi + 1,
        date: dateInWeek(wi),
        workflow: weighted(c.workflows),
        channel: weighted(c.channels),
        outcome,
        cause: c.name,
        staff_minutes: int(lo, hi),
        agent_note: pick(c.notes)(),
      });
      failures++;
    }
  }
  for (let i = 0; i < total - failures; i++) {
    rows.push({
      week: wi + 1,
      date: dateInWeek(wi),
      workflow: weighted(AUTO_WORKFLOWS),
      channel: weighted(AUTO_CHANNELS),
      outcome: "automated",
      cause: null,
      staff_minutes: 0,
      agent_note: "",
    });
  }
});

// Stable order: by date, then shuffled within the day with the seeded RNG.
rows.forEach((r) => (r._k = rand()));
rows.sort((a, b) => a.date.localeCompare(b.date) || a._k - b._k);
const data = rows.map((r, i) => {
  const { _k, ...rest } = r;
  return { id: `HO-${String(i + 1).padStart(4, "0")}`, ...rest };
});

const out = join(dirname(fileURLToPath(import.meta.url)), "..", "data.js");
writeFileSync(
  out,
  `// Demo data for a fictional practice (Harbor Orthopedics). Generated by scripts/generate-data.mjs, seed ${SEED}.\n` +
    `// Not real patient data and not Valerie Health's real performance.\n` +
    `window.DEMO_DATA = ${JSON.stringify(data)};\n`
);

// Print a summary so the story can be checked.
const auto = data.filter((r) => r.outcome === "automated").length;
console.log(`tasks ${data.length}, automated ${(100 * auto / data.length).toFixed(1)}%`);
for (const c of CAUSES) {
  const rs = data.filter((r) => r.cause === c.name);
  const w4 = rs.filter((r) => r.week === 4);
  const min = rs.reduce((s, r) => s + r.staff_minutes, 0);
  const min4 = w4.reduce((s, r) => s + r.staff_minutes, 0);
  console.log(`${c.name.padEnd(38)} all: n=${String(rs.length).padStart(3)} ${(min / 60).toFixed(1)}h | wk4: n=${String(w4.length).padStart(2)} ${(min4 / 60).toFixed(1)}h`);
}
