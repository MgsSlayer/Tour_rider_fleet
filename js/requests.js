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

// sheet rates, keyed by S/N — fetched once and reused for suggestions
let vehicleRates = null;
const METHOD_LABELS = {
  card: 'Card', apple_pay: 'Apple Pay', google_pay: 'Google Pay', cash_app: 'Cash App Pay',
  paypal: 'PayPal', venmo: 'Venmo', zelle: 'Zelle', cash: 'Cash',
};

const cardCoords = {};
const cardAddresses = {};
const cardRoutes = {};   // encoded polylines from the price suggestion
const cardMatching = {}; // fleet vehicles matched to an open request, priced server-side

// mirrors CATEGORIES and CITIES in backend/src/services/fleetService.js
const WANTS_LABELS = {
  any: 'Any vehicle', 'party-bus': 'Party bus', 'van-bus': 'Van, bus or coach', 'limo-suv': 'Limo, SUV or sedan',
  nynj: 'NY/NJ', miami: 'Miami',
};
const wantsLabel = (w = {}) => [WANTS_LABELS[w.category], WANTS_LABELS[w.city]].filter(Boolean).join(' · ');
async function loadVehicleRates() {
  if (vehicleRates) return vehicleRates;
  vehicleRates = {};
  try {
    (await fetchVehicles()).forEach(v => {
      vehicleRates[v.sn] = {
        retail: parseFloat(String(v.retprice).replace(/[^0-9.]/g, '')) || '',
        affiliate: parseFloat(String(v.affprice).replace(/[^0-9.]/g, '')) || '',
        pics: (v.pics || '').split('|').map(u => u.trim()).filter(Boolean),
      };
    });
  } catch (e) {
    console.warn('could not load fleet rates:', e.message);
  }
  return vehicleRates;
}

async function loadRequests() {
  const list = document.getElementById('list');
  list.innerHTML = '<div class="state-msg">Loading…</div>';
  const status = document.getElementById('status-filter').value;

  try {
    const [{ quotes }] = await Promise.all([
      api(`/api/quotes${status ? `?status=${status}` : ''}`),
      loadVehicleRates(),
    ]);
    document.getElementById('dash-sub').textContent =
      `${quotes.length} ${status || 'total'} request${quotes.length === 1 ? '' : 's'}`;

    if (!quotes.length) {
      list.innerHTML = '<div class="state-msg">Nothing here right now.</div>';
      return;
    }
    quotes.forEach((q) => {
      cardCoords[q._id] = q.coords || {};
      cardAddresses[q._id] = {
        pickup: q.pickupAddress, stopover: q.stopoverAddress, dropoff: q.dropoffAddress,
      };
      if (q.kind === 'open') cardMatching[q._id] = q.matching || null;
    });
    list.innerHTML = quotes.map(renderCard).join('');
    wireCards();
  } catch (err) {
    list.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function renderCard(q) {
  const created = new Date(q.createdAt).toLocaleString();
  const isPending = q.status === 'pending';
  const isOpen = q.kind === 'open';
  const rates = (vehicleRates || {})[q.vehicle?.sn] || { retail: '', affiliate: '', pics: [] };
  const hasTrip = !!(q.pickupAddress && q.dropoffAddress);

  return `
  <div class="req-card" data-id="${q._id}" data-kind="${isOpen ? 'open' : 'vehicle'}" data-email="${esc(q.customer.email)}"
       data-retail="${esc(rates.retail)}" data-affiliate="${esc(rates.affiliate)}">
    <div class="req-head">
      <div class="req-who">
        <img class="req-vehicle-pic${(rates.pics || []).length ? ' clickable' : ''}"
             src="${esc((rates.pics || [])[0] || 'css/placeholder.svg')}"
             alt="${esc(q.vehicle?.name || 'Vehicle')}" loading="lazy"
             title="${(rates.pics || []).length > 1 ? `View all ${rates.pics.length} photos` : 'View photo'}"
             data-sn="${esc(q.vehicle?.sn || '')}"
             onerror="this.src='css/placeholder.svg'">
        <div>
          <h3>${esc(q.customer.name)}</h3>
          <div class="req-vehicle-name">${isOpen && !q.vehicle?.sn
            ? `Open request · ${esc(wantsLabel(q.wants))}`
            : `${esc(q.vehicle?.name || q.vehicle?.type || 'Vehicle')}${q.vehicle?.sn ? ` · S/N ${esc(q.vehicle.sn)}` : ''}`}</div>
          <div class="cv-meta">${esc(q.customer.email)}${q.customer.phone ? ` · ${esc(q.customer.phone)}` : ''}</div>
        </div>
      </div>
      <span class="badge badge-${q.status}">${q.status}</span>
    </div>

    ${hasTrip ? `
    <div class="req-map-wrap">
      <button type="button" class="req-map-btn">View trip on map</button>
      <div class="trip-map" hidden></div>
      <div class="map-key" hidden>
        <span><i class="pin pin-a"></i> Pick-up</span>
        ${q.coords?.stopover ? '<span><i class="pin pin-b"></i> Stop over</span>' : ''}
        <span><i class="pin pin-c"></i> Drop-off</span>
        <span><i class="pin pin-route"></i> Route</span>
      </div>
    </div>` : ''}

    <div class="trip-summary" style="margin:1rem 0 0">
      <dl>
        ${isOpen ? `<dt>Wanted</dt><dd>${esc(wantsLabel(q.wants))}</dd>` : ''}
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
        ${q.paymentMethod ? `<dt>Method</dt><dd>${esc(METHOD_LABELS[q.paymentMethod] || q.paymentMethod)}${
          q.processingFee > 0 ? ` · ${money(q.processingFee)} fee` : ' · no fee'}</dd>` : ''}
        ${q.amountPaid ? `<dt>Paid</dt><dd>${money(q.amountPaid)}${q.remainingBalance > 0 ? ` (${money(q.remainingBalance)} due on pickup day)` : ''}</dd>` : ''}
        ${q.declineReason ? `<dt>Declined</dt><dd>${esc(q.declineReason)}</dd>` : ''}
      </dl>
    </div>

    ${q.status === 'awaiting_payment' || (q.offlineChosenAt && q.status === 'paid' && q.remainingBalance > 0 && !q.remainingBalancePaid) ? `
    <div class="req-actions">
      <button class="btn-confirm" data-confirm="${q._id}">Confirm ${esc(METHOD_LABELS[q.paymentMethod] || 'offline')} payment received</button>
    </div>
    <div class="card-msg"></div>` : ''}

    ${q.status === 'paid' && q.paymentOption === 'deposit'
        && q.remainingBalance > 0 && !q.remainingBalancePaid ? `
    <div class="req-actions">
      <button class="btn-charge" data-amount="${money(q.remainingBalance)}">Charge balance now (${money(q.remainingBalance)})</button>
    </div>
    <div class="card-msg"></div>` : ''}

    ${isPending ? `
    <div class="req-actions">
      <div class="breakdown">
        ${isOpen ? `
        <div class="bd-matches">
          <div class="bd-matches-head">
            <span>Vehicles that fit</span>
            <button type="button" class="bd-matches-refresh">Check the fleet again</button>
          </div>
          <div class="bd-match-list"></div>
        </div>` : ''}
        <div class="bd-suggest">
          <span class="bd-suggest-note">Working out a suggested price…</span>
        </div>
        <div class="bd-basepick" hidden>
          <label>Departing from
            <select class="bd-base-select"></select>
          </label>
          <button type="button" class="bd-basepick-go">Recalculate</button>
        </div>
        <div class="bd-reposition"></div>
        <div class="bd-candidates"></div>

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
      <button class="btn-accept">${isOpen ? 'Send vehicle &amp; price' : 'Accept &amp; send quote'}</button>
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

  refreshTotals(card, state);
}

/**
 * Updates the computed figures without touching the DOM structure.
 * Rebuilding rows on every keystroke destroys the input being typed into, which
 * drops focus and closes the keyboard on mobile.
 */
function refreshTotals(card, state) {
  const { base, priced, total } = priceQuote(state.base, state.lines);

  priced.forEach(l => {
    const row = card.querySelector(`.bd-line[data-id="${l.id}"]`);
    if (row) row.querySelector('.bd-amount').textContent = money(l.amount);
    // later lines may use this one as a percentage basis — keep those labels honest
    card.querySelectorAll(`.bd-basis input[value="${l.id}"]`).forEach(cb => {
      const text = cb.parentElement.lastChild;
      if (text && text.nodeType === 3) text.textContent = ` ${l.label || 'Untitled'}`;
    });
  });

  card.querySelector('.bd-total-value').textContent = money(total);
  card.querySelector('.bd-total').classList.toggle('empty', !base);
  state.total = total;
}

function wireBreakdown(card) {
  const state = { base: '', lines: [], total: 0, seq: 0 };
  const rerender = () => renderLines(card, state);

  const baseInput = card.querySelector('.quote-input');

  baseInput.addEventListener('input', e => {
    state.base = e.target.value;
    state.touched = true;          // a suggestion must never overwrite this
    refreshTotals(card, state);
  });

  // the $ and USD labels sit over the field — make the whole box focus it
  card.querySelector('.amount-input').addEventListener('click', () => baseInput.focus());

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
    if (e.target.classList.contains('bd-name')) line.label = e.target.value;
    else if (e.target.classList.contains('bd-value')) line.value = e.target.value;
    else return;
    refreshTotals(card, state);   // never rerender here — it would steal focus
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

  wireSuggest(card, state, rerender);
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
      msg.innerHTML = `<div class="alert alert-ok" style="margin:.9rem 0 0">Charged ${money(res.amount)}. The customer has been emailed a receipt.</div>`;
      setTimeout(loadRequests, 1400);
    } catch (err) {
      msg.innerHTML = `<div class="alert alert-error" style="margin:.9rem 0 0">${esc(err.message)}</div>`;
      btn.disabled = false;
      btn.textContent = `Charge balance now (${amount || ''})`.trim();
    }
  });
}

// one matched vehicle: retail total up front, affiliate beneath, so margin reads at a glance
function matchHtml(m) {
  const total = (label) => (m.candidates || []).find(c => c.label === label)?.total;
  const retail = total('Retail');
  const affiliate = total('Affiliate');
  // hourly rates stand in when the route could not be priced
  const main = retail ? money(retail) : m.rates?.retail ? `${money(m.rates.retail)}/h` : 'No retail rate';
  const sub = affiliate ? `Aff. ${money(affiliate)}` : m.rates?.affiliate ? `Aff. ${money(m.rates.affiliate)}/h` : '';
  return `
  <button type="button" class="bd-match" data-sn="${esc(m.sn)}">
    <img src="${esc(m.pic || 'css/placeholder.svg')}" alt="" loading="lazy" onerror="this.src='css/placeholder.svg'">
    <span class="bm-body">
      <span class="bm-name">${esc(m.name)}</span>
      <span class="bm-meta">${esc([m.type, m.capacity ? `${m.capacity} pax` : '', `S/N ${m.sn}`].filter(Boolean).join(' · '))}</span>
    </span>
    <span class="bm-price">${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}</span>
  </button>`;
}

// Distance-based suggestion. Purely advisory — applying one just fills the
// editor, and the server still re-prices whatever is finally submitted.
/**
 * Prices the trip automatically when the card opens. The result is only ever a
 * suggestion: it pre-fills the editor, is labelled as such, and every field
 * stays editable. The server caches per quote, so this costs one route lookup
 * per request rather than one per page view.
 */
function wireSuggest(card, state, rerender) {
  const note = card.querySelector('.bd-suggest-note');
  const wrap = card.querySelector('.bd-candidates');
  const pick = card.querySelector('.bd-basepick');
  const select = card.querySelector('.bd-base-select');
  const go = card.querySelector('.bd-basepick-go');
  const repo = card.querySelector('.bd-reposition');
  const isOpen = card.dataset.kind === 'open';
  const list = card.querySelector('.bd-match-list');
  const again = card.querySelector('.bd-matches-refresh');
  if (!note) return;

  let bases = [];
  let matching = null;

  const applyCandidate = (c) => {
    state.touched = false;         // an explicit pick replaces whatever was there
    state.base = c.baseFare;
    state.lines = c.lineItems.map(l => ({
      id: `l${++state.seq}`, label: l.label, mode: l.mode,
      value: l.value, basis: l.basis || ['base'],
    }));
    card.querySelector('.quote-input').value = c.baseFare;
    rerender();
  };

  const render = (res, applyFirst) => {
    const r = res.route;
    const rep = res.repositioning || {};
    // the suggestion's Routes call already returned the road path, so the map
    // can draw it without spending a Directions request
    if (r.polyline) cardRoutes[card.dataset.id] = r.polyline;

    // the route summary is noise once the figures are on screen; the note area
    // stays for the loading and failure states only
    note.textContent = '';
    note.classList.remove('err');
    repo.innerHTML = rep.note
      ? `<div class="alert alert-${rep.charged ? 'info' : 'ok'}" style="margin:0 0 .8rem">${esc(rep.note)}</div>`
      : '';

    wrap.innerHTML = res.candidates.map((c, i) => {
      const total = priceQuote(c.baseFare, c.lineItems.map((l, j) => ({
        id: `s${i}_${j}`, label: l.label, mode: l.mode, value: l.value, basis: l.basis || ['base'],
      }))).total;
      const p = c.baseFareParts || {};
      // reads as the sum it is: inputs first, result last
      const madeOf = p.repositioning > 0
        ? `${p.hours} h × ${money(p.hourlyRate)} + ${money(p.repositioning)} repositioning = ${money(c.baseFare)}`
        : `${p.hours} h × ${money(p.hourlyRate)} = ${money(c.baseFare)}`;
      return `
      <button type="button" class="bd-candidate${i === 0 && applyFirst ? ' chosen' : ''}" data-i="${i}">
        <span class="bc-label">${esc(c.label)} · ${money(c.hourlyRate)}/h</span>
        <span class="bc-total">${money(total)}</span>
        <span class="bc-parts">${esc(madeOf)}</span>
        <span class="bc-apply">Use this</span>
      </button>`;
    }).join('');

    wrap.querySelectorAll('.bd-candidate').forEach(el => {
      el.addEventListener('click', () => {
        applyCandidate(res.candidates[Number(el.dataset.i)]);
        wrap.querySelectorAll('.bd-candidate').forEach(b => b.classList.remove('chosen'));
        el.classList.add('chosen');
      });
    });

    // start from the retail suggestion, but never clobber something already typed
    if (applyFirst && res.candidates.length && !state.touched) {
      applyCandidate(res.candidates[0]);
    } else if (state.touched) {
      note.textContent = 'Your edits were kept.';
    }
  };

  // The field stays locked only while a suggestion is in flight, so an arriving
  // result can't overwrite something half-typed. It unlocks either way.
  const baseInput = card.querySelector('.quote-input');
  const showNote = () => card.querySelector('.bd-suggest')
    .classList.toggle('empty', !note.textContent.trim());

  const setBaseLocked = (locked) => {
    baseInput.disabled = locked;
    baseInput.placeholder = locked ? 'Pricing…' : '0.00';
    card.querySelector('.amount-input').classList.toggle('locked', locked);
  };

  // An open request prices every matching vehicle up front. Picking one loads
  // its figures exactly as a single-vehicle suggestion would.
  const pickVehicle = (sn, explicit) => {
    const m = (matching?.vehicles || []).find(v => v.sn === sn) || null;
    state.vehicleSn = m?.sn || null;
    state.vehicleName = m?.name || '';
    // a pick answers any "pick a vehicle first" warning still on the card
    const msg = card.querySelector('.card-msg');
    if (explicit && msg) msg.innerHTML = '';
    list.querySelectorAll('.bd-match').forEach(b => b.classList.toggle('chosen', b.dataset.sn === state.vehicleSn));

    if (m?.candidates?.length && matching.route) {
      if (explicit) state.touched = false;   // a different vehicle brings its own figures
      render({ route: matching.route, repositioning: matching.repositioning || {}, candidates: m.candidates }, true);
      showNote();
      return;
    }

    // never send one vehicle at another vehicle's suggested price
    if (explicit && !state.touched) {
      state.base = '';
      state.lines = [];
      baseInput.value = '';
      rerender();
    }
    wrap.innerHTML = '';
    repo.innerHTML = '';
    note.textContent = matching?.error
      ? `${matching.error}${m ? ' Enter a price manually below.' : ''}`
      : m ? 'No rate in the sheet for this vehicle. Enter a price manually below.'
        : (matching?.vehicles || []).length ? 'Pick a vehicle above to load its price.' : '';
    note.classList.toggle('err', !!matching?.error);
    showNote();
  };

  const showMatches = (m) => {
    matching = m || { vehicles: [] };
    cardMatching[card.dataset.id] = matching;
    const vehicles = matching.vehicles || [];
    list.innerHTML = vehicles.length
      ? vehicles.map(matchHtml).join('')
      : `<div class="bd-match-empty">${matching.error
        ? 'No vehicles to show.'
        : 'No vehicles in the fleet fit this request. Decline it, or reply to the customer with an alternative.'}</div>`;
    // a recalculation keeps the admin's pick while that vehicle still fits
    pickVehicle(vehicles.some(v => v.sn === state.vehicleSn) ? state.vehicleSn : null, false);
  };

  const load = async (baseId) => {
    note.textContent = isOpen ? 'Checking the fleet…' : baseId ? 'Recalculating…' : 'Working out a suggested price…';
    note.classList.remove('err');
    showNote();   // otherwise a recalculation stays hidden behind the empty class
    if (go) go.disabled = true;
    if (again) again.disabled = true;
    setBaseLocked(true);

    try {
      if (isOpen) {
        const res = await api(`/api/quotes/${card.dataset.id}/match`, {
          method: 'POST',
          body: JSON.stringify({ baseId }),
        });
        showMatches(res.matching);
      } else {
        const res = await api(`/api/quotes/${card.dataset.id}/suggest`, {
          method: 'POST',
          body: JSON.stringify({
            baseId,
            retailRate: card.dataset.retail || undefined,
            affiliateRate: card.dataset.affiliate || undefined,
          }),
        });
        render(res, true);
      }
    } catch (err) {
      note.textContent = isOpen
        ? `Could not check the fleet: ${err.message}`
        : `No suggestion available: ${err.message} Enter a price manually below.`;
      note.classList.add('err');
      showNote();
      wrap.innerHTML = '';
    } finally {
      if (go) go.disabled = false;
      if (again) again.disabled = false;
      setBaseLocked(false);   // editable once we have an answer, success or not
      showNote();
    }
  };

  // let the admin change which yard the trip departs from, then re-price
  (async () => {
    try {
      const res = await api(`/api/quotes/${card.dataset.id}/bases-for`);
      bases = res.bases;
      if (bases.length > 1) {
        // an open request was already priced from a base; show that one
        const current = (isOpen && matching?.baseId) || res.recommendedId;
        select.innerHTML = bases.map(b =>
          `<option value="${esc(b.id)}" ${b.id === current ? 'selected' : ''}>${esc(b.label)}</option>`
        ).join('');
        pick.hidden = false;
      }
    } catch { /* the picker is optional; the suggestion still loads */ }
  })();

  if (go) go.addEventListener('click', () => load(select.value));
  if (again) again.addEventListener('click', () => load(select.value || null));
  if (list) {
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('.bd-match');
      if (btn) pickVehicle(btn.dataset.sn, true);
    });
  }

  // open requests are matched when they arrive; fetch only if that never finished
  if (isOpen && cardMatching[card.dataset.id]?.computedAt) showMatches(cardMatching[card.dataset.id]);
  else load(null);
}

// Requests taken before addresses carried coordinates still need pins, so those
// are geocoded once, on demand, and kept for the rest of the session.
async function resolveCoords(id) {
  const have = cardCoords[id] || {};
  const addrs = cardAddresses[id] || {};
  const missing = ['pickup', 'stopover', 'dropoff']
    .filter(k => addrs[k] && !Number.isFinite(have[k]?.lat));
  if (!missing.length) return have;

  const geocoder = new google.maps.Geocoder();
  const found = await Promise.all(missing.map(k => new Promise((resolve) => {
    geocoder.geocode({ address: addrs[k] }, (res, status) => {
      const loc = status === 'OK' ? res?.[0]?.geometry?.location : null;
      resolve([k, loc ? { lat: loc.lat(), lng: loc.lng() } : null]);
    });
  })));

  const next = { ...have };
  found.forEach(([k, point]) => { if (point) next[k] = point; });
  cardCoords[id] = next;
  return next;
}

// Maps are billed per load, so one is only created when the admin asks to see it.
function wireTripMap(card, btn) {
  const el = card.querySelector('.trip-map');
  const key = card.querySelector('.map-key');
  const store = {};
  let shown = false;

  btn.addEventListener('click', async () => {
    if (shown) {                       // toggle it away again
      el.hidden = true; key.hidden = true; shown = false;
      btn.textContent = 'View trip on map';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Loading map…';
    try {
      if (!(await loadGoogleMaps())) throw new Error('Maps unavailable');
      const q = await resolveCoords(card.dataset.id);
      if (!Object.values(q).some(p => Number.isFinite(p?.lat))) {
        throw new Error('Addresses not mappable');
      }
      renderTripMap(el, q, store, cardRoutes[card.dataset.id] || null);
      key.hidden = false;
      shown = true;
      btn.textContent = 'Hide map';
    } catch (err) {
      btn.textContent = err.message === 'Addresses not mappable' ? err.message : 'Map unavailable';
    } finally {
      btn.disabled = false;
    }
  });
}

// money that arrived by Zelle or cash is only known to the admin
function wireConfirmOffline(btn, id, msg) {
  btn.addEventListener('click', async () => {
    if (!window.confirm('Confirm that this payment has actually arrived?')) return;
    btn.disabled = true;
    const original = btn.textContent;
    btn.textContent = 'Confirming…';
    try {
      const res = await api(`/api/quotes/${id}/confirm-offline`, { method: 'PATCH' });
      if (msg) {
        msg.className = 'card-msg ok';
        msg.textContent = `Marked paid: ${money(res.amountPaid)}`;
      }
      loadRequests();
    } catch (err) {
      if (msg) { msg.className = 'card-msg err'; msg.textContent = err.message; }
      btn.disabled = false;
      btn.textContent = original;
    }
  });
}

function wireCards() {
  document.querySelectorAll('.req-card').forEach((card) => {
    const id = card.dataset.id;
    const msg = card.querySelector('.card-msg');
    const mapBtn = card.querySelector('.req-map-btn');
    if (mapBtn) wireTripMap(card, mapBtn);

    const confirmBtn = card.querySelector('.btn-confirm');
    if (confirmBtn) wireConfirmOffline(confirmBtn, id, msg);

    const pic = card.querySelector('.req-vehicle-pic.clickable');
    if (pic) {
      pic.addEventListener('click', () => {
        const all = (vehicleRates || {})[pic.dataset.sn]?.pics || [];
        if (all.length) openLightbox(all, card.querySelector('.req-vehicle-name')?.textContent || '', 0);
      });
    }

    const charge = card.querySelector('.btn-charge');
    if (charge) wireCharge(card, charge);

    const accept = card.querySelector('.btn-accept');
    const decline = card.querySelector('.btn-decline');
    if (!accept) return;

    const state = wireBreakdown(card);
    const isOpen = card.dataset.kind === 'open';
    const acceptLabel = accept.textContent;

    const setBusy = (busy) => {
      accept.disabled = busy;
      decline.disabled = busy;
    };
    const showMsg = (text, kind = 'error') => {
      msg.innerHTML = `<div class="alert alert-${kind}" style="margin:.9rem 0 0">${esc(text)}</div>`;
    };

    accept.addEventListener('click', async () => {
      if (isOpen && !state.vehicleSn) return showMsg('Pick a vehicle to offer first.');
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
        message: `${isOpen ? `${state.vehicleName} at ` : ''}${money(state.total)} will be emailed to ${card.dataset.email} with a payment link.${breakdown}`,
        confirmLabel: 'Send quote',
      });
      if (!confirmed) return;

      setBusy(true);
      accept.textContent = 'Sending…';
      try {
        await api(`/api/quotes/${id}/accept`, {
          method: 'PATCH',
          body: JSON.stringify({
            vehicleSn: state.vehicleSn || undefined,
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
        showMsg('Quote sent. The customer has been emailed a payment link.', 'ok');
        setTimeout(loadRequests, 1200);
      } catch (err) {
        showMsg(err.message);
        setBusy(false);
        accept.textContent = acceptLabel;
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
          placeholder: isOpen ? 'e.g. Nothing suitable is free on that date' : 'e.g. That vehicle is already booked for those dates',
          required: true,
          requiredMessage: 'A reason is required. The customer will see it.',
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
        showMsg('Request declined. The customer has been emailed.', 'ok');
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
  // shared photo viewer, used by the vehicle thumbnails on each card
  if (typeof initLightbox === 'function' && document.getElementById('lightbox')) initLightbox();

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
