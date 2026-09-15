import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT = dirname(fileURLToPath(import.meta.url));
const CORPORATE = dirname(SCRIPT);

export function load(options = {}) {
  const lines = [];
  const context = vm.createContext({
    console,
    Logger: {log: (...parts) => lines.push(parts.map(String).join(' '))},
    Utilities: {getUuid: () => randomUUID()},
    Session: {getScriptTimeZone: () => options.zone || 'America/Los_Angeles'},
    __logger_lines: lines,

    // Piece 2 adds DriveApp, LockService, PropertiesService, ContentService.
  });

  for (const name of readdirSync(SCRIPT).filter((name) => name.endsWith('.gs')).sort()) {
    vm.runInContext(readFileSync(join(SCRIPT, name), 'utf8'), context, {filename: name});
  }
  const questions = readFileSync(join(CORPORATE, 'questions.json'), 'utf8');
  vm.runInContext('const QUESTIONS = ' + questions + ';', context, {filename: 'questions.json'});
  return context;
}
