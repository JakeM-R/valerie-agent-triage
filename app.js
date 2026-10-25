(function () {
  "use strict";

  // Method constants, shown on the page so the rules are visible.
  const MIN_TASKS_TO_FLAG = 8;   // below this, a week-on-week jump is mostly noise
  const FLAG_RATIO = 1.25;       // flag when this week's hours are 25%+ above the cause's own baseline
  const DEFAULT_CATCH = 70;      // default share of a cause's failures a fix would catch (assumption)

  // Short headline names for the demo causes. Uploaded causes fall back to their own text.
  const SHORT = {
    "Fax unreadable after text extraction": "Unreadable faxes",
    "Referral missing required fields": "Referrals missing required fields",
    "Payer not on eligibility list": "Payers missing from the eligibility list",
    "Provider/location not mapped in PMS": "Unmapped providers and locations",
    "Duplicate patient match": "Duplicate patient matches",
    "Document classified as wrong type": "Misclassified documents",
  };
  const OUTCOME_LABEL = { automated: "Automated", review: "Needed review", staff: "Handed to staff" };
  const COLUMNS = ["id", "week", "date", "workflow", "channel", "outcome", "cause", "staff_minutes", "agent_note"];

  const state = {
    data: window.DEMO_DATA,
    sourceName: null, // null = demo
    weeks: [],
    filters: { week: null, workflow: "all", channel: "all" },
    fixes: {},        // cause -> { on, catch }
    open: null,       // cause shown in drill-down
  };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const hrs = (min) => (min / 60).toFixed(1);
  const pct = (x) => `${Math.round(x * 100)}%`;
  const short = (c) => SHORT[c] || c;
  const uniq = (arr) => [...new Set(arr)];

  function fmtDate(iso, opts) {
    const d = new Date(iso + "T00:00:00Z");
    return isNaN(d) ? iso : d.toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
  }
  function weekRange(w) {
    const dates = state.data.filter((r) => r.week === w).map((r) => r.date).filter(Boolean).sort();
    if (!dates.length) return "";
    const a = fmtDate(dates[0], { month: "short", day: "numeric" });
    const last = dates[dates.length - 1];
    const sameMonth = last.slice(0, 7) === dates[0].slice(0, 7);
    const b = fmtDate(last, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
    return dates[0] === last ? a : `${a}–${b}`;
  }
  function weeksLabel(ws) {
    if (!ws.length) return "";
    return ws.length === 1 ? `week ${ws[0]}` : `weeks ${ws[0]}–${ws[ws.length - 1]}`;
  }

  // ---------- data setup ----------

  function loadData(rows, sourceName) {
    state.data = rows;
    state.sourceName = sourceName;
    state.weeks = uniq(rows.map((r) => r.week)).sort((a, b) => a - b);
    state.filters = { week: state.weeks[state.weeks.length - 1], workflow: "all", channel: "all" };
    state.fixes = {};
    state.open = null;
    $("sim-list").dataset.order = "";
    allCauses().forEach((c) => (state.fixes[c] = { on: false, catch: DEFAULT_CATCH }));
    buildFilters();
    render();
  }

  function allCauses() {
    return uniq(state.data.map((r) => r.cause).filter(Boolean)).sort();
  }

  function buildFilters() {
    const latest = state.weeks[state.weeks.length - 1];
    $("f-week").innerHTML = state.weeks
      .map((w) => `<option value="${w}">Week ${w} · ${esc(weekRange(w))}${w === latest ? " (latest)" : ""}</option>`)
      .join("");
    $("f-week").value = String(state.filters.week);
    const opts = (key) =>
      `<option value="all">All</option>` +
      uniq(state.data.map((r) => r[key])).sort().map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
    $("f-workflow").innerHTML = opts("workflow");
    $("f-channel").innerHTML = opts("channel");
  }

  // ---------- computation ----------

  function filtered() {
    const { workflow, channel } = state.filters;
    return state.data.filter((r) => (workflow === "all" || r.workflow === workflow) && (channel === "all" || r.channel === channel));
  }

  function compute() {
    const rows = filtered();
    const week = state.filters.week;
    const thisWeek = rows.filter((r) => r.week === week);
    const priorWeeks = state.weeks.filter((w) => w < week);
    const total = thisWeek.length;
    const automated = thisWeek.filter((r) => r.outcome === "automated").length;
    const failures = thisWeek.filter((r) => r.outcome !== "automated");

    const priorRates = priorWeeks
      .map((w) => rows.filter((r) => r.week === w))
      .filter((rs) => rs.length)
      .map((rs) => rs.filter((r) => r.outcome === "automated").length / rs.length);

    const causes = allCauses().map((cause) => {
      const tasks = failures.filter((r) => r.cause === cause);
      const minutes = sum(tasks, (r) => r.staff_minutes);
      const priorMin = priorWeeks.map((w) => sum(rows.filter((r) => r.week === w && r.cause === cause), (r) => r.staff_minutes));
      const priorCnt = priorWeeks.map((w) => rows.filter((r) => r.week === w && r.cause === cause).length);
      const baseMin = priorWeeks.length ? sum(priorMin, (x) => x) / priorWeeks.length : null;
      const baseCnt = priorWeeks.length ? sum(priorCnt, (x) => x) / priorWeeks.length : null;
      const flagged = baseMin !== null && tasks.length >= MIN_TASKS_TO_FLAG && minutes > baseMin * FLAG_RATIO;
      const wfCounts = {};
      tasks.forEach((r) => (wfCounts[r.workflow] = (wfCounts[r.workflow] || 0) + 1));
      const topWf = Object.entries(wfCounts).sort((a, b) => b[1] - a[1])[0];
      return { cause, tasks, count: tasks.length, minutes, baseMin, baseCnt, flagged, topWf };
    }).filter((c) => c.count > 0)
      .sort((a, b) => b.minutes - a.minutes || b.count - a.count);

    return {
      rows, week, priorWeeks, thisWeek, total, automated, failures, causes,
      rate: total ? automated / total : 0,
      priorRate: priorRates.length ? sum(priorRates, (x) => x) / priorRates.length : null,
      staffMin: sum(failures, (r) => r.staff_minutes),
      staffCount: failures.filter((r) => r.outcome === "staff").length,
      reviewCount: failures.filter((r) => r.outcome === "review").length,
    };
  }

  // Expected effect of the active fixes on a set of rows.
  function simulate(rows, fixes) {
    const total = rows.length;
    const automated = rows.filter((r) => r.outcome === "automated").length;
    let caught = 0, savedMin = 0;
    for (const [cause, f] of Object.entries(fixes)) {
      if (!f.on) continue;
      const rs = rows.filter((r) => r.cause === cause && r.outcome !== "automated");
      caught += rs.length * f.catch / 100;
      savedMin += sum(rs, (r) => r.staff_minutes) * f.catch / 100;
    }
    return { total, automated, caught, savedMin, before: total ? automated / total : 0, after: total ? (automated + caught) / total : 0 };
  }

  // ---------- rendering ----------

  function render() {
    const m = compute();
    renderSource();
    renderHero(m);
    renderTiles(m);
    renderCauses(m);
    renderSim(m);
    renderChart(m);
  }

  function renderSource() {
    const n = state.data.length;
    $("source").innerHTML = state.sourceName
      ? `<span class="badge yours">Your export</span>${esc(state.sourceName)} · ${n} tasks · read in your browser only`
      : `<span class="badge">Demo data</span>Harbor Orthopedics (fictional) · ${n} tasks · ${state.weeks.length} weeks`;
    $("reset").hidden = !state.sourceName;
  }

  function weekWord(m) {
    return m.week === state.weeks[state.weeks.length - 1] ? "this week" : `in week ${m.week}`;
  }

  function renderHero(m) {
    const practice = state.sourceName ? "Your export" : "Harbor Orthopedics (demo)";
    const filt = [state.filters.workflow, state.filters.channel].filter((v) => v !== "all").join(" · ");
    $("eyebrow").textContent = `${practice} · Week ${m.week} · ${weekRange(m.week)}${filt ? " · " + filt : ""}`;

    const l1 = $("headline").querySelector(".l1");
    const l2 = $("headline").querySelector(".l2");
    const top = m.causes[0];
    if (!top) {
      l1.textContent = `No failed tasks ${weekWord(m)} for this filter.`;
      l2.textContent = m.total ? `Automation is ${pct(m.rate)} on ${m.total} tasks.` : "No tasks match.";
      $("hero-sub").textContent = "";
      return;
    }
    const sim = simulate(m.thisWeek, { [top.cause]: { on: true, catch: DEFAULT_CATCH } });
    l1.textContent = `${short(top.cause)} cost ${hrs(top.minutes)} staff hours ${weekWord(m)}.`;
    l2.textContent = `Fixing ${DEFAULT_CATCH}% of them lifts automation from ${pct(sim.before)} to ${pct(sim.after)}.`;

    const bits = [];
    if (top.topWf && top.topWf[1] / top.count >= 0.5) {
      bits.push(`${Math.round((100 * top.topWf[1]) / top.count)}% of them are ${top.topWf[0]} tasks.`);
    }
    if (top.flagged && top.baseMin > 0) {
      bits.push(`That is ${(top.minutes / top.baseMin).toFixed(1)}× its own ${weeksLabel(m.priorWeeks)} average.`);
    }
    const byCount = [...m.causes].sort((a, b) => b.count - a.count)[0];
    if (byCount.cause !== top.cause) {
      bits.push(`By task count, ${short(byCount.cause).toLowerCase()} lead (${byCount.count} vs ${top.count}), but cost ${hrs(byCount.minutes)} hours.`);
    }
    bits.push(`The ${DEFAULT_CATCH}% catch rate is an assumption; change it below.`);
    $("hero-sub").textContent = bits.join(" ");
  }

  function renderTiles(m) {
    const delta = m.priorRate === null ? "No earlier weeks to compare"
      : `${weeksLabel(m.priorWeeks).replace(/^w/, "W")} average: ${pct(m.priorRate)}`;
    $("tiles").innerHTML = `
      <div class="tile"><div class="label">Automation rate</div><div class="num">${pct(m.rate)}</div><div class="delta">${delta}</div></div>
      <div class="tile"><div class="label">Staff hours on failures</div><div class="num">${hrs(m.staffMin)}</div><div class="delta">${m.failures.length} of ${m.total} tasks failed</div></div>
      <div class="tile"><div class="label">Tasks handed to staff</div><div class="num">${m.staffCount}</div><div class="delta">plus ${m.reviewCount} that needed review</div></div>`;
  }

  function renderCauses(m) {
    const max = Math.max(1, ...m.causes.map((c) => c.minutes));
    const byCount = [...m.causes].sort((a, b) => b.count - a.count)[0];
    $("count-vs-hours").textContent = !m.causes.length ? "No failures to rank."
      : byCount.cause === m.causes[0].cause
        ? `${short(m.causes[0].cause)} lead on both task count and staff time.`
        : `Ranked by count, ${short(byCount.cause).toLowerCase()} would be first (${byCount.count} tasks, ${hrs(byCount.minutes)} h). Ranked by staff time, ${short(m.causes[0].cause).toLowerCase()} are (${m.causes[0].count} tasks, ${hrs(m.causes[0].minutes)} h).`;

    $("causes").innerHTML = m.causes.map((c, i) => {
      const avgMin = c.count ? Math.round(c.minutes / c.count) : 0;
      const base = c.baseMin === null ? "" : `<span>${weeksLabel(m.priorWeeks)} avg: ${hrs(c.baseMin)} h/wk</span>`;
      const flag = c.flagged ? `<span class="flag">▲ ${c.baseMin > 0 ? (c.minutes / c.baseMin).toFixed(1) + "× baseline" : "new this week"}</span>` : "";
      const open = state.open === c.cause;
      return `<li class="cause${open ? " open" : ""}">
        <button class="cause-btn" type="button" data-cause="${esc(c.cause)}" aria-expanded="${open}">
          <span class="rank">${i + 1}</span>
          <span class="cause-name">${esc(c.cause)}<span class="chev" aria-hidden="true">›</span></span>
          <span class="cause-hours">${hrs(c.minutes)} h</span>
          <span class="bar" aria-hidden="true"><i style="width:${(100 * c.minutes) / max}%"></i></span>
          <span class="cause-meta"><span>${c.count} tasks × ${avgMin} min avg</span>${base}${flag}</span>
        </button>
        ${open ? drill(c) : ""}
      </li>`;
    }).join("");

    $("flag-rule").textContent =
      `Flag rule: this week's staff hours are at least ${Math.round((FLAG_RATIO - 1) * 100)}% above the cause's own average for the weeks before it, ` +
      `and the cause has at least ${MIN_TASKS_TO_FLAG} tasks this week, so small-number swings are not flagged.` +
      (state.sourceName ? "" : " Minutes are demo values.");
  }

  function drill(c) {
    const rows = [...c.tasks].sort((a, b) => b.staff_minutes - a.staff_minutes);
    return `<div class="drill">
      <p>${c.count} tasks in week ${state.filters.week}, longest first.</p>
      <table class="tasks">
        <thead><tr><th>Task</th><th>Date</th><th>Workflow</th><th>Channel</th><th>Outcome</th><th>Min</th><th>Agent note</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td>${esc(r.id)}</td>
          <td>${esc(fmtDate(r.date, { month: "short", day: "numeric" }))}</td>
          <td>${esc(r.workflow)}</td>
          <td>${esc(r.channel)}</td>
          <td><i class="dot ${esc(r.outcome)}"></i>${esc(OUTCOME_LABEL[r.outcome])}</td>
          <td class="num">${esc(r.staff_minutes)}</td>
          <td class="note">${esc(r.agent_note)}</td>
        </tr>`).join("")}</tbody>
      </table>
      <ul class="task-cards">${rows.map((r) => `<li>
        <div class="t1">${esc(r.id)} · ${esc(fmtDate(r.date, { month: "short", day: "numeric" }))} · ${esc(r.staff_minutes)} min</div>
        <div class="t2">${esc(r.workflow)} · ${esc(r.channel)} · <i class="dot ${esc(r.outcome)}"></i>${esc(OUTCOME_LABEL[r.outcome])}</div>
        <div class="t3">${esc(r.agent_note)}</div>
      </li>`).join("")}</ul>
    </div>`;
  }

  function renderSim(m) {
    const s = simulate(m.thisWeek, state.fixes);
    const any = Object.values(state.fixes).some((f) => f.on);
    $("sim-result").innerHTML = `
      <div class="sim-box"><div class="label">Automation rate, week ${m.week}</div>
        <div class="num">${any ? `<s>${pct(s.before)}</s>` : ""}${pct(s.after)}</div>
        <div class="sub">${any ? `≈ ${Math.round(s.caught)} more tasks automated` : "Turn on a fix below"}</div></div>
      <div class="sim-box"><div class="label">Staff hours saved per week</div>
        <div class="num">${hrs(s.savedMin)}</div>
        <div class="sub">${any ? `of ${hrs(m.staffMin)} h spent on failures` : "Based on this week's minutes"}</div></div>`;

    // Keep the list stable while sliding; only rebuild when the set of causes changes.
    const list = $("sim-list");
    const order = m.causes.map((c) => c.cause);
    if (list.dataset.order !== JSON.stringify(order)) {
      list.dataset.order = JSON.stringify(order);
      list.innerHTML = m.causes.map((c) => {
        const f = state.fixes[c.cause];
        return `<li class="sim-item${f.on ? "" : " off"}" data-cause="${esc(c.cause)}">
          <div><div class="name">${esc(c.cause)}</div><div class="info"></div></div>
          <label class="switch"><input type="checkbox" ${f.on ? "checked" : ""} aria-label="Mark ${esc(c.cause)} fixed"><span class="track"></span>Fixed</label>
          <div class="slider"><span>Fix catches</span>
            <input type="range" min="0" max="100" step="5" value="${f.catch}" aria-label="Share of ${esc(c.cause)} failures the fix would catch">
            <output>${f.catch}% <small>(assumed)</small></output></div>
        </li>`;
      }).join("");
    }
    list.querySelectorAll(".sim-item").forEach((li) => {
      const c = m.causes.find((x) => x.cause === li.dataset.cause);
      const f = state.fixes[li.dataset.cause];
      li.classList.toggle("off", !f.on);
      li.querySelector(".info").textContent =
        `${c.count} failures, ${hrs(c.minutes)} h this week → saves ≈ ${hrs((c.minutes * f.catch) / 100)} h if fixed`;
    });
  }

  function renderChart(m) {
    // Size the viewBox to the container so labels stay readable on phones.
    const W = Math.max(300, Math.min(720, $("chart").clientWidth || 640)), H = 256, padL = 4, padR = 4, top = 50, bottom = 40;
    const n = state.weeks.length || 1;
    const slot = (W - padL - padR) / n;
    const bw = Math.min(88, slot * 0.6);
    const ch = H - top - bottom;
    let out = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Task outcomes by week">`;
    state.weeks.forEach((w, i) => {
      const rows = m.rows.filter((r) => r.week === w);
      const x = padL + slot * i + (slot - bw) / 2;
      const t = rows.length || 1;
      const a = rows.filter((r) => r.outcome === "automated").length / t;
      const rv = rows.filter((r) => r.outcome === "review").length / t;
      const st = rows.filter((r) => r.outcome === "staff").length / t;
      const sim = simulate(rows, state.fixes);
      const g = sim.caught / t;
      const sel = w === m.week;
      const op = sel ? 1 : 0.55;
      let y = top + ch;
      const seg = (share, color) => { const h = share * ch; y -= h; return `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${color}" opacity="${op}"/>`; };
      out += seg(a, "var(--green)") + seg(rv, "var(--purple)") + seg(st, "var(--grey)");
      if (g > 0) {
        const gy = top + ch - (a + g) * ch;
        out += `<rect x="${x + 1}" y="${gy}" width="${bw - 2}" height="${g * ch}" fill="var(--green)" fill-opacity="0.35" stroke="var(--green-ink)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
      }
      const fw = sel ? 600 : 400;
      out += `<text x="${x + bw / 2}" y="${top - (g > 0 ? 26 : 10)}" text-anchor="middle" font-size="13" font-weight="${fw}" fill="var(--ink)">${rows.length ? pct(a) : "–"}</text>`;
      if (g > 0) out += `<text x="${x + bw / 2}" y="${top - 10}" text-anchor="middle" font-size="12" font-weight="${fw}" fill="var(--green-ink)">→ ${pct(sim.after)}</text>`;
      out += `<text x="${x + bw / 2}" y="${H - 20}" text-anchor="middle" font-size="12" font-weight="${sel ? 600 : 400}" fill="var(--ink)">Week ${w}</text>`;
      out += `<text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle" font-size="11" fill="var(--muted)">${rows.length} tasks</text>`;
    });
    out += `<line x1="0" x2="${W}" y1="${top + ch + 0.5}" y2="${top + ch + 0.5}" stroke="var(--line)"/></svg>`;
    $("chart").innerHTML = out;
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
    const missing = COLUMNS.filter((c) => !header.includes(c));
    if (missing.length) throw new Error(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
    const idx = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));
    const errors = []; const out = [];
    table.slice(1).forEach((cells, i) => {
      const line = i + 2;
      const get = (c) => (cells[idx[c]] ?? "").trim();
      const week = Number(get("week"));
      const outcome = get("outcome").toLowerCase();
      const minutes = Number(get("staff_minutes") || 0);
      if (!Number.isInteger(week) || week < 1) return errors.push(`row ${line}: week "${get("week")}" is not a whole number`);
      if (!OUTCOME_LABEL[outcome]) return errors.push(`row ${line}: outcome "${get("outcome")}" must be automated, review or staff`);
      if (!isFinite(minutes) || minutes < 0) return errors.push(`row ${line}: staff_minutes "${get("staff_minutes")}" is not a number`);
      out.push({
        id: get("id") || `row-${line}`,
        week, date: get("date"),
        workflow: get("workflow") || "Unspecified",
        channel: get("channel") || "Unspecified",
        outcome,
        cause: outcome === "automated" ? null : get("cause") || "Unspecified",
        staff_minutes: outcome === "automated" ? 0 : minutes,
        agent_note: get("agent_note"),
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

  ["f-week", "f-workflow", "f-channel"].forEach((id) => {
    $(id).addEventListener("change", (e) => {
      const key = id.slice(2);
      state.filters[key] = key === "week" ? Number(e.target.value) : e.target.value;
      state.open = null;
      render();
    });
  });

  $("causes").addEventListener("click", (e) => {
    const btn = e.target.closest(".cause-btn");
    if (!btn) return;
    state.open = state.open === btn.dataset.cause ? null : btn.dataset.cause;
    render();
  });

  $("sim-list").addEventListener("input", (e) => {
    const li = e.target.closest(".sim-item");
    if (!li) return;
    const f = state.fixes[li.dataset.cause];
    if (e.target.type === "checkbox") f.on = e.target.checked;
    if (e.target.type === "range") {
      f.catch = Number(e.target.value);
      f.on = true;
      li.querySelector('input[type="checkbox"]').checked = true;
      li.querySelector("output").innerHTML = `${f.catch}% <small>(assumed)</small>`;
    }
    render();
  });

  $("csv").addEventListener("change", (e) => {
    const file = e.target.files[0];
    const msg = $("upload-msg");
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const { rows, errors } = rowsFromCSV(String(reader.result));
        loadData(rows, file.name);
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
    a.download = "harbor-orthopedics-demo-tasks.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $("reset").addEventListener("click", () => {
    loadData(window.DEMO_DATA, null);
    $("upload-msg").textContent = "Back on demo data.";
  });

  let resizeTimer;
  window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => renderChart(compute()), 150); });

  loadData(window.DEMO_DATA, null);
})();
