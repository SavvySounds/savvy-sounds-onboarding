import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { load } from '../script/load.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPORATE = dirname(HERE);
const TESTS = join(CORPORATE, 'data', 'tests');
const fixture = (name = 'northstar-awards.json') => JSON.parse(readFileSync(join(CORPORATE, 'fixtures', name), 'utf8'));
const plain = (value) => JSON.parse(JSON.stringify(value));

function knock(g, door, token, body) {
  return JSON.parse(g.doPost({postData: {contents: JSON.stringify({door, token, body})}}).getContent());
}

function plant(g, name) {
  const seeded = fixture(name), event = g.create_event(seeded.name, seeded.company, seeded.date, seeded.tz, seeded.people);
  const answers = Object.fromEntries(Object.entries(seeded.answers).map(([qid, value]) => [qid, {value, state: 'confirmed'}]));
  for (const state of ['unknown', 'miles', 'none']) for (const qid of seeded[state] || []) answers[qid] = {value: null, state};
  assert.equal(g.save(event.event_id, 'p_miles', 'dj', {base_revision: event.revision,
    submission_id: `sub_seed_${event.event_id}`, answers})[0], 200);
  assert.equal(g.seed_apply(event.event_id, seeded.moments, seeded.proposals || [], seeded.dj_notes, seeded.stage)[0], 200);
  const tokens = {};
  for (const person of seeded.people) tokens[person.role] = g.access('mint', {event_id: event.event_id,
    person_id: person.person_id, role: person.role}).token;
  return {event: plain(g.load_event(event.event_id)), tokens};
}

function withApp(run) {
  const drive = join(TESTS, randomUUID()); mkdirSync(drive, {recursive: true});
  try {
    const g = load({drive}); g.setup();
    return run(g, g.access('dj', {}).token, drive);
  } finally { rmSync(drive, {recursive: true}); }
}

function prepared(run) { return withApp((g, dj) => { const planted = plant(g); return run(g, dj, planted); }); }

describe('Doors', {concurrency: false}, () => {
  test('setup can run twice without changing the pass', () => withApp((g, dj) => {
    assert.equal(g.setup(), dj); assert.equal(g.access('dj', {}).token, dj);
    assert.equal(g.__logger_lines.at(-1), `Your pass for the view: ${dj}`);
  }));

  test('our own knock gets in', () => withApp((g, dj) => {
    const answer = knock(g, '/api/questions', dj); assert.equal(answer.status, 200);
    assert.equal(answer.title, "Let's set the tone for your event.");
  }));

  test('no link at all is refused', () => prepared((g, dj, {event}) => {
    const answer = knock(g, `/api/events/${event.event_id}`); assert.equal(answer.status, 403); assert.equal(answer.error, 'link-expired');
  }));

  test('a revoked link stops working on every door', () => prepared((g, dj, {event, tokens}) => {
    g.access('revoke', {token: tokens.approver});
    for (const door of ['/api/me', `/api/events/${event.event_id}`, `/api/events/${event.event_id}/brief`, `/api/events/${event.event_id}/daysheet`, `/api/events/${event.event_id}/daysheet.csv`, `/api/events/${event.event_id}/save`]) {
      const answer = knock(g, door, tokens.approver, {base_revision: event.revision, submission_id: 's', answers: {}});
      assert.equal(answer.status, 403, door); assert.equal(answer.error, 'link-expired', door);
    }
  }));

  test('a link that ran out stops working', () => prepared((g, dj, {event}) => {
    const grant = g.access('mint', {event_id: event.event_id, person_id: 'p_theo', role: 'approver', expires_at: '2020-01-01T00:00:00Z'});
    const answer = knock(g, '/api/me', grant.token); assert.equal(answer.status, 403); assert.equal(answer.error, 'link-expired');
  }));

  test('a link for one event cannot read another', () => prepared((g, dj, {tokens}) => {
    const other = plant(g, 'harbor-studio.json').event;
    const answer = knock(g, `/api/events/${other.event_id}`, tokens.approver); assert.equal(answer.status, 403); assert.equal(answer.error, 'not-your-event');
  }));

  test('a made up link is refused without saying whether it exists', () => withApp((g) => {
    const answer = knock(g, '/api/me', 'f'.repeat(32)); assert.equal(answer.status, 403); assert.equal(answer.error, 'link-expired');
  }));

  test('Miles reaches every event', () => prepared((g, dj) => {
    plant(g, 'harbor-studio.json'); const answer = knock(g, '/api/events', dj);
    assert.equal(answer.status, 200); assert.equal(answer.events.length, 2);
    assert.ok(answer.events[0].next_action);
  }));

  test('a client cannot read the list of all events', () => prepared((g, dj, {tokens}) => {
    const answer = knock(g, '/api/events', tokens.approver); assert.equal(answer.status, 403); assert.equal(answer.error, 'not-allowed');
  }));

  test('me says who you are', () => prepared((g, dj, {tokens}) => {
    const answer = knock(g, '/api/me', tokens.planner); assert.equal(answer.status, 200); assert.equal(answer.person.name, 'Jules Okafor'); assert.equal(answer.role, 'planner');
  }));

  test('a save comes back with a receipt', () => prepared((g, dj, {event, tokens}) => {
    const answer = knock(g, `/api/events/${event.event_id}/save`, tokens.approver, {base_revision: event.revision, submission_id: 'sub_r', answers: {crowd_notes: {value: 'Loud room.', state: 'confirmed'}}});
    assert.equal(answer.status, 200); assert.equal(answer.receipt.revision, event.revision + 1); assert.equal(answer.receipt.name, 'Northstar Staff Awards'); assert.ok(answer.effects.coverage);
  }));

  test('sending the same thing twice books it once', () => prepared((g, dj, {event, tokens}) => {
    const body = {base_revision: event.revision, submission_id: 'sub_twice', answers: {crowd_notes: {value: 'Loud.', state: 'confirmed'}}};
    const first = knock(g, `/api/events/${event.event_id}/save`, tokens.approver, body), second = knock(g, `/api/events/${event.event_id}/save`, tokens.approver, body);
    assert.equal(first.status, 200); assert.equal(second.status, 200); assert.equal(second.duplicate, true); assert.deepEqual(second.receipt, first.receipt);
    assert.equal(knock(g, `/api/events/${event.event_id}`, dj).revision, first.revision);
  }));

  test('two editors on one time see both values', () => prepared((g, dj, {event, tokens}) => {
    knock(g, `/api/events/${event.event_id}/save`, tokens.planner, {base_revision: event.revision, submission_id: 'sub_p', moments: [{moment_id: 'm_awards', start: '20:45'}]});
    const clash = knock(g, `/api/events/${event.event_id}/save`, dj, {base_revision: event.revision, submission_id: 'sub_d', moments: [{moment_id: 'm_awards', start: '21:00'}]});
    assert.equal(clash.status, 409); assert.equal(clash.conflicts[0].yours, '21:00'); assert.equal(clash.conflicts[0].theirs, '20:45'); assert.equal(clash.conflicts[0].theirs_by, 'Jules Okafor');
  }));

  test('a contributor can only propose', () => prepared((g, dj, {event, tokens}) => {
    const answer = knock(g, `/api/events/${event.event_id}/save`, tokens.contact, {base_revision: event.revision, submission_id: 'sub_c', moments: [{moment_id: 'm_awards', start: '22:00'}]});
    assert.deepEqual(answer.proposed, ['moments.m_awards.start']);
    const awards = knock(g, `/api/events/${event.event_id}`, dj).moments.find((moment) => moment.moment_id === 'm_awards'); assert.equal(awards.start, '20:00');
  }));

  test('sending without what we must have is refused in words', () => prepared((g, dj, {event}) => {
    const answer = knock(g, `/api/events/${event.event_id}/save`, dj, {base_revision: event.revision, submission_id: 'sub_v', submit: true, answers: {contact_email: {value: null, state: 'blank'}}});
    assert.equal(answer.status, 422); assert.equal(answer.error, 'invalid'); assert.ok(answer.errors[0].message);
  }));

  test("Miles settles the planner's proposed time", () => prepared((g, dj, {event}) => {
    const answer = knock(g, `/api/events/${event.event_id}/resolve`, dj, {field: 'moments.m_awards.start', take: 'proposal', submission_id: 'sub_res'}); assert.equal(answer.status, 200);
    assert.equal(knock(g, `/api/events/${event.event_id}`, dj).moments.find((moment) => moment.moment_id === 'm_awards').start, '20:15');
  }));

  test('somebody who does not own the field cannot settle it', () => prepared((g, dj, {event, tokens}) => {
    const answer = knock(g, `/api/events/${event.event_id}/resolve`, tokens.contact, {field: 'moments.m_awards.start', take: 'proposal', submission_id: 'sub_no'});
    assert.equal(answer.status, 403); assert.equal(answer.error, 'not-your-decision');
  }));

  test('an open question can be ticked off', () => prepared((g, dj, {event, tokens}) => {
    const item = event.open_items.find((row) => row.owner === 'approver');
    assert.equal(knock(g, `/api/events/${event.event_id}/open-items/${item.item_id}`, tokens.approver, {resolved: true, answer: 'Handled.', submission_id: 'sub_oi'}).status, 200);
    assert.equal(knock(g, `/api/events/${event.event_id}`, dj).open_items.find((row) => row.item_id === item.item_id).resolved, true);
  }));

  test('the history can be read from a revision on', () => prepared((g, dj, {event, tokens}) => {
    knock(g, `/api/events/${event.event_id}/save`, tokens.approver, {base_revision: event.revision, submission_id: 'sub_hh', answers: {crowd_notes: {value: 'Loud.', state: 'confirmed'}}});
    const answer = knock(g, `/api/events/${event.event_id}/changes?since=${event.revision}`, dj); assert.equal(answer.status, 200); assert.deepEqual(answer.changes.map((change) => change.field), ['answers.crowd_notes']);
  }));

  test('a booking hands back a link that opens as that person', () => withApp((g, dj) => {
    const made = knock(g, '/api/dj/events', dj, {name: 'Harbor Studio Networking', company: 'Harbor Studio', date: '2026-10-02', tz: 'America/Los_Angeles', people: [{name: 'Dana Whitfield', role: 'approver', email: 'dana@example.com'}, {name: 'Priya Raman', role: 'contact', email: 'priya@example.com'}]});
    assert.equal(made.status, 200); assert.deepEqual(Object.keys(made.links).sort(), ['approver', 'contact']); assert.match(made.links.approver, /^\/corporate\/client\/#([0-9a-f]{32})$/);
    const token = made.links.approver.split('#')[1], me = knock(g, '/api/me', token); assert.equal(me.role, 'approver'); assert.equal(me.person.name, 'Dana Whitfield'); assert.equal(me.event_id, made.event_id);
    assert.equal(knock(g, `/api/events/${made.event_id}`, token).answers.event_name.value, 'Harbor Studio Networking');
  }));

  test('a booking needs the person who says yes', () => withApp((g, dj) => {
    for (const people of [[{name: 'Priya Raman', role: 'contact', email: 'priya@example.com'}], []]) {
      const answer = knock(g, '/api/dj/events', dj, {people}); assert.equal(answer.status, 422); assert.ok(answer.errors[0].message);
    }
    assert.equal(knock(g, '/api/events', dj).events.length, 0);
  }));

  test('two people cannot share one role and lose a link', () => withApp((g, dj) => {
    const answer = knock(g, '/api/dj/events', dj, {people: [{name: 'Dana Whitfield', role: 'approver', email: 'dana@example.com'}, {name: 'Priya Raman', role: 'approver', email: 'priya@example.com'}]});
    assert.equal(answer.status, 422); assert.match(answer.errors[0].message, /one person for each role/i);
  }));

  test('a booking refuses a role it does not hand links to', () => withApp((g, dj) => {
    for (const role of ['dj', 'producer', '']) assert.equal(knock(g, '/api/dj/events', dj, {people: [{name: 'Dana Whitfield', role: 'approver', email: 'dana@example.com'}, {name: 'Priya Raman', role, email: 'priya@example.com'}]}).status, 422);
  }));

  test('a booking refuses an email that is not one', () => withApp((g, dj) => {
    assert.equal(knock(g, '/api/dj/events', dj, {people: [{name: 'Dana Whitfield', role: 'approver', email: 'dana at example'}]}).status, 422);
  }));

  test('a person id is never the text that was typed', () => withApp((g, dj) => {
    const made = knock(g, '/api/dj/events', dj, {name: 'x', people: [{name: '../../etc/passwd', role: 'approver', email: 'dana@example.com'}]}); assert.equal(made.status, 200);
    for (const person of knock(g, `/api/events/${made.event_id}`, dj).people) assert.match(person.person_id, /^p_[a-z0-9-]+x*$/);
  }));

  test('marking an event as looked at clears what changed', () => prepared((g, dj, {event, tokens}) => {
    let row = knock(g, '/api/events', dj).events.find((value) => value && value.event_id === event.event_id); assert.ok(row.changed_since_seen > 0);
    assert.equal(knock(g, '/api/dj/seen', dj, {event_id: event.event_id, revision: row.revision}).dj_seen_revision, row.revision);
    row = knock(g, '/api/events', dj).events.find((value) => value && value.event_id === event.event_id); assert.equal(row.changed_since_seen, 0);
    knock(g, `/api/events/${event.event_id}/save`, tokens.approver, {base_revision: row.revision, submission_id: 'sub_after', answers: {crowd_notes: {value: 'Loud room, after.', state: 'confirmed'}}});
    row = knock(g, '/api/events', dj).events.find((value) => value && value.event_id === event.event_id); assert.equal(row.changed_since_seen, 1);
  }));

  test('the bookmark never runs past where the event is or moves back', () => prepared((g, dj, {event}) => {
    const revision = event.revision; assert.equal(knock(g, '/api/dj/seen', dj, {event_id: event.event_id, revision: 999}).dj_seen_revision, revision);
    assert.equal(knock(g, '/api/dj/seen', dj, {event_id: event.event_id, revision: 1}).dj_seen_revision, revision);
  }));

  test('only Miles says what Miles has read', () => prepared((g, dj, {event, tokens}) => {
    for (const role of ['approver', 'planner', 'contact']) { const answer = knock(g, '/api/dj/seen', tokens[role], {event_id: event.event_id, revision: 1}); assert.equal(answer.status, 403); assert.equal(answer.error, 'not-allowed'); }
  }));

  test('marking an event nobody minted is refused in words', () => withApp((g, dj) => {
    for (const event_id of ['ev_0000000000', '../../etc/passwd']) { const answer = knock(g, '/api/dj/seen', dj, {event_id, revision: 1}); assert.equal(answer.status, 404); assert.equal(answer.error, 'no-such-event'); }
  }));

  test('a revision that is not a number is refused in words', () => prepared((g, dj, {event}) => {
    const answer = knock(g, '/api/dj/seen', dj, {event_id: event.event_id, revision: 'soon'}); assert.equal(answer.status, 422); assert.equal(answer.error, 'invalid'); assert.ok(answer.errors[0].message);
  }));

  test('marking it read is not a change to the event', () => prepared((g, dj, {event}) => {
    const lines = g.read_changes(event.event_id).length; knock(g, '/api/dj/seen', dj, {event_id: event.event_id, revision: event.revision});
    assert.equal(g.load_event(event.event_id).revision, event.revision); assert.equal(g.read_changes(event.event_id).length, lines);
  }));

  test('the day sheet prints the revision the zone and the cue words', () => prepared((g, dj, {event}) => {
    const answer = knock(g, `/api/events/${event.event_id}/daysheet`, dj); assert.equal(answer.kind, 'text/html');
    for (const wanted of [`revision ${event.revision}`, 'Central time (Chicago)', 'Raffle', 'shi-VAWN', 'please welcome your host for the evening']) assert.ok(answer.text.includes(wanted), wanted);
    assert.ok(!answer.text.includes('America/'), 'the sheet never shows a zone as a file name');
  }));

  test('a client cannot pull the day sheet', () => prepared((g, dj, {event, tokens}) => {
    const answer = knock(g, `/api/events/${event.event_id}/daysheet`, tokens.approver); assert.equal(answer.status, 403); assert.equal(answer.error, 'not-allowed');
  }));

  test('the day sheet says when a block runs into the next day', () => prepared((g, dj, {event}) => {
    const html = knock(g, `/api/events/${event.event_id}/daysheet`, dj).text; assert.ok(html.includes('9:30 PM–12:30 AM (into the next day)'));
    const military = /(^|[^\d:])([01]\d|2[0-3]):[0-5]\d(?!\s?[AP]M)/; assert.match('hard stop 21:41', military);
    assert.doesNotMatch(html.split('<h2>Key times</h2>')[1].split('</table>')[0], military);
    const csv = knock(g, `/api/events/${event.event_id}/daysheet.csv`, dj).text; assert.doesNotMatch(csv.split('\r\n').filter((line) => /^\d/.test(line)).join(' '), military);
  }));

  test('a cell that would run as a formula leaves behind a quote', () => prepared((g, dj, {event, tokens}) => {
    knock(g, `/api/events/${event.event_id}/save`, tokens.planner, {base_revision: event.revision, submission_id: 'sub_csv', moments: [{moment_id: 'm_dinner', cue_text: '=1+1 then hit play'}]});
    const csv = knock(g, `/api/events/${event.event_id}/daysheet.csv`, dj).text; assert.ok(csv.includes("'=1+1 then hit play")); assert.ok(!csv.includes(',=1+1'));
  }));

  test('the brief carries the name the client gave a part of the night', () => prepared((g, dj, {event, tokens}) => {
    const answer = knock(g, `/api/events/${event.event_id}/brief`, tokens.approver);
    const named = answer.moments.find((moment) => moment.kind === 'custom');
    assert.equal(named && named.label, 'Raffle');
  }));

  test('the brief only carries the questions this person owns', () => prepared((g, dj, {event, tokens}) => {
    const answer = knock(g, `/api/events/${event.event_id}/brief`, tokens.planner); assert.ok(answer.open_items.length); assert.deepEqual(new Set(answer.open_items.map((item) => item.owner)), new Set(['planner'])); assert.equal(answer.header.name, 'Northstar Staff Awards');
  }));

  test('malformed knocks and unknown doors are refused', () => withApp((g, dj) => {
    assert.deepEqual(JSON.parse(g.doPost({postData: {contents: '{'}}).getContent()), {status: 404, ok: false, error: 'no-such-door'});
    assert.equal(knock(g, '/nope', dj).error, 'no-such-door'); assert.match(g.doGet().getContent(), /^This is the prep home\./);
  }));

  test('a lock timeout says busy and writes nothing', () => prepared((g, dj, {event}) => {
    const before = plain(g.load_event(event.event_id)); g.LockService.getScriptLock = () => ({waitLock() { throw new Error('LockService timed out'); }, releaseLock() {}});
    const answer = knock(g, `/api/events/${event.event_id}/save`, dj, {base_revision: event.revision, submission_id: 'sub_busy', answers: {crowd_notes: {value: 'lost', state: 'confirmed'}}});
    assert.deepEqual(answer, {status: 503, ok: false, error: 'busy'}); assert.deepEqual(plain(g.load_event(event.event_id)), before);
  }));
});
