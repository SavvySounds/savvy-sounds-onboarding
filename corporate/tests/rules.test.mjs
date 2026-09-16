import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {describe, test} from 'node:test';
import {load} from '../script/load.mjs';

const CORPORATE = new URL('../', import.meta.url);
const QUESTIONS = JSON.parse(readFileSync(new URL('questions.json', CORPORATE), 'utf8')).questions;
const rules = load();
const plain = (value) => JSON.parse(JSON.stringify(value));

const APPROVER = {person_id: 'p_a', name: 'Dana Whitfield', role: 'approver'};
const PLANNER = {person_id: 'p_p', name: 'Jules Okafor', role: 'planner'};

function moment(mid, kind, date, start, end, extra = {}) {
  return {moment_id: mid, kind, label: kind[0].toUpperCase() + kind.slice(1), date,
    start, end, duration_min: 0, purpose: '', room: '', music_owner: 'dj',
    cue_owner: 'planner', cue_text: '', pronunciation: '', approval: 'confirmed',
    active: true, previous: null, proposal: null, ...extra};
}

function event(moments = [], answers = {}, people = [], open_items = []) {
  return {event_id: 'ev_0123456789', revision: 1, tz: 'America/Chicago',
    moments: structuredClone(moments), answers: structuredClone(answers),
    people: Array.from(people), open_items: structuredClone(open_items),
    songs: [], sources: [], dj_notes: ''};
}

function answer(value, state = 'confirmed') {
  return {value, state, supplied_by: null, supplied_at: null, source: 'form',
    approved_by: null, approved_at: null, previous: null, proposal: null};
}

describe('Clock', () => {
  test('every stored time is said the way miles reads it', () => {
    const values = ['00:00', '00:30', '12:00', '12:05', '20:15', '09:07', 'garbage'];
    assert.deepEqual(Object.fromEntries(values.map((value) => [value, rules.clock(value)])),
      {'00:00': '12:00 AM', '00:30': '12:30 AM', '12:00': '12:00 PM',
        '12:05': '12:05 PM', '20:15': '8:15 PM', '09:07': '9:07 AM', garbage: 'garbage'});
  });
});

describe('Question labels', () => {
  test('clock and moment choices have plain labels', () => {
    const questions = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
    assert.deepEqual(questions.moments.option_labels, {
      arrival: 'Guests arrive', networking: 'Mingling and networking', dinner: 'Dinner',
      presentations: 'Speeches and presentations', awards: 'Awards', dancing: 'Dancing',
      closing: 'Wrapping up', custom: 'Something else'});
    assert.deepEqual(questions.tz.option_labels, {
      'America/Los_Angeles': 'Pacific time (Los Angeles)',
      'America/Denver': 'Mountain time (Denver)',
      'America/Phoenix': 'Arizona time (Phoenix, no clock change)',
      'America/Chicago': 'Central time (Chicago)',
      'America/New_York': 'Eastern time (New York)',
      'Pacific/Honolulu': 'Hawaii time (Honolulu)', Other: 'Somewhere else'});
  });
  test('every part of the night and every zone has words of its own, and the control\'s words are in the file', () => {
    const questions = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
    for (const kind of questions.moments.options) {
      const words = (questions.moments.option_labels || {})[kind];
      assert.ok(words && words !== kind, `${kind} has no plain words`);
    }
    for (const zone of questions.tz.options) {
      const words = (questions.tz.option_labels || {})[zone];
      assert.ok(words && words !== zone && !/[/_]/.test(words), `${zone} would show as a file name`);
    }
    assert.ok(questions.moments.time_labels.start && questions.moments.time_labels.end, 'the Starts and Ends words');
    assert.ok(questions.moments.custom_name.label, 'the words asking the client to name "Something else"');
  });
});

describe('Owner table', () => {
  test('answer owner comes from the question', () => {
    assert.equal(rules.owner_of('answers.must_plays', QUESTIONS), 'direction');
    assert.equal(rules.owner_of('answers.access_constraints', QUESTIONS), 'production');
    assert.equal(rules.owner_of('answers.event_date', QUESTIONS), 'event');
  });

  test('moment times belong to the running order', () => {
    assert.equal(rules.owner_of('moments.m_awards.start'), 'running_order');
    assert.equal(rules.owner_of('moments.m_awards.cue_text'), 'running_order');
    assert.equal(rules.owner_of('moments.m_awards.music_owner'), 'prep');
  });

  test('an unknown field is refused not guessed', () => {
    assert.throws(() => rules.owner_of('answers.no_such_question', QUESTIONS));
    assert.throws(() => rules.owner_of('moments.m_x.colour'));
  });

  test('the fallback only applies when nobody holds the role', () => {
    assert.equal(rules.role_of('running_order', [APPROVER]), 'approver');
    assert.equal(rules.role_of('running_order', [APPROVER, PLANNER]), 'planner');
    assert.equal(rules.role_of('direction', [PLANNER]), 'approver');
    assert.equal(rules.role_of('prep', [APPROVER]), 'dj');
  });

  test('only the owner confirms but miles always may', () => {
    assert.equal(rules.may_confirm('running_order', 'planner', [PLANNER]), true);
    assert.equal(rules.may_confirm('running_order', 'contact', [PLANNER]), false);
    assert.equal(rules.may_confirm('running_order', 'dj', [PLANNER]), true);
  });
});

describe('Three way', () => {
  test('only you moved it', () => {
    const [merged, clashes] = plain(rules.three_way({a: 1}, {a: 1}, {a: 2}));
    assert.deepEqual(merged, {a: 2});
    assert.deepEqual(clashes, []);
  });

  test('only they moved it so yours still lands', () => {
    const [merged, clashes] = plain(rules.three_way({a: 1, b: 1}, {a: 9, b: 1}, {b: 2}));
    assert.deepEqual(merged, {b: 2});
    assert.deepEqual(clashes, []);
  });

  test('both moved it the same way', () => {
    const [merged, clashes] = plain(rules.three_way({a: 1}, {a: 2}, {a: 2}));
    assert.deepEqual(merged, {a: 2});
    assert.deepEqual(clashes, []);
  });

  test('both moved it differently is a clash carrying both values', () => {
    const [merged, clashes] = plain(rules.three_way({a: '19:30'}, {a: '19:45'}, {a: '20:00'}));
    assert.deepEqual(merged, {});
    assert.deepEqual(clashes, [{field: 'a', yours: '20:00', theirs: '19:45'}]);
  });
});

describe('Coverage', () => {
  const night = [
    moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00'),
    moment('m_dancing', 'dancing', '2026-11-06', '21:30', '00:30'),
    moment('m_closing', 'closing', '2026-11-07', '00:30', '00:30'),
  ];

  test('a span across midnight is three hours not minus twentyone', () => {
    assert.equal(rules.span_min(night[1]), 180);
  });

  test('the target adds up and midnight is not a gap', () => {
    const answered = plain(rules.coverage(event(night)));
    assert.equal(answered.target_min, 60 + 180 + 0);
    assert.deepEqual(answered.gaps.map((g) => g.after), ['m_awards']);
    assert.equal(answered.gaps[0].minutes, 30);
    assert.deepEqual(answered.overlaps, []);
  });

  test('an overlap is seen', () => {
    const clash = [moment('m_a', 'dinner', '2026-11-06', '19:00', '20:30'),
      moment('m_b', 'awards', '2026-11-06', '20:00', '21:00')];
    assert.deepEqual(plain(rules.coverage(event(clash))).overlaps,
      [{a: 'm_a', b: 'm_b', minutes: 30}]);
  });

  test('music somebody else owns is not in the target', () => {
    const band = [moment('m_band', 'presentations', '2026-11-06', '19:00', '20:00', {music_owner: 'live act'})];
    assert.equal(rules.coverage(event(band)).target_min, 0);
  });
});

describe('Next action', () => {
  test('it names the person and counts the questions', () => {
    const record = event([], {}, [APPROVER], [1, 2, 3, 4].map((n) => ({item_id: 'oi_' + n, owner: 'approver', active: true, resolved: false})));
    assert.equal(rules.next_action(record), 'Waiting on Dana: 4 open questions.');
  });

  test('one question is singular', () => {
    const record = event([], {}, [APPROVER], [{item_id: 'oi_1', owner: 'approver', active: true, resolved: false}]);
    assert.equal(rules.next_action(record), 'Waiting on Dana: 1 open question.');
  });

  test('when nothing is on the client it says so', () => {
    const record = event([], {}, [], [
      {item_id: 'oi_1', owner: 'dj', active: true, resolved: false},
      {item_id: 'oi_2', owner: 'dj', active: true, resolved: false}]);
    assert.equal(rules.next_action(record), 'Nothing waiting on the client. 2 things need Miles.');
    record.open_items.pop();
    assert.equal(rules.next_action(record), 'Nothing waiting on the client. 1 thing needs Miles.');
  });

  test('nothing open at all', () => {
    assert.equal(rules.next_action(event()), 'Nothing open. Ready for the next step.');
  });
});

describe('Validate', () => {
  test('a confirmed answer with nothing in it is refused', () => {
    const errors = plain(rules.validate(QUESTIONS, {answers: {contact_name: answer('', 'confirmed')}}, false));
    assert.deepEqual(errors.map((e) => e.field), ['answers.contact_name']);
  });

  test('an unanswered question may not carry a value', () => {
    const errors = plain(rules.validate(QUESTIONS, {answers: {venue: answer('The Lakeside Hall', 'unknown')}}, false));
    assert.deepEqual(errors.map((e) => e.field), ['answers.venue']);
  });

  test('the shape of an email a date and a choice', () => {
    const errors = plain(rules.validate(QUESTIONS, {answers: {
      contact_email: answer('nope'), event_date: answer('6 November'),
      event_type: answer('Barbecue')}}, false));
    assert.deepEqual(errors.map((e) => e.field).sort(),
      ['answers.contact_email', 'answers.event_date', 'answers.event_type']);
  });

  test('a question we do not have is refused not ignored', () => {
    const errors = plain(rules.validate(QUESTIONS, {answers: {vibe_level: answer('11')}}, false));
    assert.deepEqual(errors.map((e) => e.field), ['answers.vibe_level']);
  });

  test('sending needs the five things and nothing else', () => {
    const errors = plain(rules.validate(QUESTIONS, {answers: {}}, true));
    assert.deepEqual(errors.map((e) => e.field).sort(), [
      'answers.approver_name', 'answers.contact_email', 'answers.contact_name',
      'answers.event_date', 'answers.event_name', 'answers.event_type']);
  });

  test('not sure yet satisfies the date and the approver', () => {
    const errors = plain(rules.validate(QUESTIONS, {answers: {
      company: answer('Harbor Studio'), contact_name: answer('Dana Whitfield'),
      contact_email: answer('dana@example.com'), event_date: answer(null, 'unknown'),
      event_type: answer('Networking'), approver_name: answer(null, 'unknown')}}, true));
    assert.deepEqual(errors, []);
  });

  test('other needs the words that follow it', () => {
    const base = {company: answer('Harbor Studio'), contact_name: answer('Dana Whitfield'),
      contact_email: answer('dana@example.com'), event_date: answer('2026-10-02'),
      event_type: answer('Other'), approver_name: answer('Dana Whitfield')};
    const errors = plain(rules.validate(QUESTIONS, {answers: base}, true));
    assert.deepEqual(errors.map((e) => e.field), ['answers.event_type_other']);
    base.event_type_other = answer('A product film shoot');
    assert.deepEqual(plain(rules.validate(QUESTIONS, {answers: base}, true)), []);
  });

  test('a moment is checked too', () => {
    const errors = rules.validate(QUESTIONS, {moments: [
      {moment_id: 'm_x', kind: 'disco', approval: 'maybe', start: '7pm', date: 'next friday'}]}, false);
    assert.equal(errors.length, 4);
  });
});

describe('Effects', () => {
  test('awards going live adds exactly the five cue questions', () => {
    const before = event();
    const after = event([moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00')], {}, [APPROVER, PLANNER]);
    const result = plain(rules.effects(before, after, QUESTIONS));
    const ids = result.open_items_added.map((i) => i.item_id).sort();
    assert.deepEqual(ids, ['oi_awards_cue_caller_m_awards', 'oi_awards_cue_text_m_awards',
      'oi_awards_introducer_m_awards', 'oi_awards_names_m_awards', 'oi_awards_walkon_m_awards']);
    const owners = Object.fromEntries(result.open_items_added.map((i) => [i.item_id, i.owner]));
    assert.equal(owners.oi_awards_names_m_awards, 'approver');
    assert.equal(owners.oi_awards_cue_text_m_awards, 'planner');
  });

  test('with no planner the cue questions fall to the approver', () => {
    const after = event([moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00')], {}, [APPROVER]);
    const result = plain(rules.effects(event(), after, QUESTIONS));
    assert.deepEqual([...new Set(result.open_items_added.map((i) => i.owner))].sort(), ['approver']);
  });

  test('running it twice adds nothing the second time', () => {
    const before = event();
    const after = event([moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00')], {}, [APPROVER, PLANNER]);
    const first = plain(rules.effects(before, after, QUESTIONS));
    after.open_items.push(...first.open_items_added);
    const second = plain(rules.effects(before, after, QUESTIONS));
    assert.equal(first.open_items_added.length, 5);
    assert.deepEqual(second.open_items_added, []);
  });

  test('a time change flags the cues and adds the two questions', () => {
    const cue = "Music down on the host's first word.";
    const before = event([
      moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00', {cue_text: cue}),
      moment('m_dancing', 'dancing', '2026-11-06', '21:30', '00:30')], {}, [APPROVER, PLANNER]);
    const after = structuredClone(before);
    after.moments[0].start = '20:15';
    after.moments[0].end = '21:15';
    const result = plain(rules.effects(before, after, QUESTIONS));
    assert.deepEqual(result.cues_to_recheck, ['m_awards']);
    assert.deepEqual(result.open_items_added.map((i) => i.item_id).sort(),
      ['oi_cue_recheck_m_awards', 'oi_soundcheck_recheck_m_awards']);
    const owners = Object.fromEntries(result.open_items_added.map((i) => [i.item_id, i.owner]));
    assert.equal(owners.oi_soundcheck_recheck_m_awards, 'approver');
  });

  test('a time change with no cue words anywhere flags no cues', () => {
    const before = event([moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00')], {}, [APPROVER]);
    const after = structuredClone(before);
    after.moments[0].start = '20:15';
    assert.deepEqual(plain(rules.effects(before, after, QUESTIONS)).cues_to_recheck, []);
  });

  test('a do not play that is also a must play asks once', () => {
    const answers = {must_plays: answer(['Earth, Wind & Fire - September', 'Kool & The Gang - Celebration']),
      dnp_songs: answer(['Kool & The Gang - Celebration'])};
    const after = event([], answers, [APPROVER]);
    const result = plain(rules.effects(event(), after, QUESTIONS));
    const clashes = result.open_items_added.filter((i) => i.origin === 'rule:exclusion');
    assert.equal(clashes.length, 1);
    assert.equal(clashes[0].owner, 'approver');
    after.open_items.push(...result.open_items_added);
    const again = plain(rules.effects(event(), after, QUESTIONS));
    assert.deepEqual(again.open_items_added.filter((i) => i.origin === 'rule:exclusion'), []);
  });

  test('a moment switched off quietens its questions and makes none', () => {
    const live = moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00');
    const items = [{item_id: 'oi_awards_names_m_awards', question: 'q', why: 'w',
      moments: ['m_awards'], owner: 'approver', due: null, resolved: false,
      resolved_by: null, resolved_at: null, origin: 'rule:awards', active: true}];
    const before = event([live], {}, [APPROVER, PLANNER], items);
    const after = structuredClone(before);
    after.moments[0].active = false;
    after.moments[0].start = '20:30';
    const result = plain(rules.effects(before, after, QUESTIONS));
    assert.deepEqual(result.open_items_added, []);
    assert.deepEqual(result.open_items_closed, ['oi_awards_names_m_awards']);
    assert.equal(after.open_items[0].active, false);
  });

  test('a reschedule keeps the event and walks every moment forward', () => {
    const moments = [moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00'),
      moment('m_closing', 'closing', '2026-11-07', '00:30', '00:30')];
    const before = event(moments, {event_date: answer('2026-11-06')}, [APPROVER]);
    const after = structuredClone(before);
    after.answers.event_date = answer('2026-11-13');
    const result = plain(rules.effects(before, after, QUESTIONS));
    assert.equal(result.date_shift_days, 7);
    assert.equal(after.event_id, before.event_id);
    assert.deepEqual(after.moments.map((m) => m.date), ['2026-11-13', '2026-11-14']);
    assert.equal(result.open_items_added.map((i) => i.item_id).includes('oi_reschedule_recheck'), true);
  });

  test('a new venue on top of a new date does not walk the moments', () => {
    const moments = [moment('m_awards', 'awards', '2026-11-06', '20:00', '21:00')];
    const before = event(moments, {event_date: answer('2026-11-06'),
      venue: answer('The Lakeside Hall, Chicago')}, [APPROVER]);
    const after = structuredClone(before);
    after.answers.event_date = answer('2026-11-13');
    after.answers.venue = answer('Pier 9 Loft, San Francisco');
    const result = plain(rules.effects(before, after, QUESTIONS));
    assert.equal(result.date_shift_days, 0);
    assert.equal(after.moments[0].date, '2026-11-06');
  });

  test('not sure yet and miles to suggest each open a question', () => {
    const after = event([], {crowd_notes: answer(null, 'unknown'),
      dancing_opener: answer(null, 'miles')}, [APPROVER]);
    const result = plain(rules.effects(event(), after, QUESTIONS));
    const owners = Object.fromEntries(result.open_items_added.map((i) => [i.item_id, i.owner]));
    assert.equal(owners.oi_answer_crowd_notes, 'approver');
    assert.equal(owners.oi_answer_dancing_opener, 'dj');
    const miles_item = result.open_items_added.find((i) => i.item_id === 'oi_answer_dancing_opener');
    assert.equal(miles_item.why, "You said you'd suggest this \u2014 it's yours to answer.");
  });

  test('answering it closes the question again', () => {
    const items = [{item_id: 'oi_answer_crowd_notes', question: 'q', why: 'w', moments: [],
      owner: 'approver', due: null, resolved: false, resolved_by: null,
      resolved_at: null, origin: 'rule:answer-state', active: true}];
    const before = event([], {crowd_notes: answer(null, 'unknown')}, [APPROVER], items);
    const after = structuredClone(before);
    after.answers.crowd_notes = answer('Loud room, everyone knows each other.');
    const result = plain(rules.effects(before, after, QUESTIONS));
    assert.deepEqual(result.open_items_closed, ['oi_answer_crowd_notes']);
    assert.equal(after.open_items[0].active, false);
  });

  test('it refuses to guess an owner it has no question for', () => {
    const after = event([], {mystery: answer(null, 'unknown')}, [APPROVER]);
    assert.throws(() => rules.effects(event(), after, []));
  });
});

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
  }
  return value;
}

function js_answers(name, fixtures) {
  const times = (record) => (record.moments || []).flatMap((m) => [m.start, m.end]).filter((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)));
  return fixtures.map((record) => {
    if (name === 'clock') return times(record).map((value) => rules.clock(value));
    if (name === 'hhmm_to_min') return times(record).map((value) => rules.hhmm_to_min(value));
    if (name === 'span_min') return (record.moments || []).map((value) => rules.span_min(value));
    if (name === 'coverage') return plain(rules.coverage(record));
    if (name === 'next_action') return rules.next_action(record);
    if (name === 'validate') return [false, true].map((submit) => plain(rules.validate(QUESTIONS, record, submit)));
    throw new Error('unknown parity function ' + name);
  });
}

