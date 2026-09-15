"""The printable day sheet, and the one place a CSV is written.

Reads an event record; writes nothing.  Every word a client typed is printed
exactly as they typed it — the pronunciation note especially — and escaped so
a stray angle bracket cannot become markup.

A CSV cell that starts with =, +, - or @ (or a tab or a carriage return) runs
as a formula the moment the file is opened in Numbers or Excel, so every such
cell leaves here behind a single quote.  This is the only CSV writer here.
"""

import csv
import html
import io
from datetime import datetime, timezone

import rules

FORMULA_STARTS = ("=", "+", "-", "@", "\t", "\r")

CSS = """
:root { color-scheme: light; }
body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
       margin: 0; padding: 20px; color: #141414; background: #fff; }
.wrap { max-width: 780px; margin: 0 auto; }
h1 { font-size: 24px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 26px 0 8px; border-bottom: 2px solid #141414; padding-bottom: 4px; }
.built { font-size: 12px; color: #555; margin: 0 0 2px; }
.zone { font-size: 13px; font-weight: 600; margin: 8px 0 0; }
table { border-collapse: collapse; width: 100%; margin: 6px 0 0; }
th, td { text-align: left; vertical-align: top; padding: 6px 8px 6px 0; border-bottom: 1px solid #ddd; }
th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: #555; }
.time { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600; }
.cue { background: #f4f1ea; border-left: 4px solid #141414; padding: 10px 12px; margin: 10px 0; }
.cue .words { font-size: 16px; font-weight: 600; }
.say { font-size: 15px; }
ul { margin: 6px 0; padding-left: 20px; }
li { margin: 3px 0; }
.none { color: #666; font-style: italic; }
@media print { body { padding: 0; } h2 { page-break-after: avoid; } .cue { page-break-inside: avoid; } }
@media (max-width: 420px) { body { padding: 14px; } h1 { font-size: 20px; } }
"""


def _e(text):
    return html.escape("" if text is None else str(text), quote=True)


def _answer(event, qid):
    return (event.get("answers") or {}).get(qid) or {}


def _value(event, qid):
    answer = _answer(event, qid)
    return answer.get("value") if answer.get("state") == "confirmed" else None


def _as_list(value):
    if value is None:
        return []
    if isinstance(value, list):
        return [str(v) for v in value if str(v).strip()]
    return [str(value)] if str(value).strip() else []


def _event_name(event):
    return _value(event, "event_name") or _value(event, "company") or event["event_id"]


def _mac_zone():
    return datetime.now().astimezone().tzname() or "this Mac's zone"


def _times(event):
    rows = []
    for moment in rules.placed(event.get("moments") or []):
        when = moment.get("start") or ""
        if moment.get("end"):
            when += "–" + moment["end"]
        rows.append({
            "moment_id": moment["moment_id"],
            "when": when,
            "date": moment.get("date") or "",
            "label": moment.get("label") or moment.get("kind"),
            "room": moment.get("room") or "",
            "minutes": rules.span_min(moment),
            "music_owner": moment.get("music_owner") or "",
            "cue_owner": moment.get("cue_owner") or "",
            "cue_text": moment.get("cue_text") or "",
            "pronunciation": moment.get("pronunciation") or "",
            "approval": moment.get("approval") or "draft",
        })
    return rows


def _open_items(event):
    return [i for i in (event.get("open_items") or [])
            if i.get("active", True) and not i.get("resolved")]


def _pool(event, moment):
    """What Miles pulls from for this part of the night."""
    asked = _as_list(_value(event, "requests"))
    if moment["moment_id"].endswith("dancing") or moment["label"].lower().startswith("danc"):
        asked = asked + _as_list(_value(event, "must_plays"))
        asked += _as_list(_value(event, "dancing_opener"))
        asked += _as_list(_value(event, "dancing_closer"))
    if "award" in (moment["label"] or "").lower():
        asked = asked + _as_list(_value(event, "awards_walkon"))
    keep_off = _as_list(_value(event, "dnp_songs")) + _as_list(_value(event, "dnp_themes"))
    return {"styles": _as_list(_value(event, "styles")), "asked": asked,
            "keep_off": keep_off}


def _ul(items, empty="Nothing written down."):
    if not items:
        return '<p class="none">%s</p>' % _e(empty)
    return "<ul>" + "".join("<li>%s</li>" % _e(i) for i in items) + "</ul>"


def html_sheet(event, built_at=None):
    """The printable sheet.  Everything on one page, readable on a phone."""
    built = built_at or datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    zone = event.get("tz") or "unknown"
    times = _times(event)
    people = event.get("people") or []
    items = _open_items(event)
    sources = event.get("sources") or []
    out = [
        "<title>Day sheet — %s</title>" % _e(_event_name(event)),
        "<style>%s</style>" % CSS,
        '<div class="wrap">',
        "<h1>%s</h1>" % _e(_event_name(event)),
        '<p class="built">Printed %s · this is a snapshot of revision %s, not a live page.</p>'
        % (_e(built), _e(event.get("revision"))),
        '<p class="built">Sources: %s</p>'
        % (_e(", ".join(s.get("name", "?") for s in sources)) if sources
           else '<span class="none">none attached yet</span>'),
        '<p class="zone">All times are %s time.%s</p>'
        % (_e(zone), "" if zone == _mac_zone() else
           " That is not the zone this Mac is set to, so read the clock, not your watch."),
    ]

    out.append("<h2>Key times</h2>")
    if times:
        out.append("<table><tr><th>Time</th><th>What</th><th>Room</th>"
                   "<th>Minutes</th><th>Music</th></tr>")
        for row in times:
            out.append("<tr><td class='time'>%s</td><td>%s</td><td>%s</td>"
                       "<td>%s</td><td>%s</td></tr>"
                       % (_e(row["when"]), _e(row["label"]), _e(row["room"]),
                          _e(row["minutes"]),
                          "Miles" if row["music_owner"] == "dj" else _e(row["music_owner"] or "—")))
        out.append("</table>")
    else:
        out.append('<p class="none">No times confirmed yet.</p>')

    out.append("<h2>Cues — say it exactly like this</h2>")
    cued = [r for r in times if r["cue_text"].strip() or r["pronunciation"].strip()]
    if cued:
        for row in cued:
            out.append('<div class="cue"><p class="time">%s — %s</p>'
                       % (_e(row["when"]), _e(row["label"])))
            if row["cue_text"].strip():
                out.append('<p class="words">%s</p>' % _e(row["cue_text"]))
            if row["pronunciation"].strip():
                out.append('<p class="say">Say it: %s</p>' % _e(row["pronunciation"]))
            out.append("<p>Cue called by: %s</p></div>" % _e(row["cue_owner"] or "not decided"))
    else:
        out.append('<p class="none">No cue words written down yet.</p>')
    pron = _value(event, "awards_pronunciation")
    if pron:
        out.append('<div class="cue"><p class="say">%s</p></div>' % _e(pron))

    out.append("<h2>Must know before the doors open</h2>")
    out.append(_ul(["%s (%s)" % (i["question"], i["owner"]) for i in items],
                   "Nothing open."))

    out.append("<h2>Miles's own jobs</h2>")
    mine = [i["question"] for i in items if i.get("owner") == "dj"]
    mine += ["%s — %s minutes of music" % (r["label"], r["minutes"])
             for r in times if r["music_owner"] == "dj"]
    out.append(_ul(mine, "Nothing on Miles's list."))

    out.append("<h2>Load-in and access</h2>")
    out.append(_ul([v for v in (_value(event, "access_constraints"),
                                _value(event, "sound_constraints"),
                                _value(event, "live_act")) if v],
                   "Nothing written down — ask the venue."))

    out.append("<h2>Who to find</h2>")
    if people:
        out.append("<table><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th></tr>")
        for person in people:
            out.append("<tr><td>%s</td><td>%s</td><td>%s</td><td>%s</td></tr>"
                       % (_e(person.get("name")), _e(person.get("role")),
                          _e(person.get("email")), _e(person.get("phone"))))
        out.append("</table>")
    else:
        out.append('<p class="none">Nobody listed yet.</p>')

    out.append("<h2>What to pull from</h2>")
    for row in times:
        pool = _pool(event, row)
        out.append("<h3>%s</h3>" % _e(row["label"]))
        out.append("<p><strong>Styles:</strong></p>" + _ul(pool["styles"], "No styles given."))
        out.append("<p><strong>Asked for:</strong></p>" + _ul(pool["asked"], "Nothing asked for."))
        out.append("<p><strong>Keep off:</strong></p>" + _ul(pool["keep_off"], "Nothing excluded."))
    out.append("</div>")
    return "\n".join(out)


def _tame(cell):
    """A cell that would run as a formula leaves behind a single quote."""
    text = "" if cell is None else str(cell)
    if text[:1] in FORMULA_STARTS:
        return "'" + text
    return text


def csv_sheet(event):
    """Key times, contacts and open items, safe to open in a spreadsheet."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([_tame(c) for c in
                     ["Savvy Sounds day sheet", _event_name(event),
                      "revision", event.get("revision"), "zone", event.get("tz")]])
    writer.writerow([])
    writer.writerow(["Time", "What", "Room", "Minutes", "Music", "Cue words"])
    for row in _times(event):
        writer.writerow([_tame(c) for c in
                         [row["when"], row["label"], row["room"], row["minutes"],
                          "Miles" if row["music_owner"] == "dj" else row["music_owner"],
                          row["cue_text"]]])
    writer.writerow([])
    writer.writerow(["Name", "Role", "Email", "Phone"])
    for person in event.get("people") or []:
        writer.writerow([_tame(c) for c in
                         [person.get("name"), person.get("role"),
                          person.get("email"), person.get("phone")]])
    writer.writerow([])
    writer.writerow(["Still open", "Who owns it", "Why it matters"])
    for item in _open_items(event):
        writer.writerow([_tame(c) for c in
                         [item.get("question"), item.get("owner"), item.get("why")]])
    return buffer.getvalue()
