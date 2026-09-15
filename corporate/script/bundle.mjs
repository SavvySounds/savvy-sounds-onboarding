import {readdirSync, readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const script = dirname(fileURLToPath(import.meta.url));
const corporate = dirname(script);
process.stdout.on('error', (problem) => {
  if (problem.code === 'EPIPE') process.exit(0);
  throw problem;
});

for (const name of readdirSync(script).filter((name) => name.endsWith('.gs')).sort()) {
  const source = readFileSync(join(script, name));
  if (source.some((byte) => byte > 0x7f)) {
    process.stderr.write(`${name} contains a byte outside ASCII.\n`);
    process.exit(1);
  }
  process.stdout.write(`// ---- ${name} ----\n`);
  process.stdout.write(source);
  if (source.at(-1) !== 0x0a) process.stdout.write('\n');
}

process.stdout.write('const QUESTIONS = ');
process.stdout.write(readFileSync(join(corporate, 'questions.json')));
process.stdout.write(';\n');
