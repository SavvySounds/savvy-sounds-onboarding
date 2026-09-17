/* The Google Apps Script doors. All .gs files share this global scope. */

var BOOKING_ROLES = ["approver", "planner", "production", "contact"];
var DECIDES = {approver: ["direction", "event"], planner: ["running_order"],
  production: ["production"], contact: []};

function for_client(event, person_id) {
  var seen = JSON.parse(JSON.stringify(event));
  delete seen.dj_notes; delete seen.receipts; delete seen.pending_people;
  (seen.people || []).forEach(function (person) {
    if (person.person_id !== person_id) { person.email = ""; person.phone = ""; }
  });
  Object.keys(seen.answers || {}).forEach(function (qid) {
    var proposal = seen.answers[qid].proposal;
    if (proposal && proposal.by === "p_miles") proposal.note = "";
  });
  return seen;
}

function for_audience(event, who) {
  return who.role === "dj" ? event : for_client(event, who.person_id);
}

function changes_for_audience(lines, who) {
  if (who.role === "dj") return lines;
  var out = [];
  JSON.parse(JSON.stringify(lines)).forEach(function (line) {
    if (line.field === "dj_notes") return;
    if (line.field === "people") {
      ["before", "after"].forEach(function (side) {
        (line[side] || []).forEach(function (person) {
          if (person && typeof person === "object" && person.person_id !== who.person_id) {
            person.email = ""; person.phone = "";
          }
        });
      });
    }
    out.push(line);
  });
  return out;
}

function summarise(event) {
  var items = (event.open_items || []).filter(function (item) {
    return item.active !== false && !item.resolved;
  });
  var proposals = Object.keys(event.answers || {}).filter(function (qid) {
    return !!event.answers[qid].proposal;
  }).length + (event.moments || []).filter(function (moment) { return !!moment.proposal; }).length;
  var answers = event.answers || {};
  function value(qid) {
    var answer = answers[qid] || {};
    return answer.state === "confirmed" ? answer.value : null;
  }
  var seen = event.dj_seen_revision || 0;
  return {event_id: event.event_id, name: value("event_name") || event.event_id,
    company: value("company") || "", date: value("event_date") || "", tz: event.tz,
    stage: event.stage, revision: event.revision, updated_at: event.updated_at,
    changed_since_seen: changes_since(event.event_id, seen).length,
    needs_me: items.filter(function (item) { return item.owner === "dj"; }).length + proposals,
    waiting_on_client: items.filter(function (item) { return item.owner !== "dj"; }).length,
    next_action: event.next_action || next_action(event)};
}

function people_for_a_new_booking(given, questions) {
  var people = [], errors = [], taken = {};
  (given || []).forEach(function (person, index) {
    if (!person || typeof person !== "object" || Array.isArray(person)) {
      errors.push({field: "people." + index, message: "A person is a name, a role and an email."});
      return;
    }
    var name = String(person.name || "").trim(), role = String(person.role || "").trim();
    if (BOOKING_ROLES.indexOf(role) === -1) {
      errors.push({field: "people." + index, message: "That is not one of the roles a booking starts with."});
      return;
    }
    if (taken[role]) {
      errors.push({field: "people." + index, message: "Only one person for each role."});
      return;
    }
    taken[role] = true;
    var person_id = "p_" + slug(name);
    while (people.some(function (row) { return row.person_id === person_id; })) person_id += "x";
    people.push({person_id: person_id, name: name, role: role,
      email: String(person.email || "").trim(), phone: String(person.phone || "").trim(),
      decides: (DECIDES[role] || []).slice()});
  });
  errors = errors.concat(validate(questions || load_questions().questions, {people: people}, false));
  if (!people.some(function (person) { return person.role === "approver"; })) {
    errors.push({field: "people", message: "We need the person who gives the final yes."});
  }
  return [people, errors];
}

function brief(event, who) {
  var confirmed = {};
  Object.keys(event.answers || {}).forEach(function (qid) {
    var answer = event.answers[qid];
    if (answer.state === "confirmed") confirmed[qid] = answer.value;
  });
  var mine = (event.open_items || []).filter(function (item) {
    return item.active !== false && !item.resolved && (who.role === "dj" || item.owner === who.role);
  });
  return {ok: true, header: {event_id: event.event_id,
    name: confirmed.event_name || event.event_id, company: confirmed.company || "",
    date: confirmed.event_date || "", venue: confirmed.venue || "", tz: event.tz,
    revision: event.revision, stage: event.stage},
    moments: (event.moments || []).filter(function (moment) { return moment.active !== false; }),
    answers: confirmed, open_items: mine, next_action: event.next_action || ""};
}

function _door_reach(who, event_id) {
  return who.role !== "dj" && who.event_id !== event_id ?
    [403, {ok: false, error: "not-your-event"}] : null;
}

function route(door, who, body) {
  body = body || {};
  if (!who || !who.ok) return [403, who || {ok: false, error: "link-expired"}];
  if (door === "/api/questions") return [200, load_questions()];
  if (door === "/api/me") {
    var person = {person_id: who.person_id, name: "Miles", role: "dj"};
    if (who.role !== "dj") {
      var mine = load_event(who.event_id);
      (mine && mine.people || []).some(function (candidate) {
        if (candidate.person_id !== who.person_id) return false;
        person = {person_id: candidate.person_id, name: candidate.name, role: candidate.role}; return true;
      });
    }
    return [200, {ok: true, event_id: who.event_id, person: person,
      role: who.role, expires_at: who.expires_at}];
  }
  if (door === "/api/events") return who.role === "dj" ?
    [200, {ok: true, events: list_events().map(summarise)}] : [403, {ok: false, error: "not-allowed"}];

  if (door === "/api/dj/events") {
    if (who.role !== "dj") return [403, {ok: false, error: "not-allowed"}];
    var checked = people_for_a_new_booking(body.people);
    if (checked[1].length) return [422, {ok: false, error: "invalid", errors: checked[1]}];
    var made = create_event(body.name, body.company, body.date, body.tz, checked[0]);
    var links = {};
    made.people.forEach(function (person) {
      links[person.role] = access("mint", {event_id: made.event_id,
        person_id: person.person_id, role: person.role}).link;
    });
    return [200, {ok: true, event_id: made.event_id, links: links}];
  }
  if (door === "/api/dj/seen") {
    return who.role === "dj" ? set_seen(body.event_id, body.revision) :
      [403, {ok: false, error: "not-allowed"}];
  }
  if (door === "/api/dj/remove") {
    if (who.role !== "dj") return [403, {ok: false, error: "not-allowed"}];
    if (!STORE_EVENT_ID.test(String(body.event_id || ""))) return [422, {ok: false, error: "invalid"}];
    var gone = remove_event(body.event_id);
    return gone.ok ? [200, gone] : [404, gone];
  }
  if (door === "/api/dj/pass") {
    if (who.role !== "dj") return [403, {ok: false, error: "not-allowed"}];
    var changed = access("set_pass", {pass: body.pass});
    return changed.ok ? [200, changed] : [422, {ok: false, error: "invalid", errors: [{field: "pass", message: "A pass is at least eight characters with no spaces."}]}];
  }
  if (door === "/api/dj/access") {
    if (who.role !== "dj") return [403, {ok: false, error: "not-allowed"}];
    if (body.revoke) return [200, access("revoke", {token: body.revoke})];
    if (body.revoke_person) {
      var who_ = body.revoke_person || {};
      if (!STORE_EVENT_ID.test(String(who_.event_id || "")) || !who_.person_id) return [422, {ok: false, error: "invalid"}];
      return [200, access("revoke_person", {event_id: who_.event_id, person_id: who_.person_id})];
    }
    return [200, access("mint", {event_id: body.event_id, person_id: body.person_id,
      role: body.role, expires_at: body.expires_at})];
  }

  var matched = /^\/api\/events\/(ev_[0-9a-f]{10})(?:\/([^?\/]+)(?:\/([^?\/]+))?)?(?:\?since=([^&]*))?$/.exec(door);
  if (!matched) return [404, {ok: false, error: "no-such-door"}];
  var event_id = matched[1], denied = _door_reach(who, event_id);
  if (denied) return denied;
  var event = load_event(event_id);
  if (!event) return [404, {ok: false, error: "no-such-event"}];
  var tail = matched[2] || "", leaf = matched[3];
  if (!tail) return [200, for_audience(event, who)];
  if (tail === "changes" && !leaf) return [200, {ok: true,
    changes: changes_for_audience(changes_since(event_id, Number(matched[4] || 0)), who)}];
  if (tail === "brief" && !leaf) return [200, brief(for_audience(event, who), who)];
  if (tail === "daysheet" && !leaf) return who.role === "dj" ?
    [200, {ok: true, kind: "text/html", text: html_sheet(event)}] :
    [403, {ok: false, error: "not-allowed"}];
  if (tail === "daysheet.csv" && !leaf) return who.role === "dj" ?
    [200, {ok: true, kind: "text/csv", text: csv_sheet(event)}] :
    [403, {ok: false, error: "not-allowed"}];
  if (tail === "save" && !leaf) return save(event_id, who.person_id, who.role, body);
  if (tail === "resolve" && !leaf) return resolve(event_id, who.person_id, who.role,
    body.field, body.take, body.submission_id || "");
  if (tail === "open-items" && leaf) return set_open_item(event_id, who.person_id,
    who.role, leaf, !!body.resolved, body.answer || "", body.submission_id || "");
  return [404, {ok: false, error: "no-such-door"}];
}

function setup() {
  var properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty("FOLDER_ID")) {
    var folder = ensure_folder("Savvy Sounds - corporate prep");
    properties.setProperty("FOLDER_ID", folder.getId());
  }
  var token = access("dj", {}).token;
  Logger.log("Your pass for the view: " + token);
  return token;
}

function doPost(e) {
  var request;
  try { request = JSON.parse(e && e.postData && e.postData.contents); }
  catch (problem) { request = null; }
  var answer;
  if (!request || typeof request.door !== "string") {
    answer = {status: 404, ok: false, error: "no-such-door"};
  } else {
    try {
      var result = route(request.door, access("lookup", {token: request.token}), request.body || {});
      answer = Object.assign({status: result[0]}, result[1]);
    } catch (problem) {
      if (/LockService|lock|timed out|busy/i.test(String(problem && problem.message || problem))) {
        answer = {status: 503, ok: false, error: "busy"};
      } else {
        answer = {status: 500, ok: false, error: "server-problem"};
      }
    }
  }
  return ContentService.createTextOutput(JSON.stringify(answer)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput("This is the prep home. There is nothing to see here; your link opens the page.")
    .setMimeType(ContentService.MimeType.TEXT);
}
