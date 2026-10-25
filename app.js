(function () {
  "use strict";

  // Method constants, shown on the page so the rules are visible.
  const MIN_TASKS_TO_FLAG = 8;    // below this, a week-on-week jump is mostly noise
  const FLAG_RATIO = 1.25;        // flag when this week's hours are 25%+ above the cause's own earlier average
  const DEFAULT_CATCH = 70;       // share of a cause's failures a fix is assumed to catch
  const PRACTICE_HIT = 2;         // a practice counts as affected at 2+ tasks of a cause in the week
  const TASKS_SHOWN = 12;

  const OWNERS = ["Ops", "Engineering", "Ops + practice", "Practice", "Unassigned"];
  const OUTCOME_LABEL = { automated: "Automated", review: "Needed review", staff: "Handed to staff" };
  const COLUMNS = ["id", "week", "date", "practice", "workflow", "channel", "outcome", "cause", "staff_minutes", "agent_note"];
  const OPTIONAL = ["practice"];

  // Triage notes for the demo causes: fix type, owner, effort in days, and the proposed fix.
  // These are my triage estimates, editable on the page, not measurements.
  const PLAYBOOK = {
    "Fax unreadable after text extraction": { short: "Unreadable faxes", type: "Extraction", owner: "Engineering", effort: 8,
      fix: "Pre-process low-resolution faxes (deskew, contrast) before extraction. In parallel, Ops asks the affected practices’ top referrers to send at fine resolution." },
    "Referral missing required fields": { short: "Referrals missing required fields", type: "Customer process", owner: "Ops + practice", effort: 2,
      fix: "Agree a referral checklist with the top referring offices. Auto-request is live at one practice; check its result in the fix log before rolling it out." },
    "Payer not on eligibility list": { short: "Payers missing from the eligibility list", type: "Config", owner: "Ops", effort: 1,
      fix: "Roll the payer alias list out to every practice, not just the two that have it, and add a weekly check for new plan names." },
    "Provider/location not mapped in PMS": { short: "Unmapped providers and locations", type: "Integration config", owner: "Ops", effort: 0.5,
      fix: "Map the new location’s providers and schedule templates in the PMS integration. Add location mapping to the go-live checklist so it doesn’t recur." },
    "Duplicate patient match": { short: "Duplicate patient matches", type: "Agent logic", owner: "Engineering", effort: 5,
      fix: "Add phone and address to the match rule, and send remaining ties to one merge queue." },
    "Document classified as wrong type": { short: "Misclassified documents", type: "Model / prompt", owner: "Ops", effort: 3,
      fix: "Add labelled examples for the most-confused type pairs. The cover-sheet split helped; the fix log shows by how much." },
  };
  const UNKNOWN = { type: "Not triaged", owner: "Unassigned", effort: 1, fix: "No triage notes yet. Set an owner and an effort estimate." };

  const state = {
    data: [], fixes: [], sourceName: null, weeks: [], practices: [],
    filters: { week: null, practice: "all", workflow: "all", channel: "all" },
    triage: {},           // cause -> { owner, effort, catch }
    plan: new Set(),
    open: null, showAll: false, sort: "hours",
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const uniq = (arr) => [...new Set(arr)];
  const hrs = (min) => (min / 60).toFixed(1);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const pct1 = (x) => `${(x * 100).toFixed(1)}%`;
  const short = (c) => (PLAYBOOK[c] && PLAYBOOK[c].short) || c;
  const days = (d) => (d === 0.5 ? "half a day" : d === 1 ? "1 day" : `${d} days`);

  function fmtDate(iso, opts) {
    const d = new Date(iso + "T00:00:00Z");
    return isNaN(d) ? iso : d.toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
  }
  function weekRange(w) {
    const dates = state.data.filter((r) => r.week === w).map((r) => r.date).filter(Boolean).sort();
    if (!dates.length) return "";
    const a = dates[0], b = dates[dates.length - 1];
    const left = fmtDate(a, { month: "short", day: "numeric" });
    if (a === b) return left;
    return `${left}–${fmtDate(b, a.slice(0, 7) === b.slice(0, 7) ? { day: "numeric" } : { month: "short", day: "numeric" })}`;
  }
  const weeksLabel = (ws) => (!ws.length ? "" : ws.length === 1 ? `week ${ws[0]}` : `weeks ${ws[0]}–${ws[ws.length - 1]}`);
  const latestWeek = () => state.weeks[state.weeks.length - 1];
  const weekWord = (w) => (w === latestWeek() ? "this week" : `in week ${w}`);

  // ---------- data setup ----------

  function loadData(rows, fixes, sourceName) {
    state.data = rows;
    state.fixes = fixes.map((f) => ({ ...f }));
    state.sourceName = sourceName;
    state.weeks = uniq(rows.map((r) => r.week)).sort((a, b) => a - b);
    state.practices = uniq(rows.map((r) => r.practice)).sort();
    state.filters = { week: latestWeek(), practice: "all", workflow: "all", channel: "all" };
    state.triage = {};
    allCauses().forEach((c) => {
      const p = PLAYBOOK[c] || UNKNOWN;
      state.triage[c] = { owner: p.owner, effort: p.effort, catch: DEFAULT_CATCH };
    });
    state.plan = new Set();
    state.open = null;
    state.showAll = false;
    buildControls();
    render();
  }

  function allCauses() {
    return uniq(state.data.map((r) => r.cause).filter(Boolean)).sort();
  }

  function buildControls() {
    $("f-week").innerHTML = state.weeks
      .map((w) => `<option value="${w}">Week ${w} · ${esc(weekRange(w))}${w === latestWeek() ? " (latest)" : ""}</option>`).join("");
    $("f-week").value = String(state.filters.week);
    const opts = (vals, allLabel) => `<option value="all">${allLabel}</option>` + vals.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    $("f-practice").innerHTML = opts(state.practices, `All ${state.practices.length} customers`);
    $("f-workflow").innerHTML = opts(uniq(state.data.map((r) => r.workflow)).sort(), "All");
    $("f-channel").innerHTML = opts(uniq(state.data.map((r) => r.channel)).sort(), "All");

    $("fx-cause").innerHTML = allCauses().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
    $("fx-scope").innerHTML = `<option value="all">All practices</option>` + state.practices.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    $("fx-week").innerHTML = state.weeks.map((w) => `<option value="${w}">Week ${w}</option>`).join("");
    $("fx-week").value = String(state.weeks[Math.max(0, state.weeks.length - 2)]);
    $("fx-owner").innerHTML = OWNERS.map((o) => `<option>${esc(o)}</option>`).join("");
  }

  // ---------- computation ----------

  function filtered() {
    const { practice, workflow, channel } = state.filters;
    return state.data.filter((r) =>
      (practice === "all" || r.practice === practice) &&
      (workflow === "all" || r.workflow === workflow) &&
      (channel === "all" || r.channel === channel));
  }

  function compute() {
    const rows = filtered();
    const week = state.filters.week;
    const thisWeek = rows.filter((r) => r.week === week);
    const priorWeeks = state.weeks.filter((w) => w < week);
    const total = thisWeek.length;
    const automated = thisWeek.filter((r) => r.outcome === "automated").length;
    const failures = thisWeek.filter((r) => r.outcome !== "automated");
    const practices = uniq(thisWeek.map((r) => r.practice)).sort();

    const priorRates = priorWeeks.map((w) => rows.filter((r) => r.week === w)).filter((rs) => rs.length)
      .map((rs) => rs.filter((r) => r.outcome === "automated").length / rs.length);

    const causes = allCauses().map((cause) => {
      const all = rows.filter((r) => r.cause === cause);
      const tasks = all.filter((r) => r.week === week);
      const minutes = sum(tasks, (r) => r.staff_minutes);
      const weekly = state.weeks.map((w) => sum(all.filter((r) => r.week === w), (r) => r.staff_minutes));
      const prior = state.weeks.map((w, i) => [w, weekly[i]]).filter(([w]) => w < week).map(([, m]) => m);
      const baseMin = prior.length ? sum(prior, (x) => x) / prior.length : null;
      const flagged = baseMin !== null && tasks.length >= MIN_TASKS_TO_FLAG && minutes > baseMin * FLAG_RATIO;

      const byPractice = state.practices.map((p) => {
        const mine = all.filter((r) => r.practice === p);
        const now = mine.filter((r) => r.week === week);
        const base = priorWeeks.length ? sum(mine.filter((r) => r.week < week), (r) => r.staff_minutes) / priorWeeks.length : 0;
        return { p, min: sum(now, (r) => r.staff_minutes), cnt: now.length, base };
      }).filter((x) => x.min > 0 || x.base > 0).sort((a, b) => b.min - a.min);

      const affected = byPractice.filter((x) => x.cnt >= PRACTICE_HIT).length;
      const n = practices.length;
      const reuse = n < 3 ? { label: `${affected} of ${n}`, kind: "" }
        : affected >= Math.ceil(n / 2) ? { label: "Platform fix", kind: "platform" }
        : affected <= 1 ? { label: affected ? "One practice" : "Scattered", kind: "" }
        : { label: "Some practices", kind: "" };

      const t = state.triage[cause];
      const back = (minutes * t.catch) / 100 / 60;
      return { cause, tasks, count: tasks.length, minutes, weekly, baseMin, flagged, byPractice, affected, reuse,
        t, info: PLAYBOOK[cause] || UNKNOWN, back, ret: t.effort > 0 ? back / t.effort : 0 };
    }).filter((c) => c.count > 0);

    const byHours = [...causes].sort((a, b) => b.minutes - a.minutes || b.count - a.count);
    const byReturn = [...causes].sort((a, b) => b.ret - a.ret || b.minutes - a.minutes);

    return {
      rows, week, priorWeeks, thisWeek, total, automated, failures, practices, byHours, byReturn,
      queue: state.sort === "return" ? byReturn : byHours,
      rate: total ? automated / total : 0,
      priorRate: priorRates.length ? sum(priorRates, (x) => x) / priorRates.length : null,
      staffMin: sum(failures, (r) => r.staff_minutes),
      staffCount: failures.filter((r) => r.outcome === "staff").length,
      reviewCount: failures.filter((r) => r.outcome === "review").length,
    };
  }

  // Before/after for one logged fix, on all data in the fix's scope (filters do not apply).
  function measureFix(f) {
    const scope = state.data.filter((r) => f.practices === "all" || f.practices.includes(r.practice));
    const weekly = state.weeks.map((w) => {
      const rs = scope.filter((r) => r.week === w);
      const hit = rs.filter((r) => r.cause === f.cause);
      return { w, tot: rs.length, cnt: hit.length, min: sum(hit, (r) => r.staff_minutes) };
    }).filter((x) => x.tot > 0);
    const before = weekly.filter((x) => x.w < f.week);
    const after = weekly.filter((x) => x.w >= f.week);
    if (!before.length || !after.length) return { weekly, ok: false };
    const rate = (xs) => sum(xs, (x) => x.cnt) / sum(xs, (x) => x.tot);
    const rb = rate(before), ra = rate(after);
    const change = rb > 0 ? (ra - rb) / rb : 0;
    // Noise check: if the before-rate still held, how far is the after-count from what we'd expect?
    // Poisson z-score; under 2 is within normal week-to-week variation, so no verdict either way.
    const expected = rb * sum(after, (x) => x.tot);
    const observed = sum(after, (x) => x.cnt);
    const z = expected > 0 ? (observed - expected) / Math.sqrt(expected) : 0;
    const clear = Math.abs(z) >= 2;
    const verdict = !clear ? ["none", "No clear change"] : change <= -0.5 ? ["worked", "Worked"]
      : change < 0 ? ["partial", "Partial"] : ["none", "Rate rose"];
    return {
      weekly, ok: true, rb, ra, change, verdict,
      hb: sum(before, (x) => x.min) / before.length, ha: sum(after, (x) => x.min) / after.length,
      clear, nb: before.length, na: after.length,
    };
  }

  // ---------- rendering ----------

  function render() {
    const m = compute();
    renderSource();
    renderLede(m);
    renderFigures(m);
    renderQueue(m);
    renderPlan(m);
    renderFixLog();
    renderHeat(m);
  }

  function renderSource() {
    $("source").innerHTML = state.sourceName
      ? `<b>Your export</b>${esc(state.sourceName)} · ${state.data.length} tasks · read in your browser only`
      : `<b>Demo data</b>${state.practices.length} demo customers · ${state.data.length} tasks · ${state.weeks.length} weeks`;
    $("reset").hidden = !state.sourceName;
  }

  function renderLede(m) {
    const f = state.filters;
    const scope = [f.practice, f.workflow, f.channel].filter((v) => v !== "all").join(" · ");
    $("kicker").textContent = `Week ${m.week} · ${weekRange(m.week)}${scope ? " · " + scope : ""}${state.sourceName ? "" : " · demo portfolio"}`;
    const l1 = $("headline").querySelector(".l1");
    const l2 = $("headline").querySelector(".l2");
    const top = m.byHours[0];
    if (!top) {
      l1.textContent = `No failed tasks ${weekWord(m.week)} for this filter.`;
      l2.textContent = m.total ? `Automation is ${pct(m.rate)} on ${m.total} tasks.` : "No tasks match.";
      $("lede-sub").textContent = "";
      return;
    }
    const where = f.practice !== "all" ? `at ${f.practice}` : m.practices.length === 1 ? `at ${m.practices[0]}` : `across ${m.practices.length} practices`;
    l1.textContent = `${short(top.cause)} cost ${hrs(top.minutes)} staff hours ${where} ${weekWord(m.week)}` +
      (top.flagged && top.baseMin > 0 ? `, ${(top.minutes / top.baseMin).toFixed(1)}× their usual.` : ".");

    let rise = "";
    if (top.flagged && f.practice === "all") {
      const deltas = top.byPractice.map((x) => ({ p: x.p, d: x.min - x.base })).filter((x) => x.d > 0).sort((a, b) => b.d - a.d);
      const totalUp = sum(deltas, (x) => x.d);
      const lead = [];
      for (const x of deltas) { if (sum(lead, (y) => y.d) >= totalUp * 0.6) break; lead.push(x); }
      if (lead.length && lead.length <= 2) rise = `Most of the rise is at ${lead.map((x) => x.p).join(" and ")}. `;
    }
    const platform = top.reuse.kind === "platform" ? "Fix it once in the platform: " : "";
    l2.textContent = `${rise}${platform}${top.t.owner === "Unassigned" ? "No owner yet" : top.t.owner + " owns it"}, about ${days(top.t.effort)} for ≈${top.back.toFixed(1)} h a week back.`;

    const bits = [];
    const byCount = [...m.byHours].sort((a, b) => b.count - a.count)[0];
    if (byCount.cause !== top.cause) bits.push(`By task count, ${short(byCount.cause).toLowerCase()} lead (${byCount.count} vs ${top.count}) but cost ${hrs(byCount.minutes)} hours.`);
    const best = m.byReturn[0];
    if (best && best.cause !== top.cause) {
      const one = best.affected === 1 && best.byPractice[0] ? ` (${best.byPractice[0].p})` : "";
      bits.push(`Best return on effort: ${short(best.cause).toLowerCase()}${one}, ${days(best.t.effort)} for ≈${best.back.toFixed(1)} h a week.`);
    }
    bits.push(`Effort, owners and the ${DEFAULT_CATCH}% catch rate are triage estimates you can change in the queue.`);
    $("lede-sub").textContent = bits.join(" ");
  }

  function renderFigures(m) {
    const flagged = m.byHours.filter((c) => c.flagged).length;
    const prior = m.priorRate === null ? "no earlier weeks" : `${weeksLabel(m.priorWeeks)} avg ${pct(m.priorRate)}`;
    $("figures").innerHTML = `
      <div class="fig"><div class="n">${pct(m.rate)}</div><div class="k">Automated</div><div class="d">${prior}</div></div>
      <div class="fig"><div class="n">${hrs(m.staffMin)}</div><div class="k">Staff hours on failures</div><div class="d">${m.failures.length} of ${m.total} tasks failed</div></div>
      <div class="fig"><div class="n">${m.staffCount}</div><div class="k">Handed to staff</div><div class="d">plus ${m.reviewCount} needed review</div></div>
      <div class="fig"><div class="n">${flagged}</div><div class="k">Causes rising</div><div class="d">vs their own baseline</div></div>`;
  }

  function renderQueue(m) {
    const top = m.byHours[0];
    const byCount = [...m.byHours].sort((a, b) => b.count - a.count)[0];
    $("count-vs-hours").textContent = !top ? "" : byCount.cause === top.cause
      ? `${short(top.cause)} lead on both task count and staff time.`
      : `Ranked by count, ${short(byCount.cause).toLowerCase()} come first (${byCount.count} tasks, ${hrs(byCount.minutes)} h). Ranked by staff time, it’s ${short(top.cause).toLowerCase()} (${top.count} tasks, ${hrs(top.minutes)} h).`;

    document.querySelectorAll(".sort button").forEach((b) => b.classList.toggle("on", b.dataset.sort === state.sort));

    const prior = weeksLabel(m.priorWeeks);
    const head = `<div class="q-head" aria-hidden="true"><span>#</span><span>Cause · fix type</span><span class="r">Staff h</span><span>Practices</span><span>Owner</span><span class="r">Effort</span><span class="r">h/wk per day</span><span class="r">Plan</span></div>`;
    $("queue").innerHTML = head + (m.queue.length ? m.queue.map((c, i) => {
      const open = state.open === c.cause;
      const planned = state.plan.has(c.cause);
      const vs = c.baseMin === null ? "" : c.flagged
        ? `<small class="up">▲ ${c.baseMin > 0 ? (c.minutes / c.baseMin).toFixed(1) + "× usual" : "new"}</small>`
        : `<small>usual ${hrs(c.baseMin)}</small>`;
      return `<div class="q-item${open ? " open" : ""}${planned ? " planned" : ""}" role="listitem">
        <div class="q-row" tabindex="0" role="button" aria-expanded="${open}" data-cause="${esc(c.cause)}">
          <span class="q-rank">${i + 1}</span>
          <span class="q-cause">${esc(c.cause)}<span class="chev" aria-hidden="true">›</span><small>${esc(c.info.type)} · ${c.count} tasks</small></span>
          <span class="q-hours r">${hrs(c.minutes)}${vs}</span>
          <span class="q-meta">
            <span class="q-reuse"><span class="lbl">Practices</span>${c.affected} of ${m.practices.length}<small class="${c.reuse.kind}">${esc(c.reuse.label)}</small></span>
            <span class="q-owner"><span class="lbl">Owner</span>${esc(c.t.owner)}</span>
            <span class="q-effort r"><span class="lbl">Effort</span>${c.t.effort}d</span>
            <span class="q-ret r"><span class="lbl">Return</span>${c.ret.toFixed(2)}</span>
            <label class="q-plan r"><input type="checkbox" data-plan="${esc(c.cause)}" ${planned ? "checked" : ""} aria-label="Plan a fix for ${esc(c.cause)}"><span class="lbl">Plan</span></label>
          </span>
        </div>
        ${open ? detail(c, m) : ""}
      </div>`;
    }).join("") : `<p class="empty-log">No failures to rank for this filter.</p>`);

    $("method").textContent =
      `Staff h = tasks × minutes a person spent resolving them. ▲ = this week’s hours are ${Math.round((FLAG_RATIO - 1) * 100)}%+ above the cause’s own ${prior || "earlier"} average with at least ${MIN_TASKS_TO_FLAG} tasks, so small-number swings are not flagged. ` +
      `Practices = practices with ${PRACTICE_HIT}+ tasks of that cause this week; half or more makes it a platform fix rather than a per-practice one. ` +
      `h/wk per day = staff hours a week the fix gives back (hours × catch rate) per day of effort.` + (state.sourceName ? "" : " Minutes are demo values.");
  }

  function detail(c, m) {
    const max = Math.max(1, ...c.byPractice.map((x) => Math.max(x.min, x.base)));
    const markers = state.fixes.filter((f) => f.cause === c.cause).map((f) => f.week);
    const rows = [...c.tasks].sort((a, b) => b.staff_minutes - a.staff_minutes);
    const shown = state.showAll ? rows : rows.slice(0, TASKS_SHOWN);
    return `<div class="detail">
      <div>
        <h3>Proposed fix</h3>
        <p class="fixtext">${esc(c.info.fix)}</p>
        <div class="triage">
          <label>Owner<select data-t="owner">${OWNERS.map((o) => `<option ${o === c.t.owner ? "selected" : ""}>${esc(o)}</option>`).join("")}</select></label>
          <label>Effort (days)<input type="number" data-t="effort" min="0.5" max="60" step="0.5" value="${c.t.effort}"></label>
          <label>Fix type<select disabled><option>${esc(c.info.type)}</option></select></label>
          <label class="catch">Fix catches (assumed)
            <span class="catch-row"><input type="range" data-t="catch" min="0" max="100" step="5" value="${c.t.catch}"><output>${c.t.catch}% <small>of failures</small></output></span>
          </label>
        </div>
        <div class="spark">
          <h3>Staff hours by week</h3>
          ${spark(c.weekly, { sel: state.weeks.indexOf(m.week), base: c.baseMin, markers, fmt: (v) => hrs(v) })}
        </div>
      </div>
      <div>
        <h3>By practice, week ${m.week}</h3>
        <ul class="byprac">${c.byPractice.map((x) => `<li>
          <span class="nm" title="${esc(x.p)}">${esc(x.p)}</span>
          <span class="track"><i style="width:${(100 * x.min) / max}%"></i>${m.priorWeeks.length ? `<b style="left:${(100 * x.base) / max}%"></b>` : ""}</span>
          <span class="v">${hrs(x.min)} h</span></li>`).join("")}</ul>
        ${m.priorWeeks.length ? `<p class="byprac-key"><i></i> = that practice’s own ${weeksLabel(m.priorWeeks)} average</p>` : ""}
      </div>
      <div class="tasks">
        <h3>Tasks, longest first</h3>
        <ul>${shown.map((r) => `<li>
          <span>${esc(r.id)}</span><span>${esc(fmtDate(r.date, { month: "short", day: "numeric" }))}</span>
          <span>${esc(r.practice)}</span><span>${esc(r.workflow)}</span>
          <span><i class="dot ${esc(r.outcome)}"></i>${esc(OUTCOME_LABEL[r.outcome])}</span><span class="m">${esc(r.staff_minutes)}m</span>
          <span class="mob">${esc(r.id)} · ${esc(fmtDate(r.date, { month: "short", day: "numeric" }))} · ${esc(r.staff_minutes)} min · <i class="dot ${esc(r.outcome)}"></i>${esc(OUTCOME_LABEL[r.outcome])}</span>
          <span class="mob t2">${esc(r.practice)} · ${esc(r.workflow)} · ${esc(r.channel)}</span>
          <span class="note">${esc(r.agent_note)}</span>
        </li>`).join("")}</ul>
        ${rows.length > TASKS_SHOWN ? `<button class="more" type="button" data-more>${state.showAll ? "Show fewer" : `Show all ${rows.length}`}</button>` : ""}
      </div>
    </div>`;
  }

  // Small line chart: one value per week, optional baseline and fix markers.
  function spark(values, { sel = -1, base = null, markers = [], fmt = String, pctAxis = false } = {}) {
    const W = 320, H = 92, padX = 14, top = 18, bottom = 20;
    const max = Math.max(1e-9, ...values, base || 0) * 1.1;
    const x = (i) => padX + (values.length > 1 ? (i * (W - 2 * padX)) / (values.length - 1) : (W - 2 * padX) / 2);
    const y = (v) => top + (H - top - bottom) * (1 - v / max);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Weekly values">`;
    markers.forEach((w) => {
      const i = state.weeks.indexOf(w);
      if (i < 0) return;
      const mx = i > 0 ? (x(i) + x(i - 1)) / 2 : x(i);
      s += `<line x1="${mx}" x2="${mx}" y1="${top - 8}" y2="${H - bottom}" stroke="var(--accent)" stroke-width="1"/>` +
        `<text x="${mx + 3}" y="${top - 10}" font-size="10" fill="var(--accent)" font-family="var(--font-body)">fix live</text>`;
    });
    if (base !== null) s += `<line x1="${padX}" x2="${W - padX}" y1="${y(base)}" y2="${y(base)}" stroke="var(--text-faint)" stroke-dasharray="3 3"/>`;
    s += `<polyline fill="none" stroke="var(--text-primary)" stroke-width="1.25" points="${values.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>`;
    values.forEach((v, i) => {
      const on = i === sel;
      s += `<circle cx="${x(i)}" cy="${y(v)}" r="${on ? 3.5 : 2}" fill="${on ? "var(--accent)" : "var(--text-primary)"}"/>`;
      s += `<text x="${x(i)}" y="${H - 5}" text-anchor="middle" font-size="10" fill="${on ? "var(--text-primary)" : "var(--text-faint)"}" font-family="var(--font-body)">W${state.weeks[i]}</text>`;
      if (on || i === values.length - 1 || i === 0) s += `<text x="${x(i)}" y="${y(v) - 7}" text-anchor="middle" font-size="10" fill="var(--text-secondary)" font-family="var(--font-body)">${fmt(v)}</text>`;
    });
    return s + `</svg>`;
  }

  function renderPlan(m) {
    const planned = m.byHours.filter((c) => state.plan.has(c.cause));
    if (!planned.length) {
      $("plan").innerHTML = `<p class="empty">Tick Plan on the causes you would take on this week. Effort, staff time back and the automation rate add up here.</p>`;
      return;
    }
    const effort = sum(planned, (c) => c.t.effort);
    const byOwner = {};
    planned.forEach((c) => (byOwner[c.t.owner] = (byOwner[c.t.owner] || 0) + c.t.effort));
    const back = sum(planned, (c) => c.back);
    const caught = sum(planned, (c) => (c.count * c.t.catch) / 100);
    const after = m.total ? (m.automated + caught) / m.total : 0;
    $("plan").innerHTML = `
      <div><div class="n">${planned.length}</div><div class="k">fix${planned.length > 1 ? "es" : ""} planned</div></div>
      <div><div class="n">${effort}d</div><div class="k">${Object.entries(byOwner).map(([o, d]) => `${esc(o)} ${d}d`).join(" · ")}</div></div>
      <div><div class="n">≈${back.toFixed(1)} h</div><div class="k">staff time back a week, of ${hrs(m.staffMin)} h</div></div>
      <div><div class="n"><s>${pct(m.rate)}</s>${pct(after)}</div><div class="k">automated, week ${m.week}, if fixes catch as assumed</div></div>`;
  }

  function renderFixLog() {
    if (!state.fixes.length) {
      $("fixlog").innerHTML = `<p class="empty-log">No fixes logged yet. Log one below and it is measured against the data.</p>`;
      return;
    }
    $("fixlog").innerHTML = [...state.fixes].sort((a, b) => a.week - b.week).map((f) => {
      const r = measureFix(f);
      const scope = f.practices === "all" ? "All practices" : f.practices.join(", ");
      const meta = `${esc(f.cause)} · ${esc(scope)} · ${esc(f.owner)} · live from week ${f.week}`;
      const remove = f.user ? `<button class="fx-remove" type="button" data-remove="${esc(f.id)}">Remove</button>` : "";
      if (!r.ok) {
        return `<div class="fx"><div><div class="fx-title">${esc(f.title)}</div><div class="fx-meta">${meta}</div>${remove}</div>
          <div class="fx-nums">Needs at least one week before and one after the fix to measure.</div><div></div></div>`;
      }
      return `<div class="fx">
        <div><div class="fx-title">${esc(f.title)}</div><div class="fx-meta">${meta}</div>${remove}</div>
        <div class="fx-nums">
          <span class="big">${pct1(r.rb)} → ${pct1(r.ra)}</span>
          of tasks in scope hit this cause (${r.nb} wk before, ${r.na} after)<br>
          ${hrs(r.hb)} → ${hrs(r.ha)} staff h a week
          <div class="fx-verdict ${r.verdict[0]}">${r.verdict[1]} · ${r.change > 0 ? "+" : ""}${Math.round(r.change * 100)}%</div>
          ${r.clear ? "" : `<div class="fx-note">Within normal week-to-week variation for this volume.</div>`}
        </div>
        <div class="fx-spark">${spark(r.weekly.map((x) => x.cnt / x.tot), { markers: [f.week], fmt: (v) => pct1(v) })}</div>
      </div>`;
    }).join("");
  }

  function renderHeat(m) {
    const cause = state.open && m.byHours.find((c) => c.cause === state.open) ? state.open : null;
    $("heat-title").textContent = cause ? `${cause}: staff hours by practice` : "Staff hours by practice";
    $("heat-sub").textContent = cause
      ? "This cause only. Close it in the queue to see all failures."
      : "Staff hours spent on failures, by practice and week. Open a cause in the queue to see just that cause.";
    const rows = m.rows.filter((r) => r.outcome !== "automated" && (!cause || r.cause === cause));
    const practices = state.filters.practice === "all" ? state.practices : [state.filters.practice];
    const grid = practices.map((p) => state.weeks.map((w) => sum(rows.filter((r) => r.practice === p && r.week === w), (r) => r.staff_minutes)));
    const max = Math.max(1, ...grid.flat());
    const cols = `grid-template-columns: minmax(0, 1.7fr) repeat(${state.weeks.length}, minmax(0, 1fr));`;
    let h = `<div class="row" style="${cols}"><span></span>${state.weeks.map((w) => `<span class="hd${w === m.week ? " sel" : ""}">W${w}</span>`).join("")}</div>`;
    practices.forEach((p, i) => {
      h += `<div class="row" style="${cols}"><span class="nm" title="${esc(p)}">${esc(p)}</span>` +
        grid[i].map((v, j) => {
          const a = v ? 0.08 + 0.8 * (v / max) : 0;
          const ink = a > 0.5 ? "var(--bg)" : "var(--text-primary)";
          return `<span class="c${state.weeks[j] === m.week ? " sel" : ""}" style="background:rgba(122,46,42,${a.toFixed(3)});color:${ink}">${v ? hrs(v) : "·"}</span>`;
        }).join("") + `</div>`;
    });
    const totals = state.weeks.map((_, j) => sum(grid, (g) => g[j]));
    h += `<div class="row" style="${cols}"><span class="nm">Total</span>${totals.map((v, j) => `<span class="c tot${state.weeks[j] === m.week ? " sel" : ""}">${hrs(v)}</span>`).join("")}</div>`;
    $("heat").innerHTML = h;
  }

  // ---------- CSV ----------

  function parseCSV(text) {
    const rows = []; let row = []; let field = ""; let q = false;
    text = text.replace(/^﻿/, "");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.some((v) => v !== "")) rows.push(row);
        row = [];
      } else field += ch;
    }
    row.push(field);
    if (row.some((v) => v !== "")) rows.push(row);
    return rows;
  }

  function rowsFromCSV(text) {
    const table = parseCSV(text);
    if (table.length < 2) throw new Error("The file has no data rows.");
    const header = table[0].map((h) => h.trim().toLowerCase());
    const missing = COLUMNS.filter((c) => !OPTIONAL.includes(c) && !header.includes(c));
    if (missing.length) throw new Error(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
    const idx = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
    const errors = []; const out = [];
    table.slice(1).forEach((cells, i) => {
      const line = i + 2;
      const get = (c) => (idx[c] < 0 ? "" : (cells[idx[c]] ?? "").trim());
      const week = Number(get("week"));
      const outcome = get("outcome").toLowerCase();
      const minutes = Number(get("staff_minutes") || 0);
      if (!Number.isInteger(week) || week < 1) return errors.push(`row ${line}: week "${get("week")}" is not a whole number`);
      if (!OUTCOME_LABEL[outcome]) return errors.push(`row ${line}: outcome "${get("outcome")}" must be automated, review or staff`);
      if (!isFinite(minutes) || minutes < 0) return errors.push(`row ${line}: staff_minutes "${get("staff_minutes")}" is not a number`);
      out.push({
        id: get("id") || `row-${line}`, week, date: get("date"),
        practice: get("practice") || "Your practice",
        workflow: get("workflow") || "Unspecified", channel: get("channel") || "Unspecified",
        outcome, cause: outcome === "automated" ? null : get("cause") || "Unspecified",
        staff_minutes: outcome === "automated" ? 0 : minutes, agent_note: get("agent_note"),
      });
    });
    if (!out.length) throw new Error(`No usable rows. ${errors.slice(0, 3).join("; ")}`);
    return { rows: out, errors };
  }

  function toCSV(rows) {
    const cell = (v) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [COLUMNS.join(","), ...rows.map((r) => COLUMNS.map((c) => cell(r[c])).join(","))].join("\n");
  }

  // ---------- events ----------

  ["f-week", "f-practice", "f-workflow", "f-channel"].forEach((id) => {
    $(id).addEventListener("change", (e) => {
      const key = id.slice(2);
      state.filters[key] = key === "week" ? Number(e.target.value) : e.target.value;
      state.showAll = false;
      render();
    });
  });

  document.querySelector(".sort").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-sort]");
    if (!b) return;
    state.sort = b.dataset.sort;
    render();
  });

  const queue = $("queue");
  function toggleRow(row) {
    state.open = state.open === row.dataset.cause ? null : row.dataset.cause;
    state.showAll = false;
    render();
  }
  queue.addEventListener("click", (e) => {
    if (e.target.closest(".q-plan")) return;
    if (e.target.closest("[data-more]")) { state.showAll = !state.showAll; render(); return; }
    const row = e.target.closest(".q-row");
    if (row) toggleRow(row);
  });
  queue.addEventListener("keydown", (e) => {
    const row = e.target.closest(".q-row");
    if (row && e.target === row && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggleRow(row); }
  });
  queue.addEventListener("change", (e) => {
    if (e.target.dataset.plan) {
      const c = e.target.dataset.plan;
      e.target.checked ? state.plan.add(c) : state.plan.delete(c);
      render();
      return;
    }
    const key = e.target.dataset.t;
    if (!key || !state.open) return;
    const t = state.triage[state.open];
    if (key === "owner") t.owner = e.target.value;
    if (key === "effort") { const v = Number(e.target.value); if (v > 0) t.effort = v; }
    if (key === "catch") t.catch = Number(e.target.value);
    render();
  });
  // While dragging the catch slider, update the numbers without rebuilding the row under the pointer.
  queue.addEventListener("input", (e) => {
    if (e.target.dataset.t !== "catch" || !state.open) return;
    state.triage[state.open].catch = Number(e.target.value);
    e.target.parentElement.querySelector("output").innerHTML = `${e.target.value}% <small>of failures</small>`;
    const m = compute();
    renderPlan(m);
    renderLede(m);
  });

  $("fix-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const scope = fd.get("scope");
    state.fixes.push({
      id: `user-${Date.now()}`, user: true, title: String(fd.get("title")).trim(), cause: fd.get("cause"),
      practices: scope === "all" ? "all" : [scope], week: Number(fd.get("week")), owner: fd.get("owner"),
    });
    e.target.reset();
    buildControls();
    renderFixLog();
  });
  $("fixlog").addEventListener("click", (e) => {
    const b = e.target.closest("[data-remove]");
    if (!b) return;
    state.fixes = state.fixes.filter((f) => f.id !== b.dataset.remove);
    renderFixLog();
  });

  $("csv").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const msg = $("upload-msg");
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { rows, errors } = rowsFromCSV(String(reader.result));
        loadData(rows, [], file.name);
        msg.className = "upload-msg";
        msg.textContent = `Loaded ${rows.length} tasks from ${file.name}.` +
          (errors.length ? ` Skipped ${errors.length} row${errors.length > 1 ? "s" : ""}: ${errors.slice(0, 3).join("; ")}${errors.length > 3 ? "…" : ""}` : "");
        window.scrollTo({ top: 0, behavior: "smooth" });
      } catch (err) {
        msg.className = "upload-msg err";
        msg.textContent = err.message;
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  $("dl-demo").addEventListener("click", () => {
    const blob = new Blob([toCSV(window.DEMO_DATA)], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "demo-agent-tasks.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("reset").addEventListener("click", () => {
    loadData(window.DEMO_DATA, window.DEMO_FIXES, null);
    $("upload-msg").textContent = "Back on demo data.";
  });

  loadData(window.DEMO_DATA, window.DEMO_FIXES, null);
})();
