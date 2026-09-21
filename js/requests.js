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

// Promise-based replacement for confirm()/prompt().
// Resolves false/null on cancel; with `input`, resolves the entered text.
function openModal({ title, message, confirmLabel = 'Confirm', danger = false, input = null }) {
  return new Promise(resolve => {
    const backdrop = document.getElementById('modal');
    const field = document.getElementById('modal-field');
    const box = document.getElementById('modal-input');
    const error = document.getElementById('modal-error');
    const confirmBtn = document.getElementById('modal-confirm');
    const cancelBtn = document.getElementById('modal-cancel');

    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-message').textContent = message;
    confirmBtn.textContent = confirmLabel;
    confirmBtn.classList.toggle('danger', danger);
    error.hidden = true;

    field.hidden = !input;
    if (input) {
      document.getElementById('modal-label').textContent = input.label;
      box.placeholder = input.placeholder || '';
      box.value = '';
    }

    backdrop.hidden = false;
    (input ? box : confirmBtn).focus();

    const close = (result) => {
      backdrop.hidden = true;
      document.removeEventListener('keydown', onKey);
      backdrop.removeEventListener('mousedown', onBackdrop);
      confirmBtn.onclick = cancelBtn.onclick = null;
      resolve(result);
    };
    const cancelled = () => close(input ? null : false);

    const onConfirm = () => {
      if (!input) return close(true);
      const value = box.value.trim();
      if (input.required && !value) {
        error.textContent = input.requiredMessage || 'This field is required.';
        error.hidden = false;
        box.focus();
        return;
      }
      close(value);
    };

    const onKey = (e) => {
      if (e.key === 'Escape') cancelled();
      // newlines stay available in the textarea; plain Enter confirms
      if (e.key === 'Enter' && (!input || !e.shiftKey)) { e.preventDefault(); onConfirm(); }
    };
    const onBackdrop = (e) => { if (e.target === backdrop) cancelled(); };

    confirmBtn.onclick = onConfirm;
    cancelBtn.onclick = cancelled;
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', onBackdrop);
  });
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
  <div class="req-card" data-id="${q._id}" data-email="${esc(q.customer.email)}">
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
        ${q.quotedAmount ? `<dt>Quoted</dt><dd>${(q.lineItems || []).length
          ? `<div class="bd-summary"><div><span>Base fare</span><span>${money(q.baseFare)}</span></div>`
            + q.lineItems.map(l => `<div><span>${esc(l.label)}</span><span>${money(l.amount)}</span></div>`).join('')
            + `<div class="total"><span>Total</span><span>${money(q.quotedAmount)}</span></div></div>`
          : money(q.quotedAmount)}</dd>` : ''}
        ${q.amountPaid ? `<dt>Paid</dt><dd>${money(q.amountPaid)}${q.remainingBalance > 0 ? ` (${money(q.remainingBalance)} due on pickup day)` : ''}</dd>` : ''}
        ${q.declineReason ? `<dt>Declined</dt><dd>${esc(q.declineReason)}</dd>` : ''}
      </dl>
    </div>

    ${q.status === 'paid' && q.paymentOption === 'deposit'
        && q.remainingBalance > 0 && !q.remainingBalancePaid ? `
    <div class="req-actions">
      <button class="btn-charge" data-amount="${money(q.remainingBalance)}">Charge balance now (${money(q.remainingBalance)})</button>
    </div>
    <div class="card-msg"></div>` : ''}

    ${isPending ? `
    <div class="req-actions">
      <div class="breakdown">
        <div class="bd-row bd-base">
          <span class="bd-label">Base fare</span>
          <div class="amount-input">
            <span class="amount-prefix" aria-hidden="true">$</span>
            <input type="number" class="quote-input" placeholder="0.00" min="0.01" step="0.01"
                   aria-label="Base fare in US dollars">
            <span class="amount-suffix" aria-hidden="true">USD</span>
          </div>
        </div>

        <div class="bd-lines"></div>

        <div class="bd-add">
          <span>Add:</span>
          <button type="button" class="bd-chip" data-preset="Tolls">Tolls</button>
          <button type="button" class="bd-chip" data-preset="Gratuity">Gratuity</button>
          <button type="button" class="bd-chip" data-preset="VAT">VAT</button>
          <button type="button" class="bd-chip" data-preset="">Custom</button>
        </div>

        <div class="bd-total"><span>Total</span><strong class="bd-total-value">$0.00</strong></div>
      </div>
    </div>
    <div class="req-actions">
      <button class="btn-accept">Accept &amp; send quote</button>
      <button class="btn-decline">Decline</button>
    </div>
    <div class="card-msg"></div>` : ''}
  </div>`;
}

// Mirrors backend/src/helpers/pricing.js. Preview only — the server recomputes
// and its total is what gets stored and charged.
function priceQuote(baseFare, lines) {
  const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const base = Number(baseFare) || 0;
  const amounts = new Map();

  const priced = lines.map(l => {
    const value = Number(l.value) || 0;
    let amount;
    if (l.mode === 'percent') {
      const basis = l.basis.length ? l.basis : ['base'];
      const sum = basis.reduce((t, ref) =>
        t + (ref === 'base' ? base : (amounts.get(ref) || 0)), 0);
      amount = round2(sum * value / 100);
    } else {
      amount = round2(value);
    }
    amounts.set(l.id, amount);
    return { ...l, amount };
  });

  return { base, priced, total: round2(base + priced.reduce((s, l) => s + l.amount, 0)) };
}

function renderLines(card, state) {
  const wrap = card.querySelector('.bd-lines');
  const { base, priced, total } = priceQuote(state.base, state.lines);

  wrap.innerHTML = priced.map((l, i) => {
    // a percentage can only build on the base fare or a line above it
    const options = [{ id: 'base', label: 'Base fare' }]
      .concat(priced.slice(0, i).map(p => ({ id: p.id, label: p.label || 'Untitled' })));

    return `
    <div class="bd-row bd-line" data-id="${l.id}">
      <input class="bd-name" type="text" value="${esc(l.label)}" placeholder="Label" aria-label="Line label">
      <select class="bd-mode" aria-label="Amount or percentage">
        <option value="amount" ${l.mode === 'amount' ? 'selected' : ''}>$</option>
        <option value="percent" ${l.mode === 'percent' ? 'selected' : ''}>%</option>
      </select>
      <input class="bd-value" type="number" min="0" step="0.01" value="${l.value === '' ? '' : esc(l.value)}"
             placeholder="0" aria-label="Value">
      <span class="bd-amount">${money(l.amount)}</span>
      <button type="button" class="bd-remove" aria-label="Remove line">&times;</button>
      ${l.mode === 'percent' ? `
      <div class="bd-basis">of
        ${options.map(o => `
        <label><input type="checkbox" value="${esc(o.id)}"
          ${(l.basis.length ? l.basis : ['base']).includes(o.id) ? 'checked' : ''}> ${esc(o.label)}</label>`).join('')}
      </div>` : ''}
    </div>`;
  }).join('');

  card.querySelector('.bd-total-value').textContent = money(total);
  card.querySelector('.bd-total').classList.toggle('empty', !base);
  state.total = total;
}

function wireBreakdown(card) {
  const state = { base: '', lines: [], total: 0, seq: 0 };
  const rerender = () => renderLines(card, state);

  card.querySelector('.quote-input').addEventListener('input', e => {
    state.base = e.target.value;
    rerender();
  });

  card.querySelectorAll('.bd-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const preset = chip.dataset.preset;
      state.lines.push({
        id: `l${++state.seq}`,
        label: preset,
        // tolls are a pass-through cost; gratuity and VAT are normally rates
        mode: preset === 'Tolls' || preset === '' ? 'amount' : 'percent',
        value: '',
        basis: ['base'],
      });
      rerender();
      const last = card.querySelector('.bd-line:last-child .bd-name');
      if (!preset && last) last.focus();
    });
  });

  const lines = card.querySelector('.bd-lines');
  const find = el => state.lines.find(l => l.id === el.closest('.bd-line').dataset.id);

  lines.addEventListener('input', e => {
    const line = find(e.target);
    if (!line) return;
    if (e.target.classList.contains('bd-name')) { line.label = e.target.value; rerender(); }
    if (e.target.classList.contains('bd-value')) { line.value = e.target.value; rerender(); }
  });

  lines.addEventListener('change', e => {
    const line = find(e.target);
    if (!line) return;
    if (e.target.classList.contains('bd-mode')) { line.mode = e.target.value; rerender(); }
    if (e.target.type === 'checkbox') {
      const boxes = [...e.target.closest('.bd-basis').querySelectorAll('input:checked')];
      line.basis = boxes.length ? boxes.map(b => b.value) : ['base'];
      rerender();
    }
  });

  lines.addEventListener('click', e => {
    if (!e.target.classList.contains('bd-remove')) return;
    const id = e.target.closest('.bd-line').dataset.id;
    state.lines = state.lines.filter(l => l.id !== id);
    // drop references to a line that no longer exists
    state.lines.forEach(l => {
      l.basis = l.basis.filter(b => b !== id);
      if (!l.basis.length) l.basis = ['base'];
    });
    rerender();
  });

  rerender();
  return state;
}

function wireCharge(card, btn) {
  const msg = card.querySelector('.card-msg');
  const id = card.dataset.id;
  const amount = btn.dataset.amount;

  btn.addEventListener('click', async () => {
    const confirmed = await openModal({
      title: 'Charge the remaining balance?',
      message: `The card ${card.dataset.email} has on file will be charged now.`,
      confirmLabel: 'Charge now',
    });
    if (!confirmed) return;

    btn.disabled = true;
    btn.textContent = 'Charging…';
    try {
      const res = await api(`/api/quotes/${id}/charge-balance`, { method: 'PATCH' });
      msg.innerHTML = `<div class="alert alert-ok" style="margin:.9rem 0 0">Charged ${money(res.amount)} — the customer has been emailed a receipt.</div>`;
      setTimeout(loadRequests, 1400);
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-error" style="margin:.9rem 0 0">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = `Charge balance now (${amount || ''})`.trim();
    }
  });
}

function wireCards() {
  document.querySelectorAll('.req-card').forEach((card) => {
    const id = card.dataset.id;
    const msg = card.querySelector('.card-msg');
    const charge = card.querySelector('.btn-charge');
    if (charge) wireCharge(card, charge);

    const accept = card.querySelector('.btn-accept');
    const decline = card.querySelector('.btn-decline');
    if (!accept) return;

    const state = wireBreakdown(card);

    const setBusy = (busy) => {
      accept.disabled = busy;
      decline.disabled = busy;
    };
    const showMsg = (text, kind = 'error') => {
      msg.innerHTML = `<div class="alert alert-${kind}" style="margin:.9rem 0 0">${esc(text)}</div>`;
    };

    accept.addEventListener('click', async () => {
      const baseFare = Number(state.base);
      if (!Number.isFinite(baseFare) || baseFare <= 0) return showMsg('Enter a base fare first.');
      const unlabelled = state.lines.find(l => !String(l.label).trim());
      if (unlabelled) return showMsg('Every line item needs a label.');

      const breakdown = state.lines.length
        ? `\n\nBase fare ${money(baseFare)}\n` + state.lines
            .map(l => `${l.label} ${money(priceQuote(baseFare, state.lines).priced.find(p => p.id === l.id).amount)}`)
            .join('\n')
        : '';

      const confirmed = await openModal({
        title: 'Send this quote?',
        message: `${money(state.total)} will be emailed to ${card.dataset.email} with a payment link.${breakdown}`,
        confirmLabel: 'Send quote',
      });
      if (!confirmed) return;

      setBusy(true);
      accept.textContent = 'Sending…';
      try {
        await api(`/api/quotes/${id}/accept`, {
          method: 'PATCH',
          body: JSON.stringify({
            baseFare,
            lineItems: state.lines.map(l => ({
              id: l.id,
              label: String(l.label).trim(),
              mode: l.mode,
              value: Number(l.value) || 0,
              basis: l.basis,
            })),
          }),
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
      const reason = await openModal({
        title: 'Decline this request?',
        message: `${card.dataset.email} will be emailed the reason you give below.`,
        confirmLabel: 'Decline request',
        danger: true,
        input: {
          label: 'Reason',
          placeholder: 'e.g. That vehicle is already booked for those dates',
          required: true,
          requiredMessage: 'A reason is required — the customer will see it.',
        },
      });
      if (reason === null) return;

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
