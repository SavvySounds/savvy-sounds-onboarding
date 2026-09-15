/* Pure rules for corporate onboarding.

No file reads, no file writes, no clock of its own: everything it needs comes
in as arguments so the same call always gives the same answer.  The words in
here are the words in CONTRACT.md; nothing invents a second spelling.
*/

const STATES = ["blank", "none", "unknown", "miles", "confirmed"];
const ROLES = ["approver", "contact", "planner", "production", "dj"];
const MOMENT_KINDS = ["arrival", "networking", "dinner", "presentations",
  "awards", "dancing", "closing", "custom"];
const MOMENT_APPROVAL = ["draft", "proposed", "confirmed"];
const STAGES = ["draft", "waiting", "preparing", "review", "ready", "completed"];
const ORIGINS = ["form-draft", "form-submit", "client-edit", "dj-edit",
  "proposal", "resolve", "seed"];

// CONTRACT.md section 2: which role owns each answer group.
const OWNER_ROLE = {
  direction: "approver",
  running_order: "planner",
  production: "production",
  prep: "dj",
  event: "approver",
};
// Fallback when nobody on the event holds that role.
const OWNER_FALLBACK = {running_order: "approver", production: "approver"};

// Which answer group owns each attribute of a moment.
const MOMENT_FIELD_OWNER = {
  date: "running_order", start: "running_order", end: "running_order",
  duration_min: "running_order", label: "running_order",
  kind: "running_order", approval: "running_order",
  active: "running_order", purpose: "running_order",
  room: "running_order", order: "running_order",
  cue_text: "running_order", pronunciation: "running_order",
  cue_owner: "running_order", music_owner: "prep",
};

// Answers that hold songs a client asked for, matched against the exclusions.
const REQUEST_QIDS = ["requests", "must_plays", "dancing_opener",
  "dancing_closer", "awards_walkon"];
const EXCLUSION_QID = "dnp_songs";

const _HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const _YMD = /^\d{4}-\d{2}-\d{2}$/;
const _EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const _SLUG = /[^a-z0-9]+/g;
const _MISSING = {};


// ---------------------------------------------------------------- small tools

function slug(text) {
  return String(text).toLowerCase().replace(_SLUG, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "x";
}

function hhmm_to_min(value) {
  const bits = String(value).split(":");
  return Number.parseInt(bits[0], 10) * 60 + Number.parseInt(bits[1], 10);
}

function clock(hhmm) {
  // Show a stored wall-clock time the way Miles reads it.
  const bits = String(hhmm).split(":");
  const hour = Number(bits[0]);
  if (!Number.isInteger(hour) || bits.length < 2) return String(hhmm);
  const suffix = hour < 12 ? "AM" : "PM";
  const shown = hour % 12;
  return String(shown === 0 ? 12 : shown) + ":" + bits[1] + " " + suffix;
}

function ymd_to_ord(value) {
  const bits = String(value).split("-").map(Number);
  return Math.floor(Date.UTC(bits[0], bits[1] - 1, bits[2]) / 86400000) + 719163;
}

function _ord_to_ymd(value) {
  return new Date((value - 719163) * 86400000).toISOString().slice(0, 10);
}

function span_min(moment) {
  // Minutes a moment lasts.  An end earlier than its start is the next day.
  const start = moment.start;
  const end = moment.end;
  if (start && end && _HHMM.test(String(start)) && _HHMM.test(String(end))) {
    return (hhmm_to_min(end) - hhmm_to_min(start) + 1440) % 1440;
  }
  return Number.parseInt(moment.duration_min || 0, 10);
}

function abs_start(moment) {
  // Minutes since the year zero, so moments on two days sort correctly.
  if (!(moment.date && moment.start)) return null;
  if (!(_YMD.test(String(moment.date)) && _HHMM.test(String(moment.start)))) return null;
  return ymd_to_ord(moment.date) * 1440 + hhmm_to_min(moment.start);
}

function placed(moments) {
  // Active moments that have a date and a start, in time order.
  return moments.filter((m) => (m.active === undefined || m.active) && abs_start(m) !== null)
    .sort((a, b) => abs_start(a) - abs_start(b));
}


// ---------------------------------------------------------------- who decides

function owner_of(target, questions) {
  /* The answer group that owns a question record or a field path.

  target: a question object, or 'answers.<qid>', 'moments.<mid>.<attr>',
          'moments.<mid>', 'people', 'event'.
  */
  questions = questions || [];
  if (target && typeof target === "object" && !Array.isArray(target)) return target.owner || "event";
  const field = String(target);
  if (field.startsWith("answers.")) {
    const qid = field.split(".").slice(1).join(".");
    for (const q of questions) if (q.id === qid) return q.owner || "event";
    throw new Error("no question named " + JSON.stringify(qid) + ", so nobody owns it");
  }
  if (field.startsWith("moments.")) {
    const parts = field.split(".");
    const attr = parts.length > 2 ? parts[2] : "date";
    if (!(attr in MOMENT_FIELD_OWNER)) throw new Error("no moment attribute named " + JSON.stringify(attr));
    return MOMENT_FIELD_OWNER[attr];
  }
  if (field === "people" || field === "event" || field.startsWith("open_items")) return "event";
  throw new Error("no owner rule for field " + JSON.stringify(field));
}

function role_of(group, people) {
  // The role that may CONFIRM this group, after the fallback in section 2.
  people = people || [];
  const role = OWNER_ROLE[group];
  const held = people.map((p) => p.role);
  if (!held.includes(role) && group in OWNER_FALLBACK) return OWNER_FALLBACK[group];
  return role;
}

function may_confirm(group, role, people) {
  return role === "dj" || role === role_of(group, people || []);
}


// ---------------------------------------------------------------- validation

function _is_empty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.filter((v) => String(v).trim()).length === 0;
  return false;
}

function _type_errors(question, value) {
  const kind = question.type;
  const options = question.options || [];
  const qid = question.id;
  const bad = [];
  if (["text", "textarea", "email", "date", "choice"].includes(kind)) {
    if (typeof value !== "string") {
      return [{field: "answers." + qid, message: "That answer should be words."}];
    }
  }
  if (kind === "email" && !_EMAIL.test(value.trim())) bad.push("That does not look like an email address.");
  if (kind === "date" && !_YMD.test(value.trim())) bad.push("A date looks like 2026-11-06.");
  if (kind === "number" && Number.isNaN(Number(String(value).trim()))) bad.push("That should be a number.");
  if (kind === "choice" && options.length && !options.includes(value)) bad.push("Pick one of the choices offered.");
  if (["multi", "songs", "links"].includes(kind)) {
    if (!Array.isArray(value)) return [{field: "answers." + qid, message: "That answer should be a list."}];
    for (const item of value) {
      if (typeof item !== "string" || !item.trim()) {
        bad.push("One of the lines is empty.");
        break;
      }
    }
    if (kind === "multi" && options.length) {
      for (const item of value) {
        if (!options.includes(item)) {
          bad.push("Pick from the choices offered.");
          break;
        }
      }
    }
  }
  return bad.map((message) => ({field: "answers." + qid, message}));
}

function _confirmed(answers, qid) {
  const answer = answers[qid] || {};
  return answer.state === "confirmed" && !_is_empty(answer.value);
}

function validate(questions, payload, submit) {
  // Errors in the PROSPECTIVE record.  Empty list means it may be written.
  const qmap = {};
  for (const q of questions) qmap[q.id] = q;
  const errors = [];
  const answers = payload.answers || {};
  for (const [qid, answer] of Object.entries(answers)) {
    if (!(qid in qmap)) {
      errors.push({field: "answers." + qid, message: "We do not have a question called that."});
      continue;
    }
    const state = answer.state;
    if (!STATES.includes(state)) {
      errors.push({field: "answers." + qid, message: "That is not one of the five answer states."});
      continue;
    }
    const value = answer.value;
    if (state === "confirmed") {
      if (_is_empty(value)) errors.push({field: "answers." + qid, message: "Marked answered but nothing was written."});
      else errors.push(..._type_errors(qmap[qid], value));
    } else if (!_is_empty(value)) {
      errors.push({field: "answers." + qid, message: "Only an answered question carries a value."});
    }
  }

  for (const moment of payload.moments || []) {
    const mid = moment.moment_id || "?";
    if (!MOMENT_KINDS.includes(moment.kind)) errors.push({field: "moments." + mid, message: "That is not one of the parts of a night we know."});
    if (!MOMENT_APPROVAL.includes(moment.approval)) errors.push({field: "moments." + mid, message: "A moment is draft, proposed or confirmed."});
    for (const attr of ["start", "end"]) {
      if (moment[attr] && !_HHMM.test(String(moment[attr]))) errors.push({field: "moments." + mid + "." + attr, message: "A time looks like 19:30."});
    }
    if (moment.date && !_YMD.test(String(moment.date))) errors.push({field: "moments." + mid + ".date", message: "A date looks like 2026-11-06."});
  }

  for (const person of payload.people || []) {
    const pid = person.person_id || "?";
    if (!ROLES.includes(person.role)) errors.push({field: "people." + pid, message: "That is not one of the roles we know."});
    if (!String(person.name || "").trim()) errors.push({field: "people." + pid, message: "A person needs a name."});
    if (person.email && !_EMAIL.test(String(person.email).trim())) errors.push({field: "people." + pid, message: "That does not look like an email address."});
  }

  if (submit) {
    if (!(_confirmed(answers, "event_name") || _confirmed(answers, "company"))) errors.push({field: "answers.event_name", message: "We need the event name or the company."});
    if (!_confirmed(answers, "contact_name")) errors.push({field: "answers.contact_name", message: "We need a name we can talk to."});
    if (!_confirmed(answers, "contact_email")) errors.push({field: "answers.contact_email", message: "We need an email for the private link."});
    const date_state = (answers.event_date || {}).state;
    if (!(_confirmed(answers, "event_date") || date_state === "unknown")) errors.push({field: "answers.event_date", message: "Give the date, or say it is not settled yet."});
    if (!_confirmed(answers, "event_type")) errors.push({field: "answers.event_type", message: "Tell us what kind of event it is."});
    else if (answers.event_type.value === "Other" && !_confirmed(answers, "event_type_other")) errors.push({field: "answers.event_type_other", message: "Tell us what kind of event it is."});
    const approver_state = (answers.approver_name || {}).state;
    if (!(_confirmed(answers, "approver_name") || approver_state === "unknown")) errors.push({field: "answers.approver_name", message: "Name who gives the final yes, or say it is not settled yet."});
  }
  return errors;
}


// ------------------------------------------------------- simultaneous editors

function _equal(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  return ak.length === bk.length && ak.every((key) => Object.prototype.hasOwnProperty.call(b, key) && _equal(a[key], b[key]));
}

function three_way(base, current, yours) {
  /* Merge one editor's fields onto a record that moved under them.

  base / current / yours are flat {field: value} maps.  A field only the
  other editor touched stays theirs; a field only you touched is yours;
  a field both touched with different values is a conflict and nothing in
  that field is written.
  */
  const merged = {};
  const conflicts = [];
  for (const [field, mine] of Object.entries(yours)) {
    const was = Object.prototype.hasOwnProperty.call(base, field) ? base[field] : _MISSING;
    const theirs = Object.prototype.hasOwnProperty.call(current, field) ? current[field] : _MISSING;
    if (_equal(theirs, was) || _equal(theirs, mine)) merged[field] = mine;
    else conflicts.push({field, yours: mine, theirs: theirs === _MISSING ? null : theirs});
  }
  return [merged, conflicts];
}


// ------------------------------------------------------------------- coverage

function coverage(event) {
  // How many minutes of music Miles owes, and where the order does not meet.
  const moments = placed(event.moments || []);
  const target = moments.filter((m) => m.music_owner === "dj").reduce((sum, m) => sum + span_min(m), 0);
  const overlaps = [];
  const gaps = [];
  for (let i = 0; i < moments.length - 1; i += 1) {
    const first = moments[i];
    const second = moments[i + 1];
    const first_end = abs_start(first) + span_min(first);
    const second_start = abs_start(second);
    if (second_start < first_end) overlaps.push({a: first.moment_id, b: second.moment_id, minutes: first_end - second_start});
    else if (second_start > first_end) gaps.push({after: first.moment_id, before: second.moment_id, minutes: second_start - first_end});
  }
  return {target_min: target, overlaps, gaps};
}


// -------------------------------------------------------------------- effects

function _item(item_id, question, why, moments, owner, origin) {
  return {item_id, question, why, moments: Array.from(moments), owner, due: null,
    resolved: false, resolved_by: null, resolved_at: null, origin, active: true};
}

function _by_id(moments) {
  const out = {};
  for (const moment of moments) if (moment.moment_id) out[moment.moment_id] = moment;
  return out;
}

function _window(moment) {
  const start = abs_start(moment);
  if (start === null) return null;
  return [start, start + span_min(moment)];
}

function _norm_song(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function _answer_value(event, qid) {
  return ((event.answers || {})[qid] || {}).value;
}

function effects(before, after, questions) {
  /* What a save did to the prep.  Adds open items to `after` in place.

  Running it twice on the same pair adds nothing the second time: every
  item id is derived from the rule plus the thing it is about, and an item
  already active on the event is not added again.
  */
  questions = questions || [];
  const people = after.people || [];
  if (!after.open_items) after.open_items = [];
  const live = new Set(after.open_items.filter((i) => i.active === undefined || i.active).map((i) => i.item_id));
  let added = [];
  const closed = [];
  const cues = [];

  function offer(item) {
    if (live.has(item.item_id)) {
      // Already open. Nothing is added, but who owns it can have moved.
      for (const standing of after.open_items) {
        if (standing.item_id === item.item_id) {
          standing.owner = item.owner;
          standing.question = item.question;
          standing.why = item.why;
        }
      }
      return;
    }
    live.add(item.item_id);
    added.push(item);
  }

  function role_for(group) { return role_of(group, people); }

  const b_moments = _by_id(before.moments || []);
  const a_moments = _by_id(after.moments || []);

  // --- a moment of kind awards becomes active
  function awards_ids(record) {
    return new Set((record.moments || []).filter((m) => m.kind === "awards" && (m.active === undefined || m.active)).map((m) => m.moment_id));
  }

  const before_awards = awards_ids(before);
  const new_awards = Array.from(awards_ids(after)).filter((mid) => !before_awards.has(mid)).sort();
  const cue_role = people.some((p) => p.role === "planner") ? "planner" : "approver";
  for (const mid of new_awards) {
    const label = a_moments[mid].label || "the awards";
    offer(_item("oi_awards_names_" + mid, "Who are the award recipients, and how are their names pronounced?", "Read on mic during " + label + "; a wrong name is unrecoverable.", [mid], "approver", "rule:awards"));
    offer(_item("oi_awards_walkon_" + mid, "What walks each recipient on?", "Walk-on music has to be cued to the second.", [mid], "approver", "rule:awards"));
    offer(_item("oi_awards_cue_text_" + mid, "What are the exact words that start and stop the music?", "Miles goes on the words, not on a guess.", [mid], cue_role, "rule:awards"));
    offer(_item("oi_awards_introducer_" + mid, "Who introduces whom?", "The order on stage decides the order of the music.", [mid], cue_role, "rule:awards"));
    offer(_item("oi_awards_cue_caller_" + mid, "Who calls each cue on the night?", "One voice tells Miles to go.", [mid], cue_role, "rule:awards"));
  }

  // --- a moment's start / end / date changes
  for (const [mid, moment] of Object.entries(a_moments)) {
    const old = b_moments[mid];
    if (!old || moment.active === false) continue;
    if (["date", "start", "end"].every((key) => _equal(old[key], moment[key]))) continue;
    const windows = [_window(old), _window(moment)].filter(Boolean);
    if (!windows.length) continue;
    const low = Math.min(...windows.map((w) => w[0]));
    const high = Math.max(...windows.map((w) => w[1]));
    for (const other of after.moments || []) {
      if (other.active === false || !String(other.cue_text || "").trim()) continue;
      const span = _window(other);
      if (span && span[0] < high && span[1] > low && !cues.includes(other.moment_id)) cues.push(other.moment_id);
    }
    const label = moment.label || mid;
    const moment_cue_role = moment.cue_owner || role_for("running_order");
    offer(_item("oi_cue_recheck_" + mid, "Re-confirm the cue for " + label + " at the new time", "The time moved; the words and the start point have to move with it.", [mid], moment_cue_role, "rule:time-change"));
    offer(_item("oi_soundcheck_recheck_" + mid, "Re-check soundcheck and arrival against the new times", "Everything before the change was planned around the old clock.", [mid], role_for("production"), "rule:time-change"));
  }

  // --- the event date, venue or zone changes
  let shift_days = 0;
  const moved = ["event_date", "venue", "tz"].filter((qid) => !_is_empty(_answer_value(before, qid)) && !_equal(_answer_value(before, qid), _answer_value(after, qid)));
  if (moved.length) {
    offer(_item("oi_reschedule_recheck", "Re-check load-in, arrival and the room plan for the new venue/date", "A new date or a new room changes every practical answer under it.", [], role_for("production"), "rule:reschedule"));
    const old_date = _answer_value(before, "event_date");
    const new_date = _answer_value(after, "event_date");
    if (moved.length === 1 && moved[0] === "event_date" && old_date && new_date && _YMD.test(String(old_date)) && _YMD.test(String(new_date))) {
      shift_days = ymd_to_ord(new_date) - ymd_to_ord(old_date);
      if (shift_days) {
        for (const moment of after.moments || []) {
          if (moment.date && _YMD.test(String(moment.date))) moment.date = _ord_to_ymd(ymd_to_ord(moment.date) + shift_days);
        }
      }
    }
  }

  // --- a moment goes inactive: its items go quiet, nothing new is born
  const gone = new Set(Object.entries(a_moments).filter(([mid, m]) => m.active === false && (b_moments[mid] || {}).active !== false).map(([mid]) => mid));
  if (gone.size) {
    for (const item of after.open_items) {
      if ((item.active === undefined || item.active) && (item.moments || []).some((mid) => gone.has(mid))) {
        item.active = false;
        closed.push(item.item_id);
        live.delete(item.item_id);
      }
    }
    added = added.filter((item) => !(item.moments || []).some((mid) => gone.has(mid)));
  }

  // --- an answer lands on "Not sure yet" or "Miles to suggest"
  const qmap = {};
  for (const q of questions) qmap[q.id] = q;
  for (const [qid, answer] of Object.entries(after.answers || {})) {
    const state = answer.state;
    const item_id = "oi_answer_" + qid;
    if (["unknown", "miles"].includes(state)) {
      let owner;
      if (state === "miles") owner = "dj";
      else {
        if (!(qid in qmap)) throw new Error("effects needs the question list to know who owns " + JSON.stringify(qid));
        owner = role_for(owner_of(qmap[qid]));
      }
      const label = (qmap[qid] || {}).label || qid;
      const why = state === "miles" ? "You said you'd suggest this \u2014 it's yours to answer." : "Left open on the form; the night needs a real answer.";
      offer(_item(item_id, label + " \u2014 still open", why, [], owner, "rule:answer-state"));
    } else if (["confirmed", "none"].includes(state)) {
      for (const item of after.open_items) {
        if (item.item_id === item_id && (item.active === undefined || item.active)) {
          item.resolved = true;
          item.active = false;
          closed.push(item_id);
          live.delete(item_id);
        }
      }
    }
  }

  // --- a do-not-play matches something asked for
  const excluded = _answer_value(after, EXCLUSION_QID) || [];
  let request_ids = questions.filter((q) => q.type === "songs" && q.id !== EXCLUSION_QID).map((q) => q.id);
  if (!request_ids.length) request_ids = Array.from(REQUEST_QIDS);
  const wanted = [];
  for (const qid of request_ids) {
    const value = _answer_value(after, qid);
    if (Array.isArray(value)) wanted.push(...value);
    else if (typeof value === "string" && value.trim()) wanted.push(value);
  }
  for (const bad of Array.isArray(excluded) ? excluded : []) {
    const bad_norm = _norm_song(bad);
    if (!bad_norm) continue;
    for (const want of wanted) {
      const want_norm = _norm_song(want);
      if (!want_norm) continue;
      if (bad_norm === want_norm || bad_norm.includes(want_norm) || want_norm.includes(bad_norm)) {
        offer(_item("oi_exclusion_" + slug(bad_norm), bad + " is both requested and excluded \u2014 which wins?", "It is on the must-play list and on the do-not-play list.", [], "approver", "rule:exclusion"));
        break;
      }
    }
  }

  return {open_items_added: added, open_items_closed: closed,
    cues_to_recheck: cues, coverage: coverage(after), date_shift_days: shift_days};
}


// ---------------------------------------------------------------- next action

function next_action(event) {
  // One plain sentence for the top of both screens.
  const people = event.people || [];
  const open_items = (event.open_items || []).filter((i) => (i.active === undefined || i.active) && !i.resolved);
  const client = open_items.filter((i) => i.owner !== "dj");
  const mine = open_items.filter((i) => i.owner === "dj");
  if (client.length) {
    const counts = {};
    for (const item of client) counts[item.owner] = (counts[item.owner] || 0) + 1;
    const wanted = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || Number(a !== "approver") - Number(b !== "approver") || a.localeCompare(b))[0];
    let name = "";
    for (const person of people) {
      if (person.role === wanted) {
        name = String(person.name || "").split(" ")[0];
        break;
      }
    }
    if (!name) {
      for (const person of people) {
        if (person.role === "approver") {
          name = String(person.name || "").split(" ")[0];
          break;
        }
      }
    }
    const who = name || "the client";
    return "Waiting on " + who + ": " + client.length + " open question" + (client.length === 1 ? "" : "s") + ".";
  }
  if (mine.length) return "Nothing waiting on the client. " + mine.length + " thing" + (mine.length === 1 ? "" : "s") + " need" + (mine.length === 1 ? "s" : "") + " Miles.";
  return "Nothing open. Ready for the next step.";
}
