# Agent Ops triage

A weekly triage across a portfolio of practices. It answers four questions: which agent failure should be fixed next, who owns it, what fixing it is worth, and whether past fixes worked.

This is a one-page static tool (HTML, CSS, vanilla JS), made as proof of work for the Agent Operations role at Valerie Health. It runs on demo data for six anonymised, fictional customers (Customer A–F) over six weeks. None of the data is real, and none of it describes Valerie Health's customers, agents or performance.

Live: https://jakem-r.github.io/valerie-agent-triage/

## What it does

- **Failure queue.** Lists every cause this week, ranked by staff hours (tasks × minutes) or by return on effort. Each cause shows its fix type, owner, effort estimate, and how many practices it hits. Causes that hit half the practices or more are marked as platform fixes, not per-practice ones. A cause is flagged when its hours are 25% or more above its own earlier average and it has at least 8 tasks.
- **Detail.** Each cause opens to show the proposed fix, an editable owner, effort and assumed catch rate, its weekly trend, a per-practice breakdown against each practice's own baseline, and its tasks.
- **Plan.** Tick causes to see total effort by owner, the staff hours a week they would give back, and the automation rate if the fixes catch as assumed.
- **Fix log.** Measures each shipped fix on the data: the cause's failure rate in the targeted practices before and after it went live. A verdict is given only when the change is beyond normal Poisson noise. You can log your own fixes too.
- **Heatmap.** Staff hours by practice and week, for all causes or for the one that's open.
- **Your own CSV.** Columns: `id, week, date, practice, workflow, channel, outcome, cause, staff_minutes, agent_note`. The file is parsed in the browser and never leaves the page.

## Data

`node scripts/generate-data.mjs` builds `data.js` from a fixed seed, and the output is the same on every run. The generator applies the effect of the three logged fixes. The page never sees those effects; it measures them from the tasks.

## Run locally

```
python3 -m http.server 8000
```
