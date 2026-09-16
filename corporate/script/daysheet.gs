/* Printable day sheet and the one CSV writer. Reads only. */

var FORMULA_STARTS = ["=", "+", "-", "@", "\t", "\r"];
var CSS = "\n:root { color-scheme: light; }\nbody { font: 15px/1.5 -apple-system, BlinkMacSystemFont, \"Segoe UI\", Helvetica, Arial, sans-serif; margin: 0; padding: 20px; color: #141414; background: #fff; }\n.wrap { max-width: 780px; margin: 0 auto; }\nh1 { font-size: 24px; margin: 0 0 4px; }\nh2 { font-size: 17px; margin: 26px 0 8px; border-bottom: 2px solid #141414; padding-bottom: 4px; }\n.built { font-size: 12px; color: #555; margin: 0 0 2px; }\n.zone { font-size: 13px; font-weight: 600; margin: 8px 0 0; }\ntable { border-collapse: collapse; width: 100%; margin: 6px 0 0; }\nth, td { text-align: left; vertical-align: top; padding: 6px 8px 6px 0; border-bottom: 1px solid #ddd; }\nth { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #555; }\n.time { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }\n.cue { background: #f4f1ea; border-left: 4px solid #141414; padding: 10px 12px; margin: 10px 0; }\n.cue .words { font-size: 16px; font-weight: 600; }\n.say { font-size: 15px; }\nul { margin: 6px 0; padding-left: 20px; }\nli { margin: 3px 0; }\n.none { color: #666; font-style: italic; }\n@media print { body { padding: 0; } h2 { page-break-after: avoid; } .cue { page-break-inside: avoid; } }\n@media (max-width: 420px) { body { padding: 14px; } h1 { font-size: 20px; } }\n";

function _e(text) {
  return String(text === null || text === undefined ? "" : text).replace(/[&<>"']/g, function (character) {
    return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#x27;"}[character];
  });
}
function _answer(event, qid) { return (event.answers || {})[qid] || {}; }
function _value(event, qid) { var answer = _answer(event, qid); return answer.state === "confirmed" ? answer.value : null; }
function _as_list(value) {
  if (value === null || value === undefined) return [];
  var values = Array.isArray(value) ? value : [value];
  return values.map(String).filter(function (item) { return item.trim(); });
}
function _mac_zone() { return Session.getScriptTimeZone(); }
function _zone_words(tz) {
  // The plain words for a zone are questions.json's; a zone it does not list
  // is still said as a place, never as a file name.
  var question = (load_questions().questions || []).filter(function (q) { return q.id === "tz"; })[0] || {};
  return (question.option_labels || {})[tz] || String(tz || "").split("/").pop().replace(/_/g, " ") + " time";
}
function _times(event) {
  return placed(event.moments || []).map(function (moment) {
    var start = moment.start || "", when = clock(start);
    if (moment.end && moment.end !== start) {
      when += "\u2013" + clock(moment.end);
      if (moment.end < start) when += " (into the next day)";
    }
    return {moment_id: moment.moment_id, when: when, date: moment.date || "",
      label: moment.label || moment.kind, room: moment.room || "", minutes: span_min(moment),
      music_owner: moment.music_owner || "", cue_owner: moment.cue_owner || "",
      cue_text: moment.cue_text || "", pronunciation: moment.pronunciation || "",
      approval: moment.approval || "draft"};
  });
}
function _open_items(event) {
  return (event.open_items || []).filter(function (item) { return item.active !== false && !item.resolved; });
}
function _pool(event, moment) {
  var asked = _as_list(_value(event, "requests"));
  if (/dancing$/.test(moment.moment_id) || /^danc/i.test(moment.label)) {
    asked = asked.concat(_as_list(_value(event, "must_plays")),
      _as_list(_value(event, "dancing_opener")), _as_list(_value(event, "dancing_closer")));
  }
  if (/award/i.test(moment.label || "")) asked = asked.concat(_as_list(_value(event, "awards_walkon")));
  return {styles: _as_list(_value(event, "styles")), asked: asked,
    keep_off: _as_list(_value(event, "dnp_songs")).concat(_as_list(_value(event, "dnp_themes")))};
}
function _ul(items, empty) {
  if (!items.length) return '<p class="none">' + _e(empty || "Nothing written down.") + "</p>";
  return "<ul>" + items.map(function (item) { return "<li>" + _e(item) + "</li>"; }).join("") + "</ul>";
}

function html_sheet(event, built_at) {
  var built = built_at || new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";
  var zone = event.tz || "", times = _times(event), people = event.people || [];
  var items = _open_items(event), sources = event.sources || [], name = _event_name(event);
  var out = ["<title>Day sheet \u2014 " + _e(name) + "</title>", "<style>" + CSS + "</style>",
    '<div class="wrap">', "<h1>" + _e(name) + "</h1>",
    '<p class="built">Printed ' + _e(built) + " \u00b7 this is a snapshot of revision " + _e(event.revision) + ", not a live page.</p>",
    '<p class="built">Sources: ' + (sources.length ? _e(sources.map(function (source) { return source.name || "?"; }).join(", ")) : '<span class="none">none attached yet</span>') + "</p>",
    '<p class="zone">All times are ' + _e(zone ? _zone_words(zone) : "in a zone nobody has written down yet") + "." + (!zone || zone === _mac_zone() ? "" : " That is not the zone this Mac is set to, so read the clock, not your watch.") + "</p>",
    "<h2>Key times</h2>"];
  if (times.length) {
    out.push("<table><tr><th>Time</th><th>What</th><th>Room</th><th>Minutes</th><th>Music</th></tr>");
    times.forEach(function (row) { out.push("<tr><td class='time'>" + _e(row.when) + "</td><td>" + _e(row.label) + "</td><td>" + _e(row.room) + "</td><td>" + _e(row.minutes) + "</td><td>" + (row.music_owner === "dj" ? "Miles" : _e(row.music_owner || "\u2014")) + "</td></tr>"); });
    out.push("</table>");
  } else out.push('<p class="none">No times confirmed yet.</p>');
  out.push("<h2>Cues \u2014 say it exactly like this</h2>");
  var cued = times.filter(function (row) { return row.cue_text.trim() || row.pronunciation.trim(); });
  if (cued.length) cued.forEach(function (row) {
    out.push('<div class="cue"><p class="time">' + _e(row.when) + " \u2014 " + _e(row.label) + "</p>");
    if (row.cue_text.trim()) out.push('<p class="words">' + _e(row.cue_text) + "</p>");
    if (row.pronunciation.trim()) out.push('<p class="say">Say it: ' + _e(row.pronunciation) + "</p>");
    out.push("<p>Cue called by: " + _e(row.cue_owner || "not decided") + "</p></div>");
  }); else out.push('<p class="none">No cue words written down yet.</p>');
  var pron = _value(event, "awards_pronunciation");
  if (pron) out.push('<div class="cue"><p class="say">' + _e(pron) + "</p></div>");
  out.push("<h2>Must know before the doors open</h2>", _ul(items.map(function (item) { return item.question + " (" + item.owner + ")"; }), "Nothing open."));
  var mine = items.filter(function (item) { return item.owner === "dj"; }).map(function (item) { return item.question; });
  mine = mine.concat(times.filter(function (row) { return row.music_owner === "dj"; }).map(function (row) { return row.label + " \u2014 " + row.minutes + " minutes of music"; }));
  out.push("<h2>Miles's own jobs</h2>", _ul(mine, "Nothing on Miles's list."), "<h2>Load-in and access</h2>",
    _ul([_value(event, "access_constraints"), _value(event, "sound_constraints"), _value(event, "live_act")].filter(Boolean), "Nothing written down \u2014 ask the venue."), "<h2>Who to find</h2>");
  if (people.length) {
    out.push("<table><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr>");
    people.forEach(function (person) { out.push("<tr><td>" + _e(person.name) + "</td><td>" + _e(person.role) + "</td><td>" + _e(person.email) + "</td><td>" + _e(person.phone) + "</td></tr>"); });
    out.push("</table>");
  } else out.push('<p class="none">Nobody listed yet.</p>');
  out.push("<h2>What to pull from</h2>");
  times.forEach(function (row) { var pool = _pool(event, row); out.push("<h3>" + _e(row.label) + "</h3>", "<p><strong>Styles:</strong></p>" + _ul(pool.styles, "No styles given."), "<p><strong>Asked for:</strong></p>" + _ul(pool.asked, "Nothing asked for."), "<p><strong>Keep off:</strong></p>" + _ul(pool.keep_off, "Nothing excluded.")); });
  out.push("</div>"); return out.join("\n");
}

function _tame(cell) {
  var text = cell === null || cell === undefined ? "" : String(cell);
  return FORMULA_STARTS.indexOf(text.slice(0, 1)) !== -1 ? "'" + text : text;
}
function _csv_cell(cell) {
  var text = _tame(cell);
  return /[,"\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
function csv_sheet(event) {
  var rows = [["Savvy Sounds day sheet", _event_name(event), "revision", event.revision, "zone", _zone_words(event.tz)], [],
    ["Time", "What", "Room", "Minutes", "Music", "Cue words"]];
  _times(event).forEach(function (row) { rows.push([row.when, row.label, row.room, row.minutes,
    row.music_owner === "dj" ? "Miles" : row.music_owner, row.cue_text]); });
  rows.push([], ["Name", "Role", "Email", "Phone"]);
  (event.people || []).forEach(function (person) { rows.push([person.name, person.role, person.email, person.phone]); });
  rows.push([], ["Still open", "Who owns it", "Why it matters"]);
  _open_items(event).forEach(function (item) { rows.push([item.question, item.owner, item.why]); });
  return rows.map(function (row) { return row.map(_csv_cell).join(","); }).join("\r\n") + "\r\n";
}
