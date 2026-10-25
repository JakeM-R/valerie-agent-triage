# Agent failure triage

Which agent failure is costing a practice the most staff time this week, and what would fixing it be worth?

A one-page static tool (HTML, CSS, vanilla JS), made as proof of work for the Agent Operations role at Valerie Health. It uses demo data for a fictional practice, Harbor Orthopedics. None of the data is real and none of it describes Valerie Health's performance.

Live: https://jakem-r.github.io/valerie-agent-triage/

## What it does

- Headline computed from the data: the top cause by staff hours, and how much automation would rise if a fix caught 70% of it.
- Causes ranked by staff hours (tasks × minutes), not by count. A cause is flagged when its hours this week are ≥ 25% above its own average for earlier weeks and it has ≥ 8 tasks.
- Fix simulator: mark causes fixed and set an assumed catch rate. Automation rate and hours saved update live.
- Drill-down into each cause's tasks, plus filters by week, workflow and channel.
- Load your own CSV (`id, week, date, workflow, channel, outcome, cause, staff_minutes, agent_note`). It is parsed in the browser and never leaves the page.

## Data

`data.js` is generated once by `node scripts/generate-data.mjs` with a fixed seed (400 tasks over 4 weeks, about 70% automated). Run the script again to rebuild it; the output is the same every time.

## Run locally

```
python3 -m http.server 8000
```
