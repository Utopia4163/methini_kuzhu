/* ════════════════════════════════════════════════════════════
   🔧  CONFIGURATION  —  paste your Web App URL below
   ════════════════════════════════════════════════════════════ */
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxHAXDtzr5AW66E5exX9DZO_9j9L_Fn9P4SyFaXc_4GB16Nn0WPlCYb7CyW4RMjeLB9/exec'; // ← Replace!

/* ── Auth / identity keys ── */
const AUTH_KEY        = 'pk_admin_hash';
const ADMIN_NAME_KEY  = 'pk_admin_name';
const ADMIN_EMAIL_KEY = 'pk_admin_email';

/* ── Runtime data ── */
let allLogs        = [];
let allMembers     = [];
let allContribs    = [];    // current year view
let allContribsAll = [];   // all months (for member payment totals)
let allContribLog  = [];   // full immutable audit trail

/* ── Modal instances & contribution-change state ── */
let contribModalInst = null;
let historyModalInst = null;
let cmState = { memberId: '', memberName: '', month: 0, year: 0, status: 'Paid' };

/* ════════════════════════════════════════════════════════════
   API helpers — CORS workaround for Apps Script
   ─────────────────────────────────────────────────────────
   Apps Script redirects via script.googleusercontent.com,
   stripping CORS headers. Solution:
     • Reads  → JSONP  (no CORS restriction on <script> tags)
     • Writes → no-cors fetch (fire-and-forget; we re-read after)
   ════════════════════════════════════════════════════════════ */

function apiRead(params, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const cb  = 'pk_cb_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const url = `${SCRIPT_URL}?${new URLSearchParams({ ...params, callback: cb })}`;
    const el  = document.createElement('script');
    let timer;

    window[cb] = (data) => {
      clearTimeout(timer);
      el.remove();
      delete window[cb];
      resolve(data);
    };
    el.onerror = () => {
      clearTimeout(timer);
      el.remove();
      delete window[cb];
      reject(new Error('Network error — could not reach Apps Script.'));
    };
    timer = setTimeout(() => {
      el.remove();
      delete window[cb];
      reject(new Error('Request timed out. Check your internet connection.'));
    }, timeoutMs);

    el.src = url;
    document.head.appendChild(el);
  });
}

function apiWrite(params) {
  const url = `${SCRIPT_URL}?${new URLSearchParams(params)}`;
  fetch(url, { mode: 'no-cors' }).catch(() => {});
}

/* ════════════════════════════════════════════════════════════
   SHA-256 (Web Crypto API)
   ════════════════════════════════════════════════════════════ */
async function sha256(msg) {
  const buf  = new TextEncoder().encode(msg);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/* ════════════════════════════════════════════════════════════
   Boot
   ════════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  const hasHash    = !!localStorage.getItem(AUTH_KEY);
  const savedName  = localStorage.getItem(ADMIN_NAME_KEY)  || '';
  const savedEmail = localStorage.getItem(ADMIN_EMAIL_KEY) || '';

  if (!hasHash) {
    document.getElementById('login-sub').textContent = 'First-time setup — create an admin password';
    document.getElementById('login-form').style.display    = 'none';
    document.getElementById('setup-section').style.display = 'block';
  } else {
    if (savedName)  document.getElementById('admin-name-login').value  = savedName;
    if (savedEmail) document.getElementById('admin-email-login').value = savedEmail;
  }

  contribModalInst = new bootstrap.Modal(document.getElementById('contribModal'));
  historyModalInst = new bootstrap.Modal(document.getElementById('historyModal'));
  populateYearDropdown();
  initAttCalendar();
});

/* ════════════════════════════════════════════════════════════
   Auth
   ════════════════════════════════════════════════════════════ */
async function doLogin() {
  const pw     = document.getElementById('admin-pw').value;
  const name   = document.getElementById('admin-name-login').value.trim();
  const email  = document.getElementById('admin-email-login').value.trim();
  const stored = localStorage.getItem(AUTH_KEY);
  if (!pw || !stored) return;

  const hash = await sha256(pw);
  if (hash === stored) {
    if (name)  localStorage.setItem(ADMIN_NAME_KEY, name);
    if (email) localStorage.setItem(ADMIN_EMAIL_KEY, email);
    enterAdmin();
  } else {
    document.getElementById('login-error').style.display = 'block';
    document.getElementById('admin-pw').value = '';
    document.getElementById('admin-pw').focus();
  }
}

async function doSetup() {
  const name  = document.getElementById('setup-name').value.trim();
  const email = document.getElementById('setup-email').value.trim();
  const pw    = document.getElementById('setup-pw').value;
  const pw2   = document.getElementById('setup-pw2').value;
  const errEl = document.getElementById('setup-error');

  if (!pw || pw.length < 4) {
    errEl.textContent = 'Password must be at least 4 characters.';
    errEl.style.display = 'block'; return;
  }
  if (pw !== pw2) {
    errEl.textContent = 'Passwords do not match.';
    errEl.style.display = 'block'; return;
  }
  errEl.style.display = 'none';

  const hash = await sha256(pw);
  localStorage.setItem(AUTH_KEY, hash);
  if (name)  localStorage.setItem(ADMIN_NAME_KEY, name);
  if (email) localStorage.setItem(ADMIN_EMAIL_KEY, email);
  enterAdmin();
}

function doForgotPw() {
  if (!confirm('This will clear the stored password from this device, allowing anyone with access to set a new admin password.\n\nContinue to reset?')) return;
  localStorage.removeItem(AUTH_KEY);
  document.getElementById('login-error').style.display  = 'none';
  document.getElementById('login-form').style.display   = 'none';
  document.getElementById('setup-section').style.display = 'block';
  document.getElementById('login-sub').textContent = 'Reset password — set a new one below';
  const n = localStorage.getItem(ADMIN_NAME_KEY)  || '';
  const e = localStorage.getItem(ADMIN_EMAIL_KEY) || '';
  if (n) document.getElementById('setup-name').value  = n;
  if (e) document.getElementById('setup-email').value = e;
}

function doLogout() {
  document.getElementById('admin-panel').style.display  = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-pw').value = '';

  const savedName  = localStorage.getItem(ADMIN_NAME_KEY)  || '';
  const savedEmail = localStorage.getItem(ADMIN_EMAIL_KEY) || '';
  document.getElementById('admin-name-login').value  = savedName;
  document.getElementById('admin-email-login').value = savedEmail;

  const hasHash = !!localStorage.getItem(AUTH_KEY);
  if (hasHash) {
    document.getElementById('login-form').style.display    = 'block';
    document.getElementById('setup-section').style.display = 'none';
    document.getElementById('login-sub').textContent = 'Admin Dashboard';
  }
}

function enterAdmin() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('admin-panel').style.display  = 'block';
  const name  = localStorage.getItem(ADMIN_NAME_KEY)  || 'Admin';
  const email = localStorage.getItem(ADMIN_EMAIL_KEY) || '';
  document.getElementById('navbar-admin-name').textContent =
    email ? `${name} (${email})` : name;
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
  ['att','mem','con'].forEach(t => {
    document.getElementById('tab-'+t).classList.toggle('active', t === id);
    document.getElementById('panel-'+t).style.display = t === id ? 'block' : 'none';
  });
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
let _attDayMap      = {};                     // 'dd/MM/yyyy' → [name, …]   (all-members)
let _memberAttDates = {};                     // localid → Set<'dd/MM/yyyy'> (individual)
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

/* 'dd/MM/yyyy' → [name, …]  — all members (excludes voided) */
function _buildAttDayMap() {
  _attDayMap = {};
  allLogs.forEach(l => {
    if (!l.date || l.status === 'Voided') return;
    if (!_attDayMap[l.date]) _attDayMap[l.date] = [];
    _attDayMap[l.date].push(l.name || '?');
  });
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

  // Build week rows
  const weeksHtml = [];
  for (let w = 0; w < cells.length / 7; w++) {
    const dayCells = cells.slice(w * 7, w * 7 + 7).map(dayNum => {
      if (dayNum === null) return `<div class="att-day-cell att-other-month"></div>`;

      const key     = _fmtDateKey(dayNum, _attMonth + 1, _attYear);
      const isToday = key === todayKey;
      const isSel   = key === _attSelectedDay;
      const numCls  = isToday ? 'att-day-num att-today-num' : 'att-day-num';
      let inner     = `<div class="${numCls}">${dayNum}</div>`;
      let hasAtt    = false;

      if (isIndividual) {
        hasAtt = memberDates.has(key);
        if (hasAtt) {
          inner += `<div class="att-count-pill"><i class="bi bi-check2"></i> Present</div>`;
        }
      } else {
        const names = _attDayMap[key] || [];
        hasAtt = names.length > 0;
        if (hasAtt) {
          inner += `<div class="att-count-pill">${names.length} present</div>`;
          const unique  = [...new Set(names)];
          const preview = unique.slice(0, 3).map(n => esc(n)).join(', ');
          const more    = unique.length > 3 ? ` +${unique.length - 3}` : '';
          inner += `<div class="att-day-names">${preview}${more}</div>`;
        }
      }

      const cls     = ['att-day-cell', hasAtt ? 'att-has-data' : '', isSel ? 'att-selected' : '']
                        .filter(Boolean).join(' ');
      const datAttr = hasAtt ? `data-date="${key}"` : '';

      return `<div class="${cls}" ${datAttr}>${inner}</div>`;
    }).join('');
    weeksHtml.push(`<div class="att-week-row">${dayCells}</div>`);
  }

  document.getElementById('att-cal-weeks').innerHTML = weeksHtml.join('');

  // Restore detail panel if selected day still has data
  if (_attSelectedDay) {
    const still = isIndividual
      ? memberDates.has(_attSelectedDay)
      : !!(_attDayMap[_attSelectedDay]?.length);
    still ? _showAttDay(_attSelectedDay, true) : closeAttDetail();
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
      .map(m => `<option value="${esc(m.localId)}" data-name="${esc(m.name)}">${esc(m.name)}</option>`)
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

    return `<tr class="${rowCls}">
      <td class="hm-name-col">${esc(m.name)}</td>
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
    renderMembers();
  } catch (e) {
    document.getElementById('mem-body').innerHTML =
      `<tr><td colspan="6" class="text-center py-3 text-danger">⚠️ ${esc(e.message)}</td></tr>`;
  }
}

function renderMembers() {
  const body = document.getElementById('mem-body');
  if (!allMembers.length) {
    body.innerHTML = `<tr><td colspan="8">
      <div class="empty-state"><span class="empty-icon">👥</span>No members yet. Use "Add Member" to add someone.</div>
    </td></tr>`;
    return;
  }

  const countMap = {};
  allLogs.forEach(l => { countMap[l.localid] = (countMap[l.localid] || 0) + 1; });

  body.innerHTML = allMembers.map((m, i) => {
    const cnt        = countMap[m.localId] || 0;
    const mContribs  = allContribsAll.filter(c => String(c.memberId) === String(m.localId) && parseInt(c.month) > 0);
    const paidMonths = mContribs.filter(c => c.status === 'Paid');
    const obRec      = allContribsAll.find(c => String(c.memberId) === String(m.localId) && parseInt(c.month) === 0);
    const obAmt      = obRec ? (Number(obRec.amount) || 0) : 0;
    const totalPaid  = obAmt + paidMonths.reduce((s, c) => s + (Number(c.amount) || 30), 0);
    const allPaid    = mContribs.length > 0 && paidMonths.length === mContribs.length;

    const tagBadges   = renderTagBadges(m.tags || '');
    const escapedTags = esc(m.tags || '');
    const escapedId   = esc(m.localId);
    const escapedName = esc(m.name);

    return `<tr>
      <td style="color:var(--muted);">${i+1}</td>
      <td>
        <strong>${escapedName}</strong>
        ${tagBadges ? `<div style="margin-top:0.25rem;display:flex;flex-wrap:wrap;gap:0.25rem;">${tagBadges}</div>` : ''}
      </td>
      <td>${m.email ? `<a href="mailto:${esc(m.email)}" style="color:var(--blue);font-size:0.83rem;">${esc(m.email)}</a>` : '–'}</td>
      <td style="font-size:0.83rem;color:var(--muted);">${esc(m.joinDate || '–')}</td>
      <td><span class="badge-neutral">${cnt} session${cnt !== 1 ? 's' : ''}</span></td>
      <td><span class="pay-pill ${allPaid && mContribs.length ? 'all-paid' : ''}">
            ${paidMonths.length} / ${mContribs.length} months
          </span></td>
      <td style="font-weight:600;color:var(--green);">$${totalPaid}</td>
      <td>
        <div style="display:flex;flex-direction:column;gap:0.2rem;align-items:flex-start;">
          <button class="contrib-link-btn"
                  onclick="goToContribs('${escapedId}','${escapedName}')">
            <i class="bi bi-cash-coin me-1"></i>Contributions
          </button>
          <button class="edit-tags-btn"
                  onclick="openEditTagsModal('${escapedId}','${escapedName}','${escapedTags}')">
            <i class="bi bi-tags me-1"></i>Edit Roles
          </button>
        </div>
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

/* ── Add Member ─────────────────────────────────────────────── */
let addMemberModalInst = null;

function openAddMemberModal() {
  if (!addMemberModalInst)
    addMemberModalInst = new bootstrap.Modal(document.getElementById('addMemberModal'));
  document.getElementById('am-name').value  = '';
  document.getElementById('am-email').value = '';
  document.getElementById('am-name').classList.remove('is-invalid');
  document.getElementById('am-email').classList.remove('is-invalid');
  _resetTagInput('am', '');
  addMemberModalInst.show();
  setTimeout(() => document.getElementById('am-name').focus(), 350);
}

async function submitAddMember() {
  const name  = document.getElementById('am-name').value.trim();
  const email = document.getElementById('am-email').value.trim();

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
    // Use apiRead (JSONP) so we can inspect the response and catch email conflicts
    const data = await apiRead({ action: 'registerMember', localId, name, tags, email });

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

  apiWrite({ action: 'updateMemberTags', localId: _etMemberId, tags });
  await new Promise(r => setTimeout(r, 1100));

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
    // After rendering, check if carry-forward is needed for this year
    await checkAndCarryForward(year);
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
  document.getElementById('s-paid').textContent   = paidCount;
  document.getElementById('s-unpaid').textContent = allMembers.length - paidCount;

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
    ? `NOTES <span style="font-weight:400;color:var(--muted);">(describe what this OB covers, e.g. balance from ${iYear - 1})</span>`
    : 'NOTES <span style="font-weight:400;color:var(--muted);">(payment method, ref, or months covered)</span>';
  document.getElementById('cm-notes').placeholder = isOB
    ? `e.g. Carried forward from ${iYear - 1}`
    : 'e.g. Bank transfer ref #123, covers Feb + March';

  document.getElementById('cm-amount').previousElementSibling.innerHTML =
    isOB ? `OPENING BALANCE ${iYear} ($)` : 'AMOUNT RECEIVED ($)';
  document.getElementById('cm-amount').nextElementSibling.textContent = isOB
    ? `Opening balance for the ${iYear} year. Editing this will override the auto-calculated carry-forward.`
    : 'Default $30/month. Enter higher amount for catch-up payments (e.g. $60 for 2 months).';

  // Strip auto-carry flag from notes display so admin sees clean value
  const rawNotes = hasRecord ? (existing.notes || '') : '';
  const displayNotes = rawNotes.replace(/^\[auto:\d{4}\]\s*/, '');
  document.getElementById('cm-notes').value  = displayNotes;
  document.getElementById('cm-amount').value = hasRecord ? (existing.amount || (isOB ? 0 : 30)) : (isOB ? 0 : 30);

  const name  = localStorage.getItem(ADMIN_NAME_KEY)  || '';
  const email = localStorage.getItem(ADMIN_EMAIL_KEY) || '';
  document.getElementById('cm-by').value = (name && email) ? `${name} (${email})` : (name || '');

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

    // If a contribution was edited in a past year, reconcile carry-forwards in subsequent years
    if (!isOB) {
      reconcileSubsequentOBs(year);
    }
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

  const thisMonth = allLogs.filter(l => {
    if (!l.date) return false;
    const [d,m,y] = l.date.split('/');
    return parseInt(m) === month && parseInt(y) === year;
  });
  document.getElementById('s-month').textContent = thisMonth.length;
}

/* ════════════════════════════════════════════════════════════
   Utilities
   ════════════════════════════════════════════════════════════ */
function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
