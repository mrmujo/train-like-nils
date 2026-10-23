/* Train like Nils: UI. Reads the controls, builds the plan, renders it. */
(function () {
  'use strict';

  const P = window.NilsPlan;
  const $ = (sel) => document.querySelector(sel);
  const SVG = 'http://www.w3.org/2000/svg';

  const state = { p: 30, race: 'marathon', time: '', mode: 'race', weeks: 16, season: 'aerobic', strength: true, now: '',
    recentKey: '10k', recentTime: '' };
  const openWeeks = new Set([1]);
  let plan = null;

  // Day and week totals include odd jog rests (2 × 15 min + 2 min jog);
  // show them to the nearest 5 min so the numbers stay clean.
  const round5 = (m) => Math.round(m / 5) * 5;
  const fmtTotal = (m) => P.fmtMin(round5(m));

  // --- Elements -------------------------------------------------------------
  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else node.setAttribute(k, v);
    }
    for (const c of children) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  function svg(tag, attrs) {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs || {})) node.setAttribute(k, v);
    return node;
  }

  // --- State <-> URL hash ---------------------------------------------------
  function readHash() {
    const q = new URLSearchParams(location.hash.slice(1));
    const p = Number(q.get('p'));
    if (p >= 10 && p <= 100) state.p = Math.round(p / 5) * 5;
    if (P.RACES[q.get('race')]) state.race = q.get('race');
    if (q.has('time')) state.time = q.get('time').slice(0, 12);
    if (['race', 'cycle', 'year', 'season'].includes(q.get('mode'))) state.mode = q.get('mode');
    const w = Number(q.get('weeks'));
    if (w >= 8 && w <= 30) state.weeks = Math.round(w);
    if (['aerobic', 'threshold', 'specific'].includes(q.get('season'))) state.season = q.get('season');
    if (q.get('strength') === '0') state.strength = false;
    if (q.has('now')) state.now = q.get('now').slice(0, 5);
    if (P.RECENT_RACES[q.get('rk')]) state.recentKey = q.get('rk');
    if (q.has('rt')) state.recentTime = q.get('rt').slice(0, 12);
  }

  function writeHash() {
    const q = new URLSearchParams({ p: state.p, race: state.race, mode: state.mode });
    if (state.time) q.set('time', state.time);
    if (state.mode === 'race') q.set('weeks', state.weeks);
    if (state.mode === 'season') q.set('season', state.season);
    if (!state.strength) q.set('strength', '0');
    if (state.now) q.set('now', state.now);
    if (state.recentTime) { q.set('rk', state.recentKey); q.set('rt', state.recentTime); }
    history.replaceState(null, '', '#' + q.toString().replace(/%3A/g, ':'));
  }

  function syncControls() {
    $('#dose').value = state.p;
    document.querySelector(`input[name="race"][value="${state.race}"]`).checked = true;
    document.querySelector(`input[name="mode"][value="${state.mode}"]`).checked = true;
    document.querySelector(`input[name="season"][value="${state.season}"]`).checked = true;
    $('#time').value = state.time;
    $('#weeks').value = state.weeks;
    $('#strength').checked = state.strength;
    $('#now').value = state.now;
    document.querySelector(`input[name="recent"][value="${state.recentKey}"]`).checked = true;
    $('#recent-time').value = state.recentTime;
  }

  function currentHours() {
    const h = Number(state.now);
    return state.now !== '' && h > 0 && h <= 40 ? h : null;
  }

  // --- Paces ------------------------------------------------------------------
  function paceText(zone, paces) {
    if (!paces) return '';
    const range = (r) => `${P.fmtPace(r[0])}–${P.fmtPace(r[1])} /km`;
    if (zone === 'easy') return range(paces.easy);
    if (zone === 'warmup') return `steady ${P.fmtPace(paces.steady)} /km`;
    if (zone === 'threshold') return range(paces.threshold);
    if (zone === 'race' && paces.race) return `${P.fmtPace(paces.race)} /km`;
    if (zone === 'speed' && paces.speed) return `${P.fmtPace(paces.speed)} /km`;
    return '';
  }

  const EFFORT = {
    threshold: 'comfortably hard',
    race: 'goal-race effort',
    speed: 'a notch faster than goal effort',
  };

  function renderPaces() {
    const host = $('#paces');
    const pc = plan.paces;
    const race = plan.race;
    const tile = (label, value, unit, sub) => el('div', { class: 'pace' },
      el('div', { class: 'pace-label' }, label),
      el('div', { class: unit ? 'pace-value num' : 'pace-value' }, value, unit ? el('small', null, unit) : null),
      el('div', { class: 'pace-sub' }, sub));

    // Training paces and race pace can come from different inputs, so each tile
    // falls back to effort on its own.
    const tiles = [
      pc
        ? tile('Easy', `${P.fmtPace(pc.easy[0])}–${P.fmtPace(pc.easy[1])}`, '/km', `60–75 % of max heart rate. Daily test: steady at ${P.fmtPace(pc.steady)}.`)
        : tile('Easy', 'Conversational', '', '60–75 % of max heart rate. Daily test: steady at the top of it.'),
      pc
        ? tile('Threshold', `${P.fmtPace(pc.threshold[0])}–${P.fmtPace(pc.threshold[1])}`, '/km', 'Pace you could race for about an hour')
        : tile('Threshold', 'Comfortably hard', '', 'Pace you could race for about an hour'),
      pc && pc.race
        ? tile('Race pace', P.fmtPace(pc.race), '/km', `${race.label} in ${P.fmtClock(plan.goalSec)}`)
        : tile('Race pace', 'Goal effort', '', 'Add a goal time to get race pace'),
      race.ultra ? null
        : pc && pc.speed
          ? tile('Speed', P.fmtPace(pc.speed), '/km', '3 % faster, used in overreach weeks')
          : tile('Speed', 'A notch faster', '', 'Used in overreach weeks'),
    ];
    host.replaceChildren(...tiles.filter(Boolean));
  }

  // --- Overview chart ---------------------------------------------------------
  function niceStep(max) {
    for (const s of [1, 2, 5, 10]) if (max / s <= 5) return s;
    return 20;
  }

  function barPath(x, y, w, h, r) {
    const y0 = y + h;
    r = Math.min(r, w / 2, h);
    return `M${x},${y0}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y0}Z`;
  }

  function renderChart() {
    const host = $('#chart');
    const W = Math.max(280, host.clientWidth || 600);
    const H = 190;
    const m = { t: 10, r: 4, b: 24, l: 34 };
    const weeks = plan.weeks;
    const n = weeks.length;
    const maxH = Math.max(1, ...weeks.map((w) => w.totalMin / 60));
    const step = niceStep(maxH);
    const top = Math.ceil(maxH / step) * step;
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const band = iw / n;
    const bw = Math.min(24, Math.max(3, band * 0.7));
    const y = (h) => m.t + ih - (h / top) * ih;

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': 'Weekly training hours by phase' });

    for (let v = 0; v <= top; v += step) {
      const yy = Math.round(y(v)) + 0.5;
      root.append(svg('line', { class: v === 0 ? 'baseline' : 'grid', x1: m.l, x2: W - m.r, y1: yy, y2: yy }));
      const t = svg('text', { class: 'tick', x: m.l - 8, y: yy + 4, 'text-anchor': 'end' });
      t.textContent = `${v} h`;
      root.append(t);
    }

    const every = Math.max(1, Math.ceil(22 / band));
    weeks.forEach((w, i) => {
      const cx = m.l + band * i + band / 2;
      const hours = w.totalMin / 60;
      const g = svg('g', { class: 'col', tabindex: '0', role: 'button', 'aria-label': `Week ${w.index}, ${P.PHASES[w.phase].name}, ${fmtTotal(w.totalMin)}` });
      g.append(svg('rect', { class: 'hit', x: m.l + band * i, y: m.t, width: band, height: ih, rx: 4 }));
      if (hours > 0) {
        const yTop = y(hours);
        g.append(svg('path', { class: `bar phase-${w.phase}`, d: barPath(cx - bw / 2, yTop, bw, m.t + ih - yTop, 4) }));
      }
      if (i === 0 || (i + 1) % every === 0 || i === n - 1 && n <= 16) {
        const t = svg('text', { class: 'tick', x: cx, y: H - 6, 'text-anchor': 'middle' });
        t.textContent = w.index;
        root.append(t);
      }
      g.addEventListener('pointerenter', (e) => showTip(w, e.clientX, e.clientY));
      g.addEventListener('pointermove', (e) => moveTip(e.clientX, e.clientY));
      g.addEventListener('pointerleave', hideTip);
      g.addEventListener('focus', () => {
        const r = g.getBoundingClientRect();
        showTip(w, r.left + r.width / 2, r.top);
      });
      g.addEventListener('blur', hideTip);
      g.addEventListener('click', () => openWeek(w.index));
      g.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWeek(w.index); }
      });
      root.append(g);
    });

    host.replaceChildren(root);
  }

  const tip = $('#tooltip');

  function showTip(w, x, y) {
    const ph = P.PHASES[w.phase];
    const key = el('i', { class: `key phase-${w.phase}` });
    tip.replaceChildren(
      el('strong', null, fmtTotal(w.totalMin)),
      el('span', null, key, `Week ${w.index} · ${ph.name}`),
      w.sub ? el('div', null, el('span', null, w.sub)) : null,
    );
    tip.hidden = false;
    moveTip(x, y);
  }

  function moveTip(x, y) {
    const r = tip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x - r.width / 2));
    const top = y - r.height - 12 < 8 ? y + 16 : y - r.height - 12;
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }

  function hideTip() { tip.hidden = true; }

  function renderOverview() {
    const c = plan.counts;
    const parts = ['aerobic', 'threshold', 'specific', 'peak'].filter((k) => c[k] > 0);
    const peakWeek = plan.weeks.reduce((a, b) => (b.totalMin > a.totalMin ? b : a));
    $('#summary').textContent = `${plan.weeks.length} weeks · biggest week ${fmtTotal(peakWeek.totalMin)}`;
    $('#legend').replaceChildren(...parts.map((k) => el('li', null,
      el('span', { class: `swatch phase-${k}` }),
      P.PHASES[k].name,
      el('b', null, `${c[k]} wk`))));
    renderChart();
  }

  // --- Week cards --------------------------------------------------------------
  function renderBlock(b) {
    const work = b.zone === 'threshold' || b.zone === 'race' || b.zone === 'speed' || b.zone === 'strength';
    const pace = paceText(b.zone, plan.paces) || (work && EFFORT[b.zone]) || '';
    return el('li', { class: work ? 'work' : null },
      el('span', { class: 'b-min' }, P.fmtMin(b.min)),
      el('span', null,
        b.session ? el('span', { class: 'session' }, b.session) : null,
        el('span', { class: 'b-label' }, b.label),
        pace ? el('span', { class: 'b-pace' }, pace) : null,
        b.detail ? el('span', { class: 'b-detail' }, b.detail) : null));
  }

  function fuelBadge() {
    const icon = svg('svg', { viewBox: '0 0 16 16', width: 12, height: 12, 'aria-hidden': 'true' });
    icon.append(svg('path', { d: 'M9.5 1 3 9.5h4.5L6.5 15 13 6.5H8.5z' }));
    return el('span', { class: 'fuel' }, icon, 'Fuel');
  }

  function renderDay(d) {
    let total = '';
    if (d.goal) total = plan.goalSec ? P.fmtClock(plan.goalSec) : '';
    else if (d.totalMin) total = fmtTotal(d.totalMin);
    const title = d.goal && plan.paces && plan.paces.race ? `${d.title} at ${P.fmtPace(plan.paces.race)} /km` : d.title;
    // A one-block day (an easy run) needs no block list: put its pace under the title.
    const single = d.blocks.length === 1 && !d.blocks[0].session ? d.blocks[0] : null;
    const meta = single
      ? [single.label === 'Easy' ? '' : single.label, paceText(single.zone, plan.paces), single.detail].filter(Boolean).join(' · ')
      : '';
    const fuel = d.fuel;
    const hasBody = meta || fuel || d.note || (d.blocks.length && !single);
    return el('li', { class: `day ${d.type}` },
      el('span', { class: 'dow' }, d.dow),
      el('p', { class: 'day-title' }, title, fuel && fuel.badge ? fuelBadge() : null),
      el('span', { class: 'day-total' }, total),
      hasBody ? el('div', { class: 'day-body' },
        meta ? el('p', { class: 'note' }, meta) : null,
        fuel ? el('p', { class: fuel.badge ? 'note fuel-note must' : 'note fuel-note' }, fuel.text) : null,
        d.note ? el('p', { class: 'note' }, d.note) : null,
        d.blocks.length && !single ? el('ul', { class: 'blocks' }, ...d.blocks.map(renderBlock)) : null) : null);
  }

  function renderWeeks() {
    const nodes = plan.weeks.map((w) => {
      const det = el('details', { class: 'week', id: `week-${w.index}` },
        el('summary', null,
          el('span', { class: 'wk-num' }, `Week ${w.index}`),
          el('span', { class: 'wk-meta' },
            el('span', { class: 'tag' }, el('span', { class: `swatch phase-${w.phase}` }), P.PHASES[w.phase].name),
            w.sub ? el('span', { class: 'wk-sub' }, w.sub) : null,
            w.p < plan.p ? el('span', { class: 'wk-sub' }, `${Math.round(w.p * 100)} % Nils`) : null),
          el('span', { class: 'wk-total' }, fmtTotal(w.totalMin))),
        el('ol', { class: 'days' }, ...w.days.map(renderDay)));
      det.open = openWeeks.has(w.index);
      det.addEventListener('toggle', () => {
        if (det.open) openWeeks.add(w.index); else openWeeks.delete(w.index);
        updateToggleAll();
      });
      return det;
    });
    $('#week-list').replaceChildren(...nodes);
    updateToggleAll();
  }

  function openWeek(i) {
    const det = document.getElementById(`week-${i}`);
    if (!det) return;
    det.open = true;
    det.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function allOpen() { return plan.weeks.every((w) => openWeeks.has(w.index)); }

  function updateToggleAll() {
    $('#toggle-all').textContent = allOpen() ? 'Collapse all' : 'Expand all';
  }

  // --- Controls ------------------------------------------------------------------
  function renderControls() {
    const race = P.RACES[state.race];
    const dose = $('#dose');
    dose.style.setProperty('--fill', `${((state.p - 10) / 90) * 100}%`);
    $('#dose-out').textContent = `${state.p} %`;
    $('#dose-hint').textContent = `A full base week is about ${fmtTotal(P.baseWeekMin(state.p / 100))} of running. Nils’s was about 25 h.`;
    $('#now').setAttribute('aria-invalid', state.now !== '' && !currentHours() ? 'true' : 'false');

    const time = $('#time');
    time.placeholder = race.example;
    const hint = $('#time-hint');
    const goalSec = P.parseTime(state.time, state.race);
    if (state.time && !goalSec) {
      hint.textContent = `Couldn’t read that. Use h:mm:ss, for example ${race.example}.`;
      hint.classList.add('error');
      time.setAttribute('aria-invalid', 'true');
    } else {
      hint.classList.remove('error');
      time.removeAttribute('aria-invalid');
      hint.textContent = goalSec
        ? `${P.fmtClock(goalSec)} = ${P.fmtPace(goalSec / race.km)} /km`
        : 'Sets your race pace. Without any times, sessions are described by effort.';
    }

    const recent = P.RECENT_RACES[state.recentKey];
    const rTime = $('#recent-time');
    rTime.placeholder = recent.example;
    const rHint = $('#recent-hint');
    const recentSec = P.parseRecent(state.recentTime, state.recentKey);
    rHint.classList.toggle('error', Boolean(state.recentTime && !recentSec));
    if (state.recentTime && !recentSec) {
      rHint.textContent = `Couldn’t read that. Use h:mm:ss, for example ${recent.example}.`;
      rTime.setAttribute('aria-invalid', 'true');
    } else {
      rTime.removeAttribute('aria-invalid');
      rHint.textContent = recentSec
        ? `${recent.label} in ${P.fmtClock(recentSec)} sets your easy, threshold and steady paces.`
        : race.km >= 50
          ? 'Add one for realistic training paces. A goal time this long says little about your easy and threshold pace.'
          : 'Sets your easy and threshold paces. Without it, they are estimated from your goal time.';
    }

    $('#extra-race').hidden = state.mode !== 'race';
    $('#extra-season').hidden = state.mode !== 'season';
    const Y = P.YEAR;
    const c = state.mode === 'race' || state.mode === 'cycle' ? P.allocate(state.mode === 'cycle' ? 12 : state.weeks) : null;
    $('#mode-hint').textContent = c
      ? `${c.aerobic} Aerobic → ${c.threshold} Threshold → ${c.specific} Specific → ${c.peak} Overreach & taper`
      : state.mode === 'year'
        ? `52 weeks like his: ${Y.aerobic} Aerobic → ${Y.threshold} Threshold → ${Y.blocks} Specific blocks with tune-up races and Aerobic 2.0 resets → ${Y.peak} Overreach & taper`
        : P.PHASES[state.season].blurb;
    return { goalSec, recent: recentSec ? { key: state.recentKey, sec: recentSec } : null };
  }

  function render() {
    const { goalSec, recent } = renderControls();
    plan = P.buildPlan({
      p: state.p / 100,
      race: state.race,
      goalSec,
      recent,
      mode: state.mode,
      weeks: state.weeks,
      season: state.season,
      strength: state.strength,
      currentHours: currentHours(),
    });
    renderNowHint();
    renderExportDates();
    renderPaces();
    renderOverview();
    renderWeeks();
    writeHash();
  }

  function renderNowHint() {
    const hint = $('#now-hint');
    hint.classList.remove('error');
    if (!plan.startP) {
      if (state.now !== '') {
        hint.textContent = 'Enter hours per week, between 0.5 and 40.';
        hint.classList.add('error');
      } else {
        hint.textContent = 'Week 1 starts here and climbs about 10 % a week to your Nils level. Leave it empty to start at full load.';
      }
      return;
    }
    const reach = plan.weeks.find((w) => w.p >= plan.p);
    if (plan.weeks[0].p >= plan.p) hint.textContent = 'You already run that much, so the plan starts at full load.';
    else if (reach) hint.textContent = `Starts at ${Math.round(plan.weeks[0].p * 100)} % Nils and reaches ${state.p} % in week ${reach.index}.`;
    else {
      const top = plan.weeks.reduce((a, w) => Math.max(a, w.p), 0);
      hint.textContent = `Climbing 10 % a week, this plan tops out at ${Math.round(top * 100)} % Nils. Pick more weeks or a lower target to get there.`;
    }
  }

  // --- Send to intervals.icu ------------------------------------------------------
  const I = window.NilsIntervals;

  function isoToday() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function fmtDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }

  function startDate() {
    const v = $('#start').value;
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? I.mondayOf(v) : null;
  }

  function renderExportDates() {
    const hint = $('#export-dates');
    const start = startDate();
    if (!start) { hint.textContent = 'Pick a date. Week 1 always starts on a Monday.'; return; }
    const end = I.addDays(start, plan.weeks.length * 7 - 1);
    const hasRace = plan.weeks.some((w) => w.days.some((d) => d.goal));
    const snapped = start !== $('#start').value ? ' (moved to that week’s Monday)' : '';
    hint.textContent = `Week 1 starts ${fmtDate(start)}${snapped}. ${hasRace ? `Race day: ${fmtDate(end)}.` : `Week ${plan.weeks.length} ends ${fmtDate(end)}.`}`;
  }

  function setStatus(text, error) {
    const el = $('#export-status');
    el.textContent = text;
    el.classList.toggle('error', Boolean(error));
  }

  async function sendToIntervals() {
    const key = $('#apikey').value.trim();
    const start = startDate();
    if (!start) return setStatus('Pick when week 1 starts.', true);
    if (!key) return setStatus('Paste your intervals.icu API key first.', true);
    const events = I.buildEvents(plan, start);
    const button = $('#send');
    button.disabled = true;
    setStatus(`Sending ${events.length} sessions…`);
    try {
      const res = await fetch(I.ENDPOINT, {
        method: 'POST',
        headers: { Authorization: `Basic ${btoa(`API_KEY:${key}`)}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(events),
      });
      if (res.status === 401 || res.status === 403) {
        setStatus('intervals.icu didn’t accept that API key. Copy it again from Settings → Developer settings.', true);
      } else if (!res.ok) {
        const text = (await res.text()).slice(0, 200);
        setStatus(`intervals.icu answered ${res.status}${text ? `: ${text}` : ''}`, true);
      } else {
        const saved = await res.json();
        setStatus(`Done: ${Array.isArray(saved) ? saved.length : events.length} sessions are in your intervals.icu calendar, ${fmtDate(start)} to ${fmtDate(I.addDays(start, plan.weeks.length * 7 - 1))}. Check them there, then sync your watch.`);
      }
    } catch (err) {
      setStatus('Couldn’t reach intervals.icu. Check your connection and try again.', true);
    } finally {
      button.disabled = false;
    }
  }

  function setWeeks(n) {
    state.weeks = Math.min(30, Math.max(8, Math.round(n) || 16));
    $('#weeks').value = state.weeks;
    render();
  }

  function bind() {
    $('#dose').addEventListener('input', (e) => { state.p = Number(e.target.value); render(); });
    $('#race').addEventListener('change', (e) => {
      state.race = e.target.value;
      state.time = ''; // a marathon time makes no sense for a 10K
      $('#time').value = '';
      render();
    });
    $('#time').addEventListener('input', (e) => { state.time = e.target.value.trim(); render(); });
    $('#recent').addEventListener('change', (e) => {
      state.recentKey = e.target.value;
      state.recentTime = ''; // a 10K time makes no sense for a marathon
      $('#recent-time').value = '';
      render();
    });
    $('#recent-time').addEventListener('input', (e) => { state.recentTime = e.target.value.trim(); render(); });
    $('#mode').addEventListener('change', (e) => { state.mode = e.target.value; render(); });
    $('#season').addEventListener('change', (e) => { state.season = e.target.value; render(); });
    $('#strength').addEventListener('change', (e) => { state.strength = e.target.checked; render(); });
    $('#now').addEventListener('input', (e) => { state.now = e.target.value.trim(); render(); });
    $('#weeks').addEventListener('change', (e) => setWeeks(Number(e.target.value)));
    $('#weeks-dec').addEventListener('click', () => setWeeks(state.weeks - 1));
    $('#weeks-inc').addEventListener('click', () => setWeeks(state.weeks + 1));

    $('#toggle-all').addEventListener('click', () => {
      const open = !allOpen();
      plan.weeks.forEach((w) => (open ? openWeeks.add(w.index) : openWeeks.delete(w.index)));
      document.querySelectorAll('.week').forEach((d) => { d.open = open; });
      updateToggleAll();
    });

    $('#print').addEventListener('click', () => window.print());
    $('#start').value = I.mondayOf(I.addDays(isoToday(), 6)); // the coming Monday, or today if it is one
    $('#start').addEventListener('change', renderExportDates);
    $('#send').addEventListener('click', sendToIntervals);

    // Closed <details> don't print, so open everything for the printout.
    let before = null;
    window.addEventListener('beforeprint', () => {
      before = new Set(openWeeks);
      document.querySelectorAll('.week').forEach((d) => { d.open = true; });
    });
    window.addEventListener('afterprint', () => {
      if (!before) return;
      document.querySelectorAll('.week').forEach((d, i) => { d.open = before.has(i + 1); });
    });

    if ('ResizeObserver' in window) {
      let lastW = 0;
      new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w !== lastW && plan) { lastW = w; renderChart(); }
      }).observe($('#chart'));
    }
  }

  readHash();
  syncControls();
  bind();
  render();
})();
