/* Train like Nils: export a plan as intervals.icu calendar events.
 * Each run becomes a structured workout written in intervals.icu's workout
 * text, which it turns into steps and pushes to Garmin Connect. Pure
 * functions, no DOM. */
(function (root) {
  'use strict';

  const P = typeof module !== 'undefined' && module.exports ? require('./plan.js') : root.NilsPlan;

  const ENDPOINT = 'https://intervals.icu/api/v1/athlete/0/events/bulk?upsert=true';
  const DELETE_ENDPOINT = 'https://intervals.icu/api/v1/athlete/0/events/bulk-delete';
  const ID_PREFIX = 'train-like-nils';
  // Every event we create gets an id from its date and one of these slots, so
  // old sessions can be removed later without remembering what was sent.
  const SLOTS = ['run1', 'run2', 'strength1', 'strength2', 'race'];
  const CLEAR_DAYS = 800; // covers a full-year plan starting up to a year ahead

  // intervals.icu durations: "1h15m", "5m", "1m30s", "45s".
  function dur(min) {
    const total = Math.round(min * 60);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${h ? `${h}h` : ''}${m ? `${m}m` : ''}${s ? `${s}s` : ''}` || '0s';
  }

  // One target type per workout: pace when we have paces, heart rate otherwise.
  function targets(paces) {
    const pace = (sec) => `${P.fmtPace(sec)}/km`;
    const range = (r) => `${pace(r[0])}-${pace(r[1])} Pace`;
    if (!paces) {
      return { mode: 'HR', easy: '60-75% HR', steady: '70-75% HR', threshold: '85-90% HR', race: '', speed: '' };
    }
    return {
      mode: 'PACE',
      easy: range(paces.easy),
      steady: `${pace(paces.steady)} Pace`,
      threshold: range(paces.threshold),
      race: paces.race ? `${pace(paces.race)} Pace` : '',
      speed: paces.speed ? `${pace(paces.speed)} Pace` : '',
    };
  }

  const WORK_NAME = { threshold: 'Threshold', race: 'Race pace', speed: 'Speed' };

  function step(cue, min, target) {
    return `- ${cue} ${dur(min)}${target ? ` ${target}` : ''}`;
  }

  // Lines of workout text for one block. Repeat blocks need a blank line
  // before and after them.
  function blockLines(b, t) {
    if (b.label === 'Warm-up') {
      return [step('Warm-up', 5, t.easy), step('Steady test, note your HR', 5, t.steady)];
    }
    if (b.reps) {
      const name = WORK_NAME[b.zone] || 'Work';
      const work = step(name, b.len, t[b.zone]);
      const jog = step('Jog', b.rest, t.easy);
      if (b.reps === 1) return [work];
      const lines = b.reps > 2 ? ['', `${name} ${b.reps - 1}x`, work, jog, ''] : [work, jog];
      return lines.concat([work]); // n reps have n - 1 jogs between them
    }
    if (b.kind === 'break' && b.detail) {
      // "right before I left the bike for my next set on the ice I did 45 seconds of threshold"
      return [step('Easy between sets', b.min - 0.75, t.easy), step('Threshold', 0.75, t.threshold)];
    }
    if (b.zone === 'walk') return [step('Fuel stop, walk and eat', b.min, '')];
    if (b.zone === 'race') return [step(b.label, b.min, t.race)];
    if (b.zone === 'speed') return [step('Speed', b.min, t.speed)];
    return [step(b.label, b.min, t.easy)];
  }

  function workoutText(blocks, t, notes) {
    const lines = blocks.flatMap((b) => blockLines(b, t));
    const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return notes.length ? `${text}\n\n${notes.join('\n')}` : text;
  }

  function addDays(isoDate, days) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d + days));
    return date.toISOString().slice(0, 10);
  }

  // Monday on or before the given ISO date.
  function mondayOf(isoDate) {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
    return addDays(isoDate, -dow);
  }

  function dayEvents(day, date, t, plan) {
    const id = (slot) => `${ID_PREFIX}-${date}-${slot}`;
    if (day.type === 'rest') return [];
    if (day.type === 'race') {
      const goal = day.goal && plan.goalSec
        ? `Goal ${P.fmtClock(plan.goalSec)}${plan.paces && plan.paces.race ? ` (${P.fmtPace(plan.paces.race)}/km)` : ''}. `
        : '';
      // intervals.icu's own race categories: A for the goal race, B for tune-ups.
      return [{
        category: day.goal ? 'RACE_A' : 'RACE_B',
        type: 'Run',
        start_date_local: `${date}T00:00:00`,
        name: day.title,
        description: `${goal}${day.note || ''}${day.fuel ? ` ${day.fuel.text}` : ''}`.trim(),
        external_id: id('race'),
      }];
    }

    const runBlocks = day.blocks.filter((b) => b.zone !== 'strength');
    const strength = day.blocks.filter((b) => b.zone === 'strength');
    const pm = runBlocks.findIndex((b) => b.session === 'PM');
    const sessions = pm > 0 ? [runBlocks.slice(0, pm), runBlocks.slice(pm)] : [runBlocks];
    const notes = [day.fuel ? `Fuel: ${day.fuel.text}` : '', day.note].filter(Boolean);
    const title = day.title.replace(/ \+ (squats|weights)$/, '');

    const events = sessions.map((blocks, i) => ({
      category: 'WORKOUT',
      type: 'Run',
      start_date_local: `${date}T${sessions.length > 1 ? (i ? '17:00:00' : '07:00:00') : '00:00:00'}`,
      name: sessions.length > 1 ? `${title} (${i ? 'PM' : 'AM'})` : title,
      description: workoutText(blocks, t, i === 0 ? notes : []),
      moving_time: Math.round(blocks.reduce((sum, b) => sum + b.min, 0) * 60),
      target: t.mode,
      external_id: id(`run${i + 1}`),
    }));

    strength.forEach((b, i) => events.push({
      category: 'WORKOUT',
      type: 'WeightTraining',
      start_date_local: `${date}T18:00:00`,
      name: b.label.replace(/^./, (c) => c.toUpperCase()),
      description: b.detail,
      moving_time: Math.round(b.min * 60),
      external_id: id(`strength${i + 1}`),
    }));
    return events;
  }

  /**
   * Batches of { external_id } covering every slot from `fromDate` for `days` days.
   * intervals.icu ignores ids that don't exist and never touches other events.
   */
  function clearBatches(fromDate, days, batchSize) {
    const ids = [];
    for (let i = 0; i < (days || CLEAR_DAYS); i++) {
      const date = addDays(fromDate, i);
      SLOTS.forEach((slot) => ids.push({ external_id: `${ID_PREFIX}-${date}-${slot}` }));
    }
    const size = batchSize || 1000;
    const batches = [];
    for (let i = 0; i < ids.length; i += size) batches.push(ids.slice(i, i + size));
    return batches;
  }

  /** startDate: ISO date (YYYY-MM-DD) of week 1's Monday. */
  function buildEvents(plan, startDate) {
    const start = mondayOf(startDate);
    const t = targets(plan.paces);
    return plan.weeks.flatMap((w, wi) => w.days.flatMap((d, di) => dayEvents(d, addDays(start, wi * 7 + di), t, plan)));
  }

  const api = { ENDPOINT, DELETE_ENDPOINT, SLOTS, buildEvents, clearBatches, mondayOf, addDays, dur };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NilsIntervals = api;
})(typeof window !== 'undefined' ? window : this);
