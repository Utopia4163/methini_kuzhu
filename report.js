/* ════════════════════════════════════════════════════════════
   report.js — Medhini Parai Kuzhu
   ─────────────────────────────────────────────────────────
   Owns:
     • Reports tab — single-report view with type + year dropdowns
     • loadReports()           called by switchTab('rep')
     • selectReport(reportId)  called by type dropdown onchange
     • _repOnYearChange(year)  called by year dropdown onchange

   Adding a new report:
     Push one entry to _REPORTS:
       { id: 'myreport', label: 'My Report', render: myRenderFn }
     That's it — the dropdown and year picker update automatically.

   Reads globals from admin.js: allLogs, allMembers, allContribsAll
   ════════════════════════════════════════════════════════════ */

/* ── Report Registry ─────────────────────────────────────── */
// To add a new report: push { id, label, render } here.
// render(year) receives the selected year as an integer
// and should write HTML into document.getElementById('rep-body').
const _REPORTS = [
  { id: 'attendance',   label: 'Attendance Report',   render: renderAttendanceReport   },
  { id: 'contribution', label: 'Contribution Report', render: renderContributionReport },
];

/* ── State ───────────────────────────────────────────────── */
const _REP_MONTHS      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let   _repYear         = new Date().getFullYear();
let   _repActiveId     = _REPORTS[0].id;
let   _repStylesDone   = false;

/* ════════════════════════════════════════════════════════════
   Entry point
   ════════════════════════════════════════════════════════════ */

function loadReports() {
  _injectReportStyles();
  _populateYearDropdown();
  _populateTypeDropdown();
  selectReport(_repActiveId);
}

/* ════════════════════════════════════════════════════════════
   Public dispatcher — called by type dropdown & internally
   ════════════════════════════════════════════════════════════ */

function selectReport(reportId) {
  _repActiveId = reportId;
  // Keep type dropdown in sync (in case called programmatically)
  const typeSel = document.getElementById('rep-type-sel');
  if (typeSel) typeSel.value = reportId;

  const rep = _REPORTS.find(r => r.id === reportId);
  if (rep) {
    rep.render(_repYear);
  } else {
    const body = document.getElementById('rep-body');
    if (body) body.innerHTML = '<div class="text-muted p-3">Unknown report.</div>';
  }
}

/* ── Year change handler (year dropdown onchange) ─────────── */
function _repOnYearChange(year) {
  _repYear = parseInt(year);
  selectReport(_repActiveId);
}

/* ════════════════════════════════════════════════════════════
   Dropdown helpers
   ════════════════════════════════════════════════════════════ */

function _populateTypeDropdown() {
  const sel = document.getElementById('rep-type-sel');
  if (!sel) return;
  sel.innerHTML = '';
  _REPORTS.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.label;
    if (r.id === _repActiveId) opt.selected = true;
    sel.appendChild(opt);
  });
}

function _populateYearDropdown() {
  const years = new Set();

  (allLogs || []).forEach(log => {
    const d = _parseLogDate(log.date);
    if (d) years.add(d.getFullYear());
  });

  (allContribsAll || []).forEach(c => {
    const y = parseInt(c.year);
    if (y > 0) years.add(y);
  });

  const current = new Date().getFullYear();
  if (!years.size) years.add(current);

  const sorted = [...years].sort((a, b) => b - a); // newest first
  _repYear = sorted.includes(current) ? current : sorted[0];

  const sel = document.getElementById('rep-year-sel');
  if (!sel) return;
  sel.innerHTML = '';
  sorted.forEach(y => {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === _repYear) opt.selected = true;
    sel.appendChild(opt);
  });
}

/* ════════════════════════════════════════════════════════════
   Attendance Report — yearly matrix
   ════════════════════════════════════════════════════════════ */

function renderAttendanceReport(year) {
  year = parseInt(year);
  const body = document.getElementById('rep-body');
  if (!body) return;

  // Build per-member, per-month count  { localid: [0..11] }
  const counts = {};
  (allLogs || []).forEach(log => {
    if (log.status === 'Voided') return;
    const d = _parseLogDate(log.date);
    if (!d || d.getFullYear() !== year) return;
    const id = log.localid;
    if (!counts[id]) counts[id] = new Array(12).fill(0);
    counts[id][d.getMonth()]++;
  });

  const members = [...(allMembers || [])].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  if (!members.length) {
    body.innerHTML = '<div class="text-muted p-3">No member data available.</div>';
    return;
  }

  let html = `<div class="pk-table-wrap"><table class="report-matrix-table">
    <thead><tr>
      <th>Name</th>
      ${_REP_MONTHS.map(m => `<th>${m}</th>`).join('')}
      <th>Total</th>
    </tr></thead>
    <tbody>`;

  members.forEach(m => {
    const mc    = counts[m.localid] || new Array(12).fill(0);
    const total = mc.reduce((s, v) => s + v, 0);
    html += `<tr>
      <td>${_esc(m.name || m.localid)}</td>
      ${mc.map(c => c > 0 ? `<td class="rep-present">${c}</td>` : `<td class="rep-absent">—</td>`).join('')}
      <td class="rep-total">${total || '—'}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  body.innerHTML = html;
}

/* ════════════════════════════════════════════════════════════
   Contribution Report — yearly matrix
   ════════════════════════════════════════════════════════════ */

function renderContributionReport(year) {
  year = parseInt(year);
  const body = document.getElementById('rep-body');
  if (!body) return;

  // Build  { memberId: { month0: {amount, status} } }
  const contribs = {};
  (allContribsAll || []).forEach(c => {
    if (parseInt(c.year) !== year) return;
    const m = parseInt(c.month);
    if (m < 1 || m > 12) return;
    const id = String(c.memberId);
    if (!contribs[id]) contribs[id] = {};
    contribs[id][m - 1] = { amount: parseFloat(c.amount) || 0, status: c.status || '' };
  });

  const members = [...(allMembers || [])].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  if (!members.length) {
    body.innerHTML = '<div class="text-muted p-3">No member data available.</div>';
    return;
  }

  let html = `<div class="pk-table-wrap"><table class="report-matrix-table">
    <thead><tr>
      <th>Name</th>
      ${_REP_MONTHS.map(m => `<th>${m}</th>`).join('')}
      <th>Total Paid</th>
    </tr></thead>
    <tbody>`;

  members.forEach(m => {
    const mc = contribs[String(m.localid)] || {};
    let totalPaid = 0;
    const cells = Array.from({ length: 12 }, (_, i) => {
      const c = mc[i];
      if (!c) return `<td class="rep-void">—</td>`;
      if (c.status === 'Paid') {
        totalPaid += c.amount;
        return `<td class="rep-paid">$${_fmt(c.amount)}</td>`;
      }
      if (c.status === 'Unpaid') return `<td class="rep-unpaid">Unpaid</td>`;
      return `<td class="rep-void">${_esc(c.status) || '—'}</td>`;
    }).join('');
    html += `<tr>
      <td>${_esc(m.name || m.localid)}</td>
      ${cells}
      <td class="rep-total">${totalPaid > 0 ? '$' + _fmt(totalPaid) : '—'}</td>
    </tr>`;
  });

  html += '</tbody></table></div>';
  body.innerHTML = html;
}

/* ════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════ */

function _parseLogDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [d, mo, y] = parts.map(Number);
  if (!d || !mo || !y) return null;
  return new Date(y, mo - 1, d);
}

function _fmt(n) {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _injectReportStyles() {
  if (_repStylesDone) return;
  _repStylesDone = true;
  const style = document.createElement('style');
  style.textContent = `
    .report-matrix-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    .report-matrix-table th {
      background: var(--pk-primary, #3a7bd5);
      color: #fff;
      padding: 6px 8px;
      text-align: center;
      white-space: nowrap;
      font-weight: 600;
    }
    .report-matrix-table th:first-child {
      text-align: left;
      min-width: 130px;
    }
    .report-matrix-table td {
      padding: 5px 8px;
      border-bottom: 1px solid var(--border, #e5e7eb);
      text-align: center;
      vertical-align: middle;
    }
    .report-matrix-table td:first-child {
      text-align: left;
      font-weight: 500;
      white-space: nowrap;
    }
    .report-matrix-table tbody tr:hover td {
      background: #f0f4ff;
    }
    .report-matrix-table .rep-present { color: #15803d; font-weight: 600; }
    .report-matrix-table .rep-absent  { color: #9ca3af; }
    .report-matrix-table .rep-paid    { color: #15803d; font-weight: 600; }
    .report-matrix-table .rep-unpaid  { color: #dc2626; font-weight: 500; }
    .report-matrix-table .rep-void    { color: #9ca3af; }
    .report-matrix-table .rep-total   { font-weight: 700; background: #f9fafb; }
  `;
  document.head.appendChild(style);
}
