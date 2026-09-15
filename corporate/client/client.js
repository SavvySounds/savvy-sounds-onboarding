/* The client's private page.
 *
 * Every word on screen comes from questions.json or from the doors; nothing
 * about the form is written down twice.  Everything the client types is held
 * in memory and on their own device the moment they type it, and sent to the
 * event a moment later.  Nothing is ever called saved until the door says so.
 */
(function () {
  'use strict';

  var KEEP = 'savvy-corporate';
  var DEBOUNCE = 1500;

  var S = {
    token: '',
    me: null,              // {event_id, person:{...}, role}
    form: null,            // questions.json
    event: null,           // the event as the door last told us
    dirty: {answers: {}, moments: {}},   // what they changed and we have not had back
    view: 'start',
    section: 0,
    status: {kind: 'idle', text: ''},
    attempt: '',           // one submission id per attempt, reused on Retry
    sending: false,
    errors: {},            // field -> message, from the door
    conflict: null,
    receipt: null,
    brief: null,
    lastFocus: null
  };

  // ------------------------------------------------------------ the link
  function takeToken() {
    var hit = location.pathname.match(/^\/c\/([0-9a-f]{32})$/);
    if (hit) {
      S.token = hit[1];
      remember('token', S.token);
      // The door serves this page at /c — with the slash on the end it is a
      // page nobody has, so a refresh at that address would find nothing.
      history.replaceState(null, '', '/c');
      return;
    }
    S.token = recall('token') || '';
  }

  function remember(key, value) {
    try { sessionStorage.setItem(KEEP + ':' + key, value); } catch (e) { /* private window */ }
  }
  function recall(key) {
    try { return sessionStorage.getItem(KEEP + ':' + key); } catch (e) { return null; }
  }

  function keepDraft() {
    remember('draft', JSON.stringify({event_id: S.me && S.me.event_id, dirty: S.dirty}));
  }
  function takeDraft() {
    var raw = recall('draft');
    if (!raw) return;
    try {
      var kept = JSON.parse(raw);
      if (kept && kept.event_id === S.me.event_id && kept.dirty) {
        S.dirty = {answers: kept.dirty.answers || {}, moments: kept.dirty.moments || {}};
      }
    } catch (e) { /* nothing worth keeping */ }
  }

  // ------------------------------------------------------------ the doors
  function door(method, path, body) {
    var opts = {method: method, headers: {'X-Access-Token': S.token}};
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    return fetch(path, opts).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        return {status: res.status, data: data};
      });
    });
  }

  // ------------------------------------------------------------ small hands
  function el(tag, props, kids) {
    var node = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (key) {
        var value = props[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'text') node.textContent = value;
        else if (key === 'on') Object.keys(value).forEach(function (name) {
          node.addEventListener(name, value[name]);
        });
        else if (value === true) node.setAttribute(key, '');
        else node.setAttribute(key, value);
      });
    }
    [].concat(kids || []).forEach(function (kid) { if (kid) node.appendChild(kid); });
    return node;
  }

  function add(parent, node) { if (node) parent.appendChild(node); }

  function isEmpty(value) {
    if (value === null || value === undefined) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.filter(function (v) { return String(v).trim(); }).length === 0;
    return false;
  }

  function firstWord(name) { return String(name || '').split(' ')[0]; }

  function titled(word) {
    return String(word || '').charAt(0).toUpperCase() + String(word || '').slice(1);
  }

  // ------------------------------------------------------- what an answer is
  function saved(qid) {
    var answer = ((S.event || {}).answers || {})[qid];
    if (!answer) return {value: null, state: 'blank'};
    // A value this person put forward that is waiting on somebody else is
    // still what they said; show it back to them.
    var mine = answer.proposal && answer.proposal.by === S.me.person.person_id;
    if (mine) return {value: answer.proposal.value, state: answer.proposal.state, waiting: true};
    return {value: answer.value, state: answer.state};
  }

  function answerOf(qid) {
    if (Object.prototype.hasOwnProperty.call(S.dirty.answers, qid)) return S.dirty.answers[qid];
    return saved(qid);
  }

  function setAnswer(qid, value, state) {
    var was = S.dirty.answers[qid] || {};
    S.dirty.answers[qid] = {value: value, state: state, kept: was.kept};
    keepDraft();
    queueSave();
  }

  function keepTyped(qid, value) {
    var entry = S.dirty.answers[qid] || {};
    entry.kept = value;
    S.dirty.answers[qid] = entry;
  }

  // -------------------------------------------------------- what a moment is
  function savedMoments() { return ((S.event || {}).moments || []).slice(); }

  function momentFor(kind) {
    var mid = null;
    savedMoments().forEach(function (m) { if (m.kind === kind && !mid) mid = m.moment_id; });
    if (!mid) mid = 'm_' + kind;
    if (Object.prototype.hasOwnProperty.call(S.dirty.moments, mid)) return S.dirty.moments[mid];
    var found = null;
    savedMoments().forEach(function (m) { if (m.moment_id === mid) found = m; });
    if (found) return found;
    return {moment_id: mid, kind: kind, label: titled(kind), date: eventDate(),
            start: '', end: '', duration_min: 0, purpose: '', room: '',
            music_owner: 'dj', cue_owner: 'planner', cue_text: '', pronunciation: '',
            approval: 'draft', active: false};
  }

  function setMoment(kind, patch) {
    var moment = JSON.parse(JSON.stringify(momentFor(kind)));
    Object.keys(patch).forEach(function (key) { moment[key] = patch[key]; });
    delete moment.previous;
    delete moment.proposal;
    S.dirty.moments[moment.moment_id] = moment;
    keepDraft();
    queueSave();
  }

  function momentOn(kind) { return !!momentFor(kind).active; }

  function eventDate() {
    var date = answerOf('event_date');
    return date.state === 'confirmed' ? date.value : null;
  }

  // ------------------------------------------------------------- the form
  function questions() { return (S.form || {}).questions || []; }
  function sections() { return (S.form || {}).sections || []; }

  function shown(question) {
    var when = question.when;
    if (!when) return true;
    if (when.moment) return momentOn(when.moment);
    if (when.answer) {
      var answer = answerOf(when.answer);
      return answer.state === 'confirmed' && answer.value === when.equals;
    }
    return true;
  }

  function inSection(name) {
    return questions().filter(function (q) { return q.section === name; });
  }

  function stateLabel(state) {
    return ((S.form || {}).state_labels || {})[state] || state;
  }

  function offeredStates(question) {
    var offered = ['unknown'];
    if (question.offers_miles) offered.push('miles');
    if (['songs', 'links', 'multi'].indexOf(question.type) >= 0) offered.push('none');
    return offered;
  }

  // Questions that must carry an answer before the form may be sent, in the
  // door's own words: the file's flag, plus the three the door softens.
  function missing() {
    var gaps = [];
    questions().forEach(function (q) {
      if (!q.required_to_submit) return;
      var answer = answerOf(q.id);
      var ok = answer.state === 'confirmed' && !isEmpty(answer.value);
      if (q.id === 'company' && answerOf('event_name').state === 'confirmed') return;
      if (q.id === 'event_name' && answerOf('company').state === 'confirmed') return;
      if (q.id === 'event_date' && answer.state === 'unknown') return;
      if (q.id === 'approver_name' && answer.state === 'unknown') return;
      if (!ok) gaps.push(q);
    });
    var kind = answerOf('event_type');
    if (kind.state === 'confirmed' && kind.value === 'Other') {
      var other = answerOf('event_type_other');
      if (other.state !== 'confirmed' || isEmpty(other.value)) {
        questions().forEach(function (q) { if (q.id === 'event_type_other') gaps.push(q); });
      }
    }
    return gaps;
  }

  function openish() {
    var out = [];
    questions().forEach(function (q) {
      if (!shown(q)) return;
      var answer = answerOf(q.id);
      if (answer.state === 'unknown' || answer.state === 'miles') out.push({q: q, state: answer.state});
    });
    return out;
  }

  // ------------------------------------------------------------- saving
  var timer = null;

  function queueSave() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () { timer = null; send(false); }, DEBOUNCE);
    say('saving');
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; send(false); }
  }

  function payload(submit) {
    var answers = {};
    Object.keys(S.dirty.answers).forEach(function (qid) {
      var mine = S.dirty.answers[qid];
      var value = mine.state === 'confirmed' ? mine.value : null;
      if (Array.isArray(value)) value = value.filter(function (line) { return String(line).trim(); });
      answers[qid] = {value: value, state: mine.state};
    });
    var moments = Object.keys(S.dirty.moments).map(function (mid) {
      return S.dirty.moments[mid];
    });
    var body = {base_revision: S.event.revision, submission_id: S.attempt,
                submit: !!submit, answers: answers};
    if (moments.length) body.moments = moments;
    return body;
  }

  function nothingToSay() {
    return Object.keys(S.dirty.answers).length === 0 && Object.keys(S.dirty.moments).length === 0;
  }

  function send(submit) {
    // Nothing of theirs is waiting: what the page holds IS what the event
    // holds, so say so rather than leaving the line blank.
    if (!submit && nothingToSay()) {
      S.status = {kind: 'saved', text: String(S.event.revision)};
      paintStatus();
      return Promise.resolve();
    }
    if (!S.attempt) S.attempt = 'sub_' + Math.random().toString(16).slice(2) + Date.now().toString(16);
    var sent = payload(submit);
    say(submit ? 'sending' : 'saving');
    return door('POST', '/api/events/' + S.me.event_id + '/save', sent)
      .then(function (reply) { return landed(reply, sent, submit); })
      .catch(function () {
        S.status = {kind: 'device', text: ''};
        S.sending = false;
        paint();
      });
  }

  function landed(reply, sent, submit) {
    S.sending = false;
    if (reply.status === 200 && reply.data && reply.data.ok) {
      Object.keys(sent.answers).forEach(function (qid) {
        var now = S.dirty.answers[qid];
        if (now && now.state === sent.answers[qid].state) delete S.dirty.answers[qid];
      });
      (sent.moments || []).forEach(function (m) { delete S.dirty.moments[m.moment_id]; });
      S.attempt = '';
      S.errors = {};
      keepDraft();
      S.receipt = submit ? reply.data.receipt : S.receipt;
      return reread().then(function () {
        S.status = {kind: 'saved', text: String(S.event.revision)};
        if (submit) { S.view = 'receipt'; loadBrief(); }
        paint();
      });
    }
    if (reply.status === 409 && reply.data) {
      S.conflict = reply.data;
      S.conflictWasSubmit = !!submit;
      S.view = 'conflict';
      S.status = {kind: 'trouble', text: ''};
      paint();
      return;
    }
    if (reply.status === 422 && reply.data) {
      S.errors = {};
      (reply.data.errors || []).forEach(function (bad) { S.errors[bad.field] = bad.message; });
      S.status = {kind: 'trouble', text: ''};
      if (S.view === 'review' || S.view === 'form') gotoFirstError();
      paint();
      return;
    }
    S.status = {kind: 'trouble', text: ''};
    paint();
  }

  function reread() {
    return door('GET', '/api/events/' + S.me.event_id).then(function (reply) {
      if (reply.status === 200 && reply.data && reply.data.event_id) S.event = reply.data;
    });
  }

  function say(kind) {
    S.status = {kind: kind, text: ''};
    paintStatus();
  }

  function gotoFirstError() {
    var first = Object.keys(S.errors)[0];
    if (!first) return;
    var qid = first.indexOf('answers.') === 0 ? first.slice('answers.'.length) : null;
    if (!qid) return;
    questions().forEach(function (q) {
      if (q.id !== qid) return;
      var index = sections().indexOf(q.section);
      if (index >= 0) { S.view = 'form'; S.section = index; }
    });
    setTimeout(function () {
      var field = document.getElementById('f_' + qid);
      if (field) field.focus();
    }, 0);
  }

  // ------------------------------------------------------------- painting
  function paint() {
    var main = document.getElementById('main');
    main.textContent = '';
    var view = ({
      start: startView, form: formView, review: reviewView, receipt: receiptView,
      brief: briefView, conflict: conflictView, blocked: blockedView, lost: lostView
    })[S.view] || startView;
    main.appendChild(view());
    paintBars();
    if (S.lastFocus) { var back = document.getElementById(S.lastFocus); if (back) back.focus(); S.lastFocus = null; }
  }

  function paintBars() {
    var meter = document.getElementById('meter');
    var step = document.getElementById('step');
    var bar = document.getElementById('footbar');
    var onForm = S.view === 'form';
    meter.hidden = !onForm;
    step.hidden = !onForm;
    bar.hidden = !(onForm || S.view === 'review');
    if (onForm) {
      meter.textContent = '';
      sections().forEach(function (name, index) {
        meter.appendChild(el('i', {class: index <= S.section ? 'lit' : null,
                                   title: name}));
      });
      meter.setAttribute('aria-valuenow', String(S.section + 1));
      meter.setAttribute('aria-valuemax', String(sections().length));
      meter.setAttribute('aria-valuetext', 'Part ' + (S.section + 1) + ' of ' +
                          sections().length + ': ' + sections()[S.section]);
      step.textContent = (S.section + 1) + '/' + sections().length;
    }
    if (!bar.hidden) paintFootbar();
    paintStatus();
  }

  function paintFootbar() {
    var back = document.getElementById('backbtn');
    var next = document.getElementById('nextbtn');
    var last = S.section === sections().length - 1;
    if (S.view === 'review') {
      back.textContent = 'Back to the form';
      back.onclick = function () { S.view = 'form'; paint(); };
      next.textContent = S.sending ? 'Sending…' : 'Send';
      next.disabled = !!S.sending;
      next.onclick = function () { S.sending = true; paintBars(); send(true); };
      return;
    }
    back.textContent = S.section === 0 ? 'Start' : 'Back';
    back.onclick = function () {
      flush();
      if (S.section === 0) { S.view = 'start'; } else { S.section -= 1; }
      window.scrollTo(0, 0);
      paint();
    };
    next.disabled = false;
    next.textContent = last ? 'Review answers' : 'Next';
    next.onclick = function () {
      flush();
      if (last) { S.view = 'review'; } else { S.section += 1; }
      window.scrollTo(0, 0);
      paint();
    };
  }

  function paintStatus() {
    var line = document.getElementById('status');
    if (!line) return;
    line.textContent = '';
    line.className = 'status';
    var kind = S.status.kind;
    if (kind === 'saved') {
      line.appendChild(el('span', {text: 'Saved · revision ' + S.status.text}));
    } else if (kind === 'saving' || kind === 'sending') {
      line.appendChild(el('span', {text: 'Saving…'}));
    } else if (kind === 'device') {
      line.className = 'status trouble';
      line.appendChild(el('span', {text: 'Saved on this device only — not yet sent to Savvy Sounds. '}));
      line.appendChild(retryButton());
    } else if (kind === 'trouble') {
      line.className = 'status trouble';
      line.appendChild(el('span', {text: 'Not saved yet — your answers are still here. '}));
      line.appendChild(retryButton());
    }
  }

  function retryButton() {
    return el('button', {type: 'button', class: 'editlink', text: 'Retry',
                         on: {click: function () { send(S.view === 'review'); }}});
  }

  // ------------------------------------------------------------- the views
  function startView() {
    var name = eventName();
    var person = S.me.person || {};
    var left = whereTheyLeftOff();
    var box = el('div', {class: 'view'});
    box.appendChild(el('div', {class: 'hero'}, [
      el('h1', {text: (S.form || {}).title || ''}),
      el('p', {class: 'lead', text: (S.form || {}).opening || ''})
    ]));
    box.appendChild(el('section', {class: 'card'}, [
      el('h2', {text: name}),
      el('p', {class: 'muted', text: 'Hello ' + firstWord(person.name) + '. ' + left}),
      el('div', {class: 'btns'}, [
        el('button', {type: 'button', class: 'btn go',
                      text: S.event.submitted_at ? 'Review answers' : 'Continue',
                      on: {click: function () {
                        S.view = S.event.submitted_at ? 'review' : 'form';
                        window.scrollTo(0, 0); paint();
                      }}}),
        S.event.submitted_at ? null : el('button', {type: 'button', class: 'btn plain', text: 'Review answers',
                      on: {click: function () { S.view = 'review'; window.scrollTo(0, 0); paint(); }}}),
        el('button', {type: 'button', class: 'btn plain', text: 'See your event brief',
                      on: {click: function () { S.view = 'brief'; loadBrief(); window.scrollTo(0, 0); paint(); }}})
      ])
    ]));
    return box;
  }

  function eventName() {
    var name = saved('event_name');
    var company = saved('company');
    if (name.state === 'confirmed' && name.value) return name.value;
    if (company.state === 'confirmed' && company.value) return company.value;
    return 'Your event';
  }

  function whereTheyLeftOff() {
    var answered = questions().filter(function (q) {
      return shown(q) && answerOf(q.id).state !== 'blank';
    }).length;
    var all = questions().filter(shown).length;
    if (S.event.submitted_at) {
      return 'You sent your answers. Anything you change from here reaches Miles the same way.';
    }
    if (answered === 0) return 'Nothing filled in yet — six short parts, and you can stop anywhere.';
    return answered + ' of ' + all + ' questions have an answer. Pick up where you left off.';
  }

  function formView() {
    var name = sections()[S.section];
    var box = el('div', {class: 'view'});
    box.appendChild(el('h1', {text: name, style: 'font-size:30px;text-transform:uppercase;margin:0 0 14px;'}));
    var card = el('section', {class: 'card'});
    var here = inSection(name).filter(shown);
    here.forEach(function (question) { card.appendChild(questionBlock(question)); });
    if (!here.length) card.appendChild(el('p', {class: 'muted', text: 'Nothing to answer here yet.'}));
    box.appendChild(card);
    return box;
  }

  function questionBlock(question) {
    var answer = answerOf(question.id);
    var bad = S.errors['answers.' + question.id];
    var block = el('div', {class: 'q' + (answer.state !== 'confirmed' && answer.state !== 'blank' ? ' silent' : '') +
                                  (bad ? ' bad' : ''), id: 'q_' + question.id});
    var labelText = question.label + (question.required_to_submit ? ' ' : '');
    var head = question.type === 'multi' || question.type === 'choice' ||
               question.type === 'songs' || question.type === 'links' || question.type === 'moments'
      ? el('p', {class: 'qlabel', id: 'l_' + question.id, text: labelText})
      : el('label', {class: 'qlabel', for: 'f_' + question.id, text: labelText});
    if (question.required_to_submit) head.appendChild(el('span', {class: 'req', text: 'needed'}));
    block.appendChild(head);
    if (question.help) block.appendChild(el('p', {class: 'qhelp', text: question.help}));
    block.appendChild(control(question, answer));
    var states = offeredStates(question);
    if (states.length) {
      var row = el('div', {class: 'chips states', role: 'group',
                           'aria-labelledby': 'l_' + question.id});
      if (!document.getElementById('l_' + question.id)) head.id = 'l_' + question.id;
      states.forEach(function (state) {
        var on = answer.state === state;
        row.appendChild(el('button', {
          type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false',
          text: stateLabel(state),
          on: {click: function () {
            if (on) {
              var back = (S.dirty.answers[question.id] || {}).kept;
              setAnswer(question.id, isEmpty(back) ? null : back,
                        isEmpty(back) ? 'blank' : 'confirmed');
            } else {
              if (answer.state === 'confirmed') keepTyped(question.id, answer.value);
              setAnswer(question.id, null, state);
            }
            paint();
          }}
        }));
      });
      block.appendChild(row);
    }
    if (answer.waiting) {
      block.appendChild(el('p', {class: 'qhelp',
        text: 'Your answer is with ' + ownerName(question) + ' to confirm.'}));
    }
    if (bad) block.appendChild(el('p', {class: 'err', text: bad}));
    return block;
  }

  function ownerName(question) {
    var people = (S.event || {}).people || [];
    var role = {direction: 'approver', event: 'approver', running_order: 'planner',
                production: 'production', prep: 'dj'}[question.owner || 'event'];
    var found = '';
    people.forEach(function (p) { if (p.role === role && !found) found = firstWord(p.name); });
    return found || 'Miles';
  }

  function control(question, answer) {
    var id = 'f_' + question.id;
    var value = answer.state === 'confirmed' ? answer.value : null;
    var kind = question.type;

    if (kind === 'textarea') {
      var area = el('textarea', {id: id, rows: 3});
      area.value = value || '';
      area.addEventListener('input', function () {
        setAnswer(question.id, area.value, area.value.trim() ? 'confirmed' : 'blank');
      });
      return area;
    }
    if (kind === 'text' || kind === 'email' || kind === 'date' || kind === 'number') {
      var type = kind === 'number' ? 'number' : (kind === 'date' ? 'date' : (kind === 'email' ? 'email' : 'text'));
      var input = el('input', {id: id, type: type,
                               inputmode: kind === 'number' ? 'numeric' : null,
                               autocomplete: 'off'});
      input.value = value || '';
      input.addEventListener('input', function () {
        setAnswer(question.id, input.value, input.value.trim() ? 'confirmed' : 'blank');
      });
      return input;
    }
    if (kind === 'choice') {
      var one = el('div', {class: 'chips', id: id, role: 'group', 'aria-labelledby': 'l_' + question.id});
      var picked = value;
      if (picked === null && question.default && answer.state === 'blank') picked = question.default;
      (question.options || []).forEach(function (option) {
        var label = (question.option_labels || {})[option] || option;
        one.appendChild(el('button', {
          type: 'button', class: 'chip', 'aria-pressed': picked === option ? 'true' : 'false', text: label,
          on: {click: function () {
            setAnswer(question.id, picked === option ? null : option,
                      picked === option ? 'blank' : 'confirmed');
            paint();
          }}
        }));
      });
      return one;
    }
    if (kind === 'multi') {
      var many = el('div', {class: 'chips', id: id, role: 'group', 'aria-labelledby': 'l_' + question.id});
      var chosen = Array.isArray(value) ? value.slice() : [];
      (question.options || []).forEach(function (option) {
        var on = chosen.indexOf(option) >= 0;
        many.appendChild(el('button', {
          type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false', text: option,
          on: {click: function () {
            var next = on ? chosen.filter(function (o) { return o !== option; }) : chosen.concat([option]);
            setAnswer(question.id, next, next.length ? 'confirmed' : 'blank');
            paint();
          }}
        }));
      });
      return many;
    }
    if (kind === 'songs' || kind === 'links') {
      return listRows(question);
    }
    if (kind === 'moments') {
      return momentsControl(question);
    }
    return el('p', {class: 'err',
      text: 'This page does not know how to ask "' + question.label + '" yet.'});
  }

  function linesOf(question) {
    var answer = answerOf(question.id);
    var lines = answer.state === 'confirmed' && Array.isArray(answer.value) ? answer.value.slice() : [];
    return lines.length ? lines : [''];
  }

  function setLines(question, lines) {
    var real = lines.filter(function (line) { return String(line).trim(); });
    setAnswer(question.id, lines, real.length ? 'confirmed' : 'blank');
  }

  function listRows(question) {
    var wrap = el('div', {class: 'rows', id: 'f_' + question.id});
    var rows = linesOf(question);
    rows.forEach(function (line, index) {
      var input = el('input', {type: 'text',
                               'aria-label': question.label + ', line ' + (index + 1),
                               autocomplete: 'off'});
      input.value = line;
      input.addEventListener('input', function () {
        var live = linesOf(question);
        while (live.length <= index) live.push('');
        live[index] = input.value;
        setLines(question, live);
      });
      var row = el('div', {class: 'row'}, [input]);
      if (rows.length > 1) {
        row.appendChild(el('button', {type: 'button', class: 'drop', text: '\u00d7',
          'aria-label': 'Take out line ' + (index + 1) + ' of ' + question.label,
          on: {click: function () {
            var live = linesOf(question).filter(function (v, i) { return i !== index; });
            setLines(question, live.length ? live : ['']);
            paint();
          }}}));
      }
      wrap.appendChild(row);
    });
    wrap.appendChild(el('button', {type: 'button', class: 'addrow', text: '+ Add another',
      on: {click: function () {
        setLines(question, linesOf(question).concat(['']));
        paint();
        var inputs = document.querySelectorAll('#f_' + question.id + ' input');
        if (inputs.length) inputs[inputs.length - 1].focus();
      }}}));
    return wrap;
  }

  function momentsControl(question) {
    var wrap = el('div', {id: 'f_' + question.id});
    (question.options || []).forEach(function (kind) {
      var moment = momentFor(kind);
      var on = !!moment.active;
      var card = el('div', {class: 'moment'});
      card.appendChild(el('button', {
        type: 'button', class: 'chip', 'aria-pressed': on ? 'true' : 'false',
        text: moment.label || titled(kind),
        on: {click: function () { setMoment(kind, {active: !on}); paint(); }}
      }));
      if (on) {
        var times = el('div', {class: 'times'});
        [['start', 'Starts'], ['end', 'Ends']].forEach(function (pair) {
          var field = el('input', {type: 'time', id: 'm_' + kind + '_' + pair[0],
                                   'aria-label': (moment.label || titled(kind)) + ' ' + pair[1].toLowerCase()});
          field.value = moment[pair[0]] || '';
          field.addEventListener('input', function () {
            var patch = {}; patch[pair[0]] = field.value; setMoment(kind, patch);
          });
          times.appendChild(el('div', {}, [
            el('label', {for: 'm_' + kind + '_' + pair[0], text: pair[1]}), field
          ]));
        });
        card.appendChild(times);
      }
      wrap.appendChild(card);
    });
    return wrap;
  }

  // ------------------------------------------------------------- review
  function reviewView() {
    var box = el('div', {class: 'view'});
    box.appendChild(el('h1', {text: 'Before you send', style: 'font-size:30px;text-transform:uppercase;margin:0 0 6px;'}));
    box.appendChild(el('p', {class: 'muted', text: 'Read it back. Anything can still change after you send.'}));

    var gaps = missing();
    if (gaps.length) {
      var warn = el('div', {class: 'note warn'}, [
        el('p', {style: 'margin:0 0 6px', text: 'Still needed before this can go:'})
      ]);
      var list = el('ul', {style: 'margin:0; padding-left:20px'});
      gaps.forEach(function (q) {
        list.appendChild(el('li', {}, [
          el('button', {type: 'button', class: 'editlink', text: q.label,
                        on: {click: function () { jumpTo(q); }}})
        ]));
      });
      warn.appendChild(list);
      box.appendChild(warn);
    }

    var open = openish();
    if (open.length) {
      var note = el('div', {class: 'note'}, [
        el('p', {style: 'margin:0 0 6px',
                 text: 'These become questions we work out together:'})
      ]);
      var ul = el('ul', {style: 'margin:0; padding-left:20px'});
      open.forEach(function (item) {
        ul.appendChild(el('li', {text: item.q.label + ' — ' + stateLabel(item.state)}));
      });
      note.appendChild(ul);
      box.appendChild(note);
    }

    sections().forEach(function (name, index) {
      var here = inSection(name).filter(shown);
      if (!here.length) return;
      var card = el('section', {class: 'card'});
      card.appendChild(el('div', {class: 'sechead'}, [
        el('h2', {text: name}),
        el('button', {type: 'button', class: 'editlink', text: 'Edit',
                      'aria-label': 'Edit ' + name,
                      on: {click: function () {
                        S.view = 'form'; S.section = index; window.scrollTo(0, 0); paint();
                      }}})
      ]));
      here.forEach(function (question) {
        var answer = answerOf(question.id);
        var row = el('div', {class: 'ans'}, [el('div', {class: 'k', text: question.label})]);
        if (answer.state === 'confirmed' && !isEmpty(answer.value)) {
          row.appendChild(el('div', {class: 'v', text: readable(question, answer.value)}));
        } else if (answer.state === 'blank') {
          row.appendChild(el('div', {class: 'v open', text: 'Not answered'}));
        } else {
          row.appendChild(el('div', {class: 'v open', text: stateLabel(answer.state)}));
        }
        var bad = S.errors['answers.' + question.id];
        if (bad) row.appendChild(el('p', {class: 'err', text: bad}));
        card.appendChild(row);
      });
      box.appendChild(card);
    });
    return box;
  }

  function jumpTo(question) {
    var index = sections().indexOf(question.section);
    S.view = 'form';
    S.section = index < 0 ? 0 : index;
    window.scrollTo(0, 0);
    paint();
    var field = document.getElementById('f_' + question.id);
    if (field) field.focus();
  }

  function readable(question, value) {
    if (Array.isArray(value)) {
      return value.filter(function (line) { return String(line).trim(); }).join('\n');
    }
    if (question.type === 'choice') return (question.option_labels || {})[value] || value;
    if (question.type === 'moments') return String(value);
    return String(value);
  }

  // ------------------------------------------------------------- receipt
  function troubleNote() {
    if (S.status.kind !== 'trouble' && S.status.kind !== 'device') return null;
    var words = S.status.kind === 'device'
      ? 'Saved on this device only — not yet sent to Savvy Sounds.'
      : 'Not saved yet — your answers are still here.';
    return el('div', {class: 'note warn'}, [
      el('span', {text: words + ' '}), retryButton()
    ]);
  }

  function receiptView() {
    var receipt = S.receipt || {};
    var box = el('div', {class: 'view'});
    add(box, troubleNote());
    box.appendChild(el('div', {class: 'card'}, [
      el('h2', {text: 'Sent'}),
      el('p', {text: 'Saved as revision ' + receipt.revision + ' — thank you.'}),
      el('p', {class: 'muted', text: receipt.name || eventName()}),
      el('div', {class: 'btns'}, [
        el('button', {type: 'button', class: 'btn go', text: 'See your event brief',
                      on: {click: function () { S.view = 'brief'; loadBrief(); window.scrollTo(0, 0); paint(); }}}),
        el('button', {type: 'button', class: 'btn plain', text: 'Back to your answers',
                      on: {click: function () { S.view = 'review'; window.scrollTo(0, 0); paint(); }}})
      ])
    ]));
    var text = plainAnswers();
    var copy = el('div', {class: 'card'}, [
      el('h3', {text: 'Keep a copy'}),
      el('p', {class: 'qhelp', id: 'copyword',
               text: 'Your answers in plain words — copy them wherever you keep things.'}),
      el('button', {type: 'button', class: 'btn plain', text: 'Copy the answers',
                    on: {click: function (e) { copyOut(text, e.target); }}}),
      el('pre', {class: 'copy', id: 'plaincopy', text: text})
    ]);
    box.appendChild(copy);
    return box;
  }

  function plainAnswers() {
    var lines = [eventName(), ''];
    sections().forEach(function (name) {
      var here = inSection(name).filter(shown);
      if (!here.length) return;
      lines.push(name.toUpperCase());
      here.forEach(function (question) {
        var answer = answerOf(question.id);
        var said = answer.state === 'confirmed' && !isEmpty(answer.value)
          ? readable(question, answer.value).replace(/\n/g, '; ')
          : (answer.state === 'blank' ? '—' : stateLabel(answer.state));
        lines.push('  ' + question.label + ': ' + said);
      });
      lines.push('');
    });
    return lines.join('\n');
  }

  function copyOut(text, button) {
    var word = document.getElementById('copyword');
    var pre = document.getElementById('plaincopy');
    if (!navigator.clipboard || !navigator.clipboard.writeText) return selectInstead(pre, word);
    navigator.clipboard.writeText(text).then(function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy the answers'; }, 2000);
    }).catch(function () { selectInstead(pre, word); });
  }

  function selectInstead(pre, word) {
    // The browser would not open the clipboard.  Say so and select the words
    // instead of claiming a copy that did not happen.
    if (pre) {
      var range = document.createRange();
      range.selectNodeContents(pre);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
    if (word) word.textContent = 'Your browser would not let the page copy. The words are selected — press command-C.';
  }

  // ------------------------------------------------------------- the brief
  function loadBrief() {
    door('GET', '/api/events/' + S.me.event_id + '/brief').then(function (reply) {
      if (reply.status === 200 && reply.data && reply.data.ok) S.brief = reply.data;
      if (S.view === 'brief') paint();
    }).catch(function () { /* the brief screen says so itself */ });
  }

  function briefView() {
    var box = el('div', {class: 'view'});
    box.appendChild(el('h1', {text: 'Your event brief', style: 'font-size:30px;text-transform:uppercase;margin:0 0 6px;'}));
    add(box, troubleNote());
    if (!S.brief) {
      box.appendChild(el('p', {class: 'muted', text: 'Fetching your brief…'}));
      box.appendChild(backHome());
      return box;
    }
    var head = S.brief.header || {};
    box.appendChild(el('section', {class: 'card'}, [
      el('h2', {text: head.name || eventName()}),
      el('dl', {class: 'facts'}, [
        el('dt', {text: 'Company'}), el('dd', {text: head.company || '—'}),
        el('dt', {text: 'Date'}), el('dd', {text: head.date || 'Not settled yet'}),
        el('dt', {text: 'Where'}), el('dd', {text: head.venue || '—'})
      ]),
      el('p', {class: 'qhelp', style: 'margin-top:10px',
               text: 'Every time below is the time on the clock at your event (' + (head.tz || '') + ').'}),
      S.brief.next_action ? el('p', {class: 'note good', text: S.brief.next_action}) : null
    ]));

    var moments = (S.brief.moments || []).slice().sort(function (a, b) {
      return String(a.date || '') + String(a.start || '') > String(b.date || '') + String(b.start || '') ? 1 : -1;
    });
    if (moments.length) {
      var order = el('section', {class: 'card'}, [el('h3', {text: 'The order of the night'})]);
      moments.forEach(function (moment) {
        order.appendChild(el('div', {class: 'ans'}, [
          el('div', {class: 'k tnum', text: momentClock(moment)}),
          el('div', {class: 'v', text: moment.label || titled(moment.kind)}),
          moment.purpose ? el('div', {class: 'k', text: moment.purpose}) : null
        ]));
      });
      box.appendChild(order);
    }

    var proposals = mineToSettle();
    if (proposals.length) {
      var choose = el('section', {class: 'card'}, [
        el('h3', {text: 'Two answers to settle'}),
        el('p', {class: 'qhelp', text: 'Somebody else put a different answer forward. Pick the one that is right.'})
      ]);
      proposals.forEach(function (item) { choose.appendChild(proposalBlock(item)); });
      box.appendChild(choose);
    }

    var items = S.brief.open_items || [];
    var mine = el('section', {class: 'card'}, [el('h3', {text: 'Your open questions'})]);
    if (!items.length) {
      mine.appendChild(el('p', {class: 'muted', text: 'Nothing is waiting on you right now.'}));
    }
    items.forEach(function (item) { mine.appendChild(openItemBlock(item)); });
    box.appendChild(mine);

    var confirmed = S.brief.answers || {};
    var known = el('section', {class: 'card'}, [el('h3', {text: 'What is settled'})]);
    var any = false;
    questions().forEach(function (question) {
      if (!Object.prototype.hasOwnProperty.call(confirmed, question.id)) return;
      if (isEmpty(confirmed[question.id])) return;
      any = true;
      known.appendChild(el('div', {class: 'ans'}, [
        el('div', {class: 'k', text: question.label}),
        el('div', {class: 'v', text: readable(question, confirmed[question.id])})
      ]));
    });
    if (!any) known.appendChild(el('p', {class: 'muted', text: 'Nothing is settled yet.'}));
    box.appendChild(known);
    box.appendChild(backHome());
    return box;
  }

  function backHome() {
    return el('div', {class: 'btns'}, [
      el('button', {type: 'button', class: 'btn plain', text: 'Back to your answers',
                    on: {click: function () { S.view = 'review'; window.scrollTo(0, 0); paint(); }}})
    ]);
  }

  function momentClock(moment) {
    var start = moment.start || '';
    var end = moment.end || '';
    if (!start && !end) return 'Time not set';
    if (!end || end === start) return start;
    var crosses = end < start;
    return start + ' to ' + end + (crosses ? ' the next morning' : '');
  }

  function momentLabelOf(mid) {
    var found = '';
    ((S.event || {}).moments || []).forEach(function (m) {
      if (m.moment_id === mid) found = m.label || titled(m.kind);
    });
    return found || mid;
  }

  // Proposals this person's role owns: they are the one who may settle them.
  function mineToSettle() {
    var out = [];
    var role = S.me.role;
    var people = (S.event || {}).people || [];
    var owner = {direction: 'approver', event: 'approver', running_order: 'planner',
                 production: 'production', prep: 'dj'};
    var held = people.map(function (p) { return p.role; });
    function settledBy(group) {
      var want = owner[group] || 'approver';
      if (held.indexOf(want) < 0 && (group === 'running_order' || group === 'production')) want = 'approver';
      return want;
    }
    var answers = (S.event || {}).answers || {};
    questions().forEach(function (question) {
      var answer = answers[question.id];
      if (!answer || !answer.proposal) return;
      if (answer.proposal.by === S.me.person.person_id) return;
      if (settledBy(question.owner || 'event') !== role) return;
      out.push({field: 'answers.' + question.id, label: question.label,
                mine: readable(question, answer.value), theirs: readable(question, answer.proposal.value),
                by: nameOf(answer.proposal.by), at: answer.proposal.at});
    });
    ((S.event || {}).moments || []).forEach(function (moment) {
      var proposal = moment.proposal;
      if (!proposal) return;
      if (proposal.by === S.me.person.person_id) return;
      if (settledBy('running_order') !== role) return;
      Object.keys(proposal).forEach(function (attr) {
        if (['by', 'at', 'note', 'value', 'state'].indexOf(attr) >= 0) return;
        out.push({field: 'moments.' + moment.moment_id + '.' + attr,
                  label: (moment.label || titled(moment.kind)) + ' — ' + attr,
                  mine: String(moment[attr] === null || moment[attr] === undefined ? '' : moment[attr]),
                  theirs: String(proposal[attr]),
                  by: nameOf(proposal.by), at: proposal.at});
      });
    });
    return out;
  }

  function nameOf(personId) {
    var found = '';
    ((S.event || {}).people || []).forEach(function (p) {
      if (p.person_id === personId) found = p.name;
    });
    return found || (personId === 'p_miles' ? 'Miles' : 'Somebody on your side');
  }

  function proposalBlock(item) {
    var block = el('div', {class: 'conflict'}, [
      el('h3', {text: item.label}),
      el('div', {class: 'sides'}, [
        el('div', {class: 'side'}, [el('div', {class: 'k', text: 'What is down now'}),
                                    el('div', {class: 'v', text: item.mine || '—'})]),
        el('div', {class: 'side'}, [el('div', {class: 'k', text: item.by + ' put forward'}),
                                    el('div', {class: 'v', text: item.theirs || '—'})])
      ])
    ]);
    block.appendChild(el('div', {class: 'btns'}, [
      el('button', {type: 'button', class: 'btn go', text: 'Take ' + firstWord(item.by) + "'s",
                    on: {click: function () { settle(item.field, 'proposal'); }}}),
      el('button', {type: 'button', class: 'btn plain', text: 'Keep it as it is',
                    on: {click: function () { settle(item.field, 'current'); }}})
    ]));
    return block;
  }

  function settle(field, take) {
    door('POST', '/api/events/' + S.me.event_id + '/resolve',
         {field: field, take: take,
          submission_id: 'sub_' + Math.random().toString(16).slice(2) + Date.now().toString(16)})
      .then(function (reply) {
        if (reply.status === 200 && reply.data && reply.data.ok) {
          S.status = {kind: 'saved', text: String(reply.data.revision)};
          return reread().then(loadBrief);
        }
        S.status = {kind: 'trouble', text: ''};
        paint();
      }).catch(function () { S.status = {kind: 'device', text: ''}; paint(); });
  }

  function openItemBlock(item) {
    var input = el('textarea', {id: 'oi_' + item.item_id, rows: 2,
                                'aria-label': 'Your answer to: ' + item.question});
    var block = el('div', {class: 'ans'}, [
      el('div', {class: 'v', text: item.question}),
      item.why ? el('div', {class: 'k', text: item.why}) : null,
      (item.moments || []).length ? el('div', {class: 'k',
        text: 'About: ' + item.moments.map(momentLabelOf).join(', ')}) : null,
      input,
      el('div', {class: 'btns', style: 'margin-top:8px'}, [
        el('button', {type: 'button', class: 'btn plain', text: 'Send this answer',
                      on: {click: function () { answerItem(item, input.value); }}})
      ])
    ]);
    return block;
  }

  function answerItem(item, text) {
    if (!String(text || '').trim()) {
      S.status = {kind: 'trouble', text: ''};
      paintStatus();
      return;
    }
    door('POST', '/api/events/' + S.me.event_id + '/open-items/' + item.item_id,
         {resolved: true, answer: text,
          submission_id: 'sub_' + Math.random().toString(16).slice(2) + Date.now().toString(16)})
      .then(function (reply) {
        if (reply.status === 200 && reply.data && reply.data.ok) {
          S.status = {kind: 'saved', text: String(reply.data.revision)};
          return reread().then(loadBrief);
        }
        S.status = {kind: 'trouble', text: ''};
        paint();
      }).catch(function () { S.status = {kind: 'device', text: ''}; paint(); });
  }

  // ------------------------------------------------------------- conflict
  function conflictView() {
    var box = el('div', {class: 'view'});
    box.appendChild(el('h1', {text: 'Two answers', style: 'font-size:30px;text-transform:uppercase;margin:0 0 6px;'}));
    box.appendChild(el('p', {class: 'muted',
      text: 'Somebody else changed the same thing while you were writing. Pick one of each, then send again.'}));
    var picks = {};
    (S.conflict.conflicts || []).forEach(function (clash) {
      picks[clash.field] = 'mine';
      var block = el('div', {class: 'conflict'});
      block.appendChild(el('h3', {text: clash.label}));
      var yours = el('div', {class: 'side'}, [
        el('div', {class: 'k', text: 'Yours'}),
        el('div', {class: 'v', text: plain(clash.yours)})
      ]);
      var theirs = el('div', {class: 'side'}, [
        el('div', {class: 'k', text: (clash.theirs_by || 'They') + ' changed it' +
                                     (clash.theirs_at ? ' at ' + clockOf(clash.theirs_at) : '')}),
        el('div', {class: 'v', text: plain(clash.theirs)})
      ]);
      block.appendChild(el('div', {class: 'sides'}, [yours, theirs]));
      var mineBtn = el('button', {type: 'button', class: 'chip', 'aria-pressed': 'true', text: 'Keep mine'});
      var theirsBtn = el('button', {type: 'button', class: 'chip', 'aria-pressed': 'false',
                                    text: "Take " + firstWord(clash.theirs_by || 'their') + "'s"});
      mineBtn.addEventListener('click', function () {
        picks[clash.field] = 'mine';
        mineBtn.setAttribute('aria-pressed', 'true');
        theirsBtn.setAttribute('aria-pressed', 'false');
      });
      theirsBtn.addEventListener('click', function () {
        picks[clash.field] = 'theirs';
        mineBtn.setAttribute('aria-pressed', 'false');
        theirsBtn.setAttribute('aria-pressed', 'true');
      });
      block.appendChild(el('div', {class: 'chips'}, [mineBtn, theirsBtn]));
      box.appendChild(block);
    });
    box.appendChild(el('div', {class: 'btns'}, [
      el('button', {type: 'button', class: 'btn go', text: 'Send again',
                    on: {click: function () { resendAfterConflict(picks); }}})
    ]));
    return box;
  }

  function plain(value) {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'object') {
      if (value.state && value.state !== 'confirmed') return stateLabel(value.state);
      return plain(value.value);
    }
    return String(value);
  }

  function clockOf(iso) {
    var when = new Date(iso);
    if (isNaN(when.getTime())) return iso;
    return when.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
  }

  function resendAfterConflict(picks) {
    var conflict = S.conflict;
    Object.keys(picks).forEach(function (field) {
      if (picks[field] !== 'theirs') return;
      // Their value is the one to keep: stop offering ours.
      if (field.indexOf('answers.') === 0) delete S.dirty.answers[field.slice('answers.'.length)];
      else if (field.indexOf('moments.') === 0) delete S.dirty.moments[field.split('.')[1]];
    });
    S.conflict = null;
    S.errors = {};
    keepDraft();
    // Start again from the revision the door told us it is on.
    S.event.revision = conflict.current_revision;
    S.attempt = '';
    var again = !!S.conflictWasSubmit;
    S.view = 'review';
    paint();
    reread().then(function () { return send(again); });
  }

  // ------------------------------------------------------------- refusals
  function blockedView() {
    return el('div', {class: 'view'}, [
      el('section', {class: 'card'}, [
        el('h2', {text: 'This link'}),
        el('p', {text: S.blockedWords})
      ])
    ]);
  }

  function lostView() {
    return el('div', {class: 'view'}, [
      el('section', {class: 'card'}, [
        el('h2', {text: 'Not connected'}),
        el('p', {text: 'We cannot reach Savvy Sounds from this device right now. Nothing is lost.'}),
        el('div', {class: 'btns'}, [
          el('button', {type: 'button', class: 'btn go', text: 'Try again',
                        on: {click: function () { boot(); }}})
        ])
      ])
    ]);
  }

  var REFUSALS = {
    'link-expired': 'This link has expired — ask Miles for a fresh one.',
    'not-your-event': 'This link is for a different event — ask Miles for a fresh one.',
    'no-such-event': 'We cannot find that event — ask Miles for a fresh link.'
  };

  function blocked(word) {
    S.blockedWords = REFUSALS[word] || 'This link did not open — ask Miles for a fresh one.';
    S.view = 'blocked';
    paint();
  }

  // ------------------------------------------------------------- opening
  function boot() {
    var booting = document.getElementById('booting');
    if (booting) booting.textContent = 'Opening your event…';
    if (!S.token) return blocked('link-expired');
    door('GET', '/api/me').then(function (reply) {
      if (reply.status !== 200 || !reply.data || !reply.data.ok) {
        return blocked(reply.data && reply.data.error);
      }
      S.me = reply.data;
      if (!S.me.event_id) return blocked('not-your-event');
      return Promise.all([door('GET', '/api/questions'),
                          door('GET', '/api/events/' + S.me.event_id)])
        .then(function (both) {
          if (both[0].status !== 200 || both[1].status !== 200) {
            return blocked(both[1].data && both[1].data.error);
          }
          S.form = both[0].data;
          S.event = both[1].data;
          document.title = eventName() + ' — Savvy Sounds';
          takeDraft();
          defaultsOn();
          S.status = {kind: 'saved', text: String(S.event.revision)};
          S.view = 'start';
          paint();
          if (!nothingToSay()) queueSave();
        });
    }).catch(function () {
      S.view = 'lost';
      paint();
    });
  }

  // "Clean is on unless you turn it off": a question with a default that has
  // never been answered starts answered, visibly, and goes with the first save.
  function defaultsOn() {
    questions().forEach(function (question) {
      if (!question.default) return;
      if (saved(question.id).state !== 'blank') return;
      if (Object.prototype.hasOwnProperty.call(S.dirty.answers, question.id)) return;
      S.dirty.answers[question.id] = {value: question.default, state: 'confirmed'};
    });
    keepDraft();
  }

  takeToken();
  boot();
  window.addEventListener('beforeunload', function () { keepDraft(); });
})();
