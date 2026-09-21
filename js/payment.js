// Token-gated Square checkout. Amounts are display-only; the server charges
// from the stored quote, so nothing here can change what is billed.

let quote = null;
let card = null;
const token = new URLSearchParams(window.location.search).get('token');
const money = (n) => `$${Number(n).toFixed(2)}`;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const show = (id) => { document.getElementById(id).style.display = 'block'; };
const hide = (id) => { document.getElementById(id).style.display = 'none'; };

function fail(msg) {
  hide('loading');
  document.getElementById('error-msg').textContent = msg;
  show('error-state');
}

async function init() {
  if (!token) return fail('This link is missing its access code. Please use the link from your email.');

  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/quotes/by-token?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error || 'This link is not valid.');
    quote = data.quote;
  } catch (err) {
    return fail('We could not reach our booking system. Please try again shortly.');
  }

  renderQuote();

  const cfg = await loadSquare();
  if (!cfg) return;

  hide('loading');
  show('pay-state');

  document.querySelectorAll('input[name="paymentOption"]').forEach((el) => {
    el.addEventListener('change', updateChoice);
  });
  updateChoice();
  document.getElementById('pay-button').addEventListener('click', onPay);
}

function renderQuote() {
  const rows = [
    ['Vehicle', quote.vehicle?.name || quote.vehicle?.type || '—'],
    ['Date', `${quote.date} at ${quote.pickupTime}`],
    ['Pick-up', quote.pickupAddress],
    quote.stopoverAddress ? ['Stop over', quote.stopoverAddress] : null,
    ['Drop-off', quote.dropoffAddress],
    ['Passengers', quote.passengers],
    (quote.lineItems || []).length ? ['Base fare', money(quote.baseFare)] : null,
    ...(quote.lineItems || []).map(l => [l.label, money(l.amount)]),
    ['Total quoted', money(quote.quotedAmount)],
  ].filter(Boolean);

  document.getElementById('trip-details').innerHTML = rows
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  document.getElementById('deposit-amount').textContent = money(quote.depositAmount);
  document.getElementById('full-amount').textContent = money(quote.quotedAmount);
}

async function loadSquare() {
  let cfg;
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/square/config`);
    if (!res.ok) throw new Error();
    cfg = await res.json();
  } catch {
    fail('Card payments are temporarily unavailable. Please contact us to pay by another method.');
    return null;
  }

  // the SDK host differs between sandbox and production
  const src = cfg.environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';

  try {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error('sdk'));
      document.head.appendChild(s);
    });
    const payments = window.Square.payments(cfg.applicationId, cfg.locationId);
    card = await payments.card();
    await card.attach('#card-container');
    return cfg;
  } catch {
    fail('We could not load the secure card form. Please refresh and try again.');
    return null;
  }
}

function selectedOption() {
  return document.querySelector('input[name="paymentOption"]:checked').value;
}

function updateChoice() {
  const isDeposit = selectedOption() === 'deposit';
  const amount = isDeposit ? quote.depositAmount : quote.quotedAmount;
  document.getElementById('pay-amount').textContent = money(amount);
  document.getElementById('deposit-note').style.display = isDeposit ? 'block' : 'none';
}

async function onPay() {
  const btn = document.getElementById('pay-button');
  const errEl = document.getElementById('pay-error');
  errEl.style.display = 'none';
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = 'Processing…';

  try {
    const result = await card.tokenize();
    if (result.status !== 'OK') {
      throw new Error(result.errors?.[0]?.message || 'Please check your card details.');
    }

    const res = await fetch(`${CONFIG.API_BASE}/api/square/pay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, sourceId: result.token, paymentOption: selectedOption() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.error || 'Payment could not be completed.');

    hide('pay-state');
    document.getElementById('done-note').textContent = data.remainingBalance > 0
      ? `We've charged ${money(data.amountPaid)}. The remaining ${money(data.remainingBalance)} will be charged to the same card on the morning of your trip. A receipt is on its way to your inbox.`
      : `We've charged ${money(data.amountPaid)} in full. A receipt is on its way to your inbox.`;
    show('done-state');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    errEl.textContent = err.message || 'Payment failed. Please try again.';
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

document.addEventListener('DOMContentLoaded', init);
