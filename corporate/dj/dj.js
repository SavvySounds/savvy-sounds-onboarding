/* Miles's own view of the corporate events.

   Everything on this page is read live from the doors; nothing is remembered
   between visits except the pass, and that stays in this window only.

   Two habits hold all the way through:

   * every word that came from somebody else — a client's answer, a cue, a
     name, a note — reaches the screen as a text node and never as markup.
     There is no innerHTML in this file, on purpose.
   * the words that decide who owns what are the brain's words.  The three
     tables below are copied from rules.py, and proof/walk-dj.mjs reads both
     files and fails if they ever drift apart.  A screen that invents its own
     vocabulary is how two halves of one tool start answering different
     questions.
*/

(function () {
  'use strict';

  var PASS_KEY = 'savvy-dj-pass';
  var room = document.getElementById('room');
  var sayBox = document.getElementById('say');

  // --- the brain's words (pinned against rules.py by the walk) -------------
  var OWNER_ROLE = {
    direction: 'approver', running_order: 'planner', production: 'production',
    prep: 'dj', event: 'approver'
  };
  var OWNER_FALLBACK = { running_order: 'approver', production: 'approver' };
  var MOMENT_FIELD_OWNER = {
    date: 'running_order', start: 'running_order', end: 'running_order',
    duration_min: 'running_order', label: 'running_order',
    kind: 'running_order', approval: 'running_order',
    active: 'running_order', purpose: 'running_order',
    room: 'running_order', order: 'running_order',
    cue_text: 'running_order', pronunciation: 'running_order',
    cue_owner: 'running_order',
    music_owner: 'prep'
  };

  // --- plain words for the states the brain keeps --------------------------
  var STAGE_WORDS = {
    draft: 'not sent yet', waiting: 'waiting on answers',
    preparing: 'getting it ready', review: 'ready for a look',
    ready: 'ready', completed: 'done'
  };
  var ROLE_WORDS = {
    approver: 'the one who says yes', planner: 'the planner',
    production: 'the venue side', contact: 'the day-of contact', dj: 'you'
  };
  var APPROVAL_WORDS = {
    draft: 'not settled', proposed: 'proposed', confirmed: 'settled'
  };
  var KIND_WORDS = {
    arrival: 'arrival', networking: 'networking', dinner: 'dinner',
    presentations: 'presentations', awards: 'awards', dancing: 'dancing',
    closing: 'closing', custom: 'part of the night'
  };
  var STATE_WORDS = {
    unknown: 'not sure yet', miles: 'you are to suggest this',
    none: 'none', blank: 'not answered'
  };
  var WHY = {
    'link-expired': 'That pass does not open anything. Check it and paste it again.',
    'not-allowed': 'That one is not yours to do.',
    'not-your-event': 'That pass does not open this event.',
    'no-such-event': 'That event is not here.',
    'no-such-item': 'That question is not on this event any more.',
    'no-such-door': 'The page asked for something this server does not have.',
    'no-such-page': 'The page asked for something this server does not have.',
    'bad-host': 'That did not reach your Mac the way it had to. Reload the page.',
    'bad-origin': 'That did not reach your Mac the way it had to. Reload the page.',
    'bad-json': 'The page sent something the server could not read. Nothing was saved.',
    'conflict': 'Somebody changed that while you were looking. Reload to see where it is now.',
    'invalid': 'Something in that is not right yet.',
    'not-your-decision': 'That one is not yours to settle.',
    'server-problem': 'The server tripped over that. Nothing was saved.',
    'no-answer': 'The server did not answer. Nothing was saved.'
  };
  // How many change lines the screen shows before it offers the rest.
  var LATEST = 12;

  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
                'August', 'September', 'October', 'November', 'December'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday',
              'Friday', 'Saturday'];

  var state = {
    pass: '', me: null, questions: null, events: [], event: null,
    changes: [], booking: null, draft: {}, problems: []
  };

  // ----------------------------------------------------------------- making

  function el(tag, attrs, kids) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      var value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.appendChild(document.createTextNode(String(value)));
      else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, String(value));
    });
    var list = Array.isArray(kids) ? kids : (kids === undefined || kids === null ? [] : [kids]);
    list.forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) return;
      node.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return node;
  }

  function fill(node, kids) {
    while (node.firstChild) node.removeChild(node.firstChild);
    (Array.isArray(kids) ? kids : [kids]).forEach(function (kid) {
      if (kid) node.appendChild(kid);
    });
    return node;
  }

  function say(words, bad) {
    sayBox.className = 'say' + (bad ? ' bad' : '');
    fill(sayBox, words ? [document.createTextNode(words)] : []);
    // The screen is rebuilt after every action, which throws the keyboard back
    // to the top of the document.  Whoever is on the keyboard lands on the
    // sentence that says what just happened instead.
    state.refocus = Boolean(words);
  }

  function landTheKeyboard() {
    if (!state.refocus) return;
    state.refocus = false;
    try { sayBox.focus(); } catch (no) { /* nothing to land on */ }
  }

  function expired(answer) {
    // A pass that has stopped working is not a failed action, it is a closed
    // door: leaving him on a screen he can no longer refresh would be a lie.
    if (((answer.body || {}).error) !== 'link-expired') return false;
    state.pass = '';
    state.event = null;
    try { window.sessionStorage.removeItem(PASS_KEY); } catch (no) { /* private window */ }
    gate({ words: why(answer), word: 'link-expired' });
    return true;
  }

  function why(answer) {
    var body = answer.body || {};
    if (body.errors && body.errors.length) {
      return body.errors.map(function (e) { return e.message; }).join(' ');
    }
    return WHY[body.error] || 'That did not go through. Nothing was saved.';
  }

  // ------------------------------------------------------------------ doors

  function door(path, options) {
    options = options || {};
    var headers = { 'X-Access-Token': state.pass };
    var sending = options.body !== undefined;
    if (sending) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: sending ? 'POST' : 'GET',
      headers: headers,
      body: sending ? JSON.stringify(options.body) : undefined,
      cache: 'no-store'
    }).then(function (res) {
      var kind = res.headers.get('Content-Type') || '';
      if (options.raw) {
        return res.text().then(function (text) {
          return { code: res.status, body: text, kind: kind };
        });
      }
      if (kind.indexOf('json') < 0) {
        return { code: res.status, body: { ok: false, error: 'no-such-door' } };
      }
      return res.json().then(function (body) {
        return { code: res.status, body: body };
      });
    }).catch(function () {
      return { code: 0, body: { ok: false, error: 'no-answer' } };
    });
  }

  // ------------------------------------------------------------------ words

  function prettyDate(ymd) {
    // The date is already wall-clock in the event's own zone, so it is read
    // out of its own three numbers.  Handing it to a clock would move it.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return String(ymd || '');
    var bits = ymd.split('-').map(Number);
    var day = DAYS[new Date(Date.UTC(bits[0], bits[1] - 1, bits[2])).getUTCDay()];
    return day + ' ' + bits[2] + ' ' + MONTHS[bits[1] - 1] + ' ' + bits[0];
  }

  function macZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone; }
    catch (no) { return ''; }
  }

  function zoneWords(tz) {
    if (!tz) return '';
    var tail = String(tz).split('/').pop().replace(/_/g, ' ');
    return tail + ' time';
  }

  function foreignZone(tz) {
    return tz && tz !== macZone();
  }

  function zoneNote(tz) {
    return foreignZone(tz) ? zoneWords(tz) : '';
  }

  function lengthWords(minutes) {
    minutes = Number(minutes || 0);
    if (!minutes) return '';
    var hours = Math.floor(minutes / 60), rest = minutes % 60;
    if (!hours) return rest + ' min';
    return hours + (hours === 1 ? ' hr' : ' hrs') + (rest ? ' ' + rest : '');
  }

  function whenWords(iso, tz) {
    if (!iso) return '';
    var when = new Date(iso);
    if (isNaN(when.getTime())) return String(iso);
    try {
      var day = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz || undefined, day: 'numeric', month: 'short'
      }).format(when);
      var parts = {};
      new Intl.DateTimeFormat('en-GB', {
        timeZone: tz || undefined, hour: '2-digit', minute: '2-digit', hour12: false
      }).formatToParts(when).forEach(function (part) { parts[part.type] = part.value; });
      return day + ', ' + clock((parts.hour === '24' ? '00' : parts.hour) + ':' + parts.minute);
    } catch (no) {
      return when.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function asWords(value) {
    if (value === null || value === undefined) return '';
    if (Array.isArray(value)) return value.join(', ');
    // Never JSON.stringify onto his screen: a record he cannot read is worse
    // than the same thing said badly in words.
    if (typeof value === 'object') return sideWords(value);
    return String(value);
  }

  function clock(hhmm) {
    var bits = String(hhmm).split(':');
    var hour = Number(bits[0]);
    if (bits.length < 2 || isNaN(hour)) return String(hhmm);
    var suffix = hour < 12 ? 'AM' : 'PM';
    var shown = hour % 12;
    return (shown === 0 ? 12 : shown) + ':' + bits[1] + ' ' + suffix;
  }

  function fieldValue(field, value) {
    if (value === null || value === undefined) return '';
    return /\.(start|end)$/.test(String(field || '')) ? clock(value) : asWords(value);
  }

  function changeWords(line, event) {
    // The practice events are loaded rather than filled in, and the word the
    // brain writes for that is not one he should ever read.
    if (line.origin === 'seed' && line.field === 'event') {
      return { what: 'this practice booking was loaded', before: '', after: '' };
    }
    return {
      what: fieldWords(event, line.field),
      before: shorten(fieldValue(line.field, line.before), 60),
      after: shorten(fieldValue(line.field, line.after), 60)
    };
  }

  function sideWords(side) {
    // A change line carries whatever the field held, and an answer holds a
    // little record rather than a word.  Nobody reads {"value":null,...}.
    if (side === null || side === undefined) return '';
    if (Array.isArray(side)) {
      if (side.length && typeof side[0] === 'object') {
        return side.length + (side.length === 1 ? ' person' : ' people');
      }
      return side.join(', ');
    }
    if (typeof side === 'object') {
      if ('state' in side || 'value' in side) {
        if (side.state && side.state !== 'confirmed') {
          return STATE_WORDS[side.state] || side.state;
        }
        return asWords(side.value);
      }
      return Object.keys(side).map(function (key) {
        return key + ' ' + asWords(side[key]);
      }).join(', ');
    }
    return String(side);
  }

  function shorten(text, most) {
    text = asWords(text);
    return text.length > most ? text.slice(0, most - 1) + '…' : text;
  }

  function firstName(name) {
    return String(name || '').split(' ')[0];
  }

  function personById(event, personId) {
    var found = null;
    (event.people || []).forEach(function (person) {
      if (person.person_id === personId) found = person;
    });
    if (found) return found;
    if (personId === 'p_miles') return { person_id: 'p_miles', name: 'Miles', role: 'dj' };
    return null;
  }

  function personByRole(event, role) {
    var found = null;
    (event.people || []).forEach(function (person) {
      if (!found && person.role === role) found = person;
    });
    return found;
  }

  function nameOf(event, personId) {
    var person = personById(event, personId);
    return person ? person.name : (personId || 'somebody');
  }

  function questionById(qid) {
    var found = null;
    ((state.questions || {}).questions || []).forEach(function (question) {
      if (question.id === qid) found = question;
    });
    return found;
  }

  function momentById(event, mid) {
    var found = null;
    (event.moments || []).forEach(function (moment) {
      if (moment.moment_id === mid) found = moment;
    });
    return found;
  }

  function groupOf(field) {
    if (field.indexOf('answers.') === 0) {
      var question = questionById(field.slice(8));
      return question ? (question.owner || 'event') : 'event';
    }
    if (field.indexOf('moments.') === 0) {
      var attr = field.split('.')[2] || 'date';
      return MOMENT_FIELD_OWNER[attr] || 'running_order';
    }
    return 'event';
  }

  function decidingRole(event, group) {
    var role = OWNER_ROLE[group] || 'approver';
    var held = (event.people || []).map(function (person) { return person.role; });
    if (held.indexOf(role) < 0 && OWNER_FALLBACK[group]) return OWNER_FALLBACK[group];
    return role;
  }

  function decidingWords(event, field) {
    var role = decidingRole(event, groupOf(field));
    if (role === 'dj') return 'Yours to settle.';
    var person = personByRole(event, role);
    return person
      ? (person.name + ' owns this part of the night (' + ROLE_WORDS[role] + ').')
      : ('Nobody on this event is ' + ROLE_WORDS[role] + ', so it falls to you.');
  }

  function fieldWords(event, field) {
    field = String(field || '');
    if (field.indexOf('answers.') === 0) {
      var question = questionById(field.slice(8));
      return question ? question.label : field.slice(8);
    }
    if (field.indexOf('moments.') === 0) {
      var bits = field.split('.');
      var moment = momentById(event, bits[1]);
      var label = moment ? (moment.label || bits[1]) : bits[1];
      var attr = { start: 'start time', end: 'finish time', date: 'date',
                   cue_text: 'cue words', pronunciation: 'how to say it',
                   duration_min: 'how long it runs', room: 'room',
                   active: 'on or off', approval: 'settled or not',
                   label: 'name', kind: 'what it is', purpose: 'what it is for',
                   cue_owner: 'who calls the cue',
                   music_owner: 'who brings the music' }[bits[2]] || bits[2];
      return label + ' — ' + attr;
    }
    if (field.indexOf('open_items.') === 0) return 'an open question';
    if (field === 'people') return 'who is on the event';
    if (field === 'event') return 'the booking';
    return field;
  }

  // ------------------------------------------------------------ the copying

  function copyButton(text, what) {
    // A clipboard the browser will not open is not a failure to hide: his
    // dictation overwrites the clipboard all day, and a "Copied" that did not
    // happen is worse here than anywhere.  Refused means the words are
    // selected instead, and the button says so.
    // No tabindex: this is the words beside the button, not a control.  With
    // one it added a dead keyboard stop in front of every Copy, and reaching
    // the last contact took thirteen presses instead of six.
    var shown = el('code', { text: text });
    var button = el('button', {
      class: 'plain', type: 'button',
      'aria-label': 'copy ' + what,
      text: 'Copy',
      onclick: function () {
        var restore = function () {
          window.setTimeout(function () { fill(button, [document.createTextNode('Copy')]); }, 2200);
        };
        var refused = function () {
          try {
            var range = document.createRange();
            range.selectNodeContents(shown);
            var picked = window.getSelection();
            picked.removeAllRanges();
            picked.addRange(range);
            shown.scrollIntoView({ block: 'nearest' });
          } catch (no) { /* nothing to select is still not a false Copied */ }
          fill(button, [document.createTextNode('Press ⌘C')]);
          restore();
        };
        try {
          if (!navigator.clipboard || !navigator.clipboard.writeText) return refused();
          navigator.clipboard.writeText(text).then(function () {
            fill(button, [document.createTextNode('Copied')]);
            restore();
          }, refused);
        } catch (no) { refused(); }
      }
    });
    return { shown: shown, button: button };
  }

  function copyLine(whoWords, text, what) {
    var pieces = copyButton(text, what);
    return el('p', { class: 'link-line' }, [
      el('span', { class: 'who', text: whoWords }),
      pieces.shown, pieces.button
    ]);
  }

  // ------------------------------------------------------------------- gate

  function gate(problem) {
    var box = el('input', {
      type: 'password', id: 'pass', autocomplete: 'off',
      autocapitalize: 'off', spellcheck: 'false'
    });
    var show = el('button', {
      class: 'plain', type: 'button', text: 'Show it',
      onclick: function () {
        var hidden = box.type === 'password';
        box.type = hidden ? 'text' : 'password';
        fill(show, [document.createTextNode(hidden ? 'Hide it' : 'Show it')]);
      }
    });
    var form = el('form', {
      onsubmit: function (event) {
        event.preventDefault();
        tryPass(box.value.trim());
      }
    }, [
      el('label', { class: 'fld', for: 'pass', text: 'Your pass' }),
      box,
      el('div', { class: 'doing' }, [
        el('button', { class: 'go', type: 'submit', text: 'Open my events' }),
        show
      ])
    ]);
    fill(room, [el('div', { class: 'gate' }, [
      el('h1', { text: 'Savvy Sounds' }),
      el('p', { text: 'Your own view of the corporate bookings. Your pass stays in this window: close it and it is gone.' }),
      form,
      problem ? el('div', { class: 'problem' }, [
        el('p', { text: problem.words }),
        problem.word ? el('p', { class: 'quiet', text: 'the door said: ' + problem.word }) : null
      ]) : null
    ])]);
    box.focus();
  }

  function tryPass(pass) {
    if (!pass) return gate({ words: 'Paste the pass first.' });
    state.pass = pass;
    door('/api/me').then(function (answer) {
      if (answer.code !== 200 || !answer.body.ok) {
        state.pass = '';
        return gate({ words: why(answer), word: (answer.body || {}).error });
      }
      if (answer.body.role !== 'dj') {
        state.pass = '';
        return gate({ words: 'That pass is a client\'s link, not yours. This page is only for you.',
                      word: 'not-allowed' });
      }
      state.me = answer.body;
      try { window.sessionStorage.setItem(PASS_KEY, pass); } catch (no) { /* private window */ }
      say('');
      ensureQuestions().then(function () { go('#/'); });
    });
  }

  // -------------------------------------------------------------- overview

  function masthead(kids) {
    return el('header', { class: 'masthead' }, [
      el('span', { class: 'brand', text: 'Savvy Sounds' }),
      el('span', { class: 'what', text: 'corporate events' }),
      el('span', { class: 'spacer' })
    ].concat(kids || []));
  }

  function count(many) {
    return many ? ' (' + many + ')' : '';
  }

  function countPill(count, one, many, none, kind) {
    if (!count) return el('span', { class: 'pill none', text: none });
    return el('span', { class: 'pill ' + (kind || '') }, [
      el('b', { class: 'num', text: String(count) }),
      document.createTextNode(' ' + (count === 1 ? one : many))
    ]);
  }

  function overview() {
    var rows = state.events.slice().sort(function (a, b) {
      if (b.needs_me !== a.needs_me) return b.needs_me - a.needs_me;
      if (b.changed_since_seen !== a.changed_since_seen) {
        return b.changed_since_seen - a.changed_since_seen;
      }
      return String(a.date).localeCompare(String(b.date));
    });

    var list = rows.map(function (row) {
      var when = row.date ? prettyDate(row.date) : 'no date yet';
      var zone = zoneNote(row.tz);
      return el('section', { class: 'block' + (row.needs_me ? ' needs' : '') }, [
        // The heading stays a heading: a screen reader that lists the page's
        // headings has to find the events, so the button goes INSIDE it.
        el('h3', {}, [
          el('button', {
            class: 'event-open', type: 'button', text: row.name,
            onclick: function () { go('#/e/' + row.event_id); }
          })
        ]),
        el('p', { class: 'quiet', text: [row.company, when + (zone ? ' · ' + zone : '')]
          .filter(Boolean).join(' · ') }),
        el('div', { class: 'pills' }, [
          el('span', { class: 'pill stage', text: STAGE_WORDS[row.stage] || row.stage }),
          countPill(row.needs_me, 'needs you', 'need you', 'nothing needs you', 'needs'),
          countPill(row.changed_since_seen, 'change since you last looked',
                    'changes since you last looked', 'nothing new since you last looked', 'new'),
          countPill(row.waiting_on_client, 'waiting on the client',
                    'waiting on the client', 'nothing waiting on the client')
        ]),
        el('p', { class: 'next-action', text: row.next_action || '' })
      ]);
    });

    fill(room, [
      masthead([
        el('button', { class: 'go', type: 'button', text: 'Start a booking',
                       onclick: function () { go('#/new'); } })
      ]),
      el('h1', { text: 'What changed, and what needs you' }),
      el('p', { class: 'quiet', text: rows.length
        ? 'The ones that need you are at the top.'
        : 'No bookings yet. Start one and the private links come back here.' })
    ].concat(list));
    landTheKeyboard();
  }

  // --------------------------------------------------------- start a booking

  function bookingForm() {
    var draft = state.draft;
    function field(key, label, kind, extra) {
      var input = el('input', {
        type: kind || 'text', id: 'f-' + key, value: draft[key] || '',
        oninput: function (event) { draft[key] = event.target.value; }
      });
      if (extra) Object.keys(extra).forEach(function (k) { input.setAttribute(k, extra[k]); });
      return el('div', {}, [
        el('label', { class: 'fld', for: 'f-' + key, text: label }),
        input
      ]);
    }

    var zones = ['America/Los_Angeles', 'America/Denver', 'America/Chicago',
                 'America/New_York', 'America/Phoenix', 'America/Anchorage',
                 'Pacific/Honolulu'];
    var mine = macZone();
    if (mine && zones.indexOf(mine) < 0) zones.unshift(mine);
    if (!draft.tz) draft.tz = mine || 'America/Los_Angeles';
    var picker = el('select', {
      id: 'f-tz',
      onchange: function (event) { draft.tz = event.target.value; }
    }, zones.map(function (zone) {
      return el('option', { value: zone, selected: zone === draft.tz,
                            text: zoneWords(zone) + (zone === mine ? ' (yours)' : '') });
    }));

    var people = [
      { key: 'approver', label: 'Who says yes', hint: 'the one who signs it off — needed' },
      { key: 'planner', label: 'The planner', hint: 'runs the room on the night — if there is one' },
      { key: 'production', label: 'The venue side', hint: 'sound, power, load-in — if there is one' },
      { key: 'contact', label: 'The day-of contact', hint: 'who you call on the night — if there is one' }
    ].map(function (who) {
      return el('div', { class: 'row' }, [
        el('h3', { text: who.label }),
        el('p', { class: 'quiet', text: who.hint }),
        el('div', { class: 'fields2' }, [
          field(who.key + '_name', 'Name'),
          field(who.key + '_email', 'Email', 'email')
        ])
      ]);
    });

    var problems = state.problems.length ? el('div', { class: 'problem' }, [
      el('p', { text: 'Not started yet. Nothing was saved:' }),
      el('ul', {}, state.problems.map(function (line) {
        return el('li', { text: line });
      }))
    ]) : null;

    var links = null;
    if (state.booking) {
      links = el('section', { class: 'block' }, [
        el('h2', { text: 'The private links' }),
        el('p', { text: 'Send each person their own. A link opens their page and nobody else\'s.' })
      ].concat(Object.keys(state.booking.links).sort().map(function (role) {
        var person = state.booking.people[role];
        return copyLine((person ? person.name : ROLE_WORDS[role]) + ' · ' + ROLE_WORDS[role],
                        window.location.origin + state.booking.links[role],
                        'the link for ' + (person ? person.name : role));
      })).concat([
        el('div', { class: 'doing' }, [
          el('button', { class: 'go', type: 'button', text: 'Open the booking',
                         onclick: function () { go('#/e/' + state.booking.event_id); } })
        ])
      ]));
    }

    fill(room, [
      masthead([
        el('button', { class: 'plain', type: 'button', text: 'Back to the events',
                       onclick: function () { go('#/'); } })
      ]),
      el('h1', { text: 'Start a booking' }),
      links,
      el('form', {
        onsubmit: function (event) { event.preventDefault(); startBooking(); }
      }, [
        el('section', { class: 'block' }, [
          el('h2', { text: 'The event' }),
          el('div', { class: 'fields2' }, [
            field('name', 'Event name'),
            field('company', 'Company')
          ]),
          el('div', { class: 'fields2' }, [
            field('date', 'Date', 'date'),
            el('div', {}, [
              el('label', { class: 'fld', for: 'f-tz', text: 'Time zone — the event\'s own, not yours' }),
              picker
            ])
          ])
        ]),
        el('section', { class: 'block' }, [
          el('h2', { text: 'Who it is for' }),
          el('p', { class: 'quiet', text: 'Everybody here gets their own private link. Leave a row empty and nobody is invited for it.' })
        ].concat(people)),
        problems,
        el('div', { class: 'doing' }, [
          el('button', { class: 'go', type: 'submit', text: 'Start it and make the links' }),
          el('button', { class: 'plain', type: 'button', text: 'Back to the events',
                         onclick: function () { go('#/'); } })
        ])
      ])
    ]);
  }

  function startBooking() {
    var draft = state.draft;
    var people = [];
    ['approver', 'planner', 'production', 'contact'].forEach(function (role) {
      var name = (draft[role + '_name'] || '').trim();
      var email = (draft[role + '_email'] || '').trim();
      if (name || email) people.push({ name: name, role: role, email: email });
    });
    state.problems = [];
    if (!(draft.name || '').trim() && !(draft.company || '').trim()) {
      // Nothing downstream refuses this, and an event with neither reads as
      // its own id on the overview — unrecognisable beside the others.
      state.problems = ['Give it an event name or a company, so you can tell it from the others.'];
      say('Not started. Everything you typed is still here.', true);
      return bookingForm();
    }
    say('Starting it…');
    door('/api/dj/events', {
      body: {
        name: (draft.name || '').trim(), company: (draft.company || '').trim(),
        date: (draft.date || '').trim(), tz: draft.tz, people: people
      }
    }).then(function (answer) {
      if (answer.code !== 200 || !answer.body.ok) {
        if (expired(answer)) return;
        var body = answer.body || {};
        state.problems = (body.errors || []).map(function (e) { return e.message; });
        if (!state.problems.length) state.problems = [why(answer)];
        say('Not started. Everything you typed is still here.', true);
        return bookingForm();
      }
      var named = {};
      people.forEach(function (person) { named[person.role] = person; });
      state.booking = { event_id: answer.body.event_id, links: answer.body.links || {},
                        people: named };
      state.draft = {};
      say('Booking started. The private links are below.');
      refresh().then(bookingForm);
    });
  }

  // ------------------------------------------------------------- one event

  function openItems(event) {
    return (event.open_items || []).filter(function (item) {
      return item.active !== false && !item.resolved;
    });
  }

  function proposals(event) {
    var out = [];
    Object.keys(event.answers || {}).forEach(function (qid) {
      var answer = event.answers[qid];
      if (!answer || !answer.proposal) return;
      out.push({
        field: 'answers.' + qid,
        now: asWords(answer.state === 'confirmed' ? answer.value : STATE_WORDS[answer.state] || ''),
        asked: asWords(answer.proposal.value),
        by: answer.proposal.by, at: answer.proposal.at
      });
    });
    (event.moments || []).forEach(function (moment) {
      var proposal = moment.proposal;
      if (!proposal) return;
      Object.keys(proposal).forEach(function (attr) {
        if (attr === 'by' || attr === 'at' || attr === 'note') return;
        out.push({
          field: 'moments.' + moment.moment_id + '.' + attr,
          now: fieldValue('moments.' + moment.moment_id + '.' + attr, moment[attr]),
          asked: fieldValue('moments.' + moment.moment_id + '.' + attr, proposal[attr]),
          by: proposal.by, at: proposal.at
        });
      });
    });
    return out;
  }

  function proposalRow(event, proposal) {
    var asker = firstName(nameOf(event, proposal.by));
    return el('div', { class: 'row' }, [
      el('h3', { text: fieldWords(event, proposal.field) }),
      el('p', { class: 'quiet', text: asker + ' asked for this on ' +
        whenWords(proposal.at, event.tz) + (zoneNote(event.tz) ? ' ' + zoneNote(event.tz) : '') }),
      el('div', { class: 'two-values' }, [
        el('div', { class: 'value-box' }, [
          el('span', { class: 'label', text: 'as it stands' }),
          el('span', { class: 'value', text: proposal.now || '—' })
        ]),
        el('div', { class: 'value-box asked' }, [
          el('span', { class: 'label', text: asker + ' asked for' }),
          el('span', { class: 'value', text: proposal.asked || '—' })
        ])
      ]),
      el('p', { class: 'quiet', text: decidingWords(event, proposal.field) }),
      el('div', { class: 'doing' }, [
        el('button', {
          class: 'go', type: 'button',
          text: 'Take ' + asker + '’s ' + shorten(proposal.asked, 22),
          onclick: function (ev) { settle(ev.target, event, proposal.field, 'proposal', proposal); }
        }),
        el('button', {
          class: 'plain', type: 'button',
          text: 'Keep ' + shorten(proposal.now || 'it as it is', 22),
          onclick: function (ev) { settle(ev.target, event, proposal.field, 'current', proposal); }
        })
      ])
    ]);
  }

  function myItemRow(event, item) {
    var box = el('textarea', { id: 'a-' + item.item_id });
    return el('div', { class: 'row' }, [
      el('h3', { text: item.question }),
      el('p', { class: 'quiet', text: item.why || '' }),
      el('label', { class: 'fld', for: 'a-' + item.item_id, text: 'Your answer' }),
      box,
      el('div', { class: 'doing' }, [
        el('button', {
          class: 'go', type: 'button', text: 'That’s answered',
          onclick: function (ev) { answerItem(ev.target, event, item, box.value); }
        })
      ])
    ]);
  }

  function needsYou(event) {
    var mine = openItems(event).filter(function (item) { return item.owner === 'dj'; });
    var asked = proposals(event);
    var askedFields = asked.map(function (p) { return p.field; });
    var wantsDecision = state.changes.filter(function (line) {
      return line.decision_required && !line.resolved_by
        && askedFields.indexOf(line.field) < 0;
    });

    if (!mine.length && !asked.length && !wantsDecision.length) {
      return el('section', { class: 'block' }, [
        el('h2', { text: 'Needs you' }),
        el('p', { text: 'Nothing. Everything open is with somebody else.' })
      ]);
    }
    return el('section', { class: 'block needs' }, [
      el('h2', { text: 'Needs you' })
    ].concat(
      asked.map(function (proposal) { return proposalRow(event, proposal); }),
      mine.map(function (item) { return myItemRow(event, item); }),
      wantsDecision.length ? [el('div', { class: 'row' }, [
        el('h3', { text: 'These changes want a decision' })
      ].concat(wantsDecision.map(function (line) {
        return el('p', {}, [
          document.createTextNode(fieldWords(event, line.field) + ': '),
          el('span', { class: 'was', text: shorten(fieldValue(line.field, line.before), 40) + ' → ' }),
          document.createTextNode(shorten(fieldValue(line.field, line.after), 40)),
          el('span', { class: 'quiet', text: ' · ' + firstName(nameOf(event, line.actor)) +
            ', ' + whenWords(line.at, event.tz) })
        ]);
      })))] : []
    ));
  }

  function waitingOnClient(event) {
    var theirs = openItems(event).filter(function (item) { return item.owner !== 'dj'; });
    if (!theirs.length) {
      return el('section', { class: 'block' }, [
        el('h2', { text: 'Waiting on the client' }),
        el('p', { text: 'Nothing. They have answered everything asked of them.' })
      ]);
    }
    var byRole = {};
    theirs.forEach(function (item) {
      (byRole[item.owner] = byRole[item.owner] || []).push(item);
    });
    return el('section', { class: 'block' }, [
      el('h2', { text: 'Waiting on the client' })
    ].concat(Object.keys(byRole).sort().map(function (role) {
      var person = personByRole(event, role);
      var who = person ? firstName(person.name) : ROLE_WORDS[role];
      return el('div', { class: 'row' }, [
        el('h3', { text: 'Waiting on ' + who }),
        el('p', { class: 'quiet', text: person
          ? person.name + ' · ' + ROLE_WORDS[role]
          : 'nobody on this event holds that part yet' }),
        el('ul', {}, byRole[role].map(function (item) {
          return el('li', {}, [
            document.createTextNode(item.question),
            item.why ? el('span', { class: 'quiet', text: ' ' + item.why }) : null
          ]);
        }))
      ]);
    })));
  }

  function answerWords(question, value) {
    // The form's own words for a date and a zone are a machine's words.  He
    // reads the same answer everywhere else on this page as a day and a place.
    if (question.type === 'date') return prettyDate(value);
    if (question.id === 'tz') return zoneWords(value) || asWords(value);
    return asWords(value);
  }

  function briefBlock(event) {
    var sections = (state.questions || {}).sections || [];
    var answers = event.answers || {};
    var blocks = sections.map(function (section) {
      var rows = [];
      ((state.questions || {}).questions || []).forEach(function (question) {
        if (question.section !== section) return;
        var answer = answers[question.id];
        if (!answer || answer.state === 'blank') return;
        var words = answer.state === 'confirmed'
          ? answerWords(question, answer.value)
          : (STATE_WORDS[answer.state] || answer.state);
        rows.push(el('dt', { text: question.label }));
        rows.push(el('dd', {
          class: answer.state === 'confirmed' ? 'verbatim' : 'quiet',
          text: words
        }));
      });
      if (!rows.length) return null;
      return el('div', { class: 'row' }, [
        el('h3', { text: section }),
        el('dl', { class: 'facts' }, rows)
      ]);
    }).filter(Boolean);

    var people = (event.people || []).map(function (person) {
      var bits = [
        el('h3', { text: person.name }),
        el('p', { class: 'quiet', text: ROLE_WORDS[person.role] || person.role })
      ];
      if (person.email) bits.push(copyLine('email', person.email, person.name + '’s email'));
      if (person.phone) bits.push(copyLine('phone', person.phone, person.name + '’s phone'));
      return el('div', { class: 'row' }, bits);
    });

    return el('section', { class: 'block' }, [
      el('h2', { text: 'The brief' }),
      el('p', { class: 'quiet', text: 'What they have settled, in their own words. Anything still open is in the two lists above.' })
    ].concat(blocks, [
      el('div', { class: 'row' }, [el('h3', { text: 'Who is on it' })].concat(people))
    ]));
  }

  function runningOrder(event) {
    var recheck = {};
    openItems(event).forEach(function (item) {
      if (String(item.origin || '').indexOf('rule:time-change') === 0) {
        (item.moments || []).forEach(function (mid) { recheck[mid] = true; });
      }
    });
    var moments = (event.moments || []).filter(function (moment) {
      return moment.active !== false;
    }).slice().sort(function (a, b) {
      return String(a.date + ' ' + a.start).localeCompare(String(b.date + ' ' + b.start));
    });

    var rows = moments.map(function (moment) {
      var crosses = moment.start && moment.end && moment.end < moment.start;
      var when = clock(moment.start || '')
        + (moment.end && moment.end !== moment.start ? '–' + clock(moment.end) : '');
      var minutes = moment.start && moment.end
        ? ((Number(moment.end.split(':')[0]) * 60 + Number(moment.end.split(':')[1]))
           - (Number(moment.start.split(':')[0]) * 60 + Number(moment.start.split(':')[1])) + 1440) % 1440
        : Number(moment.duration_min || 0);
      var what = [
        el('h3', {}, [
          document.createTextNode(moment.label || KIND_WORDS[moment.kind] || 'part of the night'),
          recheck[moment.moment_id] ? el('span', { class: 'tag check', text: 'check this cue' }) : null
        ]),
        el('p', { class: 'where', text: [KIND_WORDS[moment.kind] || moment.kind,
          moment.room, APPROVAL_WORDS[moment.approval] || moment.approval]
          .filter(Boolean).join(' · ') }),
        moment.purpose ? el('p', { class: 'quiet verbatim', text: moment.purpose }) : null
      ];
      if (moment.cue_text) {
        what.push(el('div', { class: 'cue' }, [
          el('span', { class: 'label', text: 'the cue, word for word' }),
          el('p', { class: 'words verbatim', text: moment.cue_text })
        ]));
      }
      if (moment.pronunciation) {
        what.push(el('div', { class: 'cue say-it' }, [
          el('span', { class: 'label', text: 'say it like this' }),
          el('p', { class: 'words verbatim', text: moment.pronunciation })
        ]));
      }
      return el('div', { class: 'row' }, [
        el('div', { class: 'moment' }, [
          el('div', { class: 'when' }, [
            document.createTextNode(when),
            crosses ? el('span', { class: 'len', text: 'finishes the next day' }) : null,
            el('span', { class: 'len', text: lengthWords(minutes) })
          ]),
          el('div', { class: 'what' }, what)
        ])
      ]);
    });

    return el('section', { class: 'block' }, [
      el('h2', { text: 'The running order' }),
      el('p', { class: 'quiet', text: foreignZone(event.tz)
        ? 'Every time here is ' + zoneWords(event.tz) + ', the event’s own.'
        : 'Every time here is the event’s own, which is also yours.' })
    ].concat(rows.length ? rows : [el('p', { text: 'No parts of the night yet.' })]));
  }

  function firstAnswer(line) {
    // An answer arriving for the first time: there was nothing there before.
    var before = sideWords(line.before);
    return String(line.field || '').indexOf('answers.') === 0
      && (!before || before === STATE_WORDS.blank);
  }

  function changesBlock(event) {
    var seen = Number(event.dj_seen_revision || 0);
    var lines = state.changes.slice().sort(function (a, b) {
      return (b.revision || 0) - (a.revision || 0);
    });
    var unseen = lines.filter(function (line) { return (line.revision || 0) > seen; }).length;

    // A form filled in and sent lands as forty lines in the same second, all
    // of them "there was nothing here, now there is".  That is one thing that
    // happened, and it reads as one line.  Everything after it is a change
    // somebody made to an answer, which is the thing he is actually looking for.
    var groups = [];
    lines.forEach(function (line) {
      var last = groups[groups.length - 1];
      if (firstAnswer(line) && last && last.together
          && last.at === line.at && last.actor === line.actor) {
        last.lines.push(line);
        return;
      }
      groups.push({ together: firstAnswer(line), at: line.at,
                    actor: line.actor, lines: [line] });
    });
    var showing = state.showAllChanges ? groups : groups.slice(0, LATEST);
    var hidden = groups.slice(showing.length).reduce(function (sum, group) {
      return sum + group.lines.length;
    }, 0);

    var rows = showing.map(function (group) {
      if (group.lines.length > 1) return arrivedTogether(event, group, seen);
      var line = group.lines[0];
      var isNew = (line.revision || 0) > seen;
      var words = changeWords(line, event);
      return el('div', { class: 'row' }, [
        el('div', { class: 'change' }, [
          el('div', { class: 'at', text: whenWords(line.at, event.tz) }),
          el('div', {}, [
            el('h3', {}, [
              document.createTextNode(words.what),
              isNew ? el('span', { class: 'tag new', text: 'new' }) : null
            ]),
            words.after || words.before ? el('p', {}, [
              el('span', { class: 'was', text: words.before || '—' }),
              document.createTextNode(' → ' + (words.after || '—'))
            ]) : null,
            el('p', { class: 'quiet', text: firstName(nameOf(event, line.actor)) +
              ((line.affected || []).length
                ? ' · this touched ' + line.affected.map(function (mid) {
                    var moment = momentById(event, mid);
                    return moment ? (moment.label || mid) : mid;
                  }).join(', ')
                : '') })
          ])
        ])
      ]);
    });

    return el('section', { class: 'block' }, [
      el('h2', { text: 'What changed' }),
      el('div', { class: 'pills' }, [
        countPill(unseen, 'change since you last looked', 'changes since you last looked',
                  'nothing new since you last looked', 'new')
      ]),
      el('div', { class: 'doing' }, [
        el('button', {
          type: 'button', text: 'Mark as looked at', disabled: !unseen,
          onclick: function (ev) { markSeen(ev.target, event); }
        })
      ])
    ].concat(
      rows.length ? rows : [el('p', { text: 'Nothing has changed yet.' })],
      hidden > 0 ? [el('div', { class: 'doing' }, [
        el('button', {
          class: 'plain', type: 'button',
          text: 'Show the ' + hidden + ' older change' + (hidden === 1 ? '' : 's'),
          onclick: function () { state.showAllChanges = true; eventView(); }
        })
      ])] : []
    ));
  }

  function arrivedTogether(event, group, seen) {
    var isNew = group.lines.some(function (line) {
      return (line.revision || 0) > seen;
    });
    var named = group.lines.slice(0, 6).map(function (line) {
      return fieldWords(event, line.field);
    }).join(', ');
    return el('div', { class: 'row' }, [
      el('div', { class: 'change' }, [
        el('div', { class: 'at', text: whenWords(group.at, event.tz) }),
        el('div', {}, [
          el('h3', {}, [
            document.createTextNode(group.lines.length + ' answers arrived together'),
            isNew ? el('span', { class: 'tag new', text: 'new' }) : null
          ]),
          el('p', { class: 'quiet', text: named
            + (group.lines.length > 6 ? ', and ' + (group.lines.length - 6) + ' more' : '') }),
          el('p', { class: 'quiet', text: firstName(nameOf(event, group.actor)) })
        ])
      ])
    ]);
  }

  function sheetsBlock(event) {
    return el('section', { class: 'block' }, [
      el('h2', { text: 'The day sheet' }),
      el('p', { text: 'The printable sheet is made fresh when you ask for it. It prints the time it was made and which revision it came from — it is a snapshot, not a live page.' }),
      el('p', { class: 'quiet', text: 'What you are reading here is revision ' + event.revision
        + '. A sheet that says the same number was printed from the same answers.' }),
      el('div', { class: 'doing' }, [
        el('button', { class: 'go', type: 'button', text: 'Open the day sheet',
                       onclick: function (ev) { openSheet(ev.target, event); } }),
        el('button', { type: 'button', text: 'Save the times as a spreadsheet',
                       onclick: function (ev) { saveCsv(ev.target, event); } })
      ])
    ]);
  }

  function notesBlock(event) {
    if (!event.dj_notes) return null;
    return el('section', { class: 'block private' }, [
      el('h2', { text: 'Your own notes' }),
      el('p', { class: 'only-you', text: 'Only you see this. It is not on the client’s page and it is not on the day sheet.' }),
      el('p', { class: 'verbatim', text: event.dj_notes })
    ]);
  }

  function jumpBar(blocks) {
    // Buttons, not links: the address bar's hash is how this page remembers
    // which event is open, and an anchor would send it somewhere else.
    return el('nav', { class: 'jump', 'aria-label': 'jump down this page' },
      blocks.filter(Boolean).map(function (block) {
        return el('button', {
          class: 'plain', type: 'button', text: block.words,
          onclick: function () {
            var found = document.getElementById(block.id);
            if (found) found.scrollIntoView();
          }
        });
      }));
  }

  function eventView() {
    var event = state.event;
    if (!event) return;
    var name = ((event.answers || {}).event_name || {}).value
      || ((event.answers || {}).company || {}).value || event.event_id;
    var company = ((event.answers || {}).company || {}).value || '';
    var date = ((event.answers || {}).event_date || {}).value || '';
    var venue = ((event.answers || {}).venue || {}).value || '';
    var zone = zoneNote(event.tz);
    var mine = openItems(event).filter(function (item) { return item.owner === 'dj'; });
    var theirs = openItems(event).filter(function (item) { return item.owner !== 'dj'; });
    var unseen = state.changes.filter(function (line) {
      return (line.revision || 0) > Number(event.dj_seen_revision || 0);
    }).length;
    var parts = [
      { id: 'needs-you', words: 'Needs you' + count(mine.length + proposals(event).length),
        block: needsYou(event) },
      { id: 'waiting', words: 'Waiting on them' + count(theirs.length),
        block: waitingOnClient(event) },
      { id: 'order', words: 'Running order', block: runningOrder(event) },
      { id: 'changed', words: 'What changed' + count(unseen), block: changesBlock(event) },
      { id: 'brief', words: 'The brief', block: briefBlock(event) },
      { id: 'sheet', words: 'Day sheet', block: sheetsBlock(event) }
    ];
    var notes = notesBlock(event);
    if (notes) parts.push({ id: 'notes', words: 'Your notes', block: notes });
    parts.forEach(function (part) { part.block.id = part.id; });

    fill(room, [
      masthead([
        el('button', { class: 'plain', type: 'button', text: 'Back to the events',
                       onclick: function () { go('#/'); } })
      ]),
      el('h1', { text: name }),
      el('p', { class: 'quiet', text: [company, date ? prettyDate(date) : 'no date yet',
        zone, venue].filter(Boolean).join(' · ') }),
      el('div', { class: 'pills' }, [
        el('span', { class: 'pill stage', text: STAGE_WORDS[event.stage] || event.stage })
      ]),
      el('p', { class: 'next-action', text: event.next_action || '' }),
      parts[0].block,
      jumpBar(parts.map(function (part) { return { id: part.id, words: part.words }; })),
      parts[1].block, parts[2].block, parts[3].block,
      parts[4].block, parts[5].block, parts[6] ? parts[6].block : null
    ]);
    landTheKeyboard();
  }

  // ----------------------------------------------------------------- doing

  function busy(button, words) {
    button.disabled = true;
    var was = button.textContent;
    fill(button, [document.createTextNode(words)]);
    return function () {
      button.disabled = false;
      fill(button, [document.createTextNode(was)]);
    };
  }

  function settle(button, event, field, take, both) {
    both = both || {};
    var undo = busy(button, 'Settling…');
    door('/api/events/' + event.event_id + '/resolve', {
      body: { field: field, take: take,
              submission_id: 'sub_' + Math.random().toString(16).slice(2) }
    }).then(function (answer) {
      if (answer.code !== 200 || !answer.body.ok) {
        undo();
        if (expired(answer)) return;
        return say(why(answer), true);
      }
      // Say the numbers.  "is now what they asked for" cannot be checked by a
      // man holding a microphone; "is now 8:15 PM, was 8:00 PM" can.
      say(take === 'proposal'
        ? 'Taken. ' + fieldWords(event, field) + ' is now ' + (both.asked || '—')
          + ', was ' + (both.now || '—') + '.'
        : 'Kept. ' + fieldWords(event, field) + ' stays ' + (both.now || 'as it was') + '.');
      openEvent(event.event_id);
    });
  }

  function answerItem(button, event, item, words) {
    var undo = busy(button, 'Saving…');
    door('/api/events/' + event.event_id + '/open-items/' + item.item_id, {
      body: { resolved: true, answer: words,
              submission_id: 'sub_' + Math.random().toString(16).slice(2) }
    }).then(function (answer) {
      if (answer.code !== 200 || !answer.body.ok) {
        undo();
        if (expired(answer)) return;
        return say(why(answer), true);
      }
      say('Answered. That one is off your list.');
      openEvent(event.event_id);
    });
  }

  function markSeen(button, event) {
    var undo = busy(button, 'Marking…');
    door('/api/dj/seen', {
      body: { event_id: event.event_id, revision: event.revision }
    }).then(function (answer) {
      if (answer.code !== 200 || !answer.body.ok) {
        undo();
        if (expired(answer)) return;
        return say(why(answer), true);
      }
      say('Marked. Anything that changes from now on shows up as new.');
      openEvent(event.event_id);
    });
  }

  function openSheet(button, event) {
    // The sheet is behind the pass like everything else, so it is fetched with
    // the pass and handed to the new tab as a file, not as an address anybody
    // could paste.
    var undo = busy(button, 'Making it…');
    door('/api/events/' + event.event_id + '/daysheet', { raw: true })
      .then(function (answer) {
        undo();
        if (answer.code !== 200) {
          return say('The day sheet did not come. Nothing was saved.', true);
        }
        var page = new window.Blob([answer.body], { type: 'text/html' });
        var address = window.URL.createObjectURL(page);
        var opened = window.open(address, '_blank');
        window.setTimeout(function () { window.URL.revokeObjectURL(address); }, 60000);
        say(opened
          ? 'The day sheet opened in another tab.'
          : 'The browser would not open another tab. Allow it for this page and ask again.',
          !opened);
      });
  }

  function saveCsv(button, event) {
    var undo = busy(button, 'Making it…');
    door('/api/events/' + event.event_id + '/daysheet.csv', { raw: true })
      .then(function (answer) {
        undo();
        if (answer.code !== 200) return say('The spreadsheet did not come.', true);
        var file = new window.Blob([answer.body], { type: 'text/csv' });
        var address = window.URL.createObjectURL(file);
        var link = el('a', { href: address, download: 'day-sheet-' + event.event_id + '.csv' });
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.setTimeout(function () { window.URL.revokeObjectURL(address); }, 60000);
        say('The spreadsheet went to your downloads.');
      });
  }

  // ----------------------------------------------------------------- moving

  function ensureQuestions() {
    if (state.questions) return Promise.resolve(state.questions);
    return door('/api/questions').then(function (answer) {
      // The labels and the sections come from questions.json and nowhere else:
      // the brief must call every answer what the form called it.
      if (answer.code === 200) state.questions = answer.body;
      return state.questions;
    });
  }

  function refresh() {
    return door('/api/events').then(function (answer) {
      if (answer.code === 200 && Array.isArray(answer.body)) state.events = answer.body;
      return answer;
    });
  }

  function openEvent(eventId) {
    return Promise.all([
      door('/api/events/' + eventId),
      refresh()
    ]).then(function (answers) {
      var answer = answers[0];
      if (answer.code !== 200 || !answer.body.event_id) {
        if (expired(answer)) return;
        say(why(answer), true);
        return go('#/');
      }
      state.event = answer.body;
      return door('/api/events/' + eventId + '/changes?since=0').then(function (history) {
        state.changes = (history.body && history.body.changes) || [];
        eventView();
      });
    });
  }

  function go(hash) {
    if (window.location.hash === hash) paint();
    else window.location.hash = hash;
  }

  function paint() {
    if (!state.pass) return gate(null);
    var hash = window.location.hash || '#/';
    if (hash.indexOf('#/e/') === 0) {
      var eventId = hash.slice(4);
      if (!state.event || state.event.event_id !== eventId) return openEvent(eventId);
      return eventView();
    }
    state.event = null;
    if (hash === '#/new') return bookingForm();
    state.booking = null;
    refresh().then(overview);
  }

  window.addEventListener('hashchange', paint);

  function start() {
    var kept = '';
    try { kept = window.sessionStorage.getItem(PASS_KEY) || ''; } catch (no) { kept = ''; }
    if (!kept) return gate(null);
    state.pass = kept;
    door('/api/me').then(function (answer) {
      if (answer.code !== 200 || !answer.body.ok || answer.body.role !== 'dj') {
        state.pass = '';
        try { window.sessionStorage.removeItem(PASS_KEY); } catch (no) { /* private window */ }
        return gate({ words: why(answer), word: (answer.body || {}).error });
      }
      state.me = answer.body;
      ensureQuestions().then(paint);
    });
  }

  start();
})();
