/*
 * PTT Week — OrangeHRM DevTools Snippet and bookmarklet source.
 * Run while signed in to the OrangeHRM page.
 * Confirm the requested changes before saving. Writes run one day at a time.
 * Re-running the snippet closes the previous overlay and opens a fresh one.
 * No captured cookies, tokens or employee IDs are used.
 */
(() => {
  const CONFIG = {
    dryRun: false,
    timezone: 'Europe/London',
    gridMinutes: 30
  };

  const API_BASE = '/web/index.php/api/v2/attendance';
  const FIRST_MINUTE = 6 * 60;
  const LAST_MINUTE = 22 * 60;
  const HOST_ID = 'ptt-week-host';
  const previous = document.getElementById(HOST_ID);
  if (previous?.__pttBusy) {
    alert('PTT Week is saving. Wait for verification before running it again.');
    return;
  }
  if (previous) { previous.__pttCleanup?.(); previous.remove(); }
  if (location.origin === 'null' || !location.pathname.startsWith('/web/')) {
    console.error('[PTT Week] Open the signed-in OrangeHRM page before running this snippet.');
    return;
  }
  // API layer. Paths, query fields, and payloads come from the supplied HARs.
  async function apiRequest(method, path, payload) {
    const options = {
      method,
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    };
    if (payload !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(payload);
    }
    let response;
    try { response = await fetch(`${API_BASE}${path}`, options); }
    catch (error) { throw new Error(`Network error: ${error.message}`); }
    console.info('[PTT Week] API', method, path.split('?')[0], 'HTTP', response.status);
    if (!(response.headers.get('content-type') || '').includes('application/json')) {
      throw new Error(`HTTP ${response.status}; expected JSON. The session may have expired or access may be blocked.`);
    }
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`HTTP ${response.status}; invalid JSON response.`); }
    if (!response.ok || body?.error) {
      throw new Error(`HTTP ${response.status}: ${body?.error?.message || body?.message || response.statusText}`);
    }
    return body;
  }
  function queryPath(path, params) { return `${path}?${new URLSearchParams(params)}`; }
  async function getAttendance(date) {
    const body = await apiRequest('GET', queryPath('/records', { limit: '50', offset: '0', date }));
    if (!Array.isArray(body?.data)) {
      throw new Error(`${date}: unexpected records response shape; expected data array.`);
    }
    const total = Number(body?.meta?.total ?? body?.meta?.totalRecords);
    if (Number.isFinite(total) && total > body.data.length) {
      throw new Error(`${date}: the API returned only ${body.data.length} of ${total} records. Review in OrangeHRM.`);
    }
    const normalized = normalizeAttendance(date, body.data);
    console.info('[PTT Week] Normalized attendance', date,
      normalized.periods.map(p => ({ startDate: p.startDate, start: p.start, endDate: p.endDate, end: p.end })));
    if (normalized.issues.length) console.warn('[PTT Week] Records needing manual review', date, normalized.issues);
    return normalized;
  }

  function normalTime(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?$/i.exec(value.trim());
    if (!match) return null;
    let hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = match[3] == null ? 0 : Number(match[3]);
    const meridiem = match[4]?.toUpperCase();
    if (minutes > 59 || seconds > 59 || hours > (meridiem ? 12 : 23) || (meridiem && hours === 0)) return null;
    if (meridiem) hours = hours % 12 + (meridiem === 'PM' ? 12 : 0);
    const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    return seconds ? `${clock}:${String(seconds).padStart(2, '0')}` : clock;
  }

  function normalizeAttendance(date, records) {
    const issues = [];
    const periods = records.map((record, index) => {
      const start = normalTime(record?.punchIn?.userTime);
      const end = record?.punchOut?.userTime == null ? null : normalTime(record.punchOut.userTime);
      const startDate = record?.punchIn?.userDate;
      const endDate = record?.punchOut?.userDate;
      const id = Number(record?.id);
      const startNote = record?.punchIn?.note;
      const endNote = record?.punchOut?.note;
      const startOffset = record?.punchIn?.offset;
      const endOffset = record?.punchOut?.offset;
      if (!start) issues.push(`Record ${index + 1}: punch-in time is missing or unrecognised.`);
      if (record?.punchOut?.userTime != null && !end) issues.push(`Record ${index + 1}: punch-out time is unrecognised.`);
      if (startDate !== date) issues.push(`Record ${index + 1}: punch-in date differs from ${date}.`);
      if (end && endDate !== date) issues.push(`Record ${index + 1}: punch-out date differs from ${date}.`);
      if (!Number.isSafeInteger(id) || id <= 0) issues.push(`Record ${index + 1}: record ID is missing or invalid.`);
      return { id, startDate, start, startNote, startOffset, endDate, end, endNote, endOffset };
    }).sort((a, b) => (a.start || '').localeCompare(b.start || ''));
    return { date, periods, issues };
  }

  // Date and planner logic. Dates use UTC arithmetic to avoid local DST shifts.
  const dayMs = 86_400_000;
  function dateFromISO(iso) { return new Date(`${iso}T00:00:00Z`); }
  function iso(date) { return date.toISOString().slice(0, 10); }
  function addDays(date, amount) { return new Date(date.getTime() + amount * dayMs); }
  function londonToday() {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: CONFIG.timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const part = name => parts.find(item => item.type === name).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  }
  function mondayOf(date) {
    const weekday = date.getUTCDay();
    return addDays(date, -(weekday === 0 ? 6 : weekday - 1));
  }
  function weekDates(monday) {
    return Array.from({ length: 5 }, (_, index) => iso(addDays(monday, index)));
  }
  function label(date) {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short'
    }).format(dateFromISO(date));
  }
  function hhmm(minutes) {
    return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  function minute(time) {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes;
  }
  function preciseMinute(time) {
    const [hours, minutes, seconds = 0] = time.split(':').map(Number);
    return hours * 60 + minutes + seconds / 60;
  }
  function attendanceToCells(attendance) {
    const cells = new Set();
    let rounded = false;
    let clipped = false;
    for (const period of attendance.periods) {
      const exactStart = preciseMinute(period.start);
      const exactEnd = preciseMinute(period.end);
      let start = Math.round(exactStart / CONFIG.gridMinutes) * CONFIG.gridMinutes;
      let end = Math.round(exactEnd / CONFIG.gridMinutes) * CONFIG.gridMinutes;
      if (end <= start) end = start + CONFIG.gridMinutes;
      if (start !== exactStart || end !== exactEnd) rounded = true;
      if (start < FIRST_MINUTE || end > LAST_MINUTE) clipped = true;
      start = Math.max(start, FIRST_MINUTE);
      end = Math.min(end, LAST_MINUTE);
      for (let at = start; at < end; at += CONFIG.gridMinutes) cells.add(at);
    }
    return { cells, rounded, clipped };
  }
  function cellsToPeriods(cells) {
    const periods = [];
    let start = null;
    for (let at = FIRST_MINUTE; at <= LAST_MINUTE; at += CONFIG.gridMinutes) {
      const filled = at < LAST_MINUTE && cells.has(at);
      if (filled && start === null) start = at;
      if (!filled && start !== null) {
        periods.push({ start: hhmm(start), end: hhmm(at) });
        start = null;
      }
    }
    return periods;
  }
  function samePeriods(left, right) {
    return left.length === right.length && left.every((period, index) =>
      period.start === right[index].start && period.end === right[index].end);
  }
  function duration(periods) {
    return periods.reduce((sum, period) => sum + (period.end ? minute(period.end) - minute(period.start) : 0), 0);
  }
  function hours(minutes) {
    return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
  }
  function timezoneOffset(date) {
    const probe = new Date(`${date}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: CONFIG.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(probe);
    const get = name => Number(parts.find(part => part.type === name).value);
    const zoned = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
    return (zoned - probe.getTime()) / 3_600_000;
  }
  function snapshotKey(attendance) {
    return JSON.stringify(attendance.periods.map(p => [
      p.id, p.startDate, p.start, p.startNote, p.startOffset,
      p.endDate, p.end, p.endNote, p.endOffset
    ]));
  }
  function recordIdentityKey(p) {
    return JSON.stringify([p.id, p.startDate, p.start, p.startNote, p.endDate, p.end, p.endNote]);
  }
  function planDay(date) {
    const existing = state.existing.get(date);
    const requested = cellsToPeriods(state.cells.get(date));
    const blocked = reason => ({ date, kind: 'blocked', requested, existing, reason });
    if (state.errors.has(date) || !existing) return blocked('Attendance could not be read.');
    if (existing.issues.length) return blocked('Existing records need manual review.');
    if (existing.periods.some(p => !p.end)) return blocked('An open punch exists.');
    const base = { date, requested, existing, baseline: snapshotKey(existing) };
    if (!state.edited.has(date) || samePeriods(existing.periods, requested)) {
      return { ...base, kind: 'none', steps: [] };
    }
    const offset = timezoneOffset(date);
    for (const p of existing.periods) {
      if (!Number.isSafeInteger(p.id) || p.id <= 0 ||
          ![p.startNote, p.endNote].every(note => note === null || typeof note === 'string') ||
          p.startOffset == null || p.endOffset == null ||
          Number(p.startOffset) !== offset || Number(p.endOffset) !== offset) {
        return blocked('A record ID, note, or London timezone offset is missing or unexpected; review manually.');
      }
    }
    const remaining = [...requested];
    const unmatched = [];
    const kept = [];
    for (const from of existing.periods) {
      const index = remaining.findIndex(to => to.start === from.start && to.end === from.end);
      if (index < 0) unmatched.push(from);
      else { kept.push(from); remaining.splice(index, 1); }
    }
    // Keep exact matches. Pair changed periods in time order, delete surplus
    // records, and create surplus periods. Deletes run before edits/creates.
    const pairCount = Math.min(unmatched.length, remaining.length);
    const edits = unmatched.slice(0, pairCount).map((from, index) => ({
      kind: 'edit', id: from.id, from, to: remaining[index]
    }));
    const deletes = unmatched.slice(pairCount).map(from => ({ kind: 'delete', id: from.id, from }));
    const creates = remaining.slice(pairCount).flatMap(period => [
      { kind: 'in', time: period.start }, { kind: 'out', time: period.end }
    ]);
    return { ...base, kind: 'change', steps: [...deletes, ...edits, ...creates], kept };
  }
  async function validateOverlap(path, params) {
    const body = await apiRequest('GET', queryPath(path, params));
    if (body?.data?.valid !== true) throw new Error(`OrangeHRM overlap check did not approve ${path}.`);
  }
  function punchPayload(date, time) {
    return { date, time, note: null, timezoneOffset: timezoneOffset(date), timezoneName: CONFIG.timezone };
  }
  async function createPunch(date, step) {
    if (state.dryRun) throw new Error('Dry run is active; write blocked.');
    const overlap = step.kind === 'in' ? '/punch-in/overlaps' : '/punch-out/overlaps';
    await validateOverlap(overlap, { date, time: step.time, timezoneOffset: String(timezoneOffset(date)) });
    return apiRequest(step.kind === 'in' ? 'POST' : 'PUT', '/records', punchPayload(date, step.time));
  }
  async function getRecord(date, id) {
    const body = await apiRequest('GET', `/records/${id}`);
    if (!body?.data || Array.isArray(body.data)) throw new Error(`Record ${id}: unexpected detail response.`);
    const normalized = normalizeAttendance(date, [body.data]);
    if (normalized.issues.length) throw new Error(`Record ${id}: detail needs manual review.`);
    return normalized.periods[0];
  }
  async function editRecord(date, step) {
    if (state.dryRun) throw new Error('Dry run is active; write blocked.');
    const detail = await getRecord(date, step.id);
    if (recordIdentityKey(detail) !== recordIdentityKey(step.from)) {
      throw new Error(`Record ${step.id} changed since Save was pressed; no edit sent.`);
    }
    const offset = String(timezoneOffset(date));
    const params = {
      recordId: String(step.id), punchInTimezoneOffset: offset,
      punchInDate: date, punchInTime: step.to.start,
      punchOutTimezoneOffset: offset, punchOutDate: date, punchOutTime: step.to.end
    };
    await validateOverlap('/records/punch-in-overlaps', params);
    await validateOverlap('/records/punch-out-overlaps', params);
    return apiRequest('PUT', `/records/${step.id}`, {
      punchInDate: date, punchInTime: step.to.start, punchInNote: step.from.startNote,
      punchOutDate: date, punchOutTime: step.to.end, punchOutNote: step.from.endNote
    });
  }
  async function deleteRecord(date, step) {
    if (state.dryRun) throw new Error('Dry run is active; deletion blocked.');
    const detail = await getRecord(date, step.id);
    if (recordIdentityKey(detail) !== recordIdentityKey(step.from)) {
      throw new Error(`Record ${step.id} changed since Save was pressed; no deletion sent.`);
    }
    const body = await apiRequest('DELETE', '/records', { ids: [step.id] });
    if (!Array.isArray(body?.data) || !body.data.includes(step.id)) {
      throw new Error(`OrangeHRM did not confirm deletion of record ${step.id}.`);
    }
  }

  const state = {
    monday: mondayOf(dateFromISO(londonToday())),
    cells: new Map(), existing: new Map(), errors: new Map(),
    edited: new Set(), gridNotes: new Map(),
    loading: false, preview: false, plan: new Map(),
    dryRun: CONFIG.dryRun, busy: false, saveStatus: new Map(), notice: '',
    drag: null, generation: 0
  };
  const host = document.createElement('div');
  host.id = HOST_ID;
  const listenerController = new AbortController();
  host.__pttCleanup = () => { listenerController.abort(); state.generation++; };
  const shadow = host.attachShadow({ mode: 'open' });
  document.body.appendChild(host);
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { position: fixed; z-index: 2147483647; top: 12px; left: 50%;
      transform: translateX(-50%); width: min(1500px, calc(100vw - 24px));
      max-height: calc(100vh - 24px); overflow: auto;
      color: #222; background: #fff; border: 1px solid #d8d8d8; border-radius: 10px;
      box-shadow: 0 12px 40px #0005; font: 13px/1.4 system-ui, sans-serif; }
    header { position: sticky; top: 0; z-index: 2; background: #262a30; color: white;
      padding: 10px 14px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    h1 { margin: 0; font-size: 16px; letter-spacing: .05em; }
    .badge { background: #fff0b8; color: #4e3900; padding: 3px 7px; border-radius: 5px; font-weight: 700; }
    main { padding: 12px 14px 16px; }
    .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin-bottom: 9px; }
    button { font: inherit; cursor: pointer; border: 1px solid #b8bdc4; background: #f5f6f7;
      border-radius: 5px; padding: 5px 8px; color: #222; }
    button:hover { background: #e9edf1; }
    button:disabled { opacity: .5; cursor: default; }
    header button { color: white; background: transparent; border-color: #737880; }
    .status { color: #4e5661; margin-bottom: 8px; }
    .gridwrap { border: 1px solid #d8dce0; border-radius: 5px; overflow: hidden; }
    table { width: 100%; border-collapse: separate; border-spacing: 1px; table-layout: fixed; user-select: none; }
    th { background: #fff; padding: 4px 2px; font-weight: 600; }
    th.dayhead, th.daylabel { width: 152px; text-align: left; padding-left: 8px; }
    th.totalhead, td.dayhours { width: 72px; text-align: center; }
    th.hourhead, th.halfhead { color: #57616c; font-size: 11px; }
    th.hourhead { text-align: left; padding-left: 3px; border-left: 2px solid #aab5bf; }
    th.halfhead { border-left: 1px solid #e1e5e9; }
    th.totalhead { border-left: 2px solid #aab5bf; }
    th.totalhead .endmark { display: block; text-align: left; color: #57616c; font-size: 11px; }
    th.daylabel strong { display: block; font-size: 12px; }
    th.daylabel button { padding: 2px 5px; font-size: 11px; margin-top: 3px; }
    td.cell { height: 39px; border: 1px solid #dce2e7; background: #f5f7f9;
      cursor: crosshair; border-radius: 2px; }
    td.cell.hourstart { border-left: 2px solid #afb9c2; }
    td.cell.on { background: #f39c32; border-color: #d77815; }
    td.cell:hover { outline: 2px solid #6f7c89; }
    td.dayhours { font-weight: 700; font-size: 12px; }
    tfoot th, tfoot td { background: #f3f5f7; font-weight: 700; padding: 6px; }
    tfoot td { text-align: right; }
    .day { padding: 7px 0; border-bottom: 1px solid #eceef0; }
    .error { color: #a62323; }
    .ok { color: #236b32; }
    .muted { color: #67707a; }
    .note { color: #624b19; background: #fff6dd; padding: 8px; border-radius: 5px; margin-top: 10px; }
    .savebutton { background: #246b39; border-color: #246b39; color: white; font-weight: 700; margin-top: 6px; }
    .savebutton:hover { background: #1c552d; }
    .savebutton:disabled { background: #b8c1bb; border-color: #b8c1bb; }
    .save-status { font-weight: 700; color: #236b32; overflow-wrap: anywhere; }
    .save-status.error { color: #a62323; }
    .busyveil { position: absolute; inset: 46px 0 0; z-index: 5; display: grid;
      place-items: center; background: #fffffff0; text-align: center; }
    .busyveil[hidden] { display: none; }
    .busycard { display: grid; justify-items: center; gap: 8px; color: #343c42; font-weight: 700; }
    @media (max-width: 900px) {
      .gridwrap { overflow-x: auto; }
      table { min-width: 900px; }
    }
  `;
  shadow.appendChild(style);
  const panel = document.createElement('div');
  panel.className = 'panel';
  shadow.appendChild(panel);
  const surface = document.createElement('div');
  panel.appendChild(surface);
  const loader = document.createElement('div');
  loader.className = 'busyveil';
  loader.setAttribute('role', 'status');
  loader.setAttribute('aria-live', 'polite');
  loader.innerHTML = '<div class="busycard"><span></span></div>';
  panel.appendChild(loader);
  const loaderText = loader.querySelector('span');

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }
  function currentDates() { return weekDates(state.monday); }
  function ensureCells() {
    for (const date of currentDates()) if (!state.cells.has(date)) state.cells.set(date, new Set());
  }
  function prefillDay(date) {
    const attendance = state.existing.get(date);
    if (!attendance || attendance.issues.length) {
      state.cells.set(date, new Set());
      state.gridNotes.set(date, 'Some existing records cannot be shown on this same-day grid.');
      return;
    }
    const completed = attendance.periods.filter(period => period.start && period.end);
    const converted = attendanceToCells({ periods: completed });
    state.cells.set(date, converted.cells);
    const notes = [];
    if (completed.length !== attendance.periods.length) notes.push('Open punch is shown below but has no end time to paint.');
    if (converted.rounded) notes.push('Existing times rounded to 30-minute cells for display.');
    if (converted.clipped) notes.push('Some existing time is outside the 06:00–22:00 grid.');
    state.gridNotes.set(date, notes.join(' '));
  }
  function invalidatePreview() { state.preview = false; state.plan.clear(); state.notice = ''; }
  function render() {
    ensureCells();
    const dates = currentDates();
    const slots = [];
    for (let at = FIRST_MINUTE; at < LAST_MINUTE; at += CONFIG.gridMinutes) slots.push(at);
    const weekTotal = dates.reduce((sum, date) => sum + duration(cellsToPeriods(state.cells.get(date))), 0);
    surface.innerHTML = `
      <header><h1>PTT WEEK</h1><span class="badge">${state.busy ? 'SAVING · DO NOT CLOSE' : state.loading ? 'LOADING' : state.dryRun ? 'DRY RUN' : 'READY'}</span><button data-action="close" aria-label="Close" ${state.busy ? 'disabled' : ''}>✕</button></header>
      <main>
        <div class="row"><button data-action="previous" ${state.busy ? 'disabled' : ''}>‹ Previous week</button><button data-action="current" ${state.busy ? 'disabled' : ''}>Current week</button><button data-action="next" ${state.busy ? 'disabled' : ''}>Next week ›</button><button data-action="refresh" ${state.loading || state.busy ? 'disabled' : ''}>Refresh records</button></div>
        <div class="status">${escapeHtml(label(dates[0]))} – ${escapeHtml(label(dates[4]))} · ${state.loading ? 'Reading OrangeHRM…' : state.busy ? 'Saving one day sequentially; wait for verification.' : 'Hour labels mark the start of the cell directly below. Drag a rectangle to fill or erase.'}</div>
        <div class="gridwrap"><table><thead><tr><th class="dayhead">Day</th>${slots.map(at => `<th class="${at % 60 === 0 ? 'hourhead' : 'halfhead'}">${at % 60 === 0 ? hhmm(at) : ''}</th>`).join('')}<th class="totalhead"><span class="endmark">${hhmm(LAST_MINUTE)}</span>Hours</th></tr></thead><tbody>
        ${dates.map(date => `<tr><th class="daylabel"><strong>${escapeHtml(label(date))}</strong><button data-action="clear-day" data-date="${date}" title="Clear planner cells for ${date}" ${state.busy ? 'disabled' : ''}>Clear</button> <button data-action="restore-day" data-date="${date}" title="Restore planner cells from the last OrangeHRM read for ${date}" ${state.existing.has(date) && !state.busy ? '' : 'disabled'}>Restore</button></th>${slots.map(at => `<td class="cell ${at % 60 === 0 ? 'hourstart' : ''} ${state.cells.get(date).has(at) ? 'on' : ''}" data-date="${date}" data-minute="${at}" title="${date} ${hhmm(at)}–${hhmm(at + CONFIG.gridMinutes)}"></td>`).join('')}<td class="dayhours" data-hours-date="${date}">${hours(duration(cellsToPeriods(state.cells.get(date))))}</td></tr>`).join('')}
        </tbody><tfoot><tr><th>Week total</th><td colspan="${slots.length}"></td><td data-week-total-footer>${hours(weekTotal)}</td></tr></tfoot></table></div>
        <div class="row" style="margin-top:10px"><button data-action="copy" ${state.busy ? 'disabled' : ''}>Copy Monday → Tue–Fri</button><button data-action="clear" ${state.busy ? 'disabled' : ''}>Clear week</button><button class="savebutton" data-action="save" ${state.loading || state.busy || state.dryRun ? 'disabled' : ''}>Save</button><strong data-week-total>Week: ${hours(weekTotal)}</strong>${state.notice ? `<span class="save-status ${[...state.saveStatus.values()].some(status => status.error) ? 'error' : ''}" role="status">${escapeHtml(state.notice)}</span>` : ''}</div>
        ${renderWarnings(dates)}
      </main>`;
    loader.hidden = !(state.loading || state.busy);
    loaderText.textContent = state.busy ? 'Clocking in the changes…' : 'Fetching the week…';
  }
  function periodText(periods) {
    return periods.length ? periods.map(p => {
      const startDate = p.startDate ? `${p.startDate} ` : '';
      const endDate = p.endDate && p.endDate !== p.startDate ? `${p.endDate} ` : '';
      return `${startDate}${p.start || '?'}–${endDate}${p.end || 'OPEN'}`;
    }).join(', ') : 'No records';
  }
  function renderWarnings(dates) {
    const warnings = dates.flatMap(date => {
      const error = state.errors.get(date);
      const attendance = state.existing.get(date);
      const note = state.gridNotes.get(date);
      return [error, ...(attendance?.issues || []), note].filter(Boolean)
        .map(message => `${label(date)}: ${message}`);
    });
    return warnings.length ? `<div class="note">${escapeHtml(warnings.join(' '))}</div>` : '';
  }
  async function saveDay(date) {
    const plan = state.plan.get(date);
    if (!plan || plan.kind !== 'change') return true;
    const status = { lines: [], error: null, verified: false };
    state.saveStatus.set(date, status);
    render();
    try {
      const fresh = await getAttendance(date);
      state.existing.set(date, fresh);
      if (fresh.issues.length || snapshotKey(fresh) !== plan.baseline) {
        throw new Error('Attendance changed since Save was pressed. No write was sent; refresh and try again.');
      }
      status.lines.push('✓ Re-read day; existing records match preview.');
      if (plan.steps.some(step => step.kind === 'in')) {
        const latest = await apiRequest('GET', '/records/latest');
        if (latest?.data && latest.data.punchOut?.userTime == null) {
          throw new Error('An open punch exists elsewhere. Close or review it in OrangeHRM before creating this day.');
        }
        status.lines.push('✓ No open punch found.');
      }
      render();
      for (const step of plan.steps) {
        if (step.kind === 'in' || step.kind === 'out') {
          await createPunch(date, step);
          status.lines.push(`✓ ${step.time} ${step.kind === 'in' ? 'IN' : 'OUT'} saved.`);
        } else if (step.kind === 'edit') {
          await editRecord(date, step);
          status.lines.push(`✓ Record ${step.id} edited to ${step.to.start}–${step.to.end}.`);
        } else {
          await deleteRecord(date, step);
          status.lines.push(`✓ Record ${step.id} deleted.`);
        }
        render();
      }
      const actual = await getAttendance(date);
      state.existing.set(date, actual);
      state.errors.delete(date);
      if (actual.issues.length || !samePeriods(actual.periods, plan.requested)) {
        throw new Error('OrangeHRM returned records that do not match the requested periods.');
      }
      const retained = [...plan.kept.map(from => ({ from, to: from })),
        ...plan.steps.filter(step => step.kind === 'edit').map(step => ({ from: step.from, to: step.to }))];
      if (retained.some(({ from, to }) => !actual.periods.some(period =>
        period.id === from.id && period.start === to.start && period.end === to.end &&
        period.startNote === from.startNote && period.endNote === from.endNote)) ||
        plan.steps.some(step => step.kind === 'delete' && actual.periods.some(period => period.id === step.id))) {
        throw new Error('Record IDs, retained notes, or deletions did not match after saving.');
      }
      status.verified = true;
      status.lines.push(`VERIFIED ✓ OrangeHRM shows ${periodText(actual.periods)}.`);
      state.edited.delete(date);
      prefillDay(date);
      state.plan.set(date, planDay(date));
      return true;
    } catch (error) {
      status.error = error.message;
      status.lines.push('Processing stopped. No write was retried.');
      console.error('[PTT Week] Save stopped', date, error.message);
      try {
        const actual = await getAttendance(date);
        state.existing.set(date, actual);
        state.errors.delete(date);
        status.actual = periodText(actual.periods);
        status.lines.push(`Actual OrangeHRM state: ${periodText(actual.periods)}.`);
      } catch (readError) {
        state.errors.set(date, readError.message);
        status.actual = `Could not re-read: ${readError.message}`;
        status.lines.push(`Could not re-read day: ${readError.message}`);
      }
      invalidatePreview();
      return false;
    } finally {
      render();
    }
  }
  async function saveWeek() {
    const dates = currentDates();
    if (state.dryRun || state.busy || state.loading || !state.preview) return;
    const blocked = dates.filter(date => state.plan.get(date)?.kind === 'blocked');
    if (blocked.length) {
      state.notice = blocked.map(date => `${label(date)}: ${state.plan.get(date).reason}`).join(' ');
      render();
      return;
    }
    const changed = dates.filter(date => state.plan.get(date)?.kind === 'change');
    if (!changed.length) { state.notice = 'Nothing changed this week.'; render(); return; }
    const deletions = changed.reduce((count, date) => count +
      state.plan.get(date).steps.filter(step => step.kind === 'delete').length, 0);
    const edits = changed.reduce((count, date) => count +
      state.plan.get(date).steps.filter(step => step.kind === 'edit').length, 0);
    const creations = changed.reduce((count, date) => count +
      state.plan.get(date).steps.filter(step => step.kind === 'in').length, 0);
    const message = `Save ${changed.length} ${changed.length === 1 ? 'day' : 'days'} in OrangeHRM?\n\n` +
      `Records: ${creations} new, ${edits} edited, ${deletions} deleted.\n\n` +
      changed.map(date => `${label(date)}: ${periodText(state.plan.get(date).requested)}`).join('\n');
    if (!window.confirm(message)) { invalidatePreview(); return; }
    state.saveStatus.clear();
    state.busy = true;
    host.__pttBusy = true;
    render();
    try {
      for (const date of changed) {
        if (!await saveDay(date)) break;
      }
    } finally {
      state.busy = false;
      host.__pttBusy = false;
      invalidatePreview();
      const verified = [...state.saveStatus.values()].filter(status => status.verified).length;
      const failed = [...state.saveStatus.entries()].find(([, status]) => status.error);
      state.notice = failed ? `${verified} ${verified === 1 ? 'day' : 'days'} saved. Stopped on ${label(failed[0])}: ${failed[1].error} Actual: ${failed[1].actual || 'unknown'}.` :
        `${verified} ${verified === 1 ? 'day' : 'days'} saved.`;
      render();
    }
  }
  function refreshTotals() {
    const dates = currentDates();
    for (const date of dates) {
      const target = panel.querySelector(`[data-hours-date="${date}"]`);
      if (target) target.textContent = hours(duration(cellsToPeriods(state.cells.get(date))));
    }
    const weekTotal = dates.reduce((sum, date) => sum + duration(cellsToPeriods(state.cells.get(date))), 0);
    const strong = panel.querySelector('[data-week-total]');
    if (strong) strong.textContent = `Week: ${hours(weekTotal)}`;
    const footer = panel.querySelector('[data-week-total-footer]');
    if (footer) footer.textContent = hours(weekTotal);
    if (panel.querySelector('.note')) render();
  }
  function paintRectangle(cell) {
    if (!cell || !cell.classList.contains('cell') || !state.drag) return;
    const dates = currentDates();
    const targetDay = dates.indexOf(cell.dataset.date);
    const targetMinute = Number(cell.dataset.minute);
    if (targetDay < 0 || !Number.isFinite(targetMinute)) return;
    const drag = state.drag;
    if (drag.targetDay === targetDay && drag.targetMinute === targetMinute) return;
    drag.targetDay = targetDay;
    drag.targetMinute = targetMinute;
    const firstDay = Math.min(drag.anchorDay, targetDay);
    const lastDay = Math.max(drag.anchorDay, targetDay);
    const firstMinute = Math.min(drag.anchorMinute, targetMinute);
    const lastMinute = Math.max(drag.anchorMinute, targetMinute);
    state.edited = new Set(drag.editedBefore);
    state.gridNotes = new Map(drag.notesBefore);
    for (const date of dates) state.cells.set(date, new Set(drag.baseCells.get(date)));
    for (let day = firstDay; day <= lastDay; day++) {
      const date = dates[day];
      const cells = state.cells.get(date);
      for (let at = firstMinute; at <= lastMinute; at += CONFIG.gridMinutes) {
        if (drag.fill) cells.add(at); else cells.delete(at);
      }
      state.edited.add(date);
      state.gridNotes.delete(date);
      state.saveStatus.delete(date);
    }
    for (const shown of panel.querySelectorAll('.cell')) {
      shown.classList.toggle('on', state.cells.get(shown.dataset.date).has(Number(shown.dataset.minute)));
    }
    refreshTotals();
  }
  panel.addEventListener('pointerdown', event => {
    const cell = event.target.closest?.('.cell');
    if (!cell || state.loading || state.busy) return;
    event.preventDefault();
    const dates = currentDates();
    const anchorDate = cell.dataset.date;
    const anchorMinute = Number(cell.dataset.minute);
    state.drag = {
      fill: !state.cells.get(anchorDate).has(anchorMinute),
      anchorDay: dates.indexOf(anchorDate), anchorMinute,
      targetDay: null, targetMinute: null,
      baseCells: new Map(dates.map(date => [date, new Set(state.cells.get(date))])),
      editedBefore: new Set(state.edited), notesBefore: new Map(state.gridNotes)
    };
    invalidatePreview();
    if (panel.querySelector('.note')) render();
    paintRectangle(cell);
  });
  panel.addEventListener('pointerover', event => {
    if (state.drag) paintRectangle(event.target.closest?.('.cell'));
  });
  window.addEventListener('pointerup', () => { state.drag = null; }, { signal: listenerController.signal });
  window.addEventListener('beforeunload', event => {
    if (state.busy) { event.preventDefault(); event.returnValue = ''; }
  }, { signal: listenerController.signal });
  panel.addEventListener('click', event => {
    const button = event.target.closest?.('button[data-action]');
    if (!button || state.busy) return;
    const action = button.dataset.action;
    if (action === 'close') { host.__pttCleanup(); host.remove(); return; }
    if (action === 'previous' || action === 'next' || action === 'current') {
      state.monday = action === 'current' ? mondayOf(dateFromISO(londonToday())) :
        addDays(state.monday, action === 'previous' ? -7 : 7);
      invalidatePreview(); render(); loadWeek(); return;
    }
    if (action === 'refresh') { loadWeek(); return; }
    if (action === 'clear-day') {
      const date = button.dataset.date;
      state.cells.set(date, new Set());
      state.edited.add(date);
      state.gridNotes.delete(date);
      state.saveStatus.delete(date);
      invalidatePreview(); render(); return;
    }
    if (action === 'restore-day') {
      const date = button.dataset.date;
      state.edited.delete(date);
      prefillDay(date);
      state.saveStatus.delete(date);
      invalidatePreview(); render(); return;
    }
    if (action === 'copy') {
      const dates = currentDates();
      for (const date of dates.slice(1)) {
        state.cells.set(date, new Set(state.cells.get(dates[0])));
        state.edited.add(date);
        state.gridNotes.delete(date);
        state.saveStatus.delete(date);
      }
      invalidatePreview(); render(); return;
    }
    if (action === 'clear') {
      for (const date of currentDates()) {
        state.cells.set(date, new Set());
        state.edited.add(date);
        state.gridNotes.delete(date);
        state.saveStatus.delete(date);
      }
      invalidatePreview(); render(); return;
    }
    if (action === 'save') {
      state.notice = '';
      state.saveStatus.clear();
      state.plan = new Map(currentDates().map(date => [date, planDay(date)]));
      state.preview = true;
      console.info('[PTT Week] Save plan', [...state.plan.values()].map(p => ({ date: p.date, kind: p.kind, actions: p.steps?.length || 0 })));
      saveWeek(); return;
    }
  });
  async function loadWeek() {
    const generation = ++state.generation;
    const dates = currentDates();
    state.loading = true;
    for (const date of dates) {
      state.existing.delete(date); state.errors.delete(date); state.saveStatus.delete(date);
    }
    invalidatePreview(); render();
    for (const date of dates) {
      try {
        const attendance = await getAttendance(date);
        if (generation !== state.generation || !host.isConnected) return;
        state.existing.set(date, attendance);
        if (!state.edited.has(date)) prefillDay(date);
      } catch (error) {
        if (generation !== state.generation || !host.isConnected) return;
        state.errors.set(date, error.message);
        console.error('[PTT Week] Read failed', date, error.message);
      }
      render();
    }
    if (generation === state.generation) { state.loading = false; render(); }
  }
  console.info('[PTT Week] Ready. Review changes before saving. Writes are sequential; no write is retried.');
  render();
  loadWeek();
})();
