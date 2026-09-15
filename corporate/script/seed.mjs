import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {load} from './load.mjs';

const corporate = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtures = join(corporate, 'fixtures');
const port = Number(process.env.CORP_PORT || 8790);
const g = load({drive: process.env.CORP_DATA});

function plant(name) {
  const fixture = JSON.parse(readFileSync(join(fixtures, name), 'utf8'));
  const questions = g.load_questions().questions;
  const event = g.create_event(fixture.name, fixture.company, fixture.date, fixture.tz, fixture.people);
  const eventId = event.event_id;
  const answers = Object.fromEntries(Object.entries(fixture.answers).map(([id, value]) => [id, {value, state: 'confirmed'}]));
  for (const state of ['unknown', 'miles', 'none']) {
    for (const id of fixture[state] || []) answers[id] = {value: null, state};
  }
  let result = g.save(eventId, 'p_miles', 'dj', {
    base_revision: event.revision,
    submission_id: `sub_seed_${eventId}`,
    answers,
  }, questions);
  if (result[0] !== 200) throw new Error(`the fixture would not save: ${JSON.stringify(result[1])}`);
  result = g.seed_apply(eventId, fixture.moments, fixture.proposals || [], fixture.dj_notes, fixture.stage, 'p_miles', questions);
  if (result[0] !== 200) throw new Error(`the moments would not save: ${JSON.stringify(result[1])}`);
  const links = fixture.people.map((person) => {
    const grant = g.access('mint', {event_id: eventId, person_id: person.person_id, role: person.role});
    return [person.name, person.role, grant.token];
  });
  return [g.load_event(eventId), links];
}

g.wipe();
console.log('Store emptied.\n');
for (const name of ['harbor-studio.json', 'northstar-awards.json']) {
  const [event, links] = plant(name);
  console.log(event.answers.event_name.value);
  console.log(`  ${event.next_action}`);
  console.log(`  ${event.moments.filter((moment) => moment.active !== false).length} parts of the night, ${event.open_items.filter((item) => item.active !== false && !item.resolved).length} questions still open.`);
  for (const [who, role, token] of links) {
    console.log(`  ${who.padEnd(16)} ${role.padEnd(11)} http://127.0.0.1:${port}/corporate/client/#${token}`);
  }
  console.log();
}
const dj = g.access('dj', {});
console.log(`Miles's own view:  http://127.0.0.1:${port}/corporate/dj/`);
console.log(`His pass, for the page to carry:  ${dj.token}`);
console.log('\nStart the server with:  node corporate/script/standin.mjs');
