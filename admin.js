/* ════════════════════════════════════════════════════════════
   🔧  CONFIGURATION  —  SCRIPT_URL is now defined in auth.js
   ════════════════════════════════════════════════════════════ */
// (SCRIPT_URL, apiRead, apiWrite defined in auth.js — loaded first)

/* ── Runtime data ── */
let allLogs        = [];
let allMembers     = [];
let allContribs    = [];    // current year view
let allContribsAll = [];   // all months (for member payment totals)
let allContribLog  = [];   // full immutable audit trail
let allExpenses    = [];   // current year expenses

/* ── Modal instances & contribution-change state ── */
let contribModalInst = null;
let historyModalInst = null;
let cmState = { memberId: '', memberName: '', month: 0, year: 0, status: 'Paid' };

// apiRead, apiWrite — defined in auth.js (loaded before admin.js)

/* ════════════════════════════════════════════════════════════
   Boot
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  contribModalInst = new bootstrap.Modal(document.getElementById('contribModal'));
  historyModalInst = new bootstrap.Modal(document.getElementById('historyModal'));
  populateYearDropdown();
  initAttCalendar();
  // Auth boot is in auth.js — checks session, validates invite token, or shows login form
  authBoot();
});

/* ════════════════════════════════════════════════════════════
   Auth  (doLogin / doSetup / doLogout / doChangePassword defined in auth.js)
   ════════════════════════════════════════════════════════════ */

// Called by auth.js after successful login or valid session restore.
function enterAdmin(name, email) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-panel').style.display  = 'block';
  document.getElementById('navbar-admin-name').textContent =
    name ? `${name} (${email})` : (email || 'Admin');
  switchTab('mem');
  initDashboard();
}

/* ════════════════════════════════════════════════════════════
   Dashboard
   ════════════════════════════════════════════════════════════ */
async function initDashboard() {
  await Promise.all([loadLogs(), loadMembers(), loadContribLog(), loadAllContribs()]);
  updateTopStats();
  loadContribs();
}

async function refreshAll() {
  const btn = document.getElementById('refresh-btn');
  btn.innerHTML = '<span class="pk-spinner" style="border-top-color:#f5e6d3;border-color:rgba(255,255,255,0.2)"></span> Refreshing…';
  await initDashboard();
  btn.innerHTML = '<i class="bi bi-arrow-clockwise"></i> Refresh';
  showToast('Dashboard refreshed ✓');
}

async function loadAllContribs() {
  try {
    const data     = await apiRead({ action: 'getContributions' });
    allContribsAll = data.contributions || [];
  } catch { allContribsAll = []; }
}

async function loadContribLog() {
  try {
    const data    = await apiRead({ action: 'getContribLog' });
    allContribLog = data.log || [];
  } catch { allContribLog = []; }
}

/* ── Tabs ── */
function switchTab(id) {
  ['att','mem','con','exp','evt','set'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t === id);
    document.getElementById('panel-'+t).style.display = t === id ? 'block' : 'none';
  });
  if (id === 'set') loadSettingsTab();
  if (id === 'exp') loadExpenses();
  if (id === 'evt') loadEvents();
}

/* ════════════════════════════════════════════════════════════
   Attendance — Calendar + Matrix Views
   ════════════════════════════════════════════════════════════ */
const ATT_MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];

let _attYear        = new Date().getFullYear();
let _attMonth       = new Date().getMonth();  // 0-based
let _attSelected    = null;                   // null = All Members, else localId string
let _attDayMap      = {};                     // 'dd/MM/yyyy' → [localid, …] (all-members)
let _memberAttDates = {};                     // localid → Set<'dd/MM/yyyy'> (individual)
let _membersById    = {};                     // localid → member object
let _attSelectedDay = null;
let _attView        = 'calendar';             // 'calendar' | 'matrix'

/* ── Init ──────────────────────────────────────────────────── */
function initAttCalendar() {
  const mSel = document.getElementById('att-sel-month');
  const ySel = document.getElementById('att-sel-year');
  ATT_MONTH_NAMES.forEach((m, i) => mSel.add(new Option(m, i)));
  mSel.value = _attMonth;
  const now = new Date().getFullYear();
  for (let y = now + 1; y >= now - 5; y--) ySel.add(new Option(y, y));
  ySel.value = _attYear;

  // ── Permanent click listener on stable parent — set ONCE, never removed.
  //    Survives every innerHTML replacement inside #att-cal-weeks.
  document.getElementById('panel-att').addEventListener('click', function(e) {
    const cell = e.target.closest('.att-day-cell[data-date]');
    if (cell) _showAttDay(cell.dataset.date);
  });
}

/* ── View toggle ───────────────────────────────────────────── */
function switchAttView(view) {
  _attView = view;
  document.getElementById('att-btn-cal').classList.toggle('active', view === 'calendar');
  document.getElementById('att-btn-matrix').classList.toggle('active', view === 'matrix');

  const calWrap    = document.getElementById('att-cal-grid-wrap');
  const heatmapEl  = document.getElementById('att-heatmap-view');

  if (view === 'calendar') {
    calWrap.style.display   = '';
    heatmapEl.style.display = 'none';
  } else {
    calWrap.style.display   = 'none';
    heatmapEl.style.display = '';
    renderAttHeatmap();
  }
}

/* ── Populate member dropdown (called after members load) ──── */
function populateAttMemberDropdown() {
  const sel     = document.getElementById('att-sel-member');
  const current = sel.value;
  while (sel.options.length > 1) sel.remove(1);  // keep "All Members" option
  allMembers.forEach(m => sel.add(new Option(m.name, m.localId)));
  if (current && allMembers.some(m => m.localId === current)) {
    sel.value    = current;
    _attSelected = current;
  } else {
    sel.value    = '';
    _attSelected = null;
  }
}

/* ── Load logs ─────────────────────────────────────────────── */
async function loadLogs() {
  try {
    const data = await apiRead({ action: 'getLogs', limit: 1500 });
    allLogs = data.logs || [];
    _buildAttDayMap();
    _buildMemberAttDates();
    renderAttCalendar();
  } catch (e) {
    document.getElementById('att-cal-weeks').innerHTML =
      `<div style="padding:2rem;text-align:center;color:#e74c3c;">⚠️ ${esc(e.message)}</div>`;
  }
}

/* 'dd/MM/yyyy' → [{id, name}, …]  — all members (excludes voided) */
function _buildAttDayMap() {
  _attDayMap = {};
  allLogs.forEach(l => {
    if (!l.date || l.status === 'Voided') return;
    if (!_attDayMap[l.date]) _attDayMap[l.date] = [];
    _attDayMap[l.date].push({ id: l.localid || '', name: l.name || '?' });
  });
}

/**
 * Display name for the attendance grid.
 * Priority: member shortName → member first name → log's recorded name first word.
 * Never shows a raw UUID.
 */
function _displayName(entry) {
  // entry can be a {id, name} object (new) or a plain string (legacy)
  const id      = (typeof entry === 'object') ? entry.id   : entry;
  const logName = (typeof entry === 'object') ? entry.name : entry;
  const m = _membersById[id];
  if (m) return (m.shortName && m.shortName.trim()) ? m.shortName.trim() : m.name.split(' ')[0];
  // Fallback to the name recorded in the attendance log
  return logName ? logName.split(' ')[0] : (id || '?');
}

/* localid → Set<'dd/MM/yyyy'>  — per-member presence lookup (excludes voided) */
function _buildMemberAttDates() {
  _memberAttDates = {};
  allLogs.forEach(l => {
    if (!l.localid || !l.date || l.status === 'Voided') return;
    if (!_memberAttDates[l.localid]) _memberAttDates[l.localid] = new Set();
    _memberAttDates[l.localid].add(l.date);
  });
}

/* ── Navigation ────────────────────────────────────────────── */
function attCalNav(delta) {
  _attMonth += delta;
  if (_attMonth < 0)  { _attMonth = 11; _attYear--; }
  if (_attMonth > 11) { _attMonth = 0;  _attYear++; }
  document.getElementById('att-sel-month').value = _attMonth;
  document.getElementById('att-sel-year').value  = _attYear;
  _attSelectedDay = null;
  renderAttCalendar();
}

function attCalGoto() {
  _attMonth = parseInt(document.getElementById('att-sel-month').value);
  _attYear  = parseInt(document.getElementById('att-sel-year').value);
  _attSelectedDay = null;
  renderAttCalendar();
}

function attMemberChange() {
  _attSelected    = document.getElementById('att-sel-member').value || null;
  _attSelectedDay = null;
  closeAttDetail();
  renderAttCalendar();
}

/* ── Render calendar ───────────────────────────────────────── */
function renderAttCalendar() {
  document.getElementById('att-cal-title').textContent =
    `${ATT_MONTH_NAMES[_attMonth]} ${_attYear}`;

  const today    = new Date();
  const todayKey = _fmtDateKey(today.getDate(), today.getMonth() + 1, today.getFullYear());

  const firstDay = new Date(_attYear, _attMonth, 1);
  const daysInMo = new Date(_attYear, _attMonth + 1, 0).getDate();
  let   startDow = (firstDay.getDay() + 6) % 7;  // Mon=0 … Sun=6

  const cells = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMo }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);

  const isIndividual = !!_attSelected;
  const memberDates  = isIndividual ? (_memberAttDates[_attSelected] || new Set()) : null;

  // Footer summary
  if (isIndividual) {
    const presentCount = memberDates
      ? [...memberDates].filter(d => {
          const [dd, mm, yy] = d.split('/').map(Number);
          return mm - 1 === _attMonth && yy === _attYear;
        }).length
      : 0;
    document.getElementById('att-cal-total').textContent =
      presentCount ? `${presentCount} session${presentCount !== 1 ? 's' : ''} attended this month` : 'No sessions this month';
    document.getElementById('att-leg-present').textContent = 'Present';
    document.getElementById('att-leg-absent').textContent  = 'Not recorded';
  } else {
    let monthTotal = 0;
    for (let d = 1; d <= daysInMo; d++)
      monthTotal += (_attDayMap[_fmtDateKey(d, _attMonth + 1, _attYear)] || []).length;
    document.getElementById('att-cal-total').textContent =
      monthTotal ? `${monthTotal} record${monthTotal !== 1 ? 's' : ''} this month` : '';
    document.getElementById('att-leg-present').textContent = 'Has attendance';
    document.getElementById('att-leg-absent').textContent  = 'No record';
  }

  // Precompute today as a plain Date (midnight) for future-date comparison
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  // Build week rows
  const weeksHtml = [];
  for (let w = 0; w < cells.length / 7; w++) {
    const dayCells = cells.slice(w * 7, w * 7 + 7).map(dayNum => {
      if (dayNum === null) return `<div class="att-day-cell att-other-month"></div>`;

      const key      = _fmtDateKey(dayNum, _attMonth + 1, _attYear);
      const isToday  = key === todayKey;
      const isSel    = key === _attSelectedDay;
      const isFuture = new Date(_attYear, _attMonth, dayNum) > todayMid;
      const numCls   = isToday ? 'att-day-num att-today-num' : 'att-day-num';
      let inner      = `<div class="${numCls}">${dayNum}</div>`;
      let hasAtt     = false;

      if (isIndividual) {
        hasAtt = memberDates.has(key);
        if (hasAtt) {
          inner += `<div class="att-count-pill"><i class="bi bi-check2"></i> Present</div>`;
        }
      } else {
        const entries = _attDayMap[key] || [];
        hasAtt = entries.length > 0;
        if (hasAtt) {
          // De-duplicate by id, preserve first-seen entry for display
          const seen = new Map();
          entries.forEach(e => { if (!seen.has(e.id)) seen.set(e.id, e); });
          const unique  = [...seen.values()];
          inner += `<div class="att-count-pill">${unique.length} present</div>`;
          const preview = unique.slice(0, 3).map(e => esc(_displayName(e))).join(', ');
          const more    = unique.length > 3 ? ` +${unique.length - 3}` : '';
          inner += `<div class="att-day-names">${preview}${more}</div>`;
        }
      }

      // Future cells: greyed out, not clickable (no data-date)
      // Past / today cells: always clickable regardless of whether they have data
      const cls     = ['att-day-cell',
                        hasAtt    ? 'att-has-data' : '',
                        isSel     ? 'att-selected' : '',
                        isFuture  ? 'att-future'   : '']
                        .filter(Boolean).join(' ');
      const datAttr = isFuture ? '' : `data-date="${key}"`;

      return `<div class="${cls}" ${datAttr}>${inner}</div>`;
    }).join('');
    weeksHtml.push(`<div class="att-week-row">${dayCells}</div>`);
  }

  document.getElementById('att-cal-weeks').innerHTML = weeksHtml.join('');

  // Restore detail panel for the selected day (even if it has no data, so
  // the Mark Attendance form stays open after marking the first record).
  // Close only if the selected day is now a future date.
  if (_attSelectedDay) {
    const [sd, sm, sy] = _attSelectedDay.split('/').map(Number);
    const selIsFuture  = new Date(sy, sm - 1, sd) > todayMid;
    selIsFuture ? closeAttDetail() : _showAttDay(_attSelectedDay, true);
  }

  // Keep heatmap in sync if it's the active view
  if (_attView === 'matrix') renderAttHeatmap();
}

function _fmtDateKey(d, m, y) {
  return `${String(d).padStart(2,'0')}/${String(m).padStart(2,'0')}/${y}`;
}

/* ── Day detail panel ──────────────────────────────────────── */
function _showAttDay(dateKey, skipScroll) {
  _attSelectedDay = dateKey;

  document.querySelectorAll('.att-day-cell').forEach(el => el.classList.remove('att-selected'));
  const cell = document.querySelector(`.att-day-cell[data-date="${dateKey}"]`);
  if (cell) cell.classList.add('att-selected');

  const [dd, mm, yy] = dateKey.split('/').map(Number);
  const label = new Date(yy, mm - 1, dd).toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
  document.getElementById('att-detail-date').textContent = label;

  // Use allLogs for both views so we have timestamps + localIds for void buttons.
  // Exclude voided records from the main list.
  const dayLogs = allLogs.filter(l =>
    l.date === dateKey &&
    l.status !== 'Voided' &&
    (!_attSelected || l.localid === _attSelected)
  );

  let bodyHtml = '';

  if (_attSelected) {
    // ── Individual member view ──────────────────────────────
    const memberName = allMembers.find(m => m.localId === _attSelected)?.name || 'Member';
    const timeRows = dayLogs.map(l => {
      const ts      = l.timestamp ? new Date(l.timestamp) : null;
      const timeStr = ts ? ts.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '–';
      const isAdm   = l.status === 'AdminMark';
      return `<div class="att-detail-row">
        <i class="bi bi-${isAdm ? 'shield-check' : 'clock'}" style="color:var(--${isAdm ? 'orange' : 'blue'});font-size:1rem;"></i>
        <span style="flex:1;">Checked in at <strong>${timeStr}</strong>${isAdm ? ' <span style="font-size:0.75em;color:var(--orange);">(admin)</span>' : ''}</span>
        <button class="att-void-btn" onclick="voidAttendanceEntry('${escJs(l.timestamp)}','${escJs(l.localid)}','${dateKey}')">
          <i class="bi bi-x-circle"></i> Void
        </button>
      </div>`;
    }).join('');
    bodyHtml = `<div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">
      ${esc(memberName)} — ${dayLogs.length} record${dayLogs.length !== 1 ? 's' : ''}
    </div>${timeRows || '<div style="font-size:0.85rem;color:var(--muted);padding:0.25rem 0;">No attendance recorded.</div>'}`;
    // Mark attendance action
    bodyHtml += `<div class="att-detail-actions">
      <button class="att-mark-btn" onclick="adminMarkAttendanceEntry('${dateKey}','${escJs(_attSelected)}','${escJs(memberName)}')">
        <i class="bi bi-plus-circle"></i> Mark Attendance
      </button>
    </div>`;

  } else {
    // ── All-members view ────────────────────────────────────
    const rows = dayLogs.map(l => {
      const ts      = l.timestamp ? new Date(l.timestamp) : null;
      const timeStr = ts ? ts.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }) : '–';
      const isAdm   = l.status === 'AdminMark';
      return `<div class="att-detail-row">
        <i class="bi bi-${isAdm ? 'shield-check' : 'person-check'}" style="color:var(--${isAdm ? 'orange' : 'green'});font-size:1rem;"></i>
        <strong style="flex:1;">${esc(l.name)}</strong>
        <span style="color:var(--muted);font-size:0.8em;margin-right:0.4rem;">${timeStr}</span>
        <button class="att-void-btn" onclick="voidAttendanceEntry('${escJs(l.timestamp)}','${escJs(l.localid)}','${dateKey}')">
          <i class="bi bi-x-circle"></i> Void
        </button>
      </div>`;
    }).join('');
    const uniq = new Set(dayLogs.map(l => l.localid)).size;
    bodyHtml = `<div style="font-size:0.8rem;color:var(--muted);margin-bottom:0.5rem;">
      ${dayLogs.length} record${dayLogs.length !== 1 ? 's' : ''} · ${uniq} unique member${uniq !== 1 ? 's' : ''}
    </div>${rows || '<div style="font-size:0.85rem;color:var(--muted);padding:0.25rem 0;">No attendance recorded.</div>'}`;
    // Mark attendance action — member dropdown
    const memberOpts = allMembers
      .map(m => {
        const label = (m.shortName && m.shortName.trim())
          ? `${esc(m.shortName)} (${esc(m.name)})`
          : esc(m.name);
        return `<option value="${esc(m.localId)}" data-name="${esc(m.name)}">${label}</option>`;
      })
      .join('');
    bodyHtml += `<div class="att-detail-actions">
      <select id="att-mark-member" class="att-mark-sel">
        <option value="">Select member…</option>
        ${memberOpts}
      </select>
      <button class="att-mark-btn" onclick="adminMarkAttendanceEntry('${dateKey}')">
        <i class="bi bi-plus-circle"></i> Mark
      </button>
    </div>`;
  }

  document.getElementById('att-detail-body').innerHTML = bodyHtml;
  const panel = document.getElementById('att-detail-panel');
  panel.style.display = 'block';
  if (!skipScroll) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeAttDetail() {
  _attSelectedDay = null;
  document.getElementById('att-detail-panel').style.display = 'none';
  document.querySelectorAll('.att-day-cell').forEach(el => el.classList.remove('att-selected'));
}

/* ── Admin: Void an attendance record ─────────────────────── */
async function voidAttendanceEntry(timestamp, localId, dateKey) {
  if (!confirm('Void this attendance record?\n\nIt will be removed from counts and the calendar, but kept in the sheet for audit.')) return;
  try {
    const data = await apiRead({ action: 'voidAttendance', timestamp, localId });
    if (data.success) {
      // Mark the entry as Voided in the local cache — no full reload needed
      const entry = allLogs.find(l => l.timestamp === timestamp && l.localid === localId);
      if (entry) entry.status = 'Voided';
      _buildAttDayMap();
      _buildMemberAttDates();
      renderAttCalendar();
      _showAttDay(dateKey, true);   // refresh panel without scroll
      showToast('Attendance voided ✓');
    } else {
      showToast(data.error || 'Could not void record', 'error');
    }
  } catch {
    showToast('Network error — please try again', 'error');
  }
}

/* ── Admin: Mark attendance for a specific date ────────────── */
async function adminMarkAttendanceEntry(dateKey, localId, memberName) {
  // All-members view: localId + memberName come from the inline dropdown
  if (!localId) {
    const sel = document.getElementById('att-mark-member');
    if (!sel || !sel.value) {
      showToast('Please select a member first', 'error');
      return;
    }
    localId    = sel.value;
    memberName = sel.options[sel.selectedIndex]?.dataset?.name || sel.options[sel.selectedIndex]?.text || localId;
  }
  // Snapshot the button reference BEFORE any async op or DOM rebuild
  const btn = document.querySelector('#att-detail-panel .att-mark-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Marking…'; }
  try {
    const data = await apiRead({ action: 'adminMarkAttendance', localId, name: memberName, date: dateKey });
    if (data.success) {
      // Add to local cache so the panel refreshes immediately without a round-trip
      allLogs.push({
        timestamp:  new Date().toISOString(),
        localid:    localId,
        name:       memberName,
        instrument: '',
        location:   'Admin Mark',
        date:       dateKey,
        status:     'AdminMark',
      });
      _buildAttDayMap();
      _buildMemberAttDates();
      renderAttCalendar();
      _showAttDay(dateKey, true);  // rebuilds panel (btn ref is now stale — that's fine)
      showToast(`Marked: ${memberName} ✓`);
    } else {
      showToast(data.error || 'Could not mark attendance', 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-plus-circle"></i> Mark'; }
    }
  } catch {
    showToast('Network error — please try again', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-plus-circle"></i> Mark'; }
  }
}

/* ── Render heatmap (matrix view) ──────────────────────────── */
function renderAttHeatmap() {
  const container = document.getElementById('att-heatmap-view');

  // Collect dates with attendance data in the current month, sorted chronologically
  const activeDates = Object.keys(_attDayMap)
    .filter(key => {
      const [d, m, y] = key.split('/').map(Number);
      return m - 1 === _attMonth && y === _attYear;
    })
    .sort((a, b) => {
      const [da, ma, ya] = a.split('/').map(Number);
      const [db, mb, yb] = b.split('/').map(Number);
      return new Date(ya, ma - 1, da) - new Date(yb, mb - 1, db);
    });

  if (!activeDates.length) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-icon"><i class="bi bi-grid-3x3-gap" style="font-size:2rem;opacity:0.3;"></i></span>
      No attendance sessions recorded for ${ATT_MONTH_NAMES[_attMonth]} ${_attYear}.
    </div>`;
    return;
  }

  if (!allMembers.length) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-icon">👥</span>No members yet.
    </div>`;
    return;
  }

  // Column headers — day number + short weekday
  const dateHeaders = activeDates.map(key => {
    const [d, m, y] = key.split('/').map(Number);
    const dow = new Date(y, m - 1, d).toLocaleDateString('en-AU', { weekday: 'short' });
    return `<th title="${key}">${d}<br><span style="font-weight:400;opacity:0.65;font-size:0.65rem;">${dow}</span></th>`;
  }).join('');

  // Per-date attendance counts (for footer totals)
  const dateTotals = activeDates.map(key => (_attDayMap[key] || []).length);
  const grandTotal = dateTotals.reduce((s, n) => s + n, 0);

  // Member rows
  const rows = allMembers.map(m => {
    const memberDates = _memberAttDates[m.localId] || new Set();
    let memberTotal = 0;
    const cells = activeDates.map(key => {
      const present = memberDates.has(key);
      if (present) memberTotal++;
      return `<td>${present
        ? `<div class="hm-cell-present"><i class="bi bi-check2"></i></div>`
        : `<div class="hm-cell-absent">·</div>`
      }</td>`;
    }).join('');

    const isFocused = !!_attSelected && m.localId === _attSelected;
    const isDimmed  = !!_attSelected && m.localId !== _attSelected;
    const rowCls    = isFocused ? 'hm-row-focused' : (isDimmed ? 'hm-row-dimmed' : '');

    const displayName = (m.shortName && m.shortName.trim()) ? m.shortName.trim() : m.name;
    const fullTitle   = (m.shortName && m.shortName.trim()) ? `title="${esc(m.name)}"` : '';
    return `<tr class="${rowCls}">
      <td class="hm-name-col" ${fullTitle}>${esc(displayName)}</td>
      ${cells}
      <td class="hm-total-col">${memberTotal > 0 ? memberTotal : '<span style="color:#d0c8c0;font-weight:400;">0</span>'}</td>
    </tr>`;
  }).join('');

  // Footer: per-date totals
  const footerCells = dateTotals.map(t => `<td>${t}</td>`).join('');

  container.innerHTML = `<div class="att-heatmap-wrap">
    <table class="att-heatmap-table">
      <thead>
        <tr>
          <th class="hm-name-col">Member</th>
          ${dateHeaders}
          <th class="hm-total-col">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td class="hm-name-col">Attendees</td>
          ${footerCells}
          <td class="hm-total-col">${grandTotal}</td>
        </tr>
      </tfoot>
    </table>
  </div>`;
}

/* ════════════════════════════════════════════════════════════
   Members
   ════════════════════════════════════════════════════════════ */
async function loadMembers() {
  try {
    const data = await apiRead({ action: 'getMembers' });
    allMembers = data.members || [];
    // Build fast lookup so the attendance grid can resolve localId → displayName
    _membersById = {};
    allMembers.forEach(m => { _membersById[m.localId] = m; });
    renderMembers();
  } catch (e) {
    document.getElementById('mem-body').innerHTML =
      `<tr><td colspan="5" class="text-center py-3 text-danger">⚠️ ${esc(e.message)}</td></tr>`;
  }
}

function renderMembers() {
  const body = document.getElementById('mem-body');
  if (!allMembers.length) {
    body.innerHTML = `<tr><td colspan="5">
      <div class="empty-state"><span class="empty-icon">👥</span>No members yet. Use "Add Member" to add someone.</div>
    </td></tr>`;
    return;
  }

  body.innerHTML = allMembers.map((m, i) => {
    const tagBadges   = renderTagBadges(m.tags || '');
    const escapedTags = esc(m.tags || '');
    const escapedId   = esc(m.localId);
    const escapedName = esc(m.name);
    const shortLabel  = m.shortName ? `<span style="font-size:0.75rem;color:var(--muted);margin-left:0.3rem;">(${esc(m.shortName)})</span>` : '';
    const phoneHtml   = m.phone    ? `<div style="font-size:0.75rem;color:var(--muted);margin-top:0.15rem;"><i class="bi bi-telephone me-1"></i>${esc(m.phone)}</div>` : '';
    const notesHtml   = m.notes    ? `<div style="font-size:0.73rem;color:var(--faint);margin-top:0.15rem;font-style:italic;">${esc(m.notes)}</div>` : '';

    return `<tr>
      <td style="color:var(--muted);">${i+1}</td>
      <td>
        <strong>${escapedName}</strong>${shortLabel}
        ${phoneHtml}${notesHtml}
        ${tagBadges ? `<div style="margin-top:0.25rem;display:flex;flex-wrap:wrap;gap:0.25rem;">${tagBadges}</div>` : ''}
      </td>
      <td>${m.email ? `<a href="mailto:${esc(m.email)}" style="color:var(--blue);font-size:0.83rem;">${esc(m.email)}</a>` : '–'}</td>
      <td style="font-size:0.83rem;color:var(--muted);">${_timeAgo(m.joinDate || '–')}</td>
      <td>
        <button class="edit-tags-btn"
                onclick="openEditMemberModal('${escapedId}')">
          <i class="bi bi-pencil me-1"></i>Edit
        </button>
      </td>
    </tr>`;
  }).join('');

  populateAttMemberDropdown();
}

/* ── Navigate from Members → Contributions ──────────────────── */
function goToContribs(memberId, memberName) {
  switchTab('con');
  setTimeout(() => {
    const row = document.getElementById('cr-' + memberId);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.classList.remove('contrib-row-hi');
      void row.offsetWidth;
      row.classList.add('contrib-row-hi');
      setTimeout(() => row.classList.remove('contrib-row-hi'), 2200);
    }
    const now = new Date();
    openContribModal(memberId, memberName, now.getMonth() + 1, now.getFullYear());
  }, 180);
}

/* ── Edit Member ─────────────────────────────────────────────── */
let editMemberModalInst = null;

function openEditMemberModal(localId) {
  const m = allMembers.find(x => x.localId === localId);
  if (!m) return;

  if (!editMemberModalInst)
    editMemberModalInst = new bootstrap.Modal(document.getElementById('editMemberModal'));

  document.getElementById('em-member-id').value    = m.localId;
  document.getElementById('em-member-name').textContent = m.name;
  document.getElementById('em-shortname').value    = m.shortName || '';
  document.getElementById('em-phone').value        = m.phone     || '';
  document.getElementById('em-notes').value        = m.notes     || '';
  document.getElementById('em-error').style.display = 'none';

  _resetTagInput('em', m.tags || '');

  const btn = document.getElementById('em-submit');
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Save Changes';

  editMemberModalInst.show();
  setTimeout(() => document.getElementById('em-shortname').focus(), 350);
}

async function submitEditMember() {
  const localId   = document.getElementById('em-member-id').value;
  const shortName = document.getElementById('em-shortname').value.trim();
  const phone     = document.getElementById('em-phone').value.trim();
  const notes     = document.getElementById('em-notes').value.trim();
  const errEl     = document.getElementById('em-error');
  errEl.style.display = 'none';

  const typedTag = document.getElementById('em-tag-text').value.replace(/,/g, '').trim();
  if (typedTag) _addTag('em', typedTag);
  const tags = _tagState.em.join(',');

  const btn = document.getElementById('em-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="pk-spinner" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.2);display:inline-block;vertical-align:middle;"></span> Saving…';

  try {
    const res = await apiRead({ action: 'updateMember', localId, shortName, phone, notes, tags });
    if (!res.success) {
      errEl.textContent = res.error || 'Could not save changes. Please try again.';
      errEl.style.display = 'block';
      return;
    }
    editMemberModalInst.hide();
    await loadMembers();
    // Rebuild att maps so shortname shows immediately in the calendar
    _membersById = {};
    allMembers.forEach(m => { _membersById[m.localId] = m; });
    renderAttCalendar();
    if (_attView === 'matrix') renderAttHeatmap();
    showToast('Member updated ✓');
  } catch {
    errEl.textContent = 'Network error — please try again.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Save Changes';
  }
}

/* ── Add Member ─────────────────────────────────────────────── */
let addMemberModalInst = null;

function openAddMemberModal() {
  if (!addMemberModalInst)
    addMemberModalInst = new bootstrap.Modal(document.getElementById('addMemberModal'));
  document.getElementById('am-name').value      = '';
  document.getElementById('am-shortname').value = '';
  document.getElementById('am-email').value     = '';
  document.getElementById('am-phone').value     = '';
  document.getElementById('am-notes').value     = '';
  document.getElementById('am-name').classList.remove('is-invalid');
  document.getElementById('am-email').classList.remove('is-invalid');
  _resetTagInput('am', '');
  addMemberModalInst.show();
  setTimeout(() => document.getElementById('am-name').focus(), 350);
}

async function submitAddMember() {
  const name      = document.getElementById('am-name').value.trim();
  const shortName = document.getElementById('am-shortname').value.trim();
  const email     = document.getElementById('am-email').value.trim();
  const phone     = document.getElementById('am-phone').value.trim();
  const notes     = document.getElementById('am-notes').value.trim();

  let valid = true;
  if (!name) {
    document.getElementById('am-name').classList.add('is-invalid');
    valid = false;
  } else {
    document.getElementById('am-name').classList.remove('is-invalid');
  }
  if (!email) {
    document.getElementById('am-email').classList.add('is-invalid');
    document.getElementById('am-email-feedback').textContent = 'Email is required.';
    valid = false;
  } else {
    document.getElementById('am-email').classList.remove('is-invalid');
  }
  if (!valid) return;

  const typedTag = document.getElementById('am-tag-text').value.replace(/,/g,'').trim();
  if (typedTag) _addTag('am', typedTag);
  const tags = _tagState.am.join(',');

  const btn = document.getElementById('am-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="pk-spinner" style="width:16px;height:16px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.2);display:inline-block;vertical-align:middle;"></span> Adding…';

  try {
    const localId = generateUUID();
    // Use apiRead so we can inspect the response and catch email conflicts
    const data = await apiRead({ action: 'registerMember', localId, name, shortName, email, phone, notes, tags });

    if (data.emailConflict) {
      // Email already in use — show inline error, leave modal open
      const feedback = document.getElementById('am-email-feedback');
      feedback.textContent = data.error || 'This email is already registered to another member.';
      document.getElementById('am-email').classList.add('is-invalid');
      return;
    }

    if (!data.success && data.error) {
      showToast(`Error: ${data.error}`, 'error');
      return;
    }

    addMemberModalInst.hide();
    await Promise.all([loadMembers(), loadAllContribs()]);
    updateTopStats();
    showToast(`${name} added ✓`);
  } catch (err) {
    showToast('Network error — please try again.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Add Member';
  }
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

/* ════════════════════════════════════════════════════════════
   Tag / Role helpers
   ════════════════════════════════════════════════════════════ */

function tagColorIdx(tag) {
  let h = 0;
  for (let i = 0; i < tag.length; i++) h = ((h * 31) + tag.charCodeAt(i)) >>> 0;
  return h % 8;
}

function renderTagBadges(tagsStr) {
  if (!tagsStr) return '';
  return tagsStr.split(',')
    .map(t => t.trim()).filter(Boolean)
    .map(t => `<span class="role-tag role-tag-p${tagColorIdx(t)}">${esc(t)}</span>`)
    .join(' ');
}

const _tagState = { am: [], et: [] };

function handleTagKey(e, prefix) {
  const input = document.getElementById(prefix + '-tag-text');
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    const val = input.value.replace(/,/g, '').trim();
    if (val) _addTag(prefix, val);
    input.value = '';
  } else if (e.key === 'Backspace' && !input.value && _tagState[prefix].length) {
    _tagState[prefix].pop();
    _renderTagInput(prefix);
  }
}

function _addTag(prefix, val) {
  const exists = _tagState[prefix].some(t => t.toLowerCase() === val.toLowerCase());
  if (!exists) _tagState[prefix].push(val);
  _renderTagInput(prefix);
}

function _removeTag(prefix, idx) {
  _tagState[prefix].splice(idx, 1);
  _renderTagInput(prefix);
}

function _renderTagInput(prefix) {
  const wrap  = document.getElementById(prefix + '-tags-wrap');
  const input = document.getElementById(prefix + '-tag-text');
  wrap.innerHTML = '';
  _tagState[prefix].forEach((t, i) => {
    const cidx = tagColorIdx(t);
    const chip = document.createElement('span');
    chip.className = `tag-chip role-tag-p${cidx}`;
    chip.innerHTML =
      `${esc(t)}<span class="tag-chip-x" onclick="_removeTag('${prefix}',${i})" title="Remove">×</span>`;
    wrap.appendChild(chip);
  });
  wrap.appendChild(input);
  input.focus();
}

function _resetTagInput(prefix, existingCsv) {
  _tagState[prefix] = existingCsv
    ? existingCsv.split(',').map(t => t.trim()).filter(Boolean)
    : [];
  const wrap  = document.getElementById(prefix + '-tags-wrap');
  const input = document.getElementById(prefix + '-tag-text');
  wrap.innerHTML = '';
  _tagState[prefix].forEach((t, i) => {
    const cidx = tagColorIdx(t);
    const chip = document.createElement('span');
    chip.className = `tag-chip role-tag-p${cidx}`;
    chip.innerHTML =
      `${esc(t)}<span class="tag-chip-x" onclick="_removeTag('${prefix}',${i})" title="Remove">×</span>`;
    wrap.appendChild(chip);
  });
  input.value = '';
  wrap.appendChild(input);
}

/* ── Edit Tags modal ─────────────────────────────────────── */
let editTagsModalInst = null;
let _etMemberId = '';

function openEditTagsModal(memberId, memberName, currentTagsCsv) {
  if (!editTagsModalInst)
    editTagsModalInst = new bootstrap.Modal(document.getElementById('editTagsModal'));
  _etMemberId = memberId;
  document.getElementById('et-member-name').textContent = memberName;
  _resetTagInput('et', currentTagsCsv || '');
  editTagsModalInst.show();
  setTimeout(() => document.getElementById('et-tag-text').focus(), 350);
}

async function submitEditTags() {
  const typedVal = document.getElementById('et-tag-text').value.replace(/,/g,'').trim();
  if (typedVal) _addTag('et', typedVal);

  const tags = _tagState.et.join(',');
  const btn  = document.getElementById('et-submit');
  btn.disabled = true;
  btn.innerHTML = '<span class="pk-spinner" style="width:14px;height:14px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.2);display:inline-block;vertical-align:middle;"></span> Saving…';

  await apiRead({ action: 'updateMemberTags', localId: _etMemberId, tags });

  editTagsModalInst.hide();
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Save Tags';

  await loadMembers();
  showToast('Roles updated ✓');
}

/* ════════════════════════════════════════════════════════════
   Contributions
   ════════════════════════════════════════════════════════════ */
function populateYearDropdown() {
  const now      = new Date();
  const maxYear  = now.getFullYear();   // current year = highest selectable year
  const minYear  = maxYear - 4;         // show 5 years of history
  const ySel     = document.getElementById('con-year');
  ySel.innerHTML = '';
  for (let y = maxYear; y >= minYear; y--) {
    const o = new Option(y, y);
    ySel.add(o);
  }
  ySel.value = maxYear;  // default to current year
}

async function loadContribs() {
  const year = parseInt(document.getElementById('con-year').value);

  document.getElementById('contrib-container').innerHTML =
    '<div class="text-center py-4 text-muted"><span class="pk-spinner"></span>&nbsp; Loading…</div>';

  try {
    const data  = await apiRead({ action: 'getContributions', year });
    allContribs = data.contributions || [];
    renderContribs();
  } catch (e) {
    document.getElementById('contrib-container').innerHTML =
      `<div class="text-center py-4 text-danger">⚠️ ${esc(e.message)}</div>`;
  }
}

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function renderContribs() {
  const container = document.getElementById('contrib-container');
  const year      = parseInt(document.getElementById('con-year').value);

  if (!allMembers.length) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-icon">👥</span>
      No members yet. Go to the Members tab and click "Add Member".
    </div>`;
    return;
  }

  const cMap = {};
  allContribs.forEach(c => {
    cMap[String(c.memberId) + '-' + parseInt(c.month)] = c;
  });

  let paidCount = 0;
  allMembers.forEach(m => {
    if (allContribs.some(c => String(c.memberId) === String(m.localId) && c.status === 'Paid'))
      paidCount++;
  });
  const sPaidEl = document.getElementById('s-paid');
  if (sPaidEl) sPaidEl.textContent = paidCount;

  const monthHeaders = MONTH_ABBR.map(mo => `<th title="${mo}">${mo}</th>`).join('');

  const rows = allMembers.map(m => {
    // Per-year OB: prefer explicit year match, fall back to legacy year=0
    const ob      = allContribsAll.find(c =>
                      String(c.memberId) === String(m.localId) &&
                      parseInt(c.month) === 0 &&
                      parseInt(c.year) === year
                    ) || allContribsAll.find(c =>
                      String(c.memberId) === String(m.localId) &&
                      parseInt(c.month) === 0 &&
                      parseInt(c.year) === 0
                    );
    const obAmt    = ob ? (parseFloat(ob.amount) || 0) : 0;
    const obLabel  = ob ? `$${obAmt}` : '—';
    const obCls    = ob ? '' : 'ob-empty';
    const isAutoOB = ob && ob.notes && ob.notes.startsWith('[auto:');
    const obDot    = (ob && ob.notes && !isAutoOB) ? '<span class="mc-dot"></span>' : '';
    const autoTag  = isAutoOB ? '<span class="ob-auto-tag">auto</span>' : '';

    let monthlyPaid = 0;
    const monthCells = [1,2,3,4,5,6,7,8,9,10,11,12].map(mon => {
      const c = cMap[String(m.localId) + '-' + mon];
      if (!c) {
        return `<td><div class="mc mc-empty"
                    title="No record — click to add"
                    onclick="openContribModal('${esc(m.localId)}','${esc(m.name)}',${mon},${year})">—</div></td>`;
      }
      const isPaid = c.status === 'Paid';
      if (isPaid) monthlyPaid += parseFloat(c.amount) || 0;
      const cls = isPaid ? 'mc-paid' : 'mc-unpaid';
      const lbl = `$${c.amount || 30}`;
      const dot = c.notes ? '<span class="mc-dot"></span>' : '';
      const tip = isPaid ? `Paid $${c.amount || 30}` : `Void $${c.amount || 30}`;
      return `<td><div class="mc ${cls}" title="${tip}${c.notes ? ' · ' + c.notes : ''}"
                  onclick="openContribModal('${esc(m.localId)}','${esc(m.name)}',${mon},${year})"
                  >${lbl}${dot}</div></td>`;
    }).join('');

    const total    = obAmt + monthlyPaid;
    const totalCls = total > 0 ? 'cy-total' : 'cy-total cy-zero';
    const obTip    = ob ? `Opening Balance ${year}${ob.notes ? ' · ' + ob.notes : ''}` : `Opening Balance ${year} — click to add`;

    return `<tr id="cr-${esc(m.localId)}">
      <td class="cy-name">
        ${esc(m.name)}
        ${m.email ? `<br><small style="color:var(--muted);font-weight:400;font-size:0.7rem;">${esc(m.email)}</small>` : ''}
      </td>
      <td title="${esc(obTip)}">
        <button class="ob-btn ${obCls}"
                onclick="openContribModal('${esc(m.localId)}','${esc(m.name)}',0,${year})">
          ${obLabel}${obDot}${autoTag}
        </button>
      </td>
      ${monthCells}
      <td class="${totalCls}">$${total > 0 ? total : 0}</td>
      <td>
        <button class="contrib-history-btn"
                onclick="showHistory('${esc(m.localId)}','${esc(m.name)}')">
          <i class="bi bi-clock-history"></i>
        </button>
      </td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="contrib-year-wrap">
      <table class="contrib-year-table">
        <thead>
          <tr>
            <th class="cy-name">Member</th>
            <th title="Opening Balance — contributions before system tracking">Prev. Bal</th>
            ${monthHeaders}
            <th>Total</th>
            <th>Log</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ── Contribution change modal ─────────────────────────────── */

function openContribModal(memberId, memberName, month, year) {
  const isOB = (parseInt(month) === 0);
  const iYear = parseInt(year);

  let existing;
  if (isOB) {
    // Per-year OB: prefer explicit year match, fall back to legacy year=0
    existing = allContribsAll.find(c =>
      String(c.memberId) === String(memberId) &&
      parseInt(c.month) === 0 &&
      parseInt(c.year) === iYear
    ) || allContribsAll.find(c =>
      String(c.memberId) === String(memberId) &&
      parseInt(c.month) === 0 &&
      parseInt(c.year) === 0
    );
  } else {
    existing = allContribs.find(c =>
      String(c.memberId) === String(memberId) && parseInt(c.month) === parseInt(month)
    );
  }

  const hasRecord  = !!existing;
  // Normalise legacy 'Unpaid' → 'Void'
  const rawStatus  = hasRecord ? (existing.status || 'Void') : 'Paid';
  const initStatus = isOB ? 'Paid' : (rawStatus === 'Unpaid' ? 'Void' : rawStatus);

  cmState = { memberId, memberName, month: parseInt(month), year: iYear, status: initStatus, isOB };

  if (isOB) {
    document.getElementById('cm-title').textContent = `Opening Balance ${iYear} — ${memberName}`;
  } else {
    const mName = new Date(iYear, parseInt(month) - 1).toLocaleString('en', { month: 'long' });
    document.getElementById('cm-title').textContent = hasRecord
      ? `Edit Payment — ${memberName} · ${mName} ${iYear}`
      : `Record Payment — ${memberName} · ${mName} ${iYear}`;
  }

  document.getElementById('cm-status-section').style.display = isOB ? 'none' : '';
  // Void only makes sense when a record already exists — hide it for new entries
  document.getElementById('cm-btn-unpaid').style.display = hasRecord ? '' : 'none';

  document.getElementById('cm-notes-label').innerHTML = isOB
    ? `NOTES <span style="font-weight:400;color:var(--muted);">(optional — describe what this opening balance covers)</span>`
    : 'NOTES <span style="font-weight:400;color:var(--muted);">(payment method, ref, or months covered)</span>';
  document.getElementById('cm-notes').placeholder = isOB
    ? `e.g. Balance as at end of ${iYear - 1}`
    : 'e.g. Bank transfer ref #123, covers Feb + March';

  document.getElementById('cm-amount').previousElementSibling.innerHTML =
    isOB ? `OPENING BALANCE ${iYear} ($)` : 'AMOUNT RECEIVED ($)';

  // Strip auto-carry flag from notes display so admin sees clean value
  const rawNotes = hasRecord ? (existing.notes || '') : '';
  const displayNotes = rawNotes.replace(/^\[auto:\d{4}\]\s*/, '');
  document.getElementById('cm-notes').value = displayNotes;

  if (isOB) {
    // Compute expected OB from prior year's closing total (year-specific OBs only — no legacy year=0)
    const priorYear   = iYear - 1;
    const priorOBRow  = allContribsAll.find(c =>
      String(c.memberId) === String(memberId) &&
      parseInt(c.month) === 0 &&
      parseInt(c.year)  === priorYear
    );
    if (priorOBRow) {
      const priorOBAmt       = parseFloat(priorOBRow.amount) || 0;
      const priorMonthlyPaid = allContribsAll
        .filter(c =>
          String(c.memberId) === String(memberId) &&
          parseInt(c.year)   === priorYear        &&
          parseInt(c.month)  >= 1                 &&
          parseInt(c.month)  <= 12                &&
          c.status === 'Paid'
        )
        .reduce((sum, c) => sum + (parseFloat(c.amount) || 0), 0);
      const expectedOB = priorOBAmt + priorMonthlyPaid;

      document.getElementById('cm-amount').nextElementSibling.textContent =
        `Required: $${expectedOB.toFixed(2)} ` +
        `(${priorYear} Opening Balance $${priorOBAmt.toFixed(2)} + ` +
        `Monthly Contributions $${priorMonthlyPaid.toFixed(2)})`;

      // Pre-fill with the expected amount so admin doesn't have to calculate it
      document.getElementById('cm-amount').value = hasRecord
        ? (parseFloat(existing.amount) ?? expectedOB)
        : expectedOB;
    } else {
      document.getElementById('cm-amount').nextElementSibling.textContent =
        `No prior year opening balance found for ${priorYear} — enter the opening balance manually.`;
      document.getElementById('cm-amount').value = hasRecord ? (parseFloat(existing.amount) || 0) : 0;
    }
  } else {
    document.getElementById('cm-amount').nextElementSibling.textContent =
      'Default $30/month. Enter higher amount for catch-up payments (e.g. $60 for 2 months).';
    document.getElementById('cm-amount').value = hasRecord ? (existing.amount || 30) : 30;
  }

  const sess  = getSession();
  const name  = sess?.name  || '';
  const email = sess?.email || '';
  document.getElementById('cm-by').value = (name && email) ? `${name} (${email})` : (name || email || '');

  refreshCMButtons();

  if (isOB) {
    const submitBtn = document.getElementById('cm-submit');
    submitBtn.className = 'btn fw-bold btn-primary';
    submitBtn.textContent = hasRecord ? '✎ Update Opening Balance' : '✓ Save Opening Balance';
  }

  contribModalInst.show();
}

function setCMStatus(status) {
  cmState.status = status;
  refreshCMButtons();
}

function refreshCMButtons() {
  const paid   = cmState.status === 'Paid';
  const btnP   = document.getElementById('cm-btn-paid');
  const btnU   = document.getElementById('cm-btn-unpaid');
  const submit = document.getElementById('cm-submit');
  btnP.className   = `status-toggle-btn ${paid  ? 'btn btn-success' : 'btn btn-outline-secondary'}`;
  btnU.className   = `status-toggle-btn ${!paid ? 'btn btn-danger'  : 'btn btn-outline-secondary'}`;
  submit.className = `btn fw-bold ${paid ? 'btn-success' : 'btn-danger'}`;
  submit.textContent = paid ? '✓ Mark as Paid' : '✗ Mark as Void';
}

async function submitContribChange() {
  const { memberId, memberName, month, year, status, isOB } = cmState;
  const notes       = document.getElementById('cm-notes').value.trim();
  const changedBy   = document.getElementById('cm-by').value.trim() || 'Admin';
  const amount      = parseFloat(document.getElementById('cm-amount').value) || 0;
  const finalStatus = isOB ? 'Paid' : status;
  // OB rows now use the actual year (not hardcoded 0) — Code.gs strips [auto:] prefix
  const saveYear    = year;

  const btn      = document.getElementById('cm-submit');
  btn.disabled   = true;
  btn.textContent = 'Saving…';

  try {
    const res = await apiRead({
      action: 'updateContribution',
      memberId, memberName,
      month,
      year: saveYear,
      amount, status: finalStatus, notes, changedBy
    });

    if (!res.success) throw new Error(res.error || 'Save failed');

    contribModalInst.hide();
    await Promise.all([loadContribLog(), loadAllContribs()]);
    await loadContribs();

    showToast(isOB ? `Opening balance ${year} saved for ${memberName} ✓` : `${memberName} — ${finalStatus} ✓`);
  } catch (e) {
    showToast(`Save failed: ${e.message}`, 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = isOB ? (cmState.status === 'Paid' ? '✎ Update Opening Balance' : '✓ Save Opening Balance') : (cmState.status === 'Paid' ? '✓ Mark as Paid' : '✗ Mark as Void');
  }
}

/* ── Carry-forward helpers ──────────────────────────────────── */

/**
 * Called after loadContribs(). If the selected year has NO OB rows for any
 * member (i.e. it's a brand-new year), automatically trigger carry-forward
 * from the prior year.  Skips if year has any data already.
 */
async function checkAndCarryForward(year) {
  const currentYear = new Date().getFullYear();
  // Only auto-carry for years that exist (past or current) and that have
  // at least one prior year worth of data to carry from.
  if (year <= 2020 || year > currentYear) return;

  // Check if any OB rows already exist for this year
  const hasOBForYear = allContribsAll.some(c =>
    parseInt(c.month) === 0 && parseInt(c.year) === year
  );
  if (hasOBForYear) return;  // already set up — nothing to do

  // Check if there's any data at all in the prior year
  const priorYear = year - 1;
  const hasPriorData = allContribsAll.some(c => parseInt(c.year) === priorYear || parseInt(c.year) === 0);
  if (!hasPriorData) return;  // no prior data to carry from

  try {
    const res = await apiRead({ action: 'autoCarryForward', year: String(year), force: 'false' });
    if (res.success && (res.carried > 0 || res.updated > 0)) {
      // Reload allContribsAll to include the new OB rows
      await loadAllContribs();
      renderContribs();
      showCarryForwardBanner(year, priorYear, res);
    }
  } catch (e) {
    console.warn('checkAndCarryForward failed:', e);
  }
}

/**
 * After a contribution is edited in `fromYear`, cascade-reconcile the
 * auto-flagged OBs in subsequent years up to the current year.
 */
async function reconcileSubsequentOBs(fromYear) {
  const currentYear = new Date().getFullYear();
  for (let y = fromYear + 1; y <= currentYear; y++) {
    // Only reconcile years that have auto-carry OBs
    const hasAutoOBs = allContribsAll.some(c =>
      parseInt(c.month) === 0 &&
      parseInt(c.year) === y &&
      String(c.notes || '').startsWith('[auto:')
    );
    if (!hasAutoOBs) break; // no auto OBs in this year — stop cascading

    try {
      await apiRead({ action: 'autoCarryForward', year: String(y), force: 'true' });
    } catch (e) {
      console.warn(`reconcileSubsequentOBs failed for year ${y}:`, e);
      break;
    }
  }

  // Reload to pick up reconciled values
  await Promise.all([loadAllContribs(), loadContribLog()]);
  const selectedYear = parseInt(document.getElementById('con-year').value);
  if (selectedYear > fromYear) renderContribs();
}

/**
 * Show the green informational banner when carry-forward completes.
 */
function showCarryForwardBanner(toYear, fromYear, res) {
  const banner = document.getElementById('carry-forward-banner');
  if (!banner) return;

  const count = (res.carried || 0) + (res.updated || 0);
  banner.innerHTML = `
    <div class="cf-banner">
      <span class="cf-banner-icon">✅</span>
      <div class="cf-banner-body">
        <div class="cf-banner-title">Opening Balances carried forward to ${toYear}</div>
        <div class="cf-banner-detail">
          ${count} member${count !== 1 ? 's' : ''} had their end-of-${fromYear} balance
          automatically carried forward as the ${toYear} Opening Balance.
          ${res.skipped > 0 ? `${res.skipped} manually-set balance${res.skipped !== 1 ? 's' : ''} were preserved.` : ''}
          You can click any <span class="ob-auto-tag" style="font-size:0.65rem;">auto</span> badge
          to review or override a specific balance.
        </div>
      </div>
      <button class="cf-banner-close" onclick="document.getElementById('carry-forward-banner').style.display='none';" aria-label="Dismiss">✕</button>
    </div>`;
  banner.style.display = '';
}

/* ── History modal ─────────────────────────────────────────── */

function showHistory(memberId, memberName) {
  document.getElementById('hm-title').textContent = `Audit Trail — ${memberName}`;

  const currentRecords = allContribsAll
    .filter(c => String(c.memberId) === String(memberId) && parseInt(c.month) > 0)
    .sort((a, b) => {
      if (parseInt(a.year) !== parseInt(b.year)) return parseInt(b.year) - parseInt(a.year);
      return parseInt(b.month) - parseInt(a.month);
    });
  // Collect all OB rows for this member (one per year)
  const currentOBs = allContribsAll.filter(c =>
    String(c.memberId) === String(memberId) && parseInt(c.month) === 0
  ).sort((a, b) => parseInt(b.year) - parseInt(a.year));

  let section1Html = '';
  if (currentRecords.length || currentOBs.length) {
    const allCurrent = [...currentOBs, ...currentRecords];
    section1Html = `
      <h6 class="fw-semibold mb-2" style="color:var(--accent);">Current Payment Records</h6>
      <div class="table-responsive mb-3">
        <table class="table table-sm history-table mb-0">
          <thead><tr>
            <th>Month</th><th>Status</th><th>Amount</th><th>Notes</th><th>Last Updated</th><th>By</th>
          </tr></thead>
          <tbody>
            ${allCurrent.map(c => {
              const isOBRec = parseInt(c.month) === 0;
              const obYear  = isOBRec ? (parseInt(c.year) || 'Legacy') : '';
              const mLabel  = isOBRec
                ? `<span style="color:#1a4a8a;font-weight:600;">Opening Balance ${obYear}</span>`
                : new Date(parseInt(c.year), parseInt(c.month) - 1)
                    .toLocaleString('en', { month: 'short' }) + ' ' + c.year;
              const rawNotes    = c.notes || '';
              const displayNote = rawNotes.replace(/^\[auto:\d{4}\]\s*/, '');
              const isAuto      = rawNotes.startsWith('[auto:');
              const notesHtml   = displayNote
                ? `<span style="color:#333;">${esc(displayNote)}${isAuto ? ' <span class="ob-auto-tag">auto</span>' : ''}</span>`
                : (isAuto ? '<span class="ob-auto-tag">auto</span>' : '<span class="text-muted">—</span>');
              return `<tr>
                <td>${mLabel}</td>
                <td><span class="${c.status === 'Paid' ? 'badge-paid' : 'badge-unpaid'}">${c.status === 'Paid' ? 'Paid' : 'Void'}</span></td>
                <td>$${c.amount || 0}</td>
                <td>${notesHtml}</td>
                <td style="white-space:nowrap;">${fmtTs(c.lastUpdated)}</td>
                <td>${esc(c.changedBy || 'Admin')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  }

  const entries = allContribLog.filter(e => String(e.memberId) === String(memberId));
  let section2Html = '';
  if (entries.length) {
    section2Html = `
      <h6 class="fw-semibold mb-2" style="color:var(--accent);">Change Log</h6>
      <div class="table-responsive">
        <table class="table table-sm history-table mb-0">
          <thead><tr>
            <th>Date &amp; Time</th><th>Month</th><th>Status</th><th>Amount</th><th>Notes</th><th>Recorded by</th>
          </tr></thead>
          <tbody>
            ${entries.map(e => {
              const isOBEntry = parseInt(e.month) === 0;
              const mLabel = isOBEntry
                ? '<span style="color:#1a4a8a;font-weight:600;">Opening Balance</span>'
                : new Date(parseInt(e.year), parseInt(e.month) - 1)
                    .toLocaleString('en', { month: 'short' }) + ' ' + e.year;
              const notesHtml = e.notes
                ? `<span style="color:#333;">${esc(e.notes)}</span>`
                : '<span class="text-muted">—</span>';
              return `<tr>
                <td style="white-space:nowrap;">${fmtTs(e.timestamp)}</td>
                <td>${mLabel}</td>
                <td><span class="${e.status === 'Paid' ? 'badge-paid' : 'badge-unpaid'}">${e.status === 'Paid' ? 'Paid' : 'Void'}</span></td>
                <td>$${e.amount || 0}</td>
                <td>${notesHtml}</td>
                <td>${esc(e.changedBy || 'Admin')}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;
  } else if (!section1Html) {
    section2Html = '<div class="text-center text-muted py-4">No history recorded yet for this member.</div>';
  }

  document.getElementById('hm-body').innerHTML = section1Html + section2Html;
  historyModalInst.show();
}

/* ════════════════════════════════════════════════════════════
   Stats
   ════════════════════════════════════════════════════════════ */
function updateTopStats() {
  document.getElementById('s-members').textContent = allMembers.length;

  const now   = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();

  const paidThisMonth = allContribsAll.filter(c => {
    return parseInt(c.month) === month && parseInt(c.year) === year && c.status === 'Paid';
  });
  const sPaid = document.getElementById('s-paid');
  if (sPaid) sPaid.textContent = paidThisMonth.length;
}

/* ════════════════════════════════════════════════════════════
   Utilities
   ════════════════════════════════════════════════════════════ */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* Human-friendly relative date + formatted date in brackets.
   Input: joinDate string as stored in sheet — typically 'D/M/YYYY' or 'DD/MM/YYYY'
   Output: e.g.  "2 years 3 months ago (4 Aug 2024)"  or  "just now"             */
function _timeAgo(dateStr) {
  if (!dateStr || dateStr === '–') return '–';

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  let d, mo, y;
  const s = String(dateStr).trim();

  if (s.includes('T') || s.includes('-')) {
    // ISO format: 2026-04-10T05:00:00.000Z  or  2026-04-10
    const dt = new Date(s);
    if (isNaN(dt)) return esc(dateStr);
    d  = dt.getUTCDate();
    mo = dt.getUTCMonth() + 1;
    y  = dt.getUTCFullYear();
  } else if (s.includes('/')) {
    // Sheet format: D/M/YYYY or DD/MM/YYYY
    const parts = s.split('/').map(Number);
    if (parts.length !== 3) return esc(dateStr);
    [d, mo, y] = parts;
  } else {
    return esc(dateStr);
  }
  if (!d || !mo || !y) return esc(dateStr);

  // Formatted date label  →  "4 Aug 2024"
  const label = `${d} ${months[mo - 1]} ${y}`;

  const now      = new Date();
  // Zero out time components for day-accurate math
  const nowDay   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thenDay  = new Date(y, mo - 1, d);
  const diffMs   = nowDay - thenDay;
  const diffDays = Math.round(diffMs / 86400000);

  let rel;
  if (diffDays < 0) {
    rel = 'in the future';
  } else if (diffDays === 0) {
    rel = 'today';
  } else if (diffDays === 1) {
    rel = 'yesterday';
  } else if (diffDays < 7) {
    rel = `${diffDays} days ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    rel = `${weeks} week${weeks > 1 ? 's' : ''} ago`;
  } else if (diffDays < 365) {
    const mos = Math.floor(diffDays / 30);
    rel = `${mos} month${mos > 1 ? 's' : ''} ago`;
  } else {
    const years = Math.floor(diffDays / 365);
    const remDays = diffDays - years * 365;
    const mos = Math.floor(remDays / 30);
    if (mos > 0) {
      rel = `${years} year${years > 1 ? 's' : ''} ${mos} month${mos > 1 ? 's' : ''} ago`;
    } else {
      rel = `${years} year${years > 1 ? 's' : ''} ago`;
    }
  }

  if (rel === 'today' || rel === 'yesterday') return `${rel} (${label})`;
  return `${rel}<br><small style="font-size:0.75em;opacity:0.7;">${label}</small>`;
}
/* Escape for use inside onclick='…' single-quoted JS string literals */
function escJs(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function fmtTs(ts) {
  if (!ts) return '–';
  try {
    const d = new Date(ts);
    return d.toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' })
           + ' ' + d.toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit' });
  } catch { return String(ts); }
}

let toastTimer;
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.toggle('toast-error', type === 'error');
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('show'); el.classList.remove('toast-error'); }, type === 'error' ? 4000 : 2800);
}

/* ════════════════════════════════════════════════════════════
   Settings Tab — Admin management & Invite management
   ════════════════════════════════════════════════════════════ */

async function loadSettingsTab() {
  await Promise.all([loadAdminList(), loadInviteList(), loadCheckinSettings()]);
}

/* ════════════════════════════════════════════════════════════
   Check-in Security  (session gate feature flag)
   ════════════════════════════════════════════════════════════ */

async function loadCheckinSettings() {
  try {
    const res = await apiRead({ action: 'getCheckinSettings' });
    if (res.error) return; // silently skip on error

    const toggle   = document.getElementById('toggle-require-session');
    const controls = document.getElementById('session-gate-controls');

    toggle.checked  = !!res.requireOpenSession;
    controls.style.display = res.requireOpenSession ? 'block' : 'none';

    if (res.requireOpenSession) {
      renderSessionStatus(res.sessionOpen, res.sessionDate);
    }
  } catch {
    // Non-critical — silently skip
  }
}

function renderSessionStatus(isOpen, sessionDate) {
  const label     = document.getElementById('session-status-label');
  const btnOpen   = document.getElementById('btn-open-session');
  const btnClose  = document.getElementById('btn-close-session');
  const today     = new Date().toISOString().slice(0, 10);
  const isToday   = sessionDate === today;

  if (isOpen && isToday) {
    label.innerHTML = '<span class="badge" style="background:#27ae60;">● OPEN</span>'
                    + `<span style="font-size:0.75rem;color:var(--muted);margin-left:0.5rem;">${sessionDate}</span>`;
    btnOpen.style.display  = 'none';
    btnClose.style.display = '';
  } else {
    label.innerHTML = '<span class="badge bg-secondary">○ CLOSED</span>';
    btnOpen.style.display  = '';
    btnClose.style.display = 'none';
  }
}

async function onSessionGateToggle(enabled) {
  const statusEl = document.getElementById('checkin-settings-status');
  const controls = document.getElementById('session-gate-controls');
  statusEl.textContent = 'Saving…';

  // For settings that write, we need admin credentials. Since the session
  // only stores email+name (password hash is never persisted client-side for
  // security), we re-verify via a quick prompt-free path. Because verifyAdmin
  // requires a hash we cannot reconstruct without the password, we pass the
  // action through the worker and let the GAS-side check handle it gracefully.
  // If you want strict auth here, prompt for password confirmation.
  try {
    const res = await apiRead({ action: 'saveCheckinSettings', requireOpenSession: enabled });

    if (res.error) {
      statusEl.style.color = '#e74c3c';
      statusEl.textContent = 'Could not save — try again.';
      // Revert the toggle visually
      document.getElementById('toggle-require-session').checked = !enabled;
      return;
    }

    controls.style.display = enabled ? 'block' : 'none';
    if (enabled) renderSessionStatus(false, '');
    statusEl.style.color   = 'var(--muted)';
    statusEl.textContent   = enabled
      ? 'Session gate enabled. Open a session before each rehearsal.'
      : 'Session gate off — QR code works at any time.';

  } catch {
    statusEl.style.color = '#e74c3c';
    statusEl.textContent = 'Network error — setting not saved.';
    document.getElementById('toggle-require-session').checked = !enabled;
  }
}

async function openCheckinSession() {
  const statusEl = document.getElementById('checkin-settings-status');
  statusEl.textContent = 'Opening session…';
  try {
    const res = await apiRead({ action: 'openCheckinSession' });
    if (res.success) {
      renderSessionStatus(true, res.sessionDate);
      statusEl.style.color = '#27ae60';
      statusEl.textContent = `Session opened for ${res.sessionDate}.`;
    } else {
      statusEl.style.color = '#e74c3c';
      statusEl.textContent = res.error || 'Could not open session.';
    }
  } catch {
    statusEl.style.color = '#e74c3c';
    statusEl.textContent = 'Network error.';
  }
}

async function closeCheckinSession() {
  const statusEl = document.getElementById('checkin-settings-status');
  statusEl.textContent = 'Closing session…';
  try {
    const res = await apiRead({ action: 'closeCheckinSession' });
    if (res.success) {
      renderSessionStatus(false, '');
      statusEl.style.color = 'var(--muted)';
      statusEl.textContent = 'Session closed.';
    } else {
      statusEl.style.color = '#e74c3c';
      statusEl.textContent = res.error || 'Could not close session.';
    }
  } catch {
    statusEl.style.color = '#e74c3c';
    statusEl.textContent = 'Network error.';
  }
}

/* ── Admin list ─────────────────────────────────────────────── */

async function loadAdminList() {
  const body = document.getElementById('admin-list-body');
  body.innerHTML = '<div class="text-muted" style="font-size:0.85rem;">Loading…</div>';
  try {
    const res     = await apiRead({ action: 'listAdmins' });
    const admins  = res.admins || [];
    const myEmail = getSession()?.email || '';

    if (!admins.length) {
      body.innerHTML = '<div class="text-muted" style="font-size:0.85rem;">No admin accounts found.</div>';
      return;
    }

    body.innerHTML = admins.map(a => {
      const isSelf    = a.email.toLowerCase() === myEmail.toLowerCase();
      const createdAt = a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' }) : '—';
      return `<div class="admin-row">
        <div class="admin-row-info">
          <strong>${esc(a.name)}</strong>
          <span style="color:var(--muted);font-size:0.8rem;margin-left:0.4rem;">${esc(a.email)}</span>
          ${isSelf ? '<span class="badge-self">You</span>' : ''}
          <div style="font-size:0.73rem;color:var(--muted);margin-top:0.1rem;">
            Added ${createdAt}${a.createdBy && a.createdBy !== a.email ? ' by ' + esc(a.createdBy) : ''}
          </div>
        </div>
        ${!isSelf ? `<button class="btn btn-sm btn-outline-danger" style="border-radius:8px;font-size:0.78rem;"
                onclick="removeAdminAccount('${esc(a.email)}','${esc(a.name)}')">
          <i class="bi bi-person-x"></i> Remove
        </button>` : ''}
      </div>`;
    }).join('');
  } catch (e) {
    body.innerHTML = `<div style="color:#e74c3c;font-size:0.85rem;">⚠️ ${esc(e.message)}</div>`;
  }
}

async function removeAdminAccount(email, name) {
  if (!confirm(`Remove admin access for ${name} (${email})?\n\nThey will no longer be able to log in.`)) return;
  try {
    const res = await apiRead({ action: 'removeAdmin', email });
    if (res.success) {
      showToast(`${name} removed ✓`);
      loadAdminList();
    } else {
      showToast(res.error || 'Could not remove admin', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ── Invite management ──────────────────────────────────────── */

async function generateInviteLink() {
  const createdBy = getSession()?.email || 'Admin';
  try {
    const res = await apiRead({ action: 'generateInvite', createdBy });
    if (!res.success) { showToast(res.error || 'Could not generate invite', 'error'); return; }

    const base = window.location.origin + window.location.pathname.replace(/[^/]*$/, 'invite.html');
    const link = `${base}?token=${res.token}`;
    document.getElementById('invite-link-input').value = link;

    const exp = new Date(res.expiresAt);
    document.getElementById('invite-expiry-label').textContent =
      `Expires: ${exp.toLocaleString('en-AU', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}`;

    document.getElementById('invite-link-box').style.display = '';
    loadInviteList();
    showToast('Invite link generated ✓');
  } catch (e) {
    showToast(e.message, 'error');
  }
}

function copyInviteLink() {
  const input = document.getElementById('invite-link-input');
  navigator.clipboard.writeText(input.value).then(() => {
    const btn = document.getElementById('copy-invite-btn');
    btn.innerHTML = '<i class="bi bi-check2"></i> Copied!';
    setTimeout(() => { btn.innerHTML = '<i class="bi bi-clipboard"></i> Copy'; }, 2000);
  }).catch(() => {
    input.select();
    document.execCommand('copy');
    showToast('Copied ✓');
  });
}

async function loadInviteList() {
  const body = document.getElementById('invite-list-body');
  try {
    const res     = await apiRead({ action: 'listInvites' });
    const invites = res.invites || [];

    if (!invites.length) {
      body.innerHTML = '<div class="text-muted" style="font-size:0.83rem;">No invites generated yet.</div>';
      return;
    }

    body.innerHTML = `<div class="table-responsive">
      <table class="table table-sm" style="font-size:0.82rem;">
        <thead><tr style="color:var(--muted);">
          <th>Status</th><th>Generated</th><th>Expires</th><th>By</th><th>Used by</th><th></th>
        </tr></thead>
        <tbody>
          ${invites.map(iv => {
            const statusCls = iv.status === 'pending' ? 'badge-paid' : (iv.status === 'used' ? 'badge bg-secondary' : 'badge-unpaid');
            const genDate   = iv.createdAt ? new Date(iv.createdAt).toLocaleDateString('en-AU', {day:'numeric',month:'short'}) : '—';
            const expDate   = iv.expiresAt ? new Date(iv.expiresAt).toLocaleDateString('en-AU', {day:'numeric',month:'short'}) : '—';
            const revokeBtn = iv.status === 'pending'
              ? `<button class="btn btn-sm btn-outline-danger" style="border-radius:6px;font-size:0.73rem;padding:2px 8px;"
                         onclick="revokeInviteToken('${esc(iv.token)}')">Revoke</button>` : '';
            return `<tr>
              <td><span class="${statusCls}" style="text-transform:capitalize;">${iv.status}</span></td>
              <td>${genDate}</td>
              <td>${expDate}</td>
              <td style="color:var(--muted);">${esc(iv.createdBy || '—')}</td>
              <td style="color:var(--muted);">${esc(iv.usedByEmail || '—')}</td>
              <td>${revokeBtn}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
  } catch (e) {
    body.innerHTML = `<div style="color:#e74c3c;font-size:0.83rem;">⚠️ ${esc(e.message)}</div>`;
  }
}

async function revokeInviteToken(token) {
  if (!confirm('Revoke this invite? It will immediately stop working.')) return;
  try {
    const res = await apiRead({ action: 'revokeInvite', token });
    if (res.success) { showToast('Invite revoked ✓'); loadInviteList(); }
    else showToast(res.error || 'Could not revoke', 'error');
  } catch (e) { showToast(e.message, 'error'); }
}

/* ════════════════════════════════════════════════════════════
   Expenses
   ════════════════════════════════════════════════════════════ */

const EXP_CATEGORIES = [
  'Venue',
  'Instruments & Equipment',
  'Materials & Props',
  'Food & Refreshments',
  'Travel',
  'Marketing & Printing',
  'Other',
];

// Category → colour class (reuse role-tag palette)
const EXP_CAT_COLOR = {
  'Venue':                    'role-tag-p0',
  'Instruments & Equipment':  'role-tag-p1',
  'Materials & Props':        'role-tag-p2',
  'Food & Refreshments':      'role-tag-p3',
  'Travel':                   'role-tag-p4',
  'Marketing & Printing':     'role-tag-p5',
  'Other':                    'role-tag-p6',
};

/* ── Year selector (mirrors contribution year dropdown) ── */
function populateExpYearDropdown() {
  const now     = new Date().getFullYear();
  const ySel    = document.getElementById('exp-year');
  const stmtSel = document.getElementById('stmt-year');
  [ySel, stmtSel].forEach(sel => {
    if (!sel) return;
    sel.innerHTML = '';
    for (let y = now; y >= now - 4; y--) sel.add(new Option(y, y));
    sel.value = now;
  });
}

/* ── Load ── */
async function loadExpenses() {
  if (!document.getElementById('exp-year').options.length) populateExpYearDropdown();
  const year = parseInt(document.getElementById('exp-year').value);
  document.getElementById('exp-body').innerHTML =
    '<tr><td colspan="8" class="text-center py-4 text-muted"><span class="pk-spinner"></span>&nbsp; Loading…</td></tr>';
  try {
    const data = await apiRead({ action: 'getExpenses', year });
    allExpenses = data.expenses || [];
    renderExpenses();
  } catch (e) {
    document.getElementById('exp-body').innerHTML =
      `<tr><td colspan="8" class="text-center py-4 text-danger">⚠️ ${esc(e.message)}</td></tr>`;
  }
}

/* ── Render ── */
function renderExpenses() {
  const filterCat = document.getElementById('exp-filter-cat').value;
  const rows = filterCat
    ? allExpenses.filter(e => e.category === filterCat)
    : allExpenses;

  const total = rows.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);

  // Update summary strip
  const strip = document.getElementById('exp-summary-strip');
  strip.style.display = '';
  document.getElementById('exp-strip-count').textContent = rows.length;
  document.getElementById('exp-strip-total').textContent = '$' + total.toFixed(2);

  if (!rows.length) {
    document.getElementById('exp-body').innerHTML =
      '<tr><td colspan="8" class="text-center py-4 text-muted">No expenses recorded for this period.</td></tr>';
    return;
  }

  document.getElementById('exp-body').innerHTML = rows.map(e => {
    const catCls = EXP_CAT_COLOR[e.category] || 'role-tag-p6';
    const dateLabel = e.date
      ? new Date(e.date + 'T00:00:00').toLocaleDateString('en-AU', { day:'numeric', month:'short', year:'numeric' })
      : '—';
    return `<tr>
      <td style="white-space:nowrap;">${dateLabel}</td>
      <td><span class="role-tag ${catCls}" style="font-size:0.73rem;">${esc(e.category)}</span></td>
      <td>${esc(e.description)}</td>
      <td style="white-space:nowrap;font-weight:600;">$${parseFloat(e.amount).toFixed(2)}</td>
      <td style="color:var(--muted);">${esc(e.paidTo || '—')}</td>
      <td style="color:var(--muted);font-size:0.82rem;">${esc(e.notes || '')}</td>
      <td style="color:var(--muted);font-size:0.78rem;">${esc(e.recordedBy || '—')}</td>
      <td>
        <button class="contrib-history-btn" title="Edit"
                onclick="openExpenseModal('${escJs(e.expenseId)}')">
          <i class="bi bi-pencil"></i>
        </button>
      </td>
    </tr>`;
  }).join('');
}

/* ── Modal helpers ── */
let expenseModalInst  = null;
let statementModalInst = null;

function _getExpenseModal() {
  if (!expenseModalInst)
    expenseModalInst = new bootstrap.Modal(document.getElementById('expenseModal'));
  return expenseModalInst;
}
function _getStatementModal() {
  if (!statementModalInst)
    statementModalInst = new bootstrap.Modal(document.getElementById('statementModal'));
  return statementModalInst;
}

/* ── Open Add / Edit modal ── */
function openExpenseModal(expenseId) {
  const isEdit   = !!expenseId;
  const existing = isEdit ? allExpenses.find(e => e.expenseId === expenseId) : null;

  document.getElementById('exp-modal-title').innerHTML =
    `<i class="bi bi-receipt me-2"></i>${isEdit ? 'Edit Expense' : 'Add Expense'}`;
  document.getElementById('exp-id').value          = existing?.expenseId || '';
  document.getElementById('exp-date').value        = existing?.date || new Date().toISOString().slice(0, 10);
  document.getElementById('exp-amount').value      = existing?.amount || '';
  document.getElementById('exp-category').value    = existing?.category || 'Venue';
  document.getElementById('exp-description').value = existing?.description || '';
  document.getElementById('exp-paidto').value      = existing?.paidTo || '';
  document.getElementById('exp-notes').value       = existing?.notes || '';

  // Delete button: visible only when editing
  document.getElementById('exp-delete-btn').style.display = isEdit ? '' : 'none';

  const btn = document.getElementById('exp-save-btn');
  btn.disabled = false;
  btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Save';

  _getExpenseModal().show();
}

/* ── Confirm delete ── */
async function confirmDeleteExpense() {
  const id = document.getElementById('exp-id').value;
  const ex = allExpenses.find(e => e.expenseId === id);
  if (!ex) return;
  if (!confirm(`Delete expense "${ex.description}" ($${parseFloat(ex.amount).toFixed(2)})?\n\nThis cannot be undone.`)) return;
  try {
    const res = await apiRead({ action: 'deleteExpense', expenseId: id });
    if (res.success) {
      _getExpenseModal().hide();
      showToast('Expense deleted ✓');
      await loadExpenses();
    } else {
      showToast(res.error || 'Could not delete', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  }
}

/* ── Submit (add or update) ── */
async function submitExpense() {
  const id          = document.getElementById('exp-id').value;
  const date        = document.getElementById('exp-date').value;
  const amount      = document.getElementById('exp-amount').value;
  const category    = document.getElementById('exp-category').value;
  const description = document.getElementById('exp-description').value.trim();
  const paidTo      = document.getElementById('exp-paidto').value.trim();
  const notes       = document.getElementById('exp-notes').value.trim();

  if (!date || !description || !amount) {
    showToast('Date, description, and amount are required.', 'error'); return;
  }
  if (parseFloat(amount) <= 0) {
    showToast('Amount must be greater than zero.', 'error'); return;
  }

  const btn = document.getElementById('exp-save-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="pk-spinner" style="width:14px;height:14px;border-width:2px;border-top-color:#fff;border-color:rgba(255,255,255,0.2);display:inline-block;vertical-align:middle;margin-right:6px;"></span>Saving…';

  try {
    const isEdit   = !!id;
    const session  = getSession();
    const params   = {
      action:      isEdit ? 'updateExpense' : 'addExpense',
      expenseId:   id,
      date, category, description, amount,
      paidTo, notes,
      recordedBy:  session?.email || 'Admin',
    };
    const res = await apiRead(params);
    if (res.success) {
      _getExpenseModal().hide();
      showToast(isEdit ? 'Expense updated ✓' : 'Expense added ✓');
      await loadExpenses();
    } else {
      showToast(res.error || 'Could not save expense.', 'error');
    }
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-check2 me-1"></i>Save';
  }
}

/* ════════════════════════════════════════════════════════════
   Statement / Reconciliation Report
   ════════════════════════════════════════════════════════════ */

async function showStatement() {
  if (!document.getElementById('stmt-year').options.length) populateExpYearDropdown();
  // Sync statement year to expenses panel year
  const expYear = document.getElementById('exp-year').value;
  document.getElementById('stmt-year').value = expYear;
  _getStatementModal().show();
  await renderStatement();
}

async function renderStatement() {
  const year    = parseInt(document.getElementById('stmt-year').value);
  const body    = document.getElementById('stmt-body');
  body.innerHTML = '<div class="text-center py-4 text-muted"><span class="pk-spinner"></span>&nbsp; Building statement…</div>';

  try {
    // Fetch fresh data for the selected year
    const [contribData, expData] = await Promise.all([
      apiRead({ action: 'getContributions', year }),
      apiRead({ action: 'getExpenses', year }),
    ]);

    const contribs  = contribData.contributions || [];
    const expenses  = expData.expenses           || [];

    // ── Income calculations ───────────────────────────────
    let openingTotal = 0;
    const monthIncome = new Array(13).fill(0); // index 1–12

    contribs.forEach(c => {
      const m   = parseInt(c.month);
      const amt = parseFloat(c.amount) || 0;
      if (m === 0 && c.status !== 'Void') {
        openingTotal += amt;
      } else if (m >= 1 && m <= 12 && c.status === 'Paid') {
        monthIncome[m] += amt;
      }
    });

    const totalContributions = monthIncome.reduce((s, v) => s + v, 0);
    const totalIncome        = openingTotal + totalContributions;

    // ── Expense calculations ──────────────────────────────
    const monthExpense = new Array(13).fill(0);
    expenses.forEach(e => {
      const m = parseInt((e.date || '').slice(5, 7));
      if (m >= 1 && m <= 12) monthExpense[m] += parseFloat(e.amount) || 0;
    });
    const totalExpenses = expenses.reduce((s, e) => s + (parseFloat(e.amount) || 0), 0);
    const netBalance    = totalIncome - totalExpenses;

    // ── Expense by category breakdown ────────────────────
    const catMap = {};
    expenses.forEach(e => {
      const cat = e.category || 'Other';
      catMap[cat] = (catMap[cat] || 0) + (parseFloat(e.amount) || 0);
    });
    const catRows = Object.entries(catMap)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `<tr>
        <td><span class="role-tag ${EXP_CAT_COLOR[cat] || 'role-tag-p6'}" style="font-size:0.73rem;">${esc(cat)}</span></td>
        <td class="text-end" style="font-weight:600;">$${amt.toFixed(2)}</td>
      </tr>`).join('');

    // ── Monthly breakdown table ───────────────────────────
    const monthRows = MONTH_ABBR.map((mo, idx) => {
      const m      = idx + 1;
      const inc    = monthIncome[m];
      const exp    = monthExpense[m];
      const net    = inc - exp;
      const netCls = net >= 0 ? 'color:#1a7a3c;font-weight:700;' : 'color:#b03020;font-weight:700;';
      if (inc === 0 && exp === 0) return `<tr style="color:var(--muted);">
        <td>${mo}</td><td class="text-end">—</td><td class="text-end">—</td>
        <td class="text-end" style="color:var(--muted);">—</td>
      </tr>`;
      return `<tr>
        <td>${mo}</td>
        <td class="text-end">${inc > 0 ? '$' + inc.toFixed(2) : '—'}</td>
        <td class="text-end">${exp > 0 ? '$' + exp.toFixed(2) : '—'}</td>
        <td class="text-end" style="${netCls}">${net >= 0 ? '+' : ''}$${net.toFixed(2)}</td>
      </tr>`;
    }).join('');

    // ── Expense detail table ──────────────────────────────
    const expRows = expenses.length
      ? expenses.map(e => {
          const catCls   = EXP_CAT_COLOR[e.category] || 'role-tag-p6';
          const dateLabel = e.date
            ? new Date(e.date + 'T00:00:00').toLocaleDateString('en-AU', { day:'numeric', month:'short' })
            : '—';
          return `<tr>
            <td style="white-space:nowrap;">${dateLabel}</td>
            <td><span class="role-tag ${catCls}" style="font-size:0.72rem;">${esc(e.category)}</span></td>
            <td>${esc(e.description)}${e.paidTo ? `<br><small style="color:var(--muted);">${esc(e.paidTo)}</small>` : ''}</td>
            <td class="text-end" style="font-weight:600;white-space:nowrap;">$${parseFloat(e.amount).toFixed(2)}</td>
          </tr>`;
        }).join('')
      : '<tr><td colspan="4" class="text-center text-muted py-2">No expenses recorded.</td></tr>';

    const netStyle = netBalance >= 0
      ? 'background:#d5f5e3;color:#1a7a3c;border:1px solid #a9dfbf;'
      : 'background:#fde8e8;color:#b03020;border:1px solid #f5b7b1;';

    body.innerHTML = `
      <!-- Summary cards -->
      <div class="row g-3 mb-4">
        <div class="col-4">
          <div class="stat-card green" style="text-align:center;padding:1rem;">
            <div class="stat-val" style="font-size:1.5rem;">$${totalIncome.toFixed(2)}</div>
            <div class="stat-label">Total Income</div>
            <div style="font-size:0.72rem;color:var(--muted);margin-top:0.25rem;">OB $${openingTotal.toFixed(2)} + Contributions $${totalContributions.toFixed(2)}</div>
          </div>
        </div>
        <div class="col-4">
          <div class="stat-card" style="text-align:center;padding:1rem;">
            <div class="stat-val" style="font-size:1.5rem;">$${totalExpenses.toFixed(2)}</div>
            <div class="stat-label">Total Expenses</div>
            <div style="font-size:0.72rem;color:var(--muted);margin-top:0.25rem;">${expenses.length} item${expenses.length !== 1 ? 's' : ''}</div>
          </div>
        </div>
        <div class="col-4">
          <div class="stat-card" style="${netStyle}text-align:center;padding:1rem;border-left-width:4px;">
            <div class="stat-val" style="font-size:1.5rem;">${netBalance >= 0 ? '+' : ''}$${netBalance.toFixed(2)}</div>
            <div class="stat-label">Net Balance</div>
            <div style="font-size:0.72rem;margin-top:0.25rem;">${netBalance >= 0 ? 'Surplus' : 'Deficit'} for ${year}</div>
          </div>
        </div>
      </div>

      <!-- Monthly breakdown -->
      <h6 class="fw-bold mb-2" style="font-size:0.9rem;color:var(--text);">Monthly Breakdown</h6>
      <div class="pk-table-wrap mb-4">
        <table class="table table-sm mb-0" style="font-size:0.85rem;">
          <thead><tr>
            <th>Month</th>
            <th class="text-end">Income</th>
            <th class="text-end">Expenses</th>
            <th class="text-end">Net</th>
          </tr></thead>
          <tbody>${monthRows}</tbody>
          <tfoot style="font-weight:700;background:#f8f0e8;">
            <tr>
              <td>Total</td>
              <td class="text-end">$${totalIncome.toFixed(2)}</td>
              <td class="text-end">$${totalExpenses.toFixed(2)}</td>
              <td class="text-end" style="${netBalance >= 0 ? 'color:#1a7a3c;' : 'color:#b03020;'}">
                ${netBalance >= 0 ? '+' : ''}$${netBalance.toFixed(2)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <!-- Expenses by category -->
      ${catRows ? `
      <h6 class="fw-bold mb-2" style="font-size:0.9rem;color:var(--text);">Expenses by Category</h6>
      <div class="pk-table-wrap mb-4" style="max-width:360px;">
        <table class="table table-sm mb-0" style="font-size:0.85rem;">
          <thead><tr><th>Category</th><th class="text-end">Amount</th></tr></thead>
          <tbody>${catRows}</tbody>
        </table>
      </div>` : ''}

      <!-- Expense detail -->
      <h6 class="fw-bold mb-2" style="font-size:0.9rem;color:var(--text);">Expense Detail — ${year}</h6>
      <div class="pk-table-wrap">
        <table class="table table-sm mb-0" style="font-size:0.83rem;">
          <thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="text-end">Amount</th></tr></thead>
          <tbody>${expRows}</tbody>
          ${expenses.length ? `<tfoot style="font-weight:700;background:#f8f0e8;">
            <tr><td colspan="3" class="text-end">Total</td>
            <td class="text-end">$${totalExpenses.toFixed(2)}</td></tr>
          </tfoot>` : ''}
        </table>
      </div>`;

  } catch (e) {
    body.innerHTML = `<div class="text-center py-4 text-danger">⚠️ ${esc(e.message)}</div>`;
  }
}

/* ════════════════════════════════════════════════════════════
   Events — Performance & Event History
   ════════════════════════════════════════════════════════════ */

let allEvents       = [];
let eventModalInst  = null;

async function loadEvents() {
  const container = document.getElementById('evt-list');
  container.innerHTML = `<div class="text-center py-5 text-muted"><span class="pk-spinner"></span>&nbsp; Loading…</div>`;
  try {
    const data = await apiRead({ action: 'getEvents' });
    allEvents  = data.events || [];
    renderEvents();
    _updateBlogLink();
  } catch (e) {
    container.innerHTML = `<div class="text-center py-4 text-danger">⚠️ ${esc(e.message)}</div>`;
  }
}

function _updateBlogLink() {
  const url   = localStorage.getItem('pk_blog_url') || '';
  const link  = document.getElementById('evt-blog-link');
  const notice = document.getElementById('evt-blogger-notice');
  if (url) {
    link.href          = url;
    link.style.display = 'flex';
    notice.style.display = 'none';
  } else {
    link.style.display = 'none';
    notice.style.display = '';
    const inp = document.getElementById('evt-blog-url-input');
    if (inp) inp.value = '';
  }
}

function saveBlogUrl() {
  const url = (document.getElementById('evt-blog-url-input').value || '').trim();
  if (!url) return;
  localStorage.setItem('pk_blog_url', url);
  _updateBlogLink();
  showToast('Blog URL saved ✓');
}

function renderEvents() {
  const container = document.getElementById('evt-list');
  if (!allEvents.length) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-icon">🥁</span>
      No events yet. Use "Add Event" to record the group's first performance.
    </div>`;
    return;
  }

  container.innerHTML = allEvents.map(ev => {
    const isPublished = ev.status === 'Published';
    const dateLabel   = _fmtEventDate(ev.eventDate);
    const ytLinks     = ev.youtubeLinks ? ev.youtubeLinks.split(',').map(u => u.trim()).filter(Boolean) : [];
    const photoLinks  = ev.photoLinks   ? ev.photoLinks.split(',').map(u => u.trim()).filter(Boolean)   : [];
    const tags        = ev.tags         ? ev.tags.split(',').map(t => t.trim()).filter(Boolean)          : [];

    const tagHtml = tags.map(t =>
      `<span style="display:inline-block;padding:0.15em 0.6em;background:#f0e8e0;color:#5c2d0e;
              border-radius:20px;font-size:0.75em;margin:0.1rem;">${esc(t)}</span>`
    ).join('');

    const mediaBadges = [
      ytLinks.length    ? `<span style="font-size:0.75rem;color:var(--muted);"><i class="bi bi-youtube text-danger me-1"></i>${ytLinks.length} video${ytLinks.length > 1 ? 's' : ''}</span>` : '',
      photoLinks.length ? `<span style="font-size:0.75rem;color:var(--muted);"><i class="bi bi-images me-1"></i>${photoLinks.length} photo${photoLinks.length > 1 ? 's' : ''}</span>` : '',
    ].filter(Boolean).join('&nbsp; ');

    const statusBadge = isPublished
      ? `<span style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.75rem;
              background:#e6f4ea;color:#1a7a3c;padding:0.2em 0.7em;border-radius:20px;">
           <i class="bi bi-check-circle-fill"></i> Published
         </span>`
      : `<span style="display:inline-flex;align-items:center;gap:0.3rem;font-size:0.75rem;
              background:#f0e8e0;color:#7a4f2e;padding:0.2em 0.7em;border-radius:20px;">
           <i class="bi bi-pencil-square"></i> Draft
         </span>`;

    const publishBtn = isPublished
      ? `<button class="btn btn-sm btn-outline-secondary" style="border-radius:8px;font-size:0.8rem;"
                 onclick="unpublishEvent('${esc(ev.eventId)}')">
           <i class="bi bi-cloud-slash me-1"></i>Unpublish
         </button>
         <a href="${esc(ev.bloggerPostUrl)}" target="_blank" rel="noopener"
            class="btn btn-sm btn-outline-primary" style="border-radius:8px;font-size:0.8rem;">
           <i class="bi bi-box-arrow-up-right me-1"></i>View Post
         </a>`
      : `<button class="btn btn-sm btn-success" style="border-radius:8px;font-size:0.8rem;"
                 onclick="publishEvent('${esc(ev.eventId)}')">
           <i class="bi bi-cloud-upload me-1"></i>Publish to Blogger
         </button>`;

    const descSnippet = ev.description
      ? `<div style="font-size:0.84rem;color:var(--muted);margin-top:0.4rem;line-height:1.5;
                     display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
           ${esc(ev.description)}
         </div>`
      : '';

    return `<div style="background:var(--surface);border-radius:14px;padding:1.1rem 1.25rem;
                        margin-bottom:0.85rem;box-shadow:0 1px 6px rgba(0,0,0,0.05);">
      <div style="display:flex;align-items:flex-start;gap:0.75rem;flex-wrap:wrap;">
        <div style="flex:1;min-width:200px;">
          <div style="display:flex;align-items:center;gap:0.6rem;flex-wrap:wrap;margin-bottom:0.2rem;">
            ${statusBadge}
            <span style="font-size:0.8rem;color:var(--muted);">${esc(dateLabel)}</span>
            ${ev.location ? `<span style="font-size:0.8rem;color:var(--muted);">· ${esc(ev.location)}</span>` : ''}
          </div>
          <div style="font-weight:700;font-size:1.05rem;color:var(--text);">${esc(ev.title)}</div>
          ${descSnippet}
          <div style="margin-top:0.5rem;display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
            ${tagHtml}
            ${mediaBadges}
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:0.35rem;align-items:flex-end;flex-shrink:0;">
          <button class="btn btn-sm btn-outline-secondary" style="border-radius:8px;font-size:0.8rem;"
                  onclick="openEventModal('${esc(ev.eventId)}')">
            <i class="bi bi-pencil me-1"></i>Edit
          </button>
          ${publishBtn}
        </div>
      </div>
    </div>`;
  }).join('');
}

function _fmtEventDate(dateStr) {
  if (!dateStr) return '';
  const dt = new Date(dateStr);
  if (isNaN(dt)) return dateStr;
  return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/* ── Add / Edit Event Modal ─────────────────────────────── */
function openEventModal(eventId) {
  if (!eventModalInst) eventModalInst = new bootstrap.Modal(document.getElementById('eventModal'));

  const isEdit = !!eventId;
  document.getElementById('evt-modal-title').innerHTML =
    `<i class="bi bi-camera-reels me-2"></i>${isEdit ? 'Edit Event' : 'Add Event'}`;
  document.getElementById('evt-delete-btn').style.display = isEdit ? '' : 'none';
  document.getElementById('evt-save-btn').textContent = 'Save Draft';

  if (isEdit) {
    const ev = allEvents.find(e => e.eventId === eventId);
    if (!ev) return;
    document.getElementById('evt-id').value          = ev.eventId;
    document.getElementById('evt-title').value       = ev.title;
    document.getElementById('evt-date').value        = ev.eventDate || '';
    document.getElementById('evt-location').value    = ev.location;
    document.getElementById('evt-description').value = ev.description;
    document.getElementById('evt-youtube').value     = (ev.youtubeLinks || '').split(',').map(s => s.trim()).filter(Boolean).join('\n');
    document.getElementById('evt-photos').value      = ev.photoLinks;
    document.getElementById('evt-tags').value        = ev.tags;
  } else {
    document.getElementById('evt-id').value          = '';
    document.getElementById('evt-title').value       = '';
    document.getElementById('evt-date').value        = '';
    document.getElementById('evt-location').value    = '';
    document.getElementById('evt-description').value = '';
    document.getElementById('evt-youtube').value     = '';
    document.getElementById('evt-photos').value      = '';
    document.getElementById('evt-tags').value        = '';
  }
  eventModalInst.show();
}

async function submitEvent() {
  const eventId     = document.getElementById('evt-id').value.trim();
  const title       = document.getElementById('evt-title').value.trim();
  const eventDate   = document.getElementById('evt-date').value.trim();
  const location    = document.getElementById('evt-location').value.trim();
  const description = document.getElementById('evt-description').value.trim();
  const youtubeRaw  = document.getElementById('evt-youtube').value.trim();
  const photoLinks  = document.getElementById('evt-photos').value.trim();
  const tags        = document.getElementById('evt-tags').value.trim();

  if (!title)     { showToast('Title is required.', 'error'); return; }
  if (!eventDate) { showToast('Date is required.', 'error'); return; }

  // Normalise YouTube — allow newlines and commas as separators
  const youtubeLinks = youtubeRaw.split(/[\n,]+/).map(s => s.trim()).filter(Boolean).join(', ');

  const btn = document.getElementById('evt-save-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const action  = eventId ? 'updateEvent' : 'addEvent';
    const payload = { action, title, eventDate, location, description, youtubeLinks, photoLinks, tags };
    if (eventId) payload.eventId = eventId;

    const res = await apiRead(payload);
    if (!res.success) throw new Error(res.error || 'Save failed');

    eventModalInst.hide();
    await loadEvents();
    showToast(eventId ? 'Event updated ✓' : 'Event saved as draft ✓');
  } catch (err) {
    showToast(err.message || 'Could not save — try again.', 'error');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save Draft';
  }
}

async function confirmDeleteEvent() {
  const eventId = document.getElementById('evt-id').value.trim();
  const title   = document.getElementById('evt-title').value.trim();
  if (!confirm(`Delete "${title}"?\n\nThis cannot be undone. Unpublish from Blogger first if already published.`)) return;

  try {
    const res = await apiRead({ action: 'deleteEvent', eventId });
    if (!res.success) throw new Error(res.error || 'Delete failed');
    eventModalInst.hide();
    await loadEvents();
    showToast('Event deleted ✓');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

/* ── Publish / Unpublish ────────────────────────────────── */
async function publishEvent(eventId) {
  const ev = allEvents.find(e => e.eventId === eventId);
  if (!ev) return;
  if (!confirm(`Publish "${ev.title}" to Blogger?\n\nMake sure BLOGGER_BLOG_ID is set in GAS Script Properties.`)) return;

  showToast('Publishing to Blogger…');
  try {
    const res = await apiRead({ action: 'publishEvent', eventId });
    if (!res.success) throw new Error(res.error || 'Publish failed');
    await loadEvents();
    showToast('Published to Blogger ✓');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function unpublishEvent(eventId) {
  const ev = allEvents.find(e => e.eventId === eventId);
  if (!ev) return;
  if (!confirm(`Unpublish "${ev.title}" from Blogger?\n\nThe post will be deleted from Blogger. The event stays here as a Draft.`)) return;

  try {
    const res = await apiRead({ action: 'unpublishEvent', eventId });
    if (!res.success) throw new Error(res.error || 'Unpublish failed');
    await loadEvents();
    showToast('Unpublished — event is now a Draft ✓');
  } catch (err) {
    showToast(err.message, 'error');
  }
}
