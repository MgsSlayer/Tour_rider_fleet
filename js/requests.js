// Admin review of quote requests. Auth is a server-issued JWT held in sessionStorage.

const TOKEN_KEY = 'trAdminToken';
const getToken = () => sessionStorage.getItem(TOKEN_KEY);
const money = (n) => `$${Number(n).toFixed(2)}`;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function api(path, options = {}) {
  const res = await fetch(`${CONFIG.API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (res.status === 401) {
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
    throw new Error('Your session expired. Please sign in again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function showLogin() {
  document.getElementById('dash-view').style.display = 'none';
  document.getElementById('logout-link').style.display = 'none';
  document.getElementById('login-view').style.display = 'block';
}

function showDash() {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('dash-view').style.display = 'block';
  document.getElementById('logout-link').style.display = 'inline';
}

async function onLogin(e) {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errEl = document.getElementById('login-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('login-email').value.trim(),
        password: document.getElementById('login-password').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Sign in failed');

    sessionStorage.setItem(TOKEN_KEY, data.token);
    document.getElementById('login-password').value = '';
    showDash();
    loadRequests();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function loadRequests() {
  const list = document.getElementById('list');
  list.innerHTML = '<div class="state-msg">Loading…</div>';
  const status = document.getElementById('status-filter').value;

  try {
    const { quotes } = await api(`/api/quotes${status ? `?status=${status}` : ''}`);
    document.getElementById('dash-sub').textContent =
      `${quotes.length} ${status || 'total'} request${quotes.length === 1 ? '' : 's'}`;

    if (!quotes.length) {
      list.innerHTML = '<div class="state-msg">Nothing here right now.</div>';
      return;
    }
    list.innerHTML = quotes.map(renderCard).join('');
    wireCards();
  } catch (err) {
    list.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function renderCard(q) {
  const created = new Date(q.createdAt).toLocaleString();
  const isPending = q.status === 'pending';

  return `
  <div class="req-card" data-id="${q._id}">
    <div class="req-head">
      <div>
        <h3>${esc(q.customer.name)} — ${esc(q.vehicle?.name || q.vehicle?.type || 'Vehicle')}</h3>
        <div class="cv-meta">${esc(q.customer.email)}${q.customer.phone ? ` · ${esc(q.customer.phone)}` : ''}</div>
      </div>
      <span class="badge badge-${q.status}">${q.status}</span>
    </div>

    <div class="trip-summary" style="margin:1rem 0 0">
      <dl>
        <dt>Trip</dt><dd>${esc(q.tripType)} · ${q.passengers} passengers</dd>
        <dt>Date</dt><dd>${esc(q.date)} ${esc(q.pickupTime)} → ${esc(q.finalDropoffTime)}</dd>
        <dt>Pick-up</dt><dd>${esc(q.pickupAddress)}</dd>
        ${q.stopoverAddress ? `<dt>Stop over</dt><dd>${esc(q.stopoverAddress)}</dd>` : ''}
        <dt>Drop-off</dt><dd>${esc(q.dropoffAddress)}</dd>
        ${q.message ? `<dt>Message</dt><dd>${esc(q.message)}</dd>` : ''}
        <dt>Received</dt><dd>${esc(created)}</dd>
        ${q.quotedAmount ? `<dt>Quoted</dt><dd>${money(q.quotedAmount)}</dd>` : ''}
        ${q.amountPaid ? `<dt>Paid</dt><dd>${money(q.amountPaid)}${q.remainingBalance > 0 ? ` (${money(q.remainingBalance)} due on pickup day)` : ''}</dd>` : ''}
        ${q.declineReason ? `<dt>Declined</dt><dd>${esc(q.declineReason)}</dd>` : ''}
      </dl>
    </div>

    ${isPending ? `
    <div class="req-actions">
      <input type="number" class="quote-input" placeholder="Quote amount (USD)" min="1" step="0.01"
             style="flex:1;min-width:180px;background:#0f0f0f;color:#fff;border:1px solid var(--border);border-radius:8px;padding:.6rem .8rem">
      <button class="btn-accept">Accept &amp; send quote</button>
      <button class="btn-decline">Decline</button>
    </div>
    <div class="card-msg"></div>` : ''}
  </div>`;
}

function wireCards() {
  document.querySelectorAll('.req-card').forEach((card) => {
    const id = card.dataset.id;
    const msg = card.querySelector('.card-msg');
    const accept = card.querySelector('.btn-accept');
    const decline = card.querySelector('.btn-decline');
    if (!accept) return;

    const setBusy = (busy) => {
      accept.disabled = busy;
      decline.disabled = busy;
    };
    const showMsg = (text, kind = 'error') => {
      msg.innerHTML = `<div class="alert alert-${kind}" style="margin:.9rem 0 0">${esc(text)}</div>`;
    };

    accept.addEventListener('click', async () => {
      const amount = Number(card.querySelector('.quote-input').value);
      if (!Number.isFinite(amount) || amount <= 0) return showMsg('Enter a quote amount first.');
      if (!confirm(`Send a quote of ${money(amount)} to this customer?`)) return;

      setBusy(true);
      accept.textContent = 'Sending…';
      try {
        await api(`/api/quotes/${id}/accept`, {
          method: 'PATCH',
          body: JSON.stringify({ quotedAmount: amount }),
        });
        showMsg('Quote sent — the customer has been emailed a payment link.', 'ok');
        setTimeout(loadRequests, 1200);
      } catch (err) {
        showMsg(err.message);
        setBusy(false);
        accept.textContent = 'Accept & send quote';
      }
    });

    decline.addEventListener('click', async () => {
      const reason = prompt('Why are you declining? The customer will see this.');
      if (reason === null) return;
      if (!reason.trim()) return showMsg('A reason is required to decline.');

      setBusy(true);
      decline.textContent = 'Sending…';
      try {
        await api(`/api/quotes/${id}/decline`, {
          method: 'PATCH',
          body: JSON.stringify({ reason: reason.trim() }),
        });
        showMsg('Request declined — the customer has been emailed.', 'ok');
        setTimeout(loadRequests, 1200);
      } catch (err) {
        showMsg(err.message);
        setBusy(false);
        decline.textContent = 'Decline';
      }
    });
  });
}

function init() {
  document.getElementById('login-form').addEventListener('submit', onLogin);
  document.getElementById('status-filter').addEventListener('change', loadRequests);
  document.getElementById('refresh-btn').addEventListener('click', loadRequests);
  document.getElementById('logout-link').addEventListener('click', (e) => {
    e.preventDefault();
    sessionStorage.removeItem(TOKEN_KEY);
    showLogin();
  });

  if (getToken()) {
    showDash();
    loadRequests();
  } else {
    showLogin();
  }
}

document.addEventListener('DOMContentLoaded', init);
