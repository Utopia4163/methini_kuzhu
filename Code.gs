/**
 * ╔══════════════════════════════════════════════════════════╗
 * ║          PARAI KUZHU — Google Apps Script Backend        ║
 * ║         Group Attendance & Contribution Tracker          ║
 * ╚══════════════════════════════════════════════════════════╝
 *
 * SETUP INSTRUCTIONS:
 *  1. Create a Google Sheet and copy its ID from the URL.
 *  2. In the Sheet: Extensions → Apps Script → paste this code.
 *  3. Replace SPREADSHEET_ID below with your actual ID.
 *  4. Deploy → New Deployment → Web App
 *       Execute as: Me | Who has access: Anyone
 *  5. Copy the Web App URL into index.html and admin.html.
 *  6. Open  YOUR_WEB_APP_URL?action=init  to create the tabs.
 */

// ─── 🔧 CONFIGURE THIS ───────────────────────────────────────
const SPREADSHEET_ID = scriptProperties.getProperty('SPREADSHEET_ID');
// ─────────────────────────────────────────────────────────────

const SHEET_NAMES = {
  MEMBERS:       'Members',
  ATTENDANCE:    'Attendance',
  CONTRIBUTIONS: 'Contributions',
  CONTRIB_LOG:   'ContribLog',   // append-only audit trail
  AUTH:          'Auth',         // admin credentials (one row per admin)
  INVITES:       'Invites',      // single-use invite tokens
  EXPENSES:      'Expenses',     // group expenses ledger
};

const SHEET_HEADERS = {
  MEMBERS:       ['LocalID', 'Name', 'Instrument', 'Email', 'JoinDate'],
  ATTENDANCE:    ['Timestamp', 'LocalID', 'MemberName', 'Instrument', 'Location', 'Date'],
  // Contributions = current state (one row per member per month)
  CONTRIBUTIONS: ['MemberID', 'MemberName', 'Month', 'Year', 'Amount', 'Status', 'Notes', 'LastUpdated', 'ChangedBy'],
  // ContribLog = immutable audit trail (every change appended)
  CONTRIB_LOG:   ['Timestamp', 'MemberID', 'MemberName', 'Month', 'Year', 'Amount', 'Status', 'Notes', 'ChangedBy'],
  // Auth: admin accounts — Hash and Salt are PBKDF2-derived client-side, stored here
  AUTH:    ['Email', 'Name', 'Hash', 'Salt', 'Iterations', 'FailedAttempts', 'LockedUntil', 'CreatedAt', 'CreatedBy'],
  // Invites: single-use invite tokens for admin signup
  INVITES: ['Token', 'CreatedAt', 'ExpiresAt', 'CreatedBy', 'UsedAt', 'UsedByEmail'],
  // Expenses: group expense ledger
  EXPENSES: ['ExpenseID', 'Date', 'Category', 'Description', 'Amount', 'PaidTo', 'Notes', 'RecordedAt', 'RecordedBy'],
};

// ── Entry Point ──────────────────────────────────────────────
function doGet(e) {
  const p      = e.parameter;
  const action = p.action || '';
  let result;

  try {
    switch (action) {
      case 'ping':               result = { ok: true, message: 'Medhini Parai Kuzhu API is running!' }; break;
      case 'init':               result = initSheets();                              break;
      case 'getMember':          result = getMember(p.localId);                      break;
      case 'registerMember':     result = registerMember(p);                         break;
      case 'recordAttendance':   result = recordAttendance(p);                       break;
      case 'getLogs':            result = getLogs(parseInt(p.limit) || 500);         break;
      case 'getMembers':         result = getMembers();                              break;
      case 'getContributions':   result = getContributions(p.year, p.month);         break;
      case 'updateContribution': result = updateContribution(p);                     break;
      case 'getContribLog':      result = getContribLog(p.memberId, p.month, p.year); break;
      case 'updateMemberTags':   result = updateMemberTags(p);                        break;
      case 'getMemberByEmail':      result = getMemberByEmail(p.email);                  break;
      case 'adminMarkAttendance':   result = adminMarkAttendance(p);                     break;
      case 'voidAttendance':        result = voidAttendance(p);                          break;
      case 'autoCarryForward':      result = autoCarryForward(p);                        break;
      // ── Auth & Invites ────────────────────────────────────────
      case 'getSalt':             result = getSalt(p);                                 break;
      case 'verifyAdmin':         result = verifyAdmin(p);                             break;
      case 'createAdmin':         result = createAdmin(p);                             break;
      case 'changePassword':      result = changePassword(p);                          break;
      case 'listAdmins':          result = listAdmins(p);                              break;
      case 'removeAdmin':         result = removeAdmin(p);                             break;
      case 'generateInvite':      result = generateInvite(p);                          break;
      case 'validateInvite':      result = validateInvite(p);                          break;
      case 'listInvites':         result = listInvites(p);                             break;
      case 'revokeInvite':        result = revokeInvite(p);                            break;
      // ── Expenses ──────────────────────────────────────────────
      case 'addExpense':          result = addExpense(p);                              break;
      case 'getExpenses':         result = getExpenses(p);                             break;
      case 'updateExpense':       result = updateExpense(p);                           break;
      case 'deleteExpense':       result = deleteExpense(p);                           break;
      default:
        result = { error: 'Unknown action.' };
    }
  } catch (err) {
    console.error('doGet error:', err);
    result = { error: err.toString() };
  }

  const output = JSON.stringify(result);

  // JSONP support — bypasses the CORS redirect issue when called from a
  // static site (GitHub Pages). Pass ?callback=fnName to use JSONP.
  if (p.callback) {
    return ContentService
      .createTextOutput(`${p.callback}(${output})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(output)
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Sheet Bootstrap ──────────────────────────────────────────
function initSheets() {
  const ss      = SpreadsheetApp.openById(SPREADSHEET_ID);
  const created = [];

  for (const [key, name] of Object.entries(SHEET_NAMES)) {
    let sheet = ss.getSheetByName(name);
    if (!sheet) {
      sheet = ss.insertSheet(name);
      const headers = SHEET_HEADERS[key];
      const hRange  = sheet.getRange(1, 1, 1, headers.length);
      hRange.setValues([headers]);
      hRange.setFontWeight('bold');
      hRange.setBackground('#2d1510');
      hRange.setFontColor('#f5e6d3');
      sheet.setFrozenRows(1);
      created.push(name);
    }
  }

  return {
    success: true,
    created: created.length ? created : 'All sheets already exist',
    sheets:  Object.values(SHEET_NAMES),
  };
}

// ── getMember ────────────────────────────────────────────────
function getMember(localId) {
  if (!localId) return { found: false, error: 'No localId provided' };

  const sheet = getSheet(SHEET_NAMES.MEMBERS);
  if (!sheet) return { found: false, error: 'Members sheet missing. Run ?action=init first.' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(localId)) {
      return {
        found:    true,
        localId:  rows[i][0],
        name:     rows[i][1],
        tags:     rows[i][2],   // formerly "instrument" column — repurposed for roles/tags
        email:    rows[i][3],
        joinDate: rows[i][4],
      };
    }
  }
  return { found: false };
}

// ── registerMember ───────────────────────────────────────────
// Admin-only. Email is now mandatory and must be unique.
function registerMember(p) {
  if (!p.localId || !p.name) {
    return { success: false, error: 'localId and name are required' };
  }
  if (!p.email || !String(p.email).trim()) {
    return { success: false, error: 'email is required' };
  }

  const existing = getMember(p.localId);
  if (existing.found) {
    return { success: true, localId: p.localId, alreadyExists: true };
  }

  // Enforce email uniqueness
  const emailCheck = getMemberByEmail(p.email);
  if (emailCheck.found) {
    return {
      success:       false,
      emailConflict: true,
      error:         `Email already registered to ${emailCheck.name}`,
    };
  }

  const sheet = getSheet(SHEET_NAMES.MEMBERS);
  if (!sheet) return { success: false, error: 'Members sheet missing. Run ?action=init first.' };

  const joinDate = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  // Column 3 stores comma-separated roles/tags (formerly "instrument" — repurposed)
  sheet.appendRow([p.localId, p.name, p.tags || p.instrument || '', p.email.trim(), joinDate]);

  return { success: true, localId: p.localId, name: p.name };
}

// ── getMemberByEmail ─────────────────────────────────────────
// Looks up a member by email (case-insensitive). Used by the check-in page
// so members don't need to remember their localId.
function getMemberByEmail(email) {
  if (!email) return { found: false, error: 'email required' };

  const sheet = getSheet(SHEET_NAMES.MEMBERS);
  if (!sheet) return { found: false, error: 'Members sheet missing. Run ?action=init first.' };

  const rows       = sheet.getDataRange().getValues();
  const emailLower = String(email).toLowerCase().trim();

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    if (String(rows[i][3]).toLowerCase().trim() === emailLower) {
      return {
        found:   true,
        localId: rows[i][0],
        name:    rows[i][1],
        tags:    rows[i][2],
        email:   rows[i][3],
      };
    }
  }
  return { found: false };
}

// ── recordAttendance ─────────────────────────────────────────
const DEDUP_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours — one session per day, flexible enough for gaps

function recordAttendance(p) {
  if (!p.name) return { success: false, error: 'name is required' };

  const sheet = getSheet(SHEET_NAMES.ATTENDANCE);
  if (!sheet) return { success: false, error: 'Attendance sheet missing. Run ?action=init first.' };

  const now    = new Date();
  const tz     = Session.getScriptTimeZone();
  const cutoff = new Date(now.getTime() - DEDUP_WINDOW_MS);

  // ── 4-hour duplicate check ───────────────────────────────────
  // Scan rows from most recent backwards. Because appendRow always adds to the
  // end, rows are chronological — the moment we hit a row older than the cutoff
  // we know all earlier rows are also outside the window and can stop scanning.
  if (p.localId) {
    const rows = sheet.getDataRange().getValues();
    for (let i = rows.length - 1; i >= 1; i--) {
      if (!rows[i][0]) continue;
      const rowTs = rows[i][0] instanceof Date ? rows[i][0] : new Date(String(rows[i][0]));
      if (isNaN(rowTs.getTime())) continue;
      if (rowTs < cutoff) break;                              // past the window — stop
      if (String(rows[i][1]) !== String(p.localId)) continue; // different member — skip
      // Same member within 4 hours → duplicate
      return {
        success:     false,
        duplicate:   true,
        checkedInAt: Utilities.formatDate(rowTs, tz, 'HH:mm'),
        message:     `Already marked present at ${Utilities.formatDate(rowTs, tz, 'HH:mm')}`,
      };
    }
  }

  // ── Record attendance ─────────────────────────────────────────
  const timestamp = now.toISOString();
  const date      = Utilities.formatDate(now, tz, 'dd/MM/yyyy');

  sheet.appendRow([
    timestamp,
    p.localId    || '',
    p.name,
    p.instrument || '',
    p.location   || 'Not specified',
    date,
  ]);

  return { success: true, message: `Attendance recorded for ${p.name} on ${date}` };
}

// ── getLogs ──────────────────────────────────────────────────
function getLogs(limit) {
  const sheet = getSheet(SHEET_NAMES.ATTENDANCE);
  if (!sheet) return { logs: [], error: 'Attendance sheet missing' };

  const rows = sheet.getDataRange().getValues();
  const logs = [];

  const tz = Session.getScriptTimeZone();

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;

    // ── Timestamp ───────────────────────────────────────────────────────────
    // Google Sheets may store ISO strings as Date objects on read-back.
    // Always serialise to ISO so the browser receives a consistent string.
    const rawTs  = rows[i][0];
    const tsDate = rawTs instanceof Date ? rawTs : new Date(String(rawTs));
    const tsStr  = rawTs instanceof Date ? rawTs.toISOString() : String(rawTs || '');

    // ── Date ────────────────────────────────────────────────────────────────
    // Do NOT rely on the stored date cell (column F).  Google Sheets
    // reinterprets "dd/MM/yyyy" strings according to the spreadsheet locale:
    // if the locale is US (M/D/Y), "08/04/2026" becomes August 4, not April 8,
    // and is stored internally as that wrong date object.
    //
    // Instead, derive the attendance date from the timestamp (ISO, locale-immune)
    // using the script timezone — identical logic to what recordAttendance() used
    // when writing the row.
    let dateStr;
    if (!isNaN(tsDate.getTime())) {
      dateStr = Utilities.formatDate(tsDate, tz, 'dd/MM/yyyy');
    } else {
      // Fallback: use the raw cell value if timestamp can't be parsed
      const rawDate = rows[i][5];
      dateStr = rawDate instanceof Date
        ? Utilities.formatDate(rawDate, tz, 'dd/MM/yyyy')
        : String(rawDate || '');
    }

    logs.push({
      timestamp:  tsStr,
      localid:    rows[i][1],
      name:       rows[i][2],
      instrument: rows[i][3],
      location:   rows[i][4],
      date:       dateStr,
      status:     String(rows[i][6] || ''),   // '' = active, 'Voided', 'AdminMark'
    });
  }

  // Most recent first
  logs.reverse();
  return { logs: logs.slice(0, limit || 500), total: logs.length };
}

// ── getMembers ───────────────────────────────────────────────
function getMembers() {
  const sheet = getSheet(SHEET_NAMES.MEMBERS);
  if (!sheet) return { members: [], error: 'Members sheet missing' };

  const rows    = sheet.getDataRange().getValues();
  const members = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    members.push({
      localId:  rows[i][0],
      name:     rows[i][1],
      tags:     rows[i][2],   // comma-separated roles/tags
      email:    rows[i][3],
      joinDate: rows[i][4],
    });
  }

  return { members };
}

// ── getContributions ─────────────────────────────────────────
function getContributions(year, month) {
  const sheet = getSheet(SHEET_NAMES.CONTRIBUTIONS);
  if (!sheet) return { contributions: [] };

  const rows          = sheet.getDataRange().getValues();
  const contributions = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const c = {
      memberId:    rows[i][0],
      memberName:  rows[i][1],
      month:       rows[i][2],
      year:        rows[i][3],
      amount:      rows[i][4],
      status:      rows[i][5],
      notes:       rows[i][6],
      lastUpdated: rows[i][7] ? String(rows[i][7]) : '',
      changedBy:   rows[i][8] || '',
    };
    const yearMatch  = !year  || String(c.year)  === String(year);
    const monthMatch = !month || String(c.month) === String(month);
    if (yearMatch && monthMatch) contributions.push(c);
  }

  return { contributions };
}

// ── updateContribution ───────────────────────────────────────
function updateContribution(p) {
  if (!p.memberId || !p.month || !p.year) {
    return { success: false, error: 'memberId, month, and year are required' };
  }

  const sheet = getSheet(SHEET_NAMES.CONTRIBUTIONS);
  if (!sheet) return { success: false, error: 'Contributions sheet missing. Run ?action=init first.' };

  const now       = new Date();
  const timestamp = now.toISOString();
  const changedBy = p.changedBy || 'Admin';
  const status    = p.status    || 'Void';
  // Strip the [auto:YEAR] carry-forward flag when an admin manually saves a contribution
  const notes     = (p.notes || '').replace(/^\[auto:\d{4}\]\s*/, '');
  const amount    = p.amount    || 30;

  const rows = sheet.getDataRange().getValues();

  for (let i = 1; i < rows.length; i++) {
    if (
      String(rows[i][0]) === String(p.memberId) &&
      String(rows[i][2]) === String(p.month)    &&
      String(rows[i][3]) === String(p.year)
    ) {
      // Update current-state row (cols 5-9)
      sheet.getRange(i + 1, 5).setValue(amount);
      sheet.getRange(i + 1, 6).setValue(status);
      sheet.getRange(i + 1, 7).setValue(notes);
      sheet.getRange(i + 1, 8).setValue(timestamp);
      sheet.getRange(i + 1, 9).setValue(changedBy);
      // Append to immutable audit log
      appendContribLog_(p, timestamp, status, notes, changedBy, amount);
      return { success: true, action: 'updated' };
    }
  }

  // New current-state record
  sheet.appendRow([
    p.memberId, p.memberName || '',
    p.month, p.year, amount, status, notes, timestamp, changedBy,
  ]);
  appendContribLog_(p, timestamp, status, notes, changedBy, amount);

  return { success: true, action: 'created' };
}

// ── appendContribLog_ (internal) ─────────────────────────────
function appendContribLog_(p, timestamp, status, notes, changedBy, amount) {
  const logSheet = getSheet(SHEET_NAMES.CONTRIB_LOG);
  if (!logSheet) return; // silently skip if sheet not yet initialised
  logSheet.appendRow([
    timestamp,
    p.memberId,
    p.memberName || '',
    p.month,
    p.year,
    amount || 30,
    status,
    notes,
    changedBy,
  ]);
}

// ── autoCarryForward ──────────────────────────────────────────
// Calculates end-of-year balance for each member and writes Opening Balance rows
// for the target year (targetYear = priorYear + 1).
//
// Parameters (all strings from URL):
//   p.year  – the TARGET year to populate OBs for (e.g. "2026")
//   p.force – "true"  → overwrite existing auto-flagged OBs (reconciliation mode)
//             "false" (default) → skip any member that already has an OB for targetYear
//
// OB formula:  OB(targetYear) = OB(priorYear) + totalPaid(priorYear)
//   priorYear OB: row where month=0 AND (year=priorYear OR year=0 as fallback)
//   priorYear paid: sum of amount for rows where year=priorYear AND month≠0 AND status='Paid'
//
// Audit trail: each carried-forward OB is written with:
//   notes     = '[auto:PRIORYR] Carried forward from PRIORYR'
//   changedBy = 'Auto:PRIORYR→TARGETYR'
//
function autoCarryForward(p) {
  const targetYear = parseInt(p.year);
  if (!targetYear || targetYear < 2020 || targetYear > 2100) {
    return { success: false, error: 'Invalid year parameter' };
  }
  const priorYear  = targetYear - 1;
  const force      = (p.force === 'true');
  const tz         = Session.getScriptTimeZone();
  const now        = new Date();
  const timestamp  = now.toISOString();

  const memberSheet = getSheet(SHEET_NAMES.MEMBERS);
  const contribSheet = getSheet(SHEET_NAMES.CONTRIBUTIONS);
  if (!memberSheet || !contribSheet) {
    return { success: false, error: 'Required sheets missing. Run ?action=init first.' };
  }

  // ── 1. Load all members ──────────────────────────────────────
  const memberRows = memberSheet.getDataRange().getValues();
  const members = [];
  for (let i = 1; i < memberRows.length; i++) {
    if (!memberRows[i][0]) continue;
    members.push({ localId: String(memberRows[i][0]), name: String(memberRows[i][1]) });
  }
  if (members.length === 0) return { success: false, error: 'No members found' };

  // ── 2. Load all contribution rows ────────────────────────────
  const contribRows = contribSheet.getDataRange().getValues();
  // Map: memberId → { obPrior, obPriorYear, obTargetRowIdx, obTargetIsAuto, totalPaid }
  const data = {};
  members.forEach(m => {
    data[m.localId] = { obPrior: 0, obPriorYear: null, obTargetRowIdx: -1, obTargetIsAuto: false, totalPaid: 0 };
  });

  for (let i = 1; i < contribRows.length; i++) {
    const row = contribRows[i];
    if (!row[0]) continue;
    const mid   = String(row[0]);
    const month = Number(row[2]);
    const year  = Number(row[3]);
    const amt   = Number(row[4]) || 0;
    const stat  = String(row[5] || '');
    const notes = String(row[6] || '');
    if (!data[mid]) continue;  // member no longer in sheet — skip

    // Opening Balance rows (month === 0)
    if (month === 0) {
      if (year === priorYear) {
        // Exact prior-year OB
        data[mid].obPrior = amt;
        data[mid].obPriorYear = priorYear;
      } else if (year === 0 && data[mid].obPriorYear === null) {
        // Legacy year=0 fallback (only if no explicit priorYear OB found yet)
        data[mid].obPrior = amt;
        data[mid].obPriorYear = 0;
      }
      if (year === targetYear) {
        data[mid].obTargetRowIdx  = i + 1;  // 1-based sheet row
        data[mid].obTargetIsAuto  = notes.startsWith('[auto:');
      }
    }

    // Regular monthly contributions from prior year
    if (year === priorYear && month !== 0 && stat === 'Paid') {
      data[mid].totalPaid += amt;
    }
  }

  // ── 3. Write / update OB rows ────────────────────────────────
  let carried = 0, skipped = 0, updated = 0;
  const changedBy = `Auto:${priorYear}→${targetYear}`;
  const autoNotes = `[auto:${priorYear}] Carried forward from ${priorYear}`;

  for (const m of members) {
    const d = data[m.localId];
    const newAmount = d.obPrior + d.totalPaid;

    if (d.obTargetRowIdx > 0) {
      // OB row already exists for targetYear
      if (!force) {
        skipped++;
        continue;
      }
      if (!d.obTargetIsAuto) {
        // Admin has manually edited this OB — don't overwrite
        skipped++;
        continue;
      }
      // force=true AND notes still starts with [auto:...] → reconcile
      contribSheet.getRange(d.obTargetRowIdx, 5).setValue(newAmount);
      contribSheet.getRange(d.obTargetRowIdx, 6).setValue('Void');
      contribSheet.getRange(d.obTargetRowIdx, 7).setValue(autoNotes);
      contribSheet.getRange(d.obTargetRowIdx, 8).setValue(timestamp);
      contribSheet.getRange(d.obTargetRowIdx, 9).setValue(changedBy);
      appendContribLog_(
        { memberId: m.localId, memberName: m.name, month: 0, year: targetYear },
        timestamp, 'Void', autoNotes, changedBy, newAmount
      );
      updated++;
    } else {
      // No OB yet for targetYear — create one
      contribSheet.appendRow([
        m.localId, m.name, 0, targetYear, newAmount, 'Void', autoNotes, timestamp, changedBy,
      ]);
      appendContribLog_(
        { memberId: m.localId, memberName: m.name, month: 0, year: targetYear },
        timestamp, 'Void', autoNotes, changedBy, newAmount
      );
      carried++;
    }
  }

  return {
    success:    true,
    targetYear: targetYear,
    priorYear:  priorYear,
    force:      force,
    carried:    carried,
    updated:    updated,
    skipped:    skipped,
  };
}

// ── getContribLog ─────────────────────────────────────────────
// Returns the full audit trail, optionally filtered by memberId / month / year.
function getContribLog(memberId, month, year) {
  const sheet = getSheet(SHEET_NAMES.CONTRIB_LOG);
  if (!sheet) return { log: [] };

  const rows = sheet.getDataRange().getValues();
  const log  = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const entry = {
      timestamp:  String(rows[i][0]),
      memberId:   rows[i][1],
      memberName: rows[i][2],
      month:      rows[i][3],
      year:       rows[i][4],
      amount:     rows[i][5],
      status:     rows[i][6],
      notes:      rows[i][7],
      changedBy:  rows[i][8],
    };
    const idMatch    = !memberId || String(entry.memberId) === String(memberId);
    const monthMatch = !month    || String(entry.month)    === String(month);
    const yearMatch  = !year     || String(entry.year)     === String(year);
    if (idMatch && monthMatch && yearMatch) log.push(entry);
  }

  log.reverse(); // most recent first
  return { log };
}

// ── updateMemberTags ─────────────────────────────────────────
// Updates the comma-separated roles/tags for an existing member (column 3).
function updateMemberTags(p) {
  if (!p.localId) return { success: false, error: 'localId is required' };

  const sheet = getSheet(SHEET_NAMES.MEMBERS);
  if (!sheet) return { success: false, error: 'Members sheet missing. Run ?action=init first.' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.localId)) {
      sheet.getRange(i + 1, 3).setValue(p.tags || '');
      return { success: true };
    }
  }
  return { success: false, error: 'Member not found' };
}

// ── adminMarkAttendance ──────────────────────────────────────
// Admin-side attendance recording: bypasses 4-hour dedup; accepts an explicit
// target date (dd/MM/yyyy). The timestamp is set to noon of the target date in
// the script timezone so that getLogs' timestamp→date derivation always returns
// the correct calendar date.
function adminMarkAttendance(p) {
  if (!p.localId || !p.name) return { success: false, error: 'localId and name are required' };
  if (!p.date)               return { success: false, error: 'date is required (dd/MM/yyyy)' };

  const sheet = getSheet(SHEET_NAMES.ATTENDANCE);
  if (!sheet) return { success: false, error: 'Attendance sheet missing. Run ?action=init first.' };

  const tz = Session.getScriptTimeZone();
  let targetDate, dateStr;
  try {
    // Parse as noon in the script timezone — locale-immune via Utilities.parseDate.
    targetDate = Utilities.parseDate(p.date + ' 12:00:00', tz, 'dd/MM/yyyy HH:mm:ss');
    dateStr    = Utilities.formatDate(targetDate, tz, 'dd/MM/yyyy');
  } catch (err) {
    return { success: false, error: 'Invalid date format. Use dd/MM/yyyy.' };
  }

  sheet.appendRow([
    targetDate.toISOString(),
    p.localId,
    p.name,
    p.instrument || '',
    'Admin Mark',
    dateStr,
    'AdminMark',
  ]);

  return { success: true, message: `Attendance marked for ${p.name} on ${dateStr}` };
}

// ── voidAttendance ───────────────────────────────────────────
// Marks a specific attendance row as Voided by setting col 7.
// The row is identified by its exact ISO timestamp + localId.
// Voided rows are excluded from counts/views but kept for audit.
function voidAttendance(p) {
  if (!p.timestamp || !p.localId) {
    return { success: false, error: 'timestamp and localId are required' };
  }

  const sheet = getSheet(SHEET_NAMES.ATTENDANCE);
  if (!sheet) return { success: false, error: 'Attendance sheet missing.' };

  const rows     = sheet.getDataRange().getValues();
  const tsTarget = String(p.timestamp);

  for (let i = 1; i < rows.length; i++) {
    const rawTs = rows[i][0];
    const tsStr = rawTs instanceof Date ? rawTs.toISOString() : String(rawTs || '');
    if (tsStr === tsTarget && String(rows[i][1]) === String(p.localId)) {
      sheet.getRange(i + 1, 7).setValue('Voided');
      return { success: true };
    }
  }
  return { success: false, error: 'Record not found — it may have already been removed.' };
}

// ══════════════════════════════════════════════════════════════
//  AUTH — Admin credential management
// ══════════════════════════════════════════════════════════════

// ── getSalt ──────────────────────────────────────────────────
// Returns the PBKDF2 salt stored for the given email so the client
// can reproduce the hash locally before calling verifyAdmin.
// Always returns a salt (real or deterministic dummy) to prevent
// email-enumeration via response differences.
function getSalt(p) {
  const email = String(p.email || '').toLowerCase().trim();
  if (!email) return { success: false, error: 'email required' };

  const sheet = getSheet(SHEET_NAMES.AUTH);
  if (!sheet) return { success: false, error: 'Auth sheet missing. Run ?action=init first.' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === email) {
      return { success: true, salt: String(rows[i][3]), iterations: Number(rows[i][4]) || 200000 };
    }
  }

  // Unknown email — return a deterministic dummy salt so timing is similar
  const raw  = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    email + SPREADSHEET_ID.slice(0, 12)
  );
  const dummy = raw.map(b => (b < 0 ? b + 256 : b).toString(16).padStart(2, '0')).join('').slice(0, 32);
  return { success: true, salt: dummy, iterations: 200000 };
}

// ── verifyAdmin ───────────────────────────────────────────────
// Validates email + client-side PBKDF2 hash.  Tracks failed attempts
// and locks the account for 15 minutes after 5 consecutive failures.
function verifyAdmin(p) {
  const email = String(p.email || '').toLowerCase().trim();
  const hash  = String(p.hash  || '');
  if (!email || !hash) return { success: false, error: 'email and hash are required' };

  const sheet = getSheet(SHEET_NAMES.AUTH);
  if (!sheet) return { success: false, error: 'Auth sheet missing.' };

  const rows = sheet.getDataRange().getValues();
  const now  = new Date();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() !== email) continue;

    // Lockout check
    const lockedUntil = rows[i][6] ? new Date(rows[i][6]) : null;
    if (lockedUntil && lockedUntil > now) {
      const mins = Math.ceil((lockedUntil - now) / 60000);
      return { success: false, locked: true,
        error: `Account locked. Try again in ${mins} minute${mins !== 1 ? 's' : ''}.` };
    }

    if (hash === String(rows[i][2])) {
      // Correct — reset fail counter
      sheet.getRange(i + 1, 6).setValue(0);
      sheet.getRange(i + 1, 7).setValue('');
      return { success: true, name: String(rows[i][1]), email: String(rows[i][0]) };
    }

    // Wrong password — increment fail counter
    const fails = (Number(rows[i][5]) || 0) + 1;
    sheet.getRange(i + 1, 6).setValue(fails);
    if (fails >= 5) {
      const lockUntil = new Date(now.getTime() + 15 * 60 * 1000);
      sheet.getRange(i + 1, 7).setValue(lockUntil.toISOString());
      return { success: false, locked: true,
        error: 'Too many failed attempts. Account locked for 15 minutes.' };
    }
    const left = 5 - fails;
    return { success: false,
      error: `Incorrect password. ${left} attempt${left !== 1 ? 's' : ''} remaining.` };
  }

  // Email not found — same error as wrong password (no enumeration)
  return { success: false, error: 'Invalid credentials.' };
}

// ── createAdmin ───────────────────────────────────────────────
// Creates a new admin account.  Requires a valid invite token unless
// the Auth sheet is empty (bootstrap: first admin).
function createAdmin(p) {
  const email      = String(p.email || '').toLowerCase().trim();
  const name       = String(p.name  || '').trim();
  const hash       = String(p.hash  || '');
  const salt       = String(p.salt  || '');
  const iterations = parseInt(p.iterations) || 200000;
  const inviteToken = String(p.inviteToken || '');
  const createdBy  = String(p.createdBy || email);

  if (!email || !name || !hash || !salt) {
    return { success: false, error: 'email, name, hash, and salt are required' };
  }

  const sheet = getSheet(SHEET_NAMES.AUTH);
  if (!sheet) return { success: false, error: 'Auth sheet missing. Run ?action=init first.' };

  const rows       = sheet.getDataRange().getValues();
  const adminCount = rows.length - 1;   // header row excluded
  const bootstrap  = (adminCount === 0);

  // Require invite token once the first admin exists
  if (!bootstrap) {
    if (!inviteToken) return { success: false, error: 'An invite token is required to sign up.' };
    const iv = validateInvite({ token: inviteToken });
    if (!iv.valid) return { success: false, error: iv.reason || 'Invalid invite token.' };
  }

  // Email uniqueness check
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === email) {
      return { success: false, emailExists: true, error: 'An admin with this email already exists.' };
    }
  }

  const now = new Date().toISOString();
  sheet.appendRow([email, name, hash, salt, iterations, 0, '', now, createdBy]);

  if (!bootstrap && inviteToken) consumeInvite_(inviteToken, email);

  return { success: true, name, email, bootstrap };
}

// ── changePassword ────────────────────────────────────────────
// Replaces the hash+salt for an existing admin (client-side key derivation).
function changePassword(p) {
  const email   = String(p.email   || '').toLowerCase().trim();
  const newHash = String(p.newHash || '');
  const newSalt = String(p.newSalt || '');
  const iters   = parseInt(p.iterations) || 200000;

  if (!email || !newHash || !newSalt) {
    return { success: false, error: 'email, newHash, and newSalt are required' };
  }

  const sheet = getSheet(SHEET_NAMES.AUTH);
  if (!sheet) return { success: false, error: 'Auth sheet missing.' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === email) {
      sheet.getRange(i + 1, 3).setValue(newHash);
      sheet.getRange(i + 1, 4).setValue(newSalt);
      sheet.getRange(i + 1, 5).setValue(iters);
      sheet.getRange(i + 1, 6).setValue(0);   // reset fail counter
      sheet.getRange(i + 1, 7).setValue('');  // clear lockout
      return { success: true };
    }
  }
  return { success: false, error: 'Admin not found.' };
}

// ── listAdmins ────────────────────────────────────────────────
function listAdmins(p) {
  const sheet = getSheet(SHEET_NAMES.AUTH);
  if (!sheet) return { admins: [] };
  const rows   = sheet.getDataRange().getValues();
  const admins = [];
  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    admins.push({
      email:     String(rows[i][0]),
      name:      String(rows[i][1]),
      createdAt: String(rows[i][7] || ''),
      createdBy: String(rows[i][8] || ''),
    });
  }
  return { admins };
}

// ── removeAdmin ───────────────────────────────────────────────
function removeAdmin(p) {
  const email = String(p.email || '').toLowerCase().trim();
  if (!email) return { success: false, error: 'email required' };

  const sheet = getSheet(SHEET_NAMES.AUTH);
  if (!sheet) return { success: false, error: 'Auth sheet missing.' };

  const rows       = sheet.getDataRange().getValues();
  const adminCount = rows.slice(1).filter(r => r[0]).length;
  if (adminCount <= 1) {
    return { success: false, error: 'Cannot remove the last admin account.' };
  }

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).toLowerCase().trim() === email) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Admin not found.' };
}

// ══════════════════════════════════════════════════════════════
//  INVITES — Single-use invite tokens for admin signup
// ══════════════════════════════════════════════════════════════

// ── generateInvite ────────────────────────────────────────────
function generateInvite(p) {
  const createdBy  = String(p.createdBy  || 'Admin');
  const expiryHrs  = Math.min(parseInt(p.expiryHours) || 48, 168); // cap at 7 days

  const sheet = getSheet(SHEET_NAMES.INVITES);
  if (!sheet) return { success: false, error: 'Invites sheet missing. Run ?action=init first.' };

  const token   = Utilities.getUuid().replace(/-/g, '');  // 32 hex chars
  const now     = new Date();
  const expiry  = new Date(now.getTime() + expiryHrs * 3600 * 1000);

  sheet.appendRow([token, now.toISOString(), expiry.toISOString(), createdBy, '', '']);

  return { success: true, token, expiresAt: expiry.toISOString(), expiryHours: expiryHrs };
}

// ── validateInvite ────────────────────────────────────────────
function validateInvite(p) {
  const token = String(p.token || '').trim();
  if (!token) return { valid: false, reason: 'Token is required.' };

  const sheet = getSheet(SHEET_NAMES.INVITES);
  if (!sheet) return { valid: false, reason: 'Invites sheet missing.' };

  const rows = sheet.getDataRange().getValues();
  const now  = new Date();

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== token) continue;
    if (rows[i][4])                   return { valid: false, reason: 'This invite has already been used.' };
    const exp = rows[i][2] ? new Date(rows[i][2]) : null;
    if (exp && exp < now)             return { valid: false, reason: 'This invite link has expired.' };
    return { valid: true, createdBy: String(rows[i][3] || ''), expiresAt: String(rows[i][2] || '') };
  }
  return { valid: false, reason: 'Invite not found. The link may be invalid.' };
}

// ── consumeInvite_ (internal) ─────────────────────────────────
function consumeInvite_(token, usedByEmail) {
  const sheet = getSheet(SHEET_NAMES.INVITES);
  if (!sheet) return;
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === token) {
      sheet.getRange(i + 1, 5).setValue(new Date().toISOString());
      sheet.getRange(i + 1, 6).setValue(usedByEmail);
      return;
    }
  }
}

// ── listInvites ───────────────────────────────────────────────
function listInvites(p) {
  const sheet = getSheet(SHEET_NAMES.INVITES);
  if (!sheet) return { invites: [] };

  const rows    = sheet.getDataRange().getValues();
  const now     = new Date();
  const invites = [];

  for (let i = 1; i < rows.length; i++) {
    if (!rows[i][0]) continue;
    const exp    = rows[i][2] ? new Date(rows[i][2]) : null;
    const isUsed = !!rows[i][4];
    const isExp  = !isUsed && exp && exp < now;
    invites.push({
      token:       String(rows[i][0]),
      createdAt:   String(rows[i][1] || ''),
      expiresAt:   String(rows[i][2] || ''),
      createdBy:   String(rows[i][3] || ''),
      usedAt:      String(rows[i][4] || ''),
      usedByEmail: String(rows[i][5] || ''),
      status:      isUsed ? 'used' : (isExp ? 'expired' : 'pending'),
    });
  }

  invites.reverse();  // most recent first
  return { invites };
}

// ── revokeInvite ──────────────────────────────────────────────
// Invalidates a pending invite by backdating its expiry.
function revokeInvite(p) {
  const token = String(p.token || '').trim();
  if (!token) return { success: false, error: 'token required' };

  const sheet = getSheet(SHEET_NAMES.INVITES);
  if (!sheet) return { success: false, error: 'Invites sheet missing.' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== token) continue;
    if (rows[i][4]) return { success: false, error: 'Token already used — cannot revoke.' };
    sheet.getRange(i + 1, 3).setValue(new Date(0).toISOString());  // expire immediately
    return { success: true };
  }
  return { success: false, error: 'Token not found.' };
}

// ══════════════════════════════════════════════════════════════
//  EXPENSES — Group Expense Ledger
// ══════════════════════════════════════════════════════════════

// ── addExpense ───────────────────────────────────────────────
function addExpense(p) {
  const sheet = getSheet(SHEET_NAMES.EXPENSES);
  if (!sheet) return { success: false, error: 'Expenses sheet missing. Run ?action=init first.' };

  if (!p.date || !p.description || !p.amount) {
    return { success: false, error: 'date, description, and amount are required.' };
  }
  const amount = parseFloat(p.amount);
  if (isNaN(amount) || amount <= 0) return { success: false, error: 'Amount must be a positive number.' };

  const expenseId  = Utilities.getUuid();
  const recordedAt = new Date().toISOString();

  sheet.appendRow([
    expenseId,
    String(p.date),
    String(p.category    || 'Other'),
    String(p.description || ''),
    amount,
    String(p.paidTo      || ''),
    String(p.notes       || ''),
    recordedAt,
    String(p.recordedBy  || 'Admin'),
  ]);

  return { success: true, expenseId };
}

// ── getExpenses ──────────────────────────────────────────────
// Returns all expenses.  Optional p.year filters to rows whose
// Date field falls in that calendar year (YYYY-MM-DD format).
function getExpenses(p) {
  const sheet = getSheet(SHEET_NAMES.EXPENSES);
  if (!sheet) return { success: false, expenses: [], error: 'Expenses sheet missing.' };

  const rows  = sheet.getDataRange().getValues();
  const year  = p && p.year ? parseInt(p.year) : null;
  const out   = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row[0]) continue;  // skip blank rows

    const dateStr = String(row[1] || '');
    if (year) {
      const rowYear = parseInt(dateStr.slice(0, 4));
      if (rowYear !== year) continue;
    }

    out.push({
      expenseId:   String(row[0]),
      date:        dateStr,
      category:    String(row[2] || ''),
      description: String(row[3] || ''),
      amount:      parseFloat(row[4]) || 0,
      paidTo:      String(row[5] || ''),
      notes:       String(row[6] || ''),
      recordedAt:  row[7] instanceof Date ? row[7].toISOString() : String(row[7] || ''),
      recordedBy:  String(row[8] || ''),
    });
  }

  // Return newest first
  out.sort((a, b) => b.date.localeCompare(a.date));
  return { success: true, expenses: out };
}

// ── updateExpense ────────────────────────────────────────────
function updateExpense(p) {
  const sheet = getSheet(SHEET_NAMES.EXPENSES);
  if (!sheet) return { success: false, error: 'Expenses sheet missing.' };
  if (!p.expenseId) return { success: false, error: 'expenseId required.' };

  const amount = parseFloat(p.amount);
  if (isNaN(amount) || amount <= 0) return { success: false, error: 'Amount must be a positive number.' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) !== String(p.expenseId)) continue;
    sheet.getRange(i + 1, 2).setValue(String(p.date        || rows[i][1]));
    sheet.getRange(i + 1, 3).setValue(String(p.category    || rows[i][2]));
    sheet.getRange(i + 1, 4).setValue(String(p.description || rows[i][3]));
    sheet.getRange(i + 1, 5).setValue(amount);
    sheet.getRange(i + 1, 6).setValue(String(p.paidTo      || rows[i][5] || ''));
    sheet.getRange(i + 1, 7).setValue(String(p.notes !== undefined ? p.notes : rows[i][6]));
    // recordedAt stays unchanged; recordedBy is updated to editor
    sheet.getRange(i + 1, 9).setValue(String(p.recordedBy  || rows[i][8]));
    return { success: true };
  }
  return { success: false, error: 'Expense not found.' };
}

// ── deleteExpense ────────────────────────────────────────────
function deleteExpense(p) {
  const sheet = getSheet(SHEET_NAMES.EXPENSES);
  if (!sheet) return { success: false, error: 'Expenses sheet missing.' };
  if (!p.expenseId) return { success: false, error: 'expenseId required.' };

  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][0]) === String(p.expenseId)) {
      sheet.deleteRow(i + 1);
      return { success: true };
    }
  }
  return { success: false, error: 'Expense not found.' };
}

// ── Helpers ──────────────────────────────────────────────────
function getSheet(name) {
  return SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(name);
}
