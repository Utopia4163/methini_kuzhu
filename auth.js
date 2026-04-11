/* ════════════════════════════════════════════════════════════
   auth.js — Medhini Parai Kuzhu
   ─────────────────────────────────────────────────────────
   Owns:
     • WORKER_URL / AUTH_API_KEY config
     • apiRead / apiWrite   (Cloudflare Worker proxy)
     • PBKDF2 key derivation
     • Session management   (sessionStorage-based)
     • Login / Logout / Signup / Change-password flows
     • Invite validation helpers
   ════════════════════════════════════════════════════════════ */

// ─── 🔧 CONFIGURE ────────────────────────────────────────────
const WORKER_URL   = 'https://medhinikuzhu.utopia4163.workers.dev/';
const AUTH_API_KEY = 'm61i(fi2wu2p965^6vlv!%#lnf6d)tj+^8g5wd7k8p6ombe*$4'; // must match Worker env var
// ─────────────────────────────────────────────────────────────

/* ════════════════════════════════════════════════════════════
   API helpers  (Cloudflare Worker — fetch POST with X-API-Key)
   ════════════════════════════════════════════════════════════ */

function apiRead(params, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(WORKER_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': AUTH_API_KEY },
    body:    JSON.stringify(params),
    signal:  controller.signal,
  })
    .then(r => { clearTimeout(timer); return r.json(); })
    .catch(e => {
      clearTimeout(timer);
      throw e.name === 'AbortError'
        ? new Error('Request timed out. Check your internet connection.')
        : new Error('Network error — could not reach server.');
    });
}

function apiWrite(params) {
  apiRead(params).catch(() => {});
}

/* ════════════════════════════════════════════════════════════
   PBKDF2 key derivation  (Web Crypto API — all modern browsers)
   ════════════════════════════════════════════════════════════ */

function _hexToBuffer(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function _bufferToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSalt() {
  return _bufferToHex(crypto.getRandomValues(new Uint8Array(16)));
}

async function deriveKey(password, saltHex, iterations = 200000) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: _hexToBuffer(saltHex), iterations, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return _bufferToHex(bits);
}

/* ════════════════════════════════════════════════════════════
   Session  (sessionStorage — clears on tab/browser close)
   ════════════════════════════════════════════════════════════ */

const AUTH_SESSION_KEY = 'pk_auth_session';

function getSession() {
  try {
    const raw = sessionStorage.getItem(AUTH_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function setSession(email, name) {
  sessionStorage.setItem(AUTH_SESSION_KEY,
    JSON.stringify({ email, name, loginTime: Date.now() })
  );
}

function clearSession() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
}

/* ════════════════════════════════════════════════════════════
   Boot — called from DOMContentLoaded in admin.html
   ════════════════════════════════════════════════════════════ */

async function authBoot() {
  // Existing session → go straight to admin panel
  const sess = getSession();
  if (sess?.email) {
    enterAdmin(sess.name, sess.email);
    return;
  }

  // Default — show login form
  // (Invite and setup flows are handled by invite.html)
  document.getElementById('login-form').style.display = '';
  _setLoginSub('Admin Dashboard');
}

/* ════════════════════════════════════════════════════════════
   Login
   ════════════════════════════════════════════════════════════ */

async function doLogin() {
  const email  = (document.getElementById('admin-email-login').value || '').trim().toLowerCase();
  const pw     = document.getElementById('admin-pw').value;
  const errEl  = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!email || !pw) {
    _loginErr('Enter your email address and password.');
    return;
  }

  const btn = document.getElementById('login-btn');
  btn.disabled = true;
  btn.innerHTML = '<span class="pk-spinner" style="width:14px;height:14px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:6px;"></span>Verifying…';

  try {
    // 1 — fetch salt for this email (always returns one, even for unknown emails)
    const saltRes = await apiRead({ action: 'getSalt', email });
    if (!saltRes.success) throw new Error(saltRes.error || 'Could not reach server.');

    // 2 — derive key client-side (password never leaves the browser)
    const hash = await deriveKey(pw, saltRes.salt, saltRes.iterations || 200000);

    // 3 — verify against the Auth sheet
    const res = await apiRead({ action: 'verifyAdmin', email, hash });
    if (res.success) {
      setSession(res.email || email, res.name || email);
      enterAdmin(res.name, res.email || email);
    } else {
      _loginErr(res.error || 'Incorrect credentials.');
      document.getElementById('admin-pw').value = '';
      document.getElementById('admin-pw').focus();
    }
  } catch (e) {
    _loginErr(e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="bi bi-shield-lock me-2"></i>Login';
  }
}

/* ════════════════════════════════════════════════════════════
   Logout
   ════════════════════════════════════════════════════════════ */

function doLogout() {
  clearSession();
  document.getElementById('admin-panel').style.display  = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('admin-pw').value = '';
  document.getElementById('admin-email-login').value = '';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-form').style.display  = '';
  _setLoginSub('Admin Dashboard');
}

/* ════════════════════════════════════════════════════════════
   Change Password  (authenticated — session must exist)
   ════════════════════════════════════════════════════════════ */

async function doChangePassword() {
  const email     = getSession()?.email;
  const currentPw = document.getElementById('chpw-current').value;
  const newPw     = document.getElementById('chpw-new').value;
  const newPw2    = document.getElementById('chpw-confirm').value;
  const errEl     = document.getElementById('chpw-error');
  const okEl      = document.getElementById('chpw-ok');
  errEl.style.display = 'none';
  okEl.style.display  = 'none';

  if (!currentPw || !newPw || !newPw2) {
    errEl.textContent = 'All fields are required.'; errEl.style.display = 'block'; return;
  }
  if (newPw.length < 8) {
    errEl.textContent = 'New password must be at least 8 characters.'; errEl.style.display = 'block'; return;
  }
  if (newPw !== newPw2) {
    errEl.textContent = 'New passwords do not match.'; errEl.style.display = 'block'; return;
  }

  const btn = document.getElementById('chpw-btn');
  btn.disabled = true;
  btn.textContent = 'Changing…';

  try {
    // Verify current password first
    const saltRes = await apiRead({ action: 'getSalt', email });
    if (!saltRes.success) throw new Error('Could not reach server.');
    const currentHash = await deriveKey(currentPw, saltRes.salt, saltRes.iterations || 200000);
    const verifyRes   = await apiRead({ action: 'verifyAdmin', email, hash: currentHash });
    if (!verifyRes.success) {
      errEl.textContent = 'Current password is incorrect.'; errEl.style.display = 'block'; return;
    }
    // Derive and store new key
    const newSalt = generateSalt();
    const newHash = await deriveKey(newPw, newSalt);
    const res     = await apiRead({ action: 'changePassword', email, newHash, newSalt, iterations: 200000 });
    if (res.success) {
      document.getElementById('chpw-current').value = '';
      document.getElementById('chpw-new').value     = '';
      document.getElementById('chpw-confirm').value = '';
      okEl.textContent = '✓ Password changed successfully.';
      okEl.style.display = 'block';
    } else {
      errEl.textContent = res.error || 'Could not change password.'; errEl.style.display = 'block';
    }
  } catch (e) {
    errEl.textContent = e.message; errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Change Password';
  }
}

/* ════════════════════════════════════════════════════════════
   Internal helpers
   ════════════════════════════════════════════════════════════ */

function _setLoginSub(text) {
  const el = document.getElementById('login-sub');
  if (el) el.textContent = text;
}

function _loginErr(msg) {
  const el = document.getElementById('login-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}

