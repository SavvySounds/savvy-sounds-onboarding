import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';

import { load } from '../script/load.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTS = join(dirname(HERE), 'data', 'tests');
const plain = (value) => JSON.parse(JSON.stringify(value));

function privateStore() {
  const drive = join(TESTS, randomUUID());
  mkdirSync(drive, {recursive: true});
  return {drive, store: load({drive}), close: () => rmSync(drive, {recursive: true})};
}

function awardMoment() {
  return {moment_id: 'm_awards', kind: 'awards', label: 'Awards',
    date: '2026-10-02', start: '20:00', end: '21:00', duration_min: 60,
    purpose: '', room: '', music_owner: 'dj', cue_owner: 'planner',
    cue_text: '', pronunciation: '', approval: 'confirmed', active: true,
    previous: null, proposal: null};
}

function plant(store, proposal = true) {
  const people = [
    {person_id: 'p_theo', name: 'Theo Marsh', role: 'approver'},
    {person_id: 'p_jules', name: 'Jules Okafor', role: 'planner'},
    {person_id: 'p_mina', name: 'Mina Park', role: 'contact'},
  ];
  let event = store.create_event('Northstar Staff Awards', 'Northstar Logistics',
    '2026-10-02', 'America/Chicago', people);
  let result = store.save(event.event_id, 'p_miles', 'dj', {
    base_revision: event.revision, submission_id: 'sub_fixture',
    answers: {
      contact_name: {value: 'Theo Marsh', state: 'confirmed'},
      contact_email: {value: 'theo@example.com', state: 'confirmed'},
      event_type: {value: 'Awards', state: 'confirmed'},
      approver_name: {value: 'Theo Marsh', state: 'confirmed'},
      guest_count: {value: '220', state: 'confirmed'},
      crowd_notes: {value: 'Warehouse crews and head office in one room. Both sides have to hear something of theirs.', state: 'confirmed'},
    },
  });
  assert.equal(result[0], 200);
  result = store.seed_apply(event.event_id, [awardMoment()], proposal ? [
    {field: 'moments.m_awards.start', value: '20:15', by: 'p_jules'},
  ] : []);
  assert.equal(result[0], 200);
  event = store.load_event(event.event_id);
  return [event, result];
}

function withStore(run) {
  const owned = privateStore();
  try { return run(owned.store, owned.drive); }
  finally { owned.close(); }
}

if (process.argv[2] === '--lock-worker') {
  const [, , , drive, eventId, index] = process.argv;
  const store = load({drive});
  const fields = ['crowd_notes', 'success_looks_like', 'languages_cultures', 'dnp_themes'];
  for (let saveNumber = 0; saveNumber < 5; saveNumber += 1) {
    const revision = store.load_event(eventId).revision;
    const result = store.save(eventId, 'p_miles', 'dj', {
      base_revision: revision,
      submission_id: `sub_${index}_${saveNumber}`,
      answers: {[fields[Number(index)]]: {value: `answer ${index}-${saveNumber}`, state: 'confirmed'}},
    });
    if (result[0] !== 200) throw new Error(JSON.stringify(plain(result)));
  }
  process.exit(0);
}

describe('Making', {concurrency: false}, () => {
  test('an event id is minted and never taken from a name', () => withStore((store) => {
    const event = store.create_event('Harbor Studio Networking', 'Harbor Studio', '2026-10-02', 'America/Los_Angeles');
    assert.match(event.event_id, /^ev_[0-9a-f]{10}$/);
    assert.ok(!event.event_id.includes('harbor'));
    assert.equal(store.load_event(event.event_id).revision, 1);
    assert.equal(store.list_events().length, 1);
  }));

  test('a name that tries to be a path is refused in words', () => withStore((store) => {
    for (const bad of ['../../etc/passwd', 'ev_../x', 'Harbor Studio', '']) {
      assert.throws(() => store.load_event(bad), /that is not an event id we minted/);
    }
  }));

  test('clean versions start switched on', () => withStore((store) => {
    const event = store.create_event('x', 'y', '2026-10-02', 'America/Chicago');
    assert.equal(event.answers.clean_versions.value, 'clean');
    assert.equal(event.answers.clean_versions.state, 'confirmed');
  }));
});

describe('Saving', {concurrency: false}, () => {
  test('a save answers with a receipt and moves the revision on', () => withStore((store) => {
    const [event] = plant(store); const base = event.revision;
    const [code, body] = store.save(event.event_id, 'p_theo', 'approver', {base_revision: base,
      submission_id: 'sub_a', answers: {crowd_notes: {value: 'Loud room.', state: 'confirmed'}}});
    assert.equal(code, 200); assert.equal(body.ok, true); assert.equal(body.revision, base + 1);
    assert.equal(body.receipt.name, 'Northstar Staff Awards'); assert.equal(body.receipt.submission_id, 'sub_a');
    assert.ok(!Object.hasOwn(body, 'duplicate'));
  }));

  test('the same send twice gives the same receipt and no second booking', () => withStore((store) => {
    const [event] = plant(store); const payload = {base_revision: event.revision,
      submission_id: 'sub_same', answers: {crowd_notes: {value: 'Loud room.', state: 'confirmed'}}};
    const first = store.save(event.event_id, 'p_theo', 'approver', payload);
    const second = store.save(event.event_id, 'p_theo', 'approver', payload);
    assert.deepEqual([first[0], second[0]], [200, 200]); assert.equal(second[1].duplicate, true);
    assert.deepEqual(plain(first[1].receipt), plain(second[1].receipt));
    assert.equal(store.load_event(event.event_id).revision, first[1].revision);
  }));

  test('a send that changes no answer still leaves a line in the history', () => withStore((store) => {
    const [event] = plant(store);
    const [code, body] = store.save(event.event_id, 'p_theo', 'approver', {base_revision: event.revision, submission_id: 'sub_empty', answers: {}});
    assert.equal(code, 200); assert.equal(body.revision, event.revision + 1);
    const lines = store.changes_since(event.event_id, event.revision);
    assert.equal(lines.length, 1); assert.equal(lines[0].revision, body.revision); assert.equal(lines[0].field, 'event');
  }));

  test('settling with a word that is not proposal or current is refused and the proposal stays', () => withStore((store) => {
    const [event] = plant(store);
    const [code, body] = store.resolve(event.event_id, 'p_miles', 'dj', 'moments.m_awards.start', 'both', 'sub_both');
    assert.equal(code, 422); assert.equal(body.error, 'invalid');
    const after = store.load_event(event.event_id);
    assert.equal(after.revision, event.revision);
    assert.ok(after.moments.find((m) => m.moment_id === 'm_awards').proposal, 'the proposal is still there');
  }));

  test('what was there before is kept on every changed answer', () => withStore((store) => {
    const [event] = plant(store);
    store.save(event.event_id, 'p_theo', 'approver', {base_revision: event.revision,
      submission_id: 'sub_1', answers: {guest_count: {value: '240', state: 'confirmed'}}});
    const answer = store.load_event(event.event_id).answers.guest_count;
    assert.equal(answer.value, '240'); assert.equal(answer.previous.value, '220');
  }));

  test('what was there before is kept on a moved moment', () => withStore((store) => {
    const [event] = plant(store, false);
    store.save(event.event_id, 'p_jules', 'planner', {base_revision: event.revision,
      submission_id: 'sub_2', moments: [{moment_id: 'm_awards', start: '20:45'}]});
    const moment = store.load_event(event.event_id).moments.find((item) => item.moment_id === 'm_awards');
    assert.equal(moment.start, '20:45'); assert.equal(moment.previous.start, '20:00');
  }));

  test('two editors on one time get both values back and nothing is written', () => withStore((store) => {
    const [event] = plant(store, false); const base = event.revision;
    const first = store.save(event.event_id, 'p_jules', 'planner', {base_revision: base,
      submission_id: 'sub_j', moments: [{moment_id: 'm_awards', start: '20:45'}]});
    assert.equal(first[0], 200);
    const [code, clash] = store.save(event.event_id, 'p_miles', 'dj', {base_revision: base,
      submission_id: 'sub_m', moments: [{moment_id: 'm_awards', start: '21:00'}]});
    assert.equal(code, 409); assert.equal(clash.error, 'conflict'); assert.equal(clash.current_revision, first[1].revision);
    const only = clash.conflicts[0]; assert.equal(only.field, 'moments.m_awards.start');
    assert.equal(only.yours, '21:00'); assert.equal(only.theirs, '20:45'); assert.equal(only.theirs_by, 'Jules Okafor');
    assert.equal(store.load_event(event.event_id).moments[0].start, '20:45');
  }));

  test('a stale save of an untouched field still lands', () => withStore((store) => {
    const [event] = plant(store, false); const base = event.revision;
    store.save(event.event_id, 'p_jules', 'planner', {base_revision: base,
      submission_id: 'sub_j', moments: [{moment_id: 'm_awards', start: '20:45'}]});
    const result = store.save(event.event_id, 'p_theo', 'approver', {base_revision: base,
      submission_id: 'sub_t', answers: {crowd_notes: {value: 'Quiet room.', state: 'confirmed'}}});
    assert.equal(result[0], 200); assert.equal(store.load_event(event.event_id).answers.crowd_notes.value, 'Quiet room.');
  }));

  test('somebody who does not own the field only proposes', () => withStore((store) => {
    const [event] = plant(store, false);
    const [code, body] = store.save(event.event_id, 'p_mina', 'contact', {base_revision: event.revision,
      submission_id: 'sub_mina', moments: [{moment_id: 'm_awards', start: '22:00'}]});
    assert.equal(code, 200); assert.deepEqual(plain(body.proposed), ['moments.m_awards.start']);
    const moment = store.load_event(event.event_id).moments[0];
    assert.equal(moment.start, '20:00'); assert.equal(moment.proposal.start, '22:00'); assert.equal(moment.proposal.by, 'p_mina');
  }));

  test('a non owner cannot propose a choice the form never offered', () => withStore((store) => {
    const [event] = plant(store, false);
    const [code, body] = store.save(event.event_id, 'p_mina', 'contact', {base_revision: event.revision,
      submission_id: 'sub_bad_proposal', answers: {clean_versions: {value: 'whatever_they_played', state: 'confirmed'}}});
    assert.equal(code, 422); assert.equal(body.error, 'invalid');
    const after = store.load_event(event.event_id); assert.equal(after.revision, event.revision);
    assert.equal(after.answers.clean_versions.proposal, null); assert.deepEqual(plain(store.changes_since(event.event_id, event.revision)), []);
  }));

  test('the owner of the running order writes it outright', () => withStore((store) => {
    const [event] = plant(store, false);
    const [, body] = store.save(event.event_id, 'p_jules', 'planner', {base_revision: event.revision,
      submission_id: 'sub_j2', moments: [{moment_id: 'm_awards', start: '20:45'}]});
    assert.deepEqual(plain(body.proposed), []);
  }));

  test('miles can take the proposal and it becomes the answer', () => withStore((store) => {
    const [event] = plant(store, true);
    const [code] = store.resolve(event.event_id, 'p_miles', 'dj', 'moments.m_awards.start', 'proposal', 'sub_r');
    assert.equal(code, 200); const moment = store.load_event(event.event_id).moments[0];
    assert.equal(moment.start, '20:15'); assert.equal(moment.proposal, null);
  }));

  test('sending without the things we must have is refused and writes nothing', () => withStore((store) => {
    const [event] = plant(store, false);
    const [code, body] = store.save(event.event_id, 'p_theo', 'approver', {base_revision: event.revision,
      submission_id: 'sub_bad', submit: true, answers: {contact_email: {value: null, state: 'blank'}}});
    assert.equal(code, 422); assert.equal(body.error, 'invalid');
    assert.ok(body.errors.map((error) => error.field).includes('answers.contact_email'));
    assert.equal(store.load_event(event.event_id).revision, event.revision);
  }));

  test('the four states still mean four different things after a round trip', () => withStore((store) => {
    const [event] = plant(store, false);
    const [code] = store.save(event.event_id, 'p_miles', 'dj', {base_revision: event.revision,
      submission_id: 'sub_states', answers: {
        sound_constraints: {value: null, state: 'blank'}, live_act: {value: null, state: 'none'},
        crowd_notes: {value: null, state: 'unknown'}, dancing_closer: {value: null, state: 'miles'},
        guest_count: {value: '230', state: 'confirmed'},
      }});
    assert.equal(code, 200); const answers = store.load_event(event.event_id).answers;
    assert.deepEqual(['blank', 'none', 'unknown', 'miles', 'confirmed'],
      ['sound_constraints', 'live_act', 'crowd_notes', 'dancing_closer', 'guest_count'].map((qid) => answers[qid].state));
    const owners = Object.fromEntries(store.load_event(event.event_id).open_items.map((item) => [item.item_id, item.owner]));
    assert.equal(owners.oi_answer_crowd_notes, 'approver'); assert.equal(owners.oi_answer_dancing_closer, 'dj');
  }));

  test('every accepted save leaves a line in the history', () => withStore((store) => {
    const [event] = plant(store, false);
    store.save(event.event_id, 'p_theo', 'approver', {base_revision: event.revision,
      submission_id: 'sub_h', answers: {crowd_notes: {value: 'Loud room.', state: 'confirmed'}}});
    const lines = store.changes_since(event.event_id, event.revision);
    assert.deepEqual(plain(lines.map((line) => line.field)), ['answers.crowd_notes']);
    assert.equal(lines[0].before.value, 'Warehouse crews and head office in one room. Both sides have to hear something of theirs.');
    assert.equal(lines[0].actor, 'p_theo'); assert.equal(lines[0].origin, 'client-edit');
  }));
});

describe('Broken write', {concurrency: false}, () => {
  test('a half written last history line does not hide the good lines', () => withStore((store) => {
    const [event] = plant(store, false); const name = store._changes_path(event.event_id);
    const good = {revision: 1, field: 'answers.company'};
    store.root().getFilesByName(name).next().setContent(JSON.stringify(good) + '\n{"revision": 2');
    assert.deepEqual(plain(store.read_changes(event.event_id)), [good]);
  }));

  test('a broken history line in the middle is refused in words', () => withStore((store) => {
    const [event] = plant(store, false); const name = store._changes_path(event.event_id);
    const good = JSON.stringify({revision: 1, field: 'answers.company'});
    store.root().getFilesByName(name).next().setContent(good + '\n{"revision": 2\n' + good + '\n');
    assert.throws(() => store.read_changes(event.event_id), /history line 2.*is broken/);
  }));

  test('a write cut off half way leaves the last good answer standing', () => withStore((store) => {
    const [event] = plant(store, false); const good = plain(store.load_event(event.event_id));
    store.root().createFile('.tmp-abc123.json', '{"event_id":"ev_9999999999","revi', 'application/json');
    assert.deepEqual(plain(store.load_event(event.event_id)), good);
    assert.deepEqual(plain(store.list_events().map((item) => item.event_id)), [event.event_id]);
    const [code] = store.save(event.event_id, 'p_theo', 'approver', {base_revision: good.revision,
      submission_id: 'sub_after', answers: {crowd_notes: {value: 'Still fine.', state: 'confirmed'}}});
    assert.equal(code, 200); assert.equal(store.load_event(event.event_id).answers.crowd_notes.value, 'Still fine.');
  }));

  test('the real file is never seen half written', () => withStore((store) => {
    const event = store.create_event('x', 'y', '2026-10-02', 'America/Chicago');
    const file = store.root().getFilesByName(event.event_id + '.json').next();
    assert.equal(JSON.parse(file.getBlob().getDataAsString()).event_id, event.event_id);
    const names = []; const files = store.root().getFiles(); while (files.hasNext()) names.push(files.next().getName());
    assert.deepEqual(names.sort(), [event.event_id + '.changes.jsonl', event.event_id + '.json'].sort());
  }));
});

describe('One lock', {concurrency: false}, () => {
  test('four processes make twenty saves and the revision never repeats', async () => {
    const owned = privateStore();
    try {
      const event = owned.store.create_event('x', 'y', '2026-10-02', 'America/Chicago');
      owned.store.root().getFilesByName(event.event_id + '.changes.jsonl').next().setTrashed(true);
      const children = Array.from({length: 4}, (_, index) => spawn(process.execPath,
        [fileURLToPath(import.meta.url), '--lock-worker', owned.drive, event.event_id, String(index)],
        {stdio: ['ignore', 'pipe', 'pipe']}));
      await Promise.all(children.map((child) => new Promise((resolve, reject) => {
        let errors = ''; child.stderr.on('data', (part) => { errors += part; });
        child.on('error', reject); child.on('close', (code) => code === 0 ? resolve() : reject(new Error(errors)));
      })));
      const final = owned.store.load_event(event.event_id);
      const lines = owned.store.read_changes(event.event_id);
      assert.equal(final.revision, 21); assert.equal(lines.length, 20);
      assert.equal(new Set(lines.map((line) => line.revision)).size, 20);
    } finally { owned.close(); }
  });
});

describe('Wiping', {concurrency: false}, () => {
  test('it refuses to empty a folder holding something it did not make', () => withStore((store) => {
    store.root().createFile('somebody-elses-work.txt', 'mine', 'text/plain');
    assert.throws(() => store.wipe(), /refusing to empty.*holds things this tool did not make/);
    assert.equal(store.root().getFilesByName('somebody-elses-work.txt').hasNext(), true);
  }));
});
