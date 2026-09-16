import { randomUUID } from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync,
  statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SCRIPT = dirname(fileURLToPath(import.meta.url));
const CORPORATE = dirname(SCRIPT);

export function load(options = {}) {
  const drive = resolve(options.drive || join(CORPORATE, 'data', 'drive'));
  mkdirSync(drive, {recursive: true});
  const lines = [];
  const iterator = (items) => ({
    hasNext() { return items.length > 0; },
    next() {
      if (!items.length) throw new Error('No more items.');
      return items.shift();
    },
  });
  const atomicWrite = (path, text) => {
    const temp = path + '.tmp-' + process.pid + '-' + randomUUID();
    writeFileSync(temp, String(text), 'utf8');
    renameSync(temp, path);
  };
  const file = (path) => ({
    getName: () => path.slice(path.lastIndexOf('/') + 1),
    getId: () => path,
    getBlob: () => ({getDataAsString: () => readFileSync(path, 'utf8')}),
    setContent(text) { atomicWrite(path, text); return this; },
    setTrashed(trashed) { if (trashed && existsSync(path)) unlinkSync(path); return this; },
  });
  const folder = (path) => ({
    getId: () => path,
    getName: () => path.slice(path.lastIndexOf('/') + 1),
    getFiles: () => iterator(readdirSync(path).filter((name) => !name.startsWith('.') && statSync(join(path, name)).isFile()).map((name) => file(join(path, name)))),
    getFilesByName: (name) => iterator(existsSync(join(path, name)) && statSync(join(path, name)).isFile() ? [file(join(path, name))] : []),
    createFile(name, text) { atomicWrite(join(path, name), text); return file(join(path, name)); },
  });
  const propertyPath = join(drive, '.properties.json');
  const readProperties = () => existsSync(propertyPath) ? JSON.parse(readFileSync(propertyPath, 'utf8')) : {};
  const scriptProperties = {
    getProperty: (name) => readProperties()[name] ?? null,
    setProperty(name, value) {
      const properties = readProperties();
      properties[name] = String(value);
      atomicWrite(propertyPath, JSON.stringify(properties));
      return this;
    },
  };
  scriptProperties.setProperty('FOLDER_ID', drive);
  let held = false;
  const scriptLock = {
    waitLock(ms) {
      const lock = join(drive, '.lock');
      const until = Date.now() + ms;
      while (true) {
        try { mkdirSync(lock); held = true; return; }
        catch (problem) {
          if (problem.code !== 'EEXIST') throw problem;
          if (Date.now() >= until) throw new Error('Service timed out: LockService');
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(10, Math.max(1, until - Date.now())));
        }
      }
    },
    releaseLock() {
      if (held) { rmdirSync(join(drive, '.lock')); held = false; }
    },
    hasLock: () => held,
  };
  const textOutput = (text) => ({
    setMimeType() { return this; },
    getContent: () => String(text),
  });
  const context = vm.createContext({
    console,
    Logger: {log: (...parts) => lines.push(parts.map(String).join(' '))},
    Utilities: {getUuid: () => randomUUID()},
    Session: {getScriptTimeZone: () => options.zone || 'America/Los_Angeles'},
    __logger_lines: lines,
    DriveApp: {
      getFolderById: (id) => folder(resolve(String(id))),
      createFolder(name) { const path = join(drive, name); mkdirSync(path, {recursive: true}); return folder(path); },
      getFoldersByName: (name) => iterator(existsSync(join(drive, name)) && statSync(join(drive, name)).isDirectory() ? [folder(join(drive, name))] : []),
    },
    LockService: {getScriptLock: () => scriptLock},
    PropertiesService: {getScriptProperties: () => scriptProperties},
    ContentService: {createTextOutput: textOutput, MimeType: {JSON: 'application/json', TEXT: 'text/plain'}},
    // Only the members Google's MimeType really has: a name it lacks must be
    // undefined here too, or the stand-in passes what the real service refuses.
    MimeType: {PLAIN_TEXT: 'text/plain'},
  });

  for (const name of readdirSync(SCRIPT).filter((name) => name.endsWith('.gs')).sort()) {
    vm.runInContext(readFileSync(join(SCRIPT, name), 'utf8'), context, {filename: name});
  }
  const questions = readFileSync(join(CORPORATE, 'questions.json'), 'utf8');
  vm.runInContext('const QUESTIONS = ' + questions + ';', context, {filename: 'questions.json'});
  return context;
}
