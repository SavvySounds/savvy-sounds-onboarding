/* The one writer for event records, change history, and private links. */

var STORE_EVENT_ID = /^ev_[0-9a-f]{10}$/;
var STORE_TOKEN = /^[0-9a-f]{32}$/;
var STORE_ACCESS_FILE = "access.json";

function ensure_folder(name) {
  // The one place a folder is made or found; setup() asks here so no other
  // file ever names Drive.
  var folders = DriveApp.getFoldersByName(name);
  return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
}

function root() {
  var id = PropertiesService.getScriptProperties().getProperty("FOLDER_ID");
  if (!id) throw new Error("Run setup first.");
  return DriveApp.getFolderById(id);
}

function events_dir() { return root(); }
function changes_dir() { return root(); }
function load_questions() { return QUESTIONS; }
function now() { return new Date().toISOString().replace(/\.\d{3}Z$/, "Z"); }
function _lock_for(event_id) { return LockService.getScriptLock(); }
function _ensure() { return root(); }

function _safe(event_id) {
  if (!STORE_EVENT_ID.test(String(event_id || ""))) {
    throw new Error("that is not an event id we minted: " + JSON.stringify(event_id));
  }
  var name = event_id + ".json";
  if (name.indexOf("/") !== -1 || name.indexOf("\\") !== -1) {
    throw new Error("that event id tried to leave the store");
  }
  return name;
}

function _changes_path(event_id) {
  _safe(event_id);
  var name = event_id + ".changes.jsonl";
  if (name.indexOf("/") !== -1 || name.indexOf("\\") !== -1) {
    throw new Error("that event id tried to leave the store");
  }
  return name;
}

function _file_named(name) {
  var files = root().getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}

function _write_json(name, obj) {
  var text = JSON.stringify(obj, null, 2);
  var file = _file_named(name);
  if (file) file.setContent(text);
  // Google's MimeType has no JSON member (found on the real service 2026-09-16:
  // "Argument cannot be null: mimeType"); the type goes in as its own words.
  else root().createFile(name, text, "application/json");
}

function _read_json(name, fallback) {
  var file = _file_named(name);
  if (!file) return arguments.length > 1 ? fallback : null;
  try { return JSON.parse(file.getBlob().getDataAsString()); }
  catch (problem) { throw new Error("cannot read " + name + ": " + problem.message); }
}

function _append_changes(event_id, lines) {
  var name = _changes_path(event_id);
  var file = _file_named(name);
  var text = file ? file.getBlob().getDataAsString() : "";
  for (var i = 0; i < lines.length; i += 1) text += JSON.stringify(lines[i]) + "\n";
  if (file) file.setContent(text);
  else root().createFile(name, text, MimeType.PLAIN_TEXT);
}

function load_event(event_id) { return _read_json(_safe(event_id)); }

function list_events() {
  var files = root().getFiles();
  var found = [];
  while (files.hasNext()) {
    var file = files.next();
    if (/^ev_[0-9a-f]{10}\.json$/.test(file.getName())) found.push(file);
  }
  found.sort(function (a, b) { return a.getName().localeCompare(b.getName()); });
  return found.map(function (file) { return JSON.parse(file.getBlob().getDataAsString()); });
}

function _blank_answer() {
  return {value: null, state: "blank", supplied_by: null, supplied_at: null,
    source: "form", approved_by: null, approved_at: null, previous: null,
    proposal: null};
}

function create_event(name, company, date, tz, people, actor, origin, stage) {
  people = people || [];
  actor = actor || "p_miles";
  origin = origin || "dj-edit";
  stage = stage || "draft";
  var lock = _lock_for("");
  lock.waitLock(30000);
  try {
    _ensure();
    var event_id;
    do { event_id = "ev_" + Utilities.getUuid().replace(/-/g, "").slice(0, 10); }
    while (_file_named(_safe(event_id)));
    var stamp = now();
    var answers = {};
    var questions = load_questions().questions;
    questions.forEach(function (question) {
      answers[question.id] = _blank_answer();
      if (question.default !== undefined && question.default !== null) {
        Object.assign(answers[question.id], {value: question.default,
          state: "confirmed", source: "form", supplied_at: stamp});
      }
    });
    [["event_name", name], ["company", company], ["event_date", date], ["tz", tz]].forEach(function (pair) {
      if (pair[1]) Object.assign(answers[pair[0]], {value: pair[1], state: "confirmed",
        source: "dj", supplied_by: actor, supplied_at: stamp});
    });
    var event = {event_id: event_id, revision: 1, created_at: stamp,
      updated_at: stamp, stage: stage, submitted_at: null,
      tz: tz || "America/Los_Angeles", answers: answers,
      people: JSON.parse(JSON.stringify(people)), moments: [], songs: [],
      open_items: [], sources: [], dj_notes: "", receipts: {}, next_action: ""};
    event.next_action = next_action(event);
    _write_json(_safe(event_id), event);
    _append_changes(event_id, [{change_id: "ch_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12),
      event_id: event_id, revision: 1, at: stamp, actor: actor, role: "dj",
      origin: origin, field: "event", before: null,
      after: {name: name, company: company, date: date, tz: tz}, affected: [],
      decision_required: false, resolved_by: null, resolved_at: null,
      submission_id: null}]);
    return event;
  } finally { lock.releaseLock(); }
}

function _answer_pair(answer) { return {value: answer.value, state: answer.state}; }

function current_fields(event, touched) {
  var out = {};
  var moments = {};
  (event.moments || []).forEach(function (moment) { moments[moment.moment_id] = moment; });
  Object.keys(touched).forEach(function (field) {
    if (field.indexOf("answers.") === 0) {
      var answer = (event.answers || {})[field.split(".")[1]];
      out[field] = answer ? _answer_pair(answer) : null;
    } else if (field.indexOf("moments.") === 0) {
      var bits = field.split(".");
      out[field] = moments[bits[1]] ? moments[bits[1]][bits[2]] : null;
    } else if (field === "people") out[field] = event.people;
  });
  return out;
}

function _touched_fields(payload) {
  var fields = {};
  Object.keys(payload.answers || {}).forEach(function (qid) {
    var answer = payload.answers[qid];
    fields["answers." + qid] = {value: answer.value === undefined ? null : answer.value,
      state: answer.state || "confirmed"};
  });
  (payload.moments || []).forEach(function (moment) {
    if (!moment.moment_id) return;
    Object.keys(moment).forEach(function (attr) {
      if (["moment_id", "previous", "proposal"].indexOf(attr) === -1) {
        fields["moments." + moment.moment_id + "." + attr] = moment[attr];
      }
    });
  });
  if (payload.people !== undefined && payload.people !== null) fields.people = payload.people;
  return fields;
}

function _changed_since(event_id, base_revision) {
  var was = {}, who = {};
  read_changes(event_id).forEach(function (line) {
    if ((line.revision || 0) > base_revision) {
      if (!Object.prototype.hasOwnProperty.call(was, line.field)) was[line.field] = line.before;
      who[line.field] = [line.actor, line.at];
    }
  });
  return [was, who];
}

function read_changes(event_id) {
  var name = _changes_path(event_id);
  var file = _file_named(name);
  if (!file) return [];
  var lines = file.getBlob().getDataAsString().split(/\r?\n/).map(function (line, index) {
    return [index + 1, line.trim()];
  }).filter(function (pair) { return pair[1]; });
  var out = [];
  for (var i = 0; i < lines.length; i += 1) {
    try { out.push(JSON.parse(lines[i][1])); }
    catch (problem) {
      if (i === lines.length - 1) break;
      throw new Error("history line " + lines[i][0] + " in " + name + " is broken: " + problem.message);
    }
  }
  return out;
}

function changes_since(event_id, since) {
  return read_changes(event_id).filter(function (change) { return (change.revision || 0) > Number(since); });
}

function _label_for(field, questions) {
  if (field.indexOf("answers.") === 0) {
    var qid = field.split(".")[1];
    for (var i = 0; i < questions.length; i += 1) if (questions[i].id === qid) return questions[i].label;
    return qid;
  }
  return field;
}

function _person_name(event, person_id) {
  for (var i = 0; i < (event.people || []).length; i += 1) {
    if (event.people[i].person_id === person_id) return event.people[i].name;
  }
  return person_id === "p_miles" ? "Miles" : person_id;
}

function save(event_id, actor, role, payload, questions) {
  questions = questions || load_questions().questions;
  var lock = _lock_for(event_id);
  lock.waitLock(30000);
  try {
    var event = load_event(event_id);
    if (event === null) return [404, {ok: false, error: "no-such-event"}];
    var submission_id = payload.submission_id || "";
    var receipts = event.receipts || (event.receipts = {});
    if (submission_id && Object.prototype.hasOwnProperty.call(receipts, submission_id)) {
      var kept = receipts[submission_id];
      return [200, {ok: true, revision: kept.revision, receipt: kept,
        duplicate: true, proposed: [], effects: {open_items_added: [],
          open_items_closed: [], cues_to_recheck: [], coverage: coverage(event)}}];
    }
    var touched = _touched_fields(payload);
    var base_revision = payload.base_revision === undefined ? event.revision : payload.base_revision;
    var current = current_fields(event, touched);
    if (base_revision !== event.revision) {
      var changed = _changed_since(event_id, base_revision);
      var base = {};
      Object.keys(touched).forEach(function (field) {
        base[field] = Object.prototype.hasOwnProperty.call(changed[0], field) ? changed[0][field] : current[field];
      });
      var combined = three_way(base, current, touched);
      if (combined[1].length) {
        var conflicts = combined[1].map(function (clash) {
          var by = changed[1][clash.field] || [null, null];
          return {field: clash.field, label: _label_for(clash.field, questions),
            yours: clash.yours, theirs: clash.theirs,
            theirs_by: _person_name(event, by[0]), theirs_at: by[1]};
        });
        return [409, {ok: false, error: "conflict", current_revision: event.revision,
          conflicts: conflicts, merged: combined[0]}];
      }
      touched = combined[0];
    }
    var proposed = [], applied = {};
    var fieldNames = Object.keys(touched);
    for (var fi = 0; fi < fieldNames.length; fi += 1) {
      var field = fieldNames[fi], group;
      try { group = owner_of(field, questions); }
      catch (unknown) { return [422, {ok: false, error: "invalid", errors: [{field: field, message: unknown.message}]}]; }
      if (may_confirm(group, role, event.people || [])) applied[field] = touched[field];
      else proposed.push(field);
    }
    var prospective = JSON.parse(JSON.stringify(event));
    _apply_fields(prospective, applied, actor, role, now(), true);
    var errors = validate(questions, prospective, !!payload.submit);
    if (!errors.length && proposed.length) {
      var with_proposals = JSON.parse(JSON.stringify(prospective));
      var proposedValues = {};
      proposed.forEach(function (field) { proposedValues[field] = touched[field]; });
      _apply_fields(with_proposals, proposedValues, actor, role, now(), true);
      errors = validate(questions, with_proposals, false);
    }
    if (errors.length) return [422, {ok: false, error: "invalid", errors: errors}];
    var before = JSON.parse(JSON.stringify(event));
    var stamp = now();
    var lines = _apply_fields(event, applied, actor, role, stamp, false);
    proposed.forEach(function (field) { _apply_proposal(event, field, touched[field], actor, stamp); });
    var made = effects(before, event, questions);
    made.open_items_added.forEach(function (item) { event.open_items.push(item); });
    if (payload.submit) { event.submitted_at = stamp; event.stage = "waiting"; }
    event.revision += 1;
    event.updated_at = stamp;
    event.next_action = next_action(event);
    var origin = payload.submit ? "form-submit" : (role === "dj" ? "dj-edit" : "client-edit");
    var log = [];
    lines.forEach(function (line) {
      Object.assign(line, {event_id: event_id, revision: event.revision, at: stamp,
        actor: actor, role: role, origin: origin, submission_id: submission_id,
        affected: made.cues_to_recheck, resolved_by: null, resolved_at: null});
      log.push(line);
    });
    proposed.forEach(function (field) {
      log.push({change_id: "ch_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12),
        event_id: event_id, revision: event.revision, at: stamp, actor: actor,
        role: role, origin: "proposal", field: field, before: current[field],
        after: touched[field], affected: [], decision_required: true,
        resolved_by: null, resolved_at: null, submission_id: submission_id});
    });
    if (!log.length) {
      // A send that changed no answer still moved the event (its stage, its
      // submitted_at, or nothing but the revision); every revision gets a line.
      log.push({change_id: "ch_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12),
        event_id: event_id, revision: event.revision, at: stamp, actor: actor,
        role: role, origin: origin, field: "event", before: {stage: before.stage},
        after: {stage: event.stage, submitted_at: event.submitted_at || null},
        affected: [], decision_required: false, resolved_by: null, resolved_at: null,
        submission_id: submission_id});
    }
    var receipt = {event_id: event_id, revision: event.revision, saved_at: stamp,
      submission_id: submission_id, name: _event_name(event)};
    if (submission_id) event.receipts[submission_id] = receipt;
    _write_json(_safe(event_id), event);
    _append_changes(event_id, log);
    return [200, {ok: true, revision: event.revision, receipt: receipt,
      proposed: proposed, effects: {
        open_items_added: made.open_items_added.map(function (item) { return item.item_id; }),
        open_items_closed: made.open_items_closed, cues_to_recheck: made.cues_to_recheck,
        coverage: made.coverage}}];
  } finally { lock.releaseLock(); }
}

function _event_name(event) {
  var answers = event.answers || {};
  for (var i = 0; i < 2; i += 1) {
    var value = (answers[["event_name", "company"][i]] || {}).value;
    if (value) return value;
  }
  return event.event_id;
}

function _apply_fields(event, applied, actor, role, stamp, dry) {
  var lines = [], moments = {};
  (event.moments || (event.moments = [])).forEach(function (moment) { moments[moment.moment_id] = moment; });
  Object.keys(applied).forEach(function (field) {
    var value = applied[field], before, after, answer, bits, moment;
    if (field.indexOf("answers.") === 0) {
      var qid = field.split(".")[1];
      answer = (event.answers || (event.answers = {}))[qid] || ((event.answers)[qid] = _blank_answer());
      before = _answer_pair(answer);
      after = {value: value.value === undefined ? null : value.value, state: value.state};
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      if (!dry) answer.previous = {value: answer.value, state: answer.state,
        supplied_by: answer.supplied_by, supplied_at: answer.supplied_at};
      answer.value = after.value; answer.state = after.state; answer.supplied_by = actor;
      answer.supplied_at = stamp; answer.source = role === "dj" ? "dj" : "form";
      if (after.state === "confirmed") { answer.approved_by = actor; answer.approved_at = stamp; }
    } else if (field.indexOf("moments.") === 0) {
      bits = field.split("."); moment = moments[bits[1]];
      if (!moment) {
        moment = {moment_id: bits[1], kind: "custom", label: bits[1], date: null,
          start: null, end: null, duration_min: 0, purpose: "", room: "",
          music_owner: "dj", cue_owner: "planner", cue_text: "",
          pronunciation: "", approval: "draft", active: true,
          previous: null, proposal: null};
        event.moments.push(moment); moments[bits[1]] = moment;
      }
      before = moment[bits[2]] === undefined ? null : moment[bits[2]];
      after = value;
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      if (!dry) { var previous = moment.previous || {}; previous[bits[2]] = before; moment.previous = previous; }
      moment[bits[2]] = value;
    } else if (field === "people") {
      before = event.people;
      after = value;
      if (JSON.stringify(before) === JSON.stringify(after)) return;
      event.people = value;
    } else return;
    lines.push({change_id: "ch_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12),
      field: field, before: before, after: after, decision_required: false});
  });
  return lines;
}

function _apply_proposal(event, field, value, actor, stamp) {
  var proposal = {by: actor, at: stamp, note: ""};
  if (field.indexOf("answers.") === 0) {
    var answer = event.answers[field.split(".")[1]] || (event.answers[field.split(".")[1]] = _blank_answer());
    Object.assign(proposal, {value: value.value, state: value.state});
    answer.proposal = proposal;
  } else if (field.indexOf("moments.") === 0) {
    var bits = field.split(".");
    (event.moments || []).forEach(function (moment) {
      if (moment.moment_id === bits[1]) {
        var keep = moment.proposal || Object.assign({}, proposal);
        Object.assign(keep, {by: actor, at: stamp}); keep[bits[2]] = value; moment.proposal = keep;
      }
    });
  } else if (field === "people") {
    (event.pending_people || (event.pending_people = [])).push({people: value, by: actor, at: stamp});
  }
}

function resolve(event_id, actor, role, field, take, submission_id, questions) {
  submission_id = submission_id || ""; questions = questions || load_questions().questions;
  var lock = _lock_for(event_id); lock.waitLock(30000);
  try {
    var event = load_event(event_id);
    if (!event) return [404, {ok: false, error: "no-such-event"}];
    if (submission_id && Object.prototype.hasOwnProperty.call(event.receipts || (event.receipts = {}), submission_id)) {
      return [200, {ok: true, revision: event.receipts[submission_id].revision, duplicate: true}];
    }
    if (take !== "proposal" && take !== "current") {
      return [422, {ok: false, error: "invalid", errors: [{field: "take", message: "Say proposal or current."}]}];
    }
    var group;
    try { group = owner_of(field, questions); }
    catch (unknown) { return [422, {ok: false, error: "invalid", errors: [{field: field, message: unknown.message}]}]; }
    if (!may_confirm(group, role, event.people || [])) return [403, {ok: false, error: "not-your-decision"}];
    var stamp = now(), proposal = _pull_proposal(event, field);
    if (!proposal) return [422, {ok: false, error: "invalid", errors: [{field: field, message: "Nothing is proposed there."}]}];
    var before = JSON.parse(JSON.stringify(event)), change = null;
    if (take === "proposal") {
      var applied = {}, bits = field.split(".");
      applied[field] = field.indexOf("answers.") === 0 ? {value: proposal.value, state: proposal.state} : proposal[bits[2]];
      var lines = _apply_fields(event, applied, actor, role, stamp, false); change = lines.length ? lines[0] : null;
    }
    var made = effects(before, event, questions);
    made.open_items_added.forEach(function (item) { event.open_items.push(item); });
    event.revision += 1; event.updated_at = stamp; event.next_action = next_action(event);
    var line = change || {change_id: "ch_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12), field: field, before: null, after: null};
    Object.assign(line, {event_id: event_id, revision: event.revision, at: stamp,
      actor: actor, role: role, origin: "resolve", affected: made.cues_to_recheck,
      decision_required: false, resolved_by: actor, resolved_at: stamp,
      submission_id: submission_id});
    var receipt = {event_id: event_id, revision: event.revision, saved_at: stamp,
      submission_id: submission_id, name: _event_name(event)};
    if (submission_id) event.receipts[submission_id] = receipt;
    _write_json(_safe(event_id), event); _append_changes(event_id, [line]);
    return [200, {ok: true, revision: event.revision, took: take}];
  } finally { lock.releaseLock(); }
}

function _pull_proposal(event, field) {
  if (field.indexOf("answers.") === 0) {
    var answer = (event.answers || {})[field.split(".")[1]] || {};
    var proposal = answer.proposal; answer.proposal = null; return proposal;
  }
  if (field.indexOf("moments.") === 0) {
    var bits = field.split(".");
    for (var i = 0; i < (event.moments || []).length; i += 1) {
      var moment = event.moments[i], proposal = moment.proposal;
      if (moment.moment_id === bits[1] && proposal && Object.prototype.hasOwnProperty.call(proposal, bits[2])) {
        moment.proposal = null; return proposal;
      }
    }
  }
  return null;
}

function set_open_item(event_id, actor, role, item_id, resolved, answer, submission_id) {
  answer = answer || ""; submission_id = submission_id || "";
  var lock = _lock_for(event_id); lock.waitLock(30000);
  try {
    var event = load_event(event_id);
    if (!event) return [404, {ok: false, error: "no-such-event"}];
    if (submission_id && Object.prototype.hasOwnProperty.call(event.receipts || (event.receipts = {}), submission_id)) {
      return [200, {ok: true, revision: event.receipts[submission_id].revision, duplicate: true}];
    }
    var found = null;
    (event.open_items || []).some(function (item) { if (item.item_id === item_id) { found = item; return true; } return false; });
    if (!found) return [404, {ok: false, error: "no-such-item"}];
    var stamp = now(), before = Object.assign({}, found);
    found.resolved = !!resolved; found.resolved_by = resolved ? actor : null;
    found.resolved_at = resolved ? stamp : null; if (answer) found.answer = answer;
    event.revision += 1; event.updated_at = stamp; event.next_action = next_action(event);
    var receipt = {event_id: event_id, revision: event.revision, saved_at: stamp,
      submission_id: submission_id, name: _event_name(event)};
    if (submission_id) event.receipts[submission_id] = receipt;
    _write_json(_safe(event_id), event);
    _append_changes(event_id, [{change_id: "ch_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12),
      event_id: event_id, revision: event.revision, at: stamp, actor: actor,
      role: role, origin: "resolve", field: "open_items." + item_id,
      before: before.resolved, after: !!resolved, affected: before.moments || [],
      decision_required: false, resolved_by: resolved ? actor : null,
      resolved_at: resolved ? stamp : null, submission_id: submission_id}]);
    return [200, {ok: true, revision: event.revision}];
  } finally { lock.releaseLock(); }
}

function set_seen(event_id, revision) {
  if (!STORE_EVENT_ID.test(String(event_id || ""))) return [404, {ok: false, error: "no-such-event"}];
  var wanted = Number(revision);
  if (!Number.isInteger(wanted)) return [422, {ok: false, error: "invalid",
    errors: [{field: "revision", message: "That is not a revision number."}]}];
  var lock = _lock_for(event_id); lock.waitLock(30000);
  try {
    var event = load_event(event_id);
    if (!event) return [404, {ok: false, error: "no-such-event"}];
    var standing = Number(event.dj_seen_revision || 0);
    wanted = Math.max(Math.min(wanted, Number(event.revision || 0)), standing);
    if (wanted !== standing) { event.dj_seen_revision = wanted; _write_json(_safe(event_id), event); }
    return [200, {ok: true, dj_seen_revision: wanted}];
  } finally { lock.releaseLock(); }
}

function _access_path() { return STORE_ACCESS_FILE; }
function _load_access() { return _read_json(_access_path(), {tokens: {}, dj_token: null}) || {tokens: {}, dj_token: null}; }

function access(op, kw) {
  kw = kw || {};
  if (op === "lookup") {
    var token = String(kw.token || "");
    var book = _load_access();
    // Miles's own pass is whatever he set it to (set_pass), so it is matched
    // whole before the client links, which are always 32 hex characters.
    if (book.dj_token && token === book.dj_token) return {ok: true, event_id: null, person_id: "p_miles", role: "dj", expires_at: null};
    if (!STORE_TOKEN.test(token)) return {ok: false, error: "link-expired"};
    var grant = (book.tokens || {})[token];
    if (!grant || grant.revoked_at || (grant.expires_at && grant.expires_at <= now())) return {ok: false, error: "link-expired"};
    return {ok: true, event_id: grant.event_id, person_id: grant.person_id,
      role: grant.role, expires_at: grant.expires_at};
  }
  var lock = _lock_for("access"); lock.waitLock(30000);
  try {
    var book = _load_access();
    if (op === "mint") {
      var token = Utilities.getUuid().replace(/-/g, "");
      (book.tokens || (book.tokens = {}))[token] = {event_id: kw.event_id,
        person_id: kw.person_id, role: kw.role, created_at: now(),
        expires_at: kw.expires_at || null, revoked_at: null};
      _write_json(_access_path(), book);
      return {ok: true, token: token, link: "/corporate/client/#" + token};
    }
    if (op === "revoke") {
      var token = String(kw.token || ""), grant = (book.tokens || {})[token];
      if (!grant) return {ok: false, error: "link-expired"};
      grant.revoked_at = now(); _write_json(_access_path(), book); return {ok: true};
    }
    if (op === "revoke_person") {
      // Every live link this person holds on this event, taken back at once.
      var taken = 0;
      Object.keys(book.tokens || {}).forEach(function (held) {
        var g = book.tokens[held];
        if (g.event_id === kw.event_id && g.person_id === kw.person_id && !g.revoked_at) { g.revoked_at = now(); taken += 1; }
      });
      if (taken) _write_json(_access_path(), book);
      return {ok: true, taken: taken};
    }
    if (op === "set_pass") {
      // His pass, in his own words. Eight characters at least, no spaces; the
      // old one stops working the moment the new one is written.
      var wanted = String(kw.pass || "");
      if (wanted.length < 8 || /\s/.test(wanted)) return {ok: false, error: "invalid"};
      book.dj_token = wanted; _write_json(_access_path(), book);
      return {ok: true};
    }
    if (op === "dj") {
      if (!book.dj_token) { book.dj_token = Utilities.getUuid().replace(/-/g, ""); _write_json(_access_path(), book); }
      return {ok: true, token: book.dj_token, link: "/corporate/dj/"};
    }
    if (op === "all") return book;
  } finally { lock.releaseLock(); }
  throw new Error("no such access operation: " + JSON.stringify(op));
}

function wipe() {
  var lock = _lock_for("wipe"); lock.waitLock(30000);
  try {
    var files = root().getFiles(), ours = [], strangers = [];
    while (files.hasNext()) {
      var file = files.next(), name = file.getName();
      if (name === STORE_ACCESS_FILE || /^ev_[0-9a-f]{10}(?:\.json|\.changes\.jsonl)$/.test(name)) ours.push(file);
      else strangers.push(name);
    }
    if (strangers.length) throw new Error("refusing to empty the store - it holds things this tool did not make: " + strangers.sort().join(", "));
    ours.forEach(function (file) { file.setTrashed(true); });
  }
  finally { lock.releaseLock(); }
}

function seed_apply(event_id, moments, proposals, dj_notes, stage, actor, questions) {
  proposals = proposals || []; actor = actor || "p_miles"; questions = questions || load_questions().questions;
  var lock = _lock_for(event_id); lock.waitLock(30000);
  try {
    var event = load_event(event_id);
    if (!event) return [404, {ok: false, error: "no-such-event"}];
    var before = JSON.parse(JSON.stringify(event)), stamp = now();
    if (moments !== undefined && moments !== null) event.moments = JSON.parse(JSON.stringify(moments));
    if (dj_notes !== undefined && dj_notes !== null) event.dj_notes = dj_notes;
    if (stage) event.stage = stage;
    proposals.forEach(function (proposal) {
      var bits = proposal.field.split(".");
      (event.moments || []).forEach(function (moment) {
        if (moment.moment_id === bits[1]) {
          var keep = moment.proposal || {}; keep[bits[2]] = proposal.value;
          keep.by = proposal.by; keep.at = stamp; moment.proposal = keep;
        }
      });
    });
    var made = effects(before, event, questions);
    made.open_items_added.forEach(function (item) { event.open_items.push(item); });
    event.revision += 1; event.updated_at = stamp; event.next_action = next_action(event);
    _write_json(_safe(event_id), event);
    _append_changes(event_id, [{change_id: "ch_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12),
      event_id: event_id, revision: event.revision, at: stamp, actor: actor,
      role: "dj", origin: "seed", field: "event", before: null,
      after: "fixture loaded", affected: made.cues_to_recheck,
      decision_required: false, resolved_by: null, resolved_at: null,
      submission_id: null}]);
    return [200, {ok: true, revision: event.revision,
      open_items_added: made.open_items_added.map(function (item) { return item.item_id; })}];
  } finally { lock.releaseLock(); }
}
