/* Train like Nils: the training-plan engine. Pure functions, no DOM.
 * Every number below comes from Nils van der Poel's "How to skate a 10k",
 * translated from bike/ice to running. */
(function (root) {
  'use strict';

  // --- Facts from the document --------------------------------------------
  const RUN_WEEK_100 = 25 * 60;          // "if I could run ... 25h weekly"
  const BIKE_TO_RUN = 25 / 33;           // 33 h cycling ≈ 25 h running
  const AEROBIC_SPLIT = [7, 6, 6, 7, 6]; // example aerobic week, hours per day
  const AEROBIC_TOTAL = 32;
  const THRESHOLD_DAY_BIKE = 300;        // 5 h bike days in threshold season
  // Example threshold week: reps get shorter as the week goes on.
  const THRESHOLD_WEEK = [
    { reps: 4, len: 30, rest: 5 },
    { reps: 5, len: 20, rest: 4 },
    { reps: 6, len: 15, rest: 4 },
    { reps: 4, len: 20, rest: 4 },
    { reps: 9, len: 10, rest: 3 },
  ];
  const HABITUATION = { reps: 6, len: 8, rest: 2 }; // "sessions like 6x8 minutes a few times a week"
  const SPECIFIC_EASY_AFTER = [90, 90, 90, 120, 120]; // "1,5-2 hours of running" after the ice
  const ULTRA_DAY = [210, 210, 210, 240, 240];
  // His year: Aerobic March–July, Threshold from August, then a winter of race-pace
  // blocks. After each block of races came two weeks of "Aerobic 2.0".
  const YEAR = { aerobic: 20, threshold: 10, blocks: 3, blockWeeks: 5, reset: 2, peak: 3 };
  const YEAR_RAMP = [0.7, 0.8, 0.9]; // "It took a few months to get there."
  const RAMP_RATE = 1.1;              // from your current volume: +10 % a week
  const MIN_P = 0.04;

  const RACES = {
    '10k':      { key: '10k', label: '10K', km: 10, rep: 5, rest: 1.5, example: '45:00', tuneUp: '10K' },
    'half':     { key: 'half', label: 'Half marathon', km: 21.0975, rep: 10, rest: 2, example: '1:45:00', tuneUp: '10K' },
    'marathon': { key: 'marathon', label: 'Marathon', km: 42.195, rep: 15, rest: 2, example: '3:30:00', tuneUp: 'Half marathon' },
    '50k':      { key: '50k', label: '50K', km: 50, rep: 20, rest: 3, example: '4:30:00', tuneUp: 'Half marathon' },
    '100k':     { key: '100k', label: '100K', km: 100, ultra: true, example: '11:00:00', tuneUp: 'Marathon' },
    '100mi':    { key: '100mi', label: '100 miles', km: 160.934, ultra: true, example: '24:00:00', tuneUp: '50K' },
  };

  const PHASES = {
    aerobic: {
      name: 'Aerobic',
      blurb: 'More is more. Easy running only, as many hours as you can recover from.',
    },
    threshold: {
      name: 'Threshold',
      blurb: 'Lots of threshold work, kept just under the red line so you can repeat it five days in a row.',
    },
    specific: {
      name: 'Specific',
      blurb: 'Race pace every day. You get good at what you train.',
    },
    peak: {
      name: 'Overreach & taper',
      blurb: 'Pile on race-specific work, then back off so you arrive fresh.',
    },
  };

  const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  // --- Clean numbers ("not 27 minutes but 30") -------------------------------
  const DURATIONS = [10, 15, 20, 30, 40, 45, 50, 60, 75, 90, 105, 120, 135, 150, 165, 180];
  for (let m = 210; m <= 720; m += 30) DURATIONS.push(m);
  const REPS = [0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 45, 60];
  const RESTS = [0.5, 1, 1.5, 2, 3, 4, 5];

  function snap(x, ladder) {
    let best = ladder[0];
    for (const v of ladder) {
      if (Math.abs(v - x) <= Math.abs(best - x)) best = v; // ties go to the larger value
    }
    return best;
  }

  // --- Formatting -------------------------------------------------------------
  function fmtMin(min) {
    const m = Math.round(min);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }

  function fmtRep(min) {
    return min < 2 && min % 1 !== 0 || min < 1 ? `${Math.round(min * 60)} s` : `${min} min`;
  }

  function fmtPace(secPerKm) {
    const s = Math.round(secPerKm);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function fmtClock(sec) {
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(r).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  // --- Goal time and paces ----------------------------------------------------
  // "45:00" is mm:ss for a 10K and h:mm for everything longer.
  function parseTime(str, raceKey) {
    const race = RACES[raceKey];
    if (!race || !str) return null;
    const parts = String(str).trim().split(/[:.]/);
    if (parts.some((p) => !/^\d+$/.test(p))) return null;
    const n = parts.map(Number);
    let sec;
    if (n.length === 3) sec = n[0] * 3600 + n[1] * 60 + n[2];
    else if (n.length === 2) sec = raceKey === '10k' ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60;
    else return null;
    const pace = sec / race.km;
    if (pace < 150 || pace > 1200) return null; // 2:30–20:00 per km
    return sec;
  }

  function computePaces(raceKey, goalSec) {
    const race = RACES[raceKey];
    if (!race || !goalSec) return null;
    // Riegel: t2 = t1 · (d2/d1)^k. Solve for the distance you could race in t minutes.
    const k = race.ultra || race.km > 43 ? 1.10 : 1.06;
    const paceFor = (minutes) => {
      const d = race.km * Math.pow((minutes * 60) / goalSec, 1 / k);
      return (minutes * 60) / d;
    };
    const t60 = paceFor(60);
    const t75 = paceFor(75);
    return {
      race: goalSec / race.km,
      threshold: [t60, t75],                     // "a little under 4 mmol/l"
      easy: [t60 * 1.2, t60 * 1.35],             // A1: 60–75 % of max HR
      speed: race.ultra ? null : (goalSec / race.km) * 0.97, // his "5k session": 29.0 vs 30.0
    };
  }

  // --- Building blocks ----------------------------------------------------------
  function block(min, label, zone, detail, session) {
    const b = { min, label, zone, detail: detail || '' };
    if (session) b.session = session;
    return b;
  }

  function warmup() {
    return block(10, 'Warm-up', 'easy', '5 min easy + 5 min steady. Note your heart rate.');
  }

  function set(reps, len, rest, zone) {
    return block(reps * len + (reps - 1) * rest, `${reps} × ${fmtRep(len)}`, zone, `${fmtRep(rest)} jog between`);
  }

  function makeDay(type, title, blocks, note) {
    const totalMin = blocks.reduce((sum, b) => sum + b.min, 0);
    if (totalMin > 180 && blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      if (last.zone === 'easy' && last.min >= 45) {
        blocks[0].session = 'AM';
        last.session = 'PM';
      }
    }
    return { type, title, blocks, totalMin, note: note || '' };
  }

  function restDay(note) {
    return { type: 'rest', title: 'Rest', blocks: [], totalMin: 0, note: note || '' };
  }

  function easyDay(min, title) {
    const total = Math.max(20, snap(min, DURATIONS));
    if (total <= 150) return makeDay('easy', title || 'Easy run', [block(total, 'Easy', 'easy')]);
    const am = snap(total * 0.55, DURATIONS);
    const pm = snap(total - am, DURATIONS);
    return makeDay('easy', title || 'Easy run, two sessions',
      [block(am, 'Easy', 'easy', '', 'AM'), block(pm, 'Easy', 'easy', '', 'PM')]);
  }

  // Fill the rest of the day with easy running, or at least a 10 min cool-down.
  function withEasy(type, title, blocks, target, detail, note) {
    const used = blocks.reduce((sum, b) => sum + b.min, 0);
    const easy = snap(Math.max(target - used, 10), DURATIONS);
    blocks.push(block(easy, easy === 10 ? 'Cool-down' : 'Easy', 'easy', easy === 10 ? '' : detail));
    return makeDay(type, title, blocks, note);
  }

  // Keep Nils's shape: reps and rep length both shrink with √s.
  function scaleSet(t, s, f) {
    const k = Math.sqrt(s);
    const len = snap(t.len * k, REPS);
    const reps = Math.max(2, Math.round((t.reps * t.len * s * f) / len));
    const rest = Math.max(1, snap(t.rest * k, RESTS));
    return { reps, len, rest };
  }

  function thresholdDay(ctx, target, template, f, title) {
    const sc = scaleSet(template, ctx.s, f);
    return withEasy('threshold', title || `Threshold ${sc.reps} × ${fmtRep(sc.len)}`,
      [warmup(), set(sc.reps, sc.len, sc.rest, 'threshold')], target);
  }

  function setBreak(ctx, minutes, detail) {
    return block(snap(minutes * Math.max(ctx.p, 1 / 3), DURATIONS), 'Easy between sets', 'easy', detail);
  }

  // Nils's 10k session: 2 sets of 3 × 8 laps at race pace, 30 min easy between.
  function raceSession(ctx, sets) {
    const len = snap(ctx.race.rep * ctx.p, REPS);
    const rest = snap(ctx.race.rest * Math.max(ctx.p, 1 / 3), RESTS);
    const blocks = [warmup()];
    for (let i = 0; i < sets; i++) {
      if (i > 0) blocks.push(setBreak(ctx, 30, 'End with 45 s at threshold pace.'));
      blocks.push(set(3, len, rest, 'race'));
    }
    const title = sets === 1 ? `Race pace 3 × ${fmtRep(len)}` : `Race pace ${sets} × (3 × ${fmtRep(len)})`;
    return { blocks, title };
  }

  // Nils's 5k session: 3 sets of 3 × 4 laps, a little faster than race pace.
  function speedSession(ctx) {
    const len = snap((ctx.race.rep * ctx.p) / 2, REPS);
    const rest = snap(ctx.race.rest * Math.max(ctx.p, 1 / 3), RESTS);
    const blocks = [warmup(), set(3, len, rest, 'speed'), setBreak(ctx, 10, ''), set(3, len, rest, 'speed'),
      setBreak(ctx, 30, 'Finish with 45 s at threshold pace.'), set(3, len, rest, 'speed')];
    return { blocks, title: `Speed 3 × (3 × ${fmtRep(len)})` };
  }

  // Ultras: race-pace reps make no sense, so rehearse the race instead.
  function rehearsalDay(ctx, minutes, title) {
    const total = Math.max(20, snap(minutes, DURATIONS));
    const detail = 'Power-hike the climbs.';
    if (total < 90) return makeDay('rehearsal', title || 'Race rehearsal', [block(total, 'Goal effort', 'race', detail)]);
    const fuel = total >= 150 ? 15 : 10;
    const half = snap((total - fuel) / 2, DURATIONS);
    return makeDay('rehearsal', title || 'Race rehearsal', [
      block(half, 'Goal effort', 'race', detail),
      block(fuel, 'Fuel stop', 'walk', 'Walk and eat a real snack.'),
      block(half, 'Goal effort', 'race', ''),
    ]);
  }

  function specificDay(ctx, d, sets, easyAfter, title) {
    if (ctx.race.ultra) return rehearsalDay(ctx, ULTRA_DAY[d] * ctx.p * (sets === 1 ? 0.75 : 1), title);
    const sess = raceSession(ctx, sets);
    return withEasy('specific', title || sess.title, sess.blocks, sess.blocks.reduce((s, b) => s + b.min, 0) + easyAfter,
      'After the fast part, never before.');
  }

  function speedDay(ctx, easyAfter) {
    const sess = speedSession(ctx);
    return withEasy('speed', sess.title, sess.blocks, sess.blocks.reduce((s, b) => s + b.min, 0) + easyAfter);
  }

  function prepDay(ctx) {
    if (ctx.race.ultra) {
      return makeDay('prep', 'Race prep', [block(30, 'Easy at goal effort', 'race', 'Shake out. Check your shoes, food and gear.')]);
    }
    return makeDay('prep', 'Race prep', [
      warmup(),
      set(3, 1, 1, 'race'),
      block(10, 'Easy', 'easy'),
      block(2, '1 × 2 min', 'speed', 'Nils: “1000 m at 5 000 m speed.”'),
      block(10, 'Cool-down', 'easy'),
    ]);
  }

  function raceDay(ctx) {
    const note = ctx.race.ultra
      ? 'Start slower than feels right and eat from the first hour.'
      : 'Run the second half a little faster than the first. Nils skated his last 12 laps faster than his first 12.';
    return { type: 'race', title: `Race day: ${ctx.race.label}`, blocks: [], totalMin: 0, note, goal: true };
  }

  function tuneUpRaceDay(ctx) {
    return { type: 'race', title: `Tune-up race: ${ctx.race.tuneUp}`, blocks: [], totalMin: 0,
      note: 'Race it hard, by feel. Practise pacing and your race-day routine.' };
  }

  // --- Strength ---------------------------------------------------------------
  // His 2019–20 logs: bodyweight one-legged squats in 9 min sets (15 s per leg)
  // and the odd heavy squat + deadlift session. By 2021 it had faded away,
  // apart from the few minutes of prehab he later said he should have kept.
  function squatBlock(p) {
    const sets = Math.min(6, Math.max(1, Math.round(6 * p)));
    return block(sets * 9 + (sets - 1), `${sets} × 9 min one-legged squats`, 'strength',
      'Bodyweight, down to a half squat and up. 15 s per leg, switch, 1 min rest between sets.');
  }

  function weightsBlock(p) {
    return block(p >= 0.5 ? 45 : 30, 'Heavy squats + deadlifts', 'strength', 'Few reps, long rests, stop well short of failure.');
  }

  function prehabBlock() {
    return block(5, 'Core + stretching', 'strength', 'The 5 min a week Nils wished he had done.');
  }

  function addTo(day, b, suffix) {
    if (!day || day.type === 'rest' || day.type === 'race') return;
    day.blocks.push(b);
    day.totalMin += b.min;
    if (suffix) day.title += ` + ${suffix}`;
  }

  function addStrength(w) {
    const days = w.days;
    if (w.phase === 'aerobic' && !/^Aerobic 2\.0/.test(w.sub)) {
      // "Of course, I eased into this program also, doing shorter sets in the beginning."
      const easeIn = w.sub === 'Ease in';
      const p = easeIn ? w.p / 2 : w.p;
      addTo(days[1], squatBlock(p), 'squats');
      if (!easeIn) addTo(days[2], weightsBlock(w.p), 'weights');
      addTo(days[3], squatBlock(p), 'squats');
    } else if (w.phase === 'aerobic' || w.phase === 'threshold') {
      addTo(days[2], squatBlock(w.p), 'squats');
    } else if (w.sub !== 'Race week') {
      addTo(days[0], prehabBlock());
    }
  }

  // --- Fuel -----------------------------------------------------------------------
  // "I made sure to always have some sugars with me whilst training and not run out
  // of energy during a session." Days you must eat on get a badge; shorter hard
  // sessions just get a reminder to carry something. Gram targets are general
  // sports-nutrition guidance, not from the document.
  const FUEL_LONG = 90;

  function longestSession(day) {
    let longest = 0;
    let current = 0;
    for (const b of day.blocks) {
      if (b.zone === 'strength') continue;
      if (b.session === 'PM') { longest = Math.max(longest, current); current = 0; }
      current += b.min;
    }
    return Math.max(longest, current);
  }

  function fuelFor(day, race) {
    const ultraGoal = race.km >= 50;
    if (day.type === 'race') {
      const km = day.goal ? race.km : race.km >= 42 ? 21 : 10; // tune-ups are a half or longer for marathon+
      return km >= 21 ? { badge: true, text: 'Eat from the start, every 20–30 min. Don’t wait until you’re hungry.' } : null;
    }
    if (day.type === 'rehearsal') return { badge: true, text: 'Practise race food: eat every 20–30 min, 60–90 g carbs an hour.' };
    const hard = day.type === 'threshold' || day.type === 'specific' || day.type === 'speed';
    if (longestSession(day) >= FUEL_LONG) {
      const amount = ultraGoal
        ? 'build toward race-day amounts (60–90 g carbs an hour)'
        : 'about 30–60 g carbs an hour';
      return { badge: true, text: hard ? `Carry sugar for the hard part, then eat every 20–30 min, ${amount}.` : `Eat every 20–30 min, ${amount}.` };
    }
    return hard ? { badge: false, text: 'Carry some sugar for the hard part.' } : null;
  }

  // --- Weeks ------------------------------------------------------------------
  const RESTS_WEEKEND = () => [restDay(), restDay()];

  function aerobicWeek(ctx, f, habituation) {
    const week = RUN_WEEK_100 * ctx.p * f;
    const days = AEROBIC_SPLIT.map((w, i) => {
      const min = (week * w) / AEROBIC_TOTAL;
      if (habituation && (i === 1 || i === 3)) return thresholdDay(ctx, min, HABITUATION, 1, 'Easy + a first threshold set');
      return easyDay(min);
    });
    return days.concat(RESTS_WEEKEND());
  }

  function thresholdWeek(ctx, i, n, nextIsSpecific) {
    const target = THRESHOLD_DAY_BIKE * BIKE_TO_RUN * ctx.p;
    let days;
    if (i === 0) {
      days = [0, 1, 2, 3, 4].map((d) => (d % 2 === 0 ? thresholdDay(ctx, target, HABITUATION, 1) : easyDay(target)));
    } else {
      const f = i === 1 ? 0.9 : 1;
      days = THRESHOLD_WEEK.map((t) => thresholdDay(ctx, target, t, f));
    }
    if (nextIsSpecific && i === n - 1) days[4] = specificDay(ctx, 4, 1, SPECIFIC_EASY_AFTER[4] * ctx.p, 'First race-pace session');
    return days.concat(RESTS_WEEKEND());
  }

  function specificWeek(ctx, sets) {
    const days = [0, 1, 2, 3, 4].map((d) => specificDay(ctx, d, sets, SPECIFIC_EASY_AFTER[d] * ctx.p));
    return days.concat(RESTS_WEEKEND());
  }

  // Races inside a block were trained through: train until four days out,
  // two days off, a short prep the day before, race.
  function tuneUpWeek(ctx) {
    return [0, 1, 2].map((d) => specificDay(ctx, d, 2, SPECIFIC_EASY_AFTER[d] * ctx.p))
      .concat([restDay(), restDay(), prepDay(ctx), tuneUpRaceDay(ctx)]);
  }

  // Example Aerobic 2.0 week: four long easy days, one race-pace session on Friday.
  function aerobic2Week(ctx) {
    const day = (RUN_WEEK_100 * ctx.p * 6) / AEROBIC_TOTAL;
    return [0, 1, 2, 3].map(() => easyDay(day))
      .concat([specificDay(ctx, 4, 2, SPECIFIC_EASY_AFTER[4] * ctx.p)], RESTS_WEEKEND());
  }

  // His 12-day overreach: six days on (Mon–Thu 10k session, Fri–Sat 5k session), Sunday off ...
  function overreachWeek1(ctx) {
    const p = ctx.p;
    const days = ctx.race.ultra
      ? [0, 1, 2, 3].map(() => rehearsalDay(ctx, 180 * p)).concat([rehearsalDay(ctx, 150 * p), rehearsalDay(ctx, 150 * p)])
      : [0, 1, 2, 3].map((d) => specificDay(ctx, d, 2, 90 * p)).concat([speedDay(ctx, 75 * p), speedDay(ctx, 75 * p)]);
    return days.concat([restDay()]);
  }

  // ... then five more days with the easy volume falling away.
  function overreachWeek2(ctx) {
    const p = ctx.p;
    const days = ctx.race.ultra
      ? [150, 150, 150, 120, 120].map((m) => rehearsalDay(ctx, m * p))
      : [specificDay(ctx, 0, 2, 60 * p), speedDay(ctx, 60 * p), speedDay(ctx, 60 * p), speedDay(ctx, 40 * p), speedDay(ctx, 40 * p)];
    return days.concat(RESTS_WEEKEND());
  }

  // Rest, easy, prep, rest, prep, race.
  function raceWeek(ctx) {
    return [
      restDay('Rest. Let the overreach soak in.'),
      easyDay(30, 'Easy 30 min'),
      restDay(),
      prepDay(ctx),
      restDay(),
      prepDay(ctx),
      raceDay(ctx),
    ];
  }

  // --- Phases -------------------------------------------------------------------
  function allocate(n) {
    const peak = 3;
    const specific = n < 10 ? 2 : n < 16 ? 3 : 4;
    const r = n - peak - specific;
    const threshold = Math.min(10, Math.floor(r / 2));
    return { aerobic: r - threshold, threshold, specific, peak };
  }

  const AEROBIC_RAMP = [0.8, 0.9];

  // Phases take the plan context and ask it for each week's context in turn,
  // since a week's "% Nils" can climb when you start from your current volume.
  function aerobicPhase(ctx, n, nextIsThreshold, ramp) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = ctx.week();
      const f = c.ramped ? 1 : (ramp || AEROBIC_RAMP)[i] || 1;
      const habituation = nextIsThreshold && i === n - 1;
      const sub = habituation ? 'First threshold sets' : i === 0 ? 'Ease in' : f < 1 || c.building ? 'Building' : '';
      out.push({ phase: 'aerobic', sub, p: c.p, days: aerobicWeek(c, f, habituation) });
    }
    return out;
  }

  function thresholdPhase(ctx, n, nextIsSpecific) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = ctx.week();
      let sub = i === 0 ? 'Ease in: three sets this week' : i === 1 ? 'Building' : '';
      if (nextIsSpecific && i === n - 1) sub = sub ? `${sub}, first race-pace session` : 'First race-pace session';
      out.push({ phase: 'threshold', sub, p: c.p, days: thresholdWeek(c, i, n, nextIsSpecific) });
    }
    return out;
  }

  function specificPhase(ctx, n, opts) {
    const o = Object.assign({ easeIn: true, tuneUp: false }, opts);
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = ctx.week();
      if (o.tuneUp && i === n - 1) {
        out.push({ phase: 'specific', sub: `Tune-up race: ${c.race.tuneUp}`, p: c.p, days: tuneUpWeek(c) });
      } else {
        const easeIn = o.easeIn && i === 0;
        out.push({ phase: 'specific', sub: easeIn ? 'Ease in: one set a day' : '', p: c.p, days: specificWeek(c, easeIn ? 1 : 2) });
      }
    }
    return out;
  }

  function aerobic2Phase(ctx, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const c = ctx.week();
      out.push({ phase: 'aerobic', sub: i === 0 ? 'Aerobic 2.0: reset after racing' : 'Aerobic 2.0', p: c.p, days: aerobic2Week(c) });
    }
    return out;
  }

  function yearPhases(ctx) {
    let raw = aerobicPhase(ctx, YEAR.aerobic, true, YEAR_RAMP).concat(thresholdPhase(ctx, YEAR.threshold, true));
    for (let b = 0; b < YEAR.blocks; b++) {
      const last = b === YEAR.blocks - 1;
      raw = raw.concat(specificPhase(ctx, YEAR.blockWeeks, { easeIn: b === 0, tuneUp: !last }));
      if (!last) raw = raw.concat(aerobic2Phase(ctx, YEAR.reset));
    }
    return raw.concat(peakPhase(ctx));
  }

  function peakPhase(ctx) {
    const c1 = ctx.week();
    const c2 = ctx.week();
    const c3 = ctx.week();
    return [
      { phase: 'peak', sub: 'Overreach: six days on', p: c1.p, days: overreachWeek1(c1) },
      { phase: 'peak', sub: 'Overreach, easing off', p: c2.p, days: overreachWeek2(c2) },
      { phase: 'peak', sub: 'Race week', p: c3.p, days: raceWeek(c3) },
    ];
  }

  /**
   * opts: { p: 0.1–1, race: key, goalSec?, mode: 'race' | 'cycle' | 'year' | 'season', weeks?, season?,
   *         strength?, currentHours? }
   */
  function buildPlan(opts) {
    const race = RACES[opts.race] || RACES.marathon;
    const p = Math.min(1, Math.max(0.1, opts.p));
    const goalSec = opts.goalSec || null;
    // "Ease into it and increase the training load carefully and wisely, but also rapidly."
    // With a current volume, week 1 starts there and climbs 10 % a week to the target.
    const startP = opts.currentHours > 0 ? Math.max(MIN_P, (opts.currentHours * 60) / RUN_WEEK_100) : null;
    let weekNo = 0;
    const ctx = {
      race,
      week() {
        const wp = startP ? Math.min(p, startP * Math.pow(RAMP_RATE, weekNo)) : p;
        weekNo += 1;
        return { p: wp, s: wp * BIKE_TO_RUN, race, goalSec, ramped: startP !== null, building: wp < p };
      },
    };

    let raw;
    if (opts.mode === 'season') {
      const season = PHASES[opts.season] && opts.season !== 'peak' ? opts.season : 'aerobic';
      raw = season === 'aerobic' ? aerobicPhase(ctx, 4, false)
        : season === 'threshold' ? thresholdPhase(ctx, 4, false)
          : specificPhase(ctx, 4);
    } else if (opts.mode === 'year') {
      raw = yearPhases(ctx);
    } else {
      const n = opts.mode === 'cycle' ? 12 : Math.min(30, Math.max(8, Math.round(opts.weeks || 16)));
      const c = allocate(n);
      raw = [].concat(
        aerobicPhase(ctx, c.aerobic, c.threshold > 0),
        thresholdPhase(ctx, c.threshold, true),
        specificPhase(ctx, c.specific),
        peakPhase(ctx),
      );
    }
    if (opts.strength !== false) raw.forEach(addStrength);
    raw.forEach((w) => w.days.forEach((d) => { d.fuel = fuelFor(d, race); }));
    const counts = { aerobic: 0, threshold: 0, specific: 0, peak: 0 };
    raw.forEach((w) => { counts[w.phase] += 1; });

    const weeks = raw.map((w, i) => ({
      index: i + 1,
      phase: w.phase,
      sub: w.sub,
      p: w.p,
      days: w.days.map((d, j) => Object.assign({ dow: DOW[j] }, d)),
      totalMin: w.days.reduce((sum, d) => sum + d.totalMin, 0),
    }));

    return {
      race,
      p,
      counts,
      weeks,
      paces: computePaces(race.key, goalSec),
      goalSec,
      startP,
    };
  }

  // A full-load aerobic week, used for the slider readout.
  function baseWeekMin(p) {
    const ctx = { p, s: p * BIKE_TO_RUN, race: RACES.marathon };
    return aerobicWeek(ctx, 1, false).reduce((sum, d) => sum + d.totalMin, 0);
  }

  const api = {
    RACES, PHASES, DOW, DURATIONS, REPS, RESTS, YEAR,
    buildPlan, baseWeekMin, parseTime, computePaces, allocate, snap,
    fmtMin, fmtRep, fmtPace, fmtClock,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NilsPlan = api;
})(typeof window !== 'undefined' ? window : this);
