import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { load } from '../script/load.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPORATE = dirname(HERE), TESTS = join(CORPORATE, 'data', 'tests');
const plain = (value) => JSON.parse(JSON.stringify(value));
function knock(g, door, token, body) { return JSON.parse(g.doPost({postData: {contents: JSON.stringify({door, token, body})}}).getContent()); }

function plant(g) {
  const fixture = JSON.parse(readFileSync(join(CORPORATE, 'fixtures', 'northstar-awards.json'), 'utf8'));
  const made = g.create_event(fixture.name, fixture.company, fixture.date, fixture.tz, fixture.people);
  const answers = Object.fromEntries(Object.entries(fixture.answers).map(([qid, value]) => [qid, {value, state: 'confirmed'}]));
  for (const state of ['unknown', 'miles', 'none']) for (const qid of fixture[state] || []) answers[qid] = {value: null, state};
  assert.equal(g.save(made.event_id, 'p_miles', 'dj', {base_revision: made.revision, submission_id: `sub_seed_${made.event_id}`, answers})[0], 200);
  assert.equal(g.seed_apply(made.event_id, fixture.moments, fixture.proposals, fixture.dj_notes, fixture.stage)[0], 200);
  const tokens = {};
  for (const person of fixture.people) tokens[person.role] = g.access('mint', {event_id: made.event_id, person_id: person.person_id, role: person.role}).token;
  return {event: plain(g.load_event(made.event_id)), tokens, secret: fixture.dj_notes};
}

function prepared(run) {
  const drive = join(TESTS, randomUUID()); mkdirSync(drive, {recursive: true});
  try { const g = load({drive}); g.setup(); return run(g, g.access('dj', {}).token, plant(g)); }
  finally { rmSync(drive, {recursive: true}); }
}

describe('Private', {concurrency: false}, () => {
  test("Miles's notes are in his own reading", () => prepared((g, dj, {event, secret}) => {
    assert.equal(knock(g, `/api/events/${event.event_id}`, dj).dj_notes, secret);
  }));

  test("Miles's notes are nowhere in the client's reading", () => prepared((g, dj, {event, tokens, secret}) => {
    for (const door of [`/api/events/${event.event_id}`, `/api/events/${event.event_id}/brief`, `/api/events/${event.event_id}/changes?since=0`]) {
      const text = JSON.stringify(knock(g, door, tokens.approver)); assert.ok(!text.includes(secret), door); assert.ok(!text.includes('dj_notes'), door); assert.ok(!text.toLowerCase().includes('do not show the client'), door);
    }
  }));

  test("one person never sees another person's phone or email", () => prepared((g, dj, {event, tokens}) => {
    const body = knock(g, `/api/events/${event.event_id}`, tokens.contact), me = body.people.find((person) => person.person_id === 'p_mina');
    assert.equal(me.email, 'mina@example.com'); assert.equal(me.phone, '555-0155');
    const others = JSON.stringify(body.people.filter((person) => person.person_id !== 'p_mina'));
    for (const secret of ['theo@example.com', 'jules@example.com', '555-0119', '555-0108']) assert.ok(!others.includes(secret));
    for (const person of body.people.filter((row) => row.person_id !== 'p_mina')) { assert.equal(person.email, ''); assert.equal(person.phone, ''); }
  }));

  test("a change to the people list never carries another person's details", () => prepared((g, dj, {event, tokens}) => {
    const people = plain(g.load_event(event.event_id).people); people.push({person_id: 'p_new', name: 'Rowan Ellis', role: 'contact', email: 'rowan@example.com', phone: '555-0199', decides: []});
    const saved = knock(g, `/api/events/${event.event_id}/save`, tokens.approver, {base_revision: event.revision, submission_id: 'sub_people', people}); assert.equal(saved.status, 200);
    const history = knock(g, `/api/events/${event.event_id}/changes?since=0`, tokens.contact), lines = history.changes.filter((change) => change.field === 'people'); assert.equal(lines.length, 1);
    const line = JSON.stringify(lines[0]); for (const secret of ['theo@example.com', 'jules@example.com', 'rowan@example.com', '555-0119', '555-0108', '555-0199']) assert.ok(!line.includes(secret), secret);
    assert.ok(line.includes('mina@example.com')); assert.ok(!JSON.stringify(history).includes('rowan@example.com'));
    assert.ok(JSON.stringify(knock(g, `/api/events/${event.event_id}/changes?since=0`, dj)).includes('rowan@example.com'));
  }));

  test("the answers the client's own side typed still read back", () => prepared((g, dj, {event, tokens}) => {
    const body = knock(g, `/api/events/${event.event_id}`, tokens.contact); assert.equal(body.answers.contact_email.value, 'theo@example.com'); assert.equal(body.answers.guest_count.value, '220');
  }));

  test('names and roles still reach the client', () => prepared((g, dj, {event, tokens}) => {
    const pairs = new Set(knock(g, `/api/events/${event.event_id}`, tokens.contact).people.map((person) => `${person.name}|${person.role}`));
    assert.ok(pairs.has('Theo Marsh|approver')); assert.ok(pairs.has('Jules Okafor|planner'));
  }));

  test("a note Miles wrote on a proposal does not travel", () => prepared((g, dj, {event, tokens}) => {
    g.save(event.event_id, 'p_miles', 'dj', {base_revision: event.revision, submission_id: 'sub_note', answers: {crowd_notes: {value: "Miles's own read.", state: 'confirmed'}}});
    const changed = plain(g.load_event(event.event_id)); changed.answers.crowd_notes.proposal = {value: 'x', state: 'confirmed', by: 'p_miles', at: '2026-09-14T00:00:00Z', note: 'Theo is wrong about this, handle it gently.'}; g._write_json(g._safe(event.event_id), changed);
    assert.ok(!JSON.stringify(knock(g, `/api/events/${event.event_id}`, tokens.approver)).includes('handle it gently'));
    assert.equal(knock(g, `/api/events/${event.event_id}`, dj).answers.crowd_notes.proposal.note, 'Theo is wrong about this, handle it gently.');
  }));

  test('the client has no door to the sheets that carry it', () => prepared((g, dj, {event, tokens, secret}) => {
    for (const door of [`/api/events/${event.event_id}/daysheet`, `/api/events/${event.event_id}/daysheet.csv`]) { const answer = knock(g, door, tokens.approver); assert.equal(answer.status, 403); assert.ok(!JSON.stringify(answer).includes(secret)); }
  }));

  test('the day sheet is for Miles and does carry the contacts', () => prepared((g, dj, {event}) => {
    const page = knock(g, `/api/events/${event.event_id}/daysheet`, dj).text; assert.ok(page.includes('theo@example.com')); assert.ok(page.includes('555-0119'));
  }));

  test('words a client typed cannot become markup', () => prepared((g, dj, {event}) => {
    g.save(event.event_id, 'p_miles', 'dj', {base_revision: event.revision, submission_id: 'sub_html', answers: {crowd_notes: {value: "<script>alert('hi')</script> & loud", state: 'confirmed'}}});
    assert.ok(!knock(g, `/api/events/${event.event_id}/daysheet`, dj).text.includes('<script>alert'));
  }));
});
