/* ════════════════════════════════════════════════════════════
   report.js — Medhini Parai Kuzhu
   ─────────────────────────────────────────────────────────
   Owns:
     • Reports tab — Attendance & Contribution yearly matrices
     • loadReports()            (called by switchTab('rep'))
     • renderAttendanceReport(year)
     • renderContributionReport(year)
   Reads globals from admin.js: allLogs, allMembers, allContribsAll
   ════════════════════════════════════════════════════════════ */

const _REP_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let _repYear = new Date().getFullYear();
let _repStylesInjected = false;

/* ════════════════════════════════════════════════════════════
   Entry point — called by switchTab('rep')
   ════════════════════════════════════════════════════════════ */

function loadReports() {
  _injectReportStyles();
  _populateReportYearDropdowns();
  renderAttendanceReport(_repYear);
  renderContributionReport(_repYear);
}

/* ════════════════════════════════════════════════════════════
   Year dropdowns
   ════════════════════════════════════════════════════════════ */

function _populateReportYearDropdowns() {
  const years = new Set();

  // Collect years from attendance logs
  (allLogs || []).forEach(log => {
    const d = _parseLogDate(log.date);
    if (d) years.add(d.getFullYear());
  });

  // Collect years from contributions (skip legacy year=0)
  (allContribsAll || []).forEach(c => {
    const y = parseInt(c.year);
    if (y > 0) years.add(y);
  });

  const current = new Date().getFullYear();
  if (!years.size) years.add(current);

  const sorted = [...years].sort((a, b) => b - a); // newest first
  _repYear = sorted.includes(current) ? current : sorted[0];

  ['att-report-year', 'con-report-year'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '';
    sorted.forEach(y => {
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      if (y === _repYear) opt.selected = true;
      sel.appendChild(opt);
    });
  });
}

/* ════════════════════════════════════════════════════════════
   Attendance Report — yearly matrix
   ════════════════════════════════════════════════════════════ */

function renderAttendanceReport(year) {
  year = parseInt(year);
  _repYear = year;
  const body = document.getElementById('att-report-body');
  if (!body) return;

  // Build per-member, per-month count map
  const counts = {}; // localid → [0..11]
  (allLogs || []).forEach(log => {
    if (log.status === 'Voided') return;
    const d = _parseLogDate(log.date);
    if (!d || d.getFullYear() !== year) return;
    const m0 = d.getMonth();
    const id = log.localid;
    if (!counts[id]) counts[id] = new Array(12).fill(0);
    counts[id][m0]++;
  });

  // All members sorted by name
  const members = [...(allMembers || [])].sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  );

  if (!members.length) {
    body.innerHTML = '<div class="text-muted p-3">No member data available.</div>';
    return;
  }

  let html = `<table class="report-matrix-table">
    <thead><tr>
      <th>Name</th>
      ${_REP_MONTHS.map(m => `<th>${m}</th>`).join('')}
      <th>Total</th>
    </tr></thead>
    <tbody>`;

  members.forEach(m => {
    const mc = counts[m.localid] || new Array(12).fill(0);
    const total = mc.reduce((s, v) => s + v, 0);
    const cells = mc.map(c =>
      c > 0
        ? `<td class="rep-present">${c}</td>`
        : `<td class="rep-absent">—</td>`
    ).join('');
    html += `<tr>
      <td>${_esc(m.name || m.localid)}</td>
      ${cells}
      <td class="rep-total">${total || '—'}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  body.innerHTML = html;
}

/* ════════════════════════════════════════════════════════════
   Contribution Report — yearly matrix
   ════════════════════════════════════════════════════════════ */

function renderContributionReport(year) {
  year = parseInt(year);
  const body = document.getElementById('con-report-body');
  if (!body) return;

  // Build per-member, per-month map  { memberId: { month0: {amount, status} } }
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

  let html = `<table class="report-matrix-table">
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
        return `<td class="rep-paid">$${c.amount % 1 === 0 ? c.amount : c.amount.toFixed(2)}</td>`;
      }
      if (c.status === 'Unpaid') return `<td class="rep-unpaid">Unpaid</td>`;
      return `<td class="rep-void">${_esc(c.status) || '—'}</td>`;
    }).join('');
    html += `<tr>
      <td>${_esc(m.name || m.localid)}</td>
      ${cells}
      <td class="rep-total">${totalPaid > 0 ? '$' + (totalPaid % 1 === 0 ? totalPaid : totalPaid.toFixed(2)) : '—'}</td>
    </tr>`;
  });

  html += '</tbody></table>';
  body.innerHTML = html;
}

/* ════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════ */

function _parseLogDate(dateStr) {
  // Expected format: dd/MM/yyyy
  if (!dateStr) return null;
  const parts = dateStr.split('/');
  if (parts.length !== 3) return null;
  const [d, mo, y] = parts.map(Number);
  if (!d || !mo || !y) return null;
  return new Date(y, mo - 1, d);
}

function _esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function _injectReportStyles() {
  if (_repStylesInjected) return;
  _repStylesInjected = true;
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
