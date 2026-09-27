// Token-gated checkout. Amounts here are display-only: every method resolves
// what is actually charged from the stored quote on the server, so nothing on
// this page can change the sum.

let quote = null;
let mode = 'initial';
let fees = {};                // method -> surcharge rate, straight from the server
let payments = null;          // Square Web Payments instance
let card = null;
let activeMethod = 'card';
const mounted = {};           // method -> { instance, amount } so a wallet is rebuilt when the total moves
const probed = {};            // availability checks build a real instance; keep it rather than build a second
const token = new URLSearchParams(window.location.search).get('token');
const money = (n) => `$${Number(n).toFixed(2)}`;

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const show = (id) => { document.getElementById(id).style.display = 'block'; };
const hide = (id) => { document.getElementById(id).style.display = 'none'; };
const busy = (on) => { document.getElementById('method-busy').hidden = !on; };

function fail(msg) {
  hide('loading');
  document.getElementById('error-msg').textContent = msg;
  show('error-state');
}

function payError(msg) {
  const el = document.getElementById('pay-error');
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

const clearPayError = () => { document.getElementById('pay-error').style.display = 'none'; };

const termsAccepted = () => document.getElementById('accept-terms').checked;

function selectedOption() {
  if (mode === 'balance') return 'full';
  return document.querySelector('input[name="paymentOption"]:checked').value;
}

function subtotalNow() {
  if (mode === 'balance') return Number(quote.remainingBalance);
  return selectedOption() === 'deposit' ? Number(quote.depositAmount) : Number(quote.quotedAmount);
}

const feeRate = (method) => Number(fees[method] || 0);
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const feeFor = (method) => round2(subtotalNow() * feeRate(method));

// what the customer is actually charged for the method they have selected
function amountNow() {
  return round2(subtotalNow() + feeFor(activeMethod));
}

async function init() {
  if (!token) return fail('This link is missing its access code. Please use the link from your email.');

  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/quotes/by-token?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error || 'This link is not valid.');
    quote = data.quote;
    mode = data.mode === 'balance' ? 'balance' : 'initial';
    fees = data.fees || {};
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

  // no method is reachable until the terms are accepted
  document.getElementById('accept-terms').addEventListener('change', syncGate);
  syncGate();

  document.getElementById('pay-button').addEventListener('click', onPayCard);
  document.getElementById('save-card').addEventListener('change', renderDepositNote);
  OFFLINE.forEach((m) => {
    document.getElementById(`${m}-choose`).addEventListener('click', () => chooseOffline(m));
  });

  await buildMethods();
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
    mode === 'balance' ? ['Already paid', money(quote.amountPaid)] : null,
  ].filter(Boolean);

  document.getElementById('trip-details').innerHTML = rows
    .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

  if (mode === 'balance') {
    document.querySelector('h1').textContent = 'Pay your remaining balance';
    document.querySelector('.form-lede').textContent =
      'Your deposit is already settled. This is the balance for your trip.';
    document.querySelector('.amount-choice').hidden = true;
    document.getElementById('deposit-note').style.display = 'none';
    return;
  }

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
    fail('Payments are temporarily unavailable. Please contact us to pay another way.');
    return null;
  }

  // the SDK host differs between sandbox and production
  const src = cfg.environment === 'production'
    ? 'https://web.squarecdn.com/v1/square.js'
    : 'https://sandbox.web.squarecdn.com/v1/square.js';

  try {
    await loadScript(src);
    payments = window.Square.payments(cfg.applicationId, cfg.locationId);
    card = await payments.card();
    await card.attach('#card-container');
    return cfg;
  } catch {
    fail('We could not load the secure payment form. Please refresh and try again.');
    return null;
  }
}

const loadScript = (src) => new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = src;
  s.onload = resolve;
  s.onerror = () => reject(new Error('script'));
  document.head.appendChild(s);
});

function updateChoice() {
  syncMethodAvailability();
  document.getElementById('pay-amount').textContent = money(amountNow());
  renderDepositNote();
  renderFeeSummary();
  refreshTabTotals();
  // a wallet bakes the total in when it mounts, so it has to be rebuilt
  if (activeMethod !== 'card' && !OFFLINE.includes(activeMethod)) mountMethod(activeMethod, true);
}

// cash cannot hold a date, so it is only offered when the whole sum is being paid
function syncMethodAvailability() {
  const depositing = mode === 'initial' && selectedOption() === 'deposit';
  const cashTab = document.querySelector('.pay-method[data-method="cash"]');
  if (!cashTab) return;
  cashTab.hidden = depositing;
  if (depositing && activeMethod === 'cash') selectMethod('card');
}

const savingCard = () => {
  const box = document.getElementById('save-card');
  return activeMethod === 'card' && !!box && box.checked;
};

/**
 * Says what will actually happen to the balance. Only a card the customer
 * agrees to store can be charged again; everything else gets asked for.
 */
function renderDepositNote() {
  const note = document.getElementById('deposit-note');
  const wrap = document.getElementById('save-card-wrap');
  const isDeposit = mode === 'initial' && selectedOption() === 'deposit';

  // keeping a card only arises on a deposit paid by card
  if (wrap) wrap.hidden = !(isDeposit && activeMethod === 'card');

  if (!isDeposit) {
    note.style.display = 'none';
    return;
  }
  note.textContent = savingCard()
    ? "We'll securely save your card and charge the remaining balance on the morning of your trip."
    : 'The remaining balance will be requested on the morning of your trip.';
  note.style.display = 'block';
}

// the surcharge is spelled out rather than folded into one number
function renderFeeSummary() {
  const box = document.getElementById('fee-summary');
  const subtotal = subtotalNow();
  const fee = feeFor(activeMethod);
  const rate = feeRate(activeMethod);
  const label = (METHODS.find(m => m.id === activeMethod) || {}).label || 'Card';

  box.innerHTML = `
    <div><span>${mode === 'balance' ? 'Balance' : (selectedOption() === 'deposit' ? 'Deposit' : 'Booking total')}</span><span>${money(subtotal)}</span></div>
    <div><span>${esc(label)} fee${rate ? ` (${esc((rate * 100).toFixed(rate * 100 % 1 ? 2 : 0))}%)` : ''}</span><span>${fee ? money(fee) : 'None'}</span></div>
    <div class="fee-total"><span>You pay</span><span>${money(round2(subtotal + fee))}</span></div>`;
  box.hidden = false;
}

function syncGate() {
  const ok = termsAccepted();
  document.getElementById('pay-methods-wrap').classList.toggle('gated', !ok);
  document.getElementById('terms-gate-hint').hidden = ok;
  if (ok) clearPayError();
}

// ── Method chooser ───────────────────────────────────────────────────────────

// Official brand marks (Simple Icons, CC0 artwork; the brands remain trademarks).
// Drawn in currentColor, not brand hex: PayPal navy and Apple black disappear
// against this dark card. Source files are in img/pay/ if you want them coloured.
const ICONS = {
  card: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20"/><path d="M6 15h4"/></svg>`,
  cash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
    <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/>
    <path d="M5.5 9.5h.01M18.5 14.5h.01"/></svg>`,
  apple_pay: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.15 4.318a42.16 42.16 0 0 0-.454.003c-.15.005-.303.013-.452.04a1.44 1.44 0 0 0-1.06.772c-.07.138-.114.278-.14.43-.028.148-.037.3-.04.45A10.2 10.2 0 0 0 0 6.222v11.557c0 .07.002.138.003.207.004.15.013.303.04.452.027.15.072.291.142.429a1.436 1.436 0 0 0 .63.63c.138.07.278.115.43.142.148.027.3.036.45.04l.208.003h20.194l.207-.003c.15-.004.303-.013.452-.04.15-.027.291-.071.428-.141a1.432 1.432 0 0 0 .631-.631c.07-.138.115-.278.141-.43.027-.148.036-.3.04-.45.002-.07.003-.138.003-.208l.001-.246V6.221c0-.07-.002-.138-.004-.207a2.995 2.995 0 0 0-.04-.452 1.446 1.446 0 0 0-1.2-1.201 3.022 3.022 0 0 0-.452-.04 10.448 10.448 0 0 0-.453-.003zm0 .512h19.942c.066 0 .131.002.197.003.115.004.25.01.375.032.109.02.2.05.287.094a.927.927 0 0 1 .407.407.997.997 0 0 1 .094.288c.022.123.028.258.031.374.002.065.003.13.003.197v11.552c0 .065 0 .13-.003.196-.003.115-.009.25-.032.375a.927.927 0 0 1-.5.693 1.002 1.002 0 0 1-.286.094 2.598 2.598 0 0 1-.373.032l-.2.003H1.906c-.066 0-.133-.002-.196-.003a2.61 2.61 0 0 1-.375-.032c-.109-.02-.2-.05-.288-.094a.918.918 0 0 1-.406-.407 1.006 1.006 0 0 1-.094-.288 2.531 2.531 0 0 1-.032-.373 9.588 9.588 0 0 1-.002-.197V6.224c0-.065 0-.131.002-.197.004-.114.01-.248.032-.375.02-.108.05-.199.094-.287a.925.925 0 0 1 .407-.406 1.03 1.03 0 0 1 .287-.094c.125-.022.26-.029.375-.032.065-.002.131-.002.196-.003zm4.71 3.7c-.3.016-.668.199-.88.456-.191.22-.36.58-.316.918.338.03.675-.169.888-.418.205-.258.345-.603.308-.955zm2.207.42v5.493h.852v-1.877h1.18c1.078 0 1.835-.739 1.835-1.812 0-1.07-.742-1.805-1.808-1.805zm.852.719h.982c.739 0 1.161.396 1.161 1.089 0 .692-.422 1.092-1.164 1.092h-.979zm-3.154.3c-.45.01-.83.28-1.05.28-.235 0-.593-.264-.981-.257a1.446 1.446 0 0 0-1.23.747c-.527.908-.139 2.255.374 2.995.249.366.549.769.944.754.373-.014.52-.242.973-.242.454 0 .586.242.98.235.41-.007.667-.366.915-.733.286-.417.403-.82.41-.841-.007-.008-.79-.308-.797-1.209-.008-.754.615-1.113.644-1.135-.352-.52-.9-.578-1.09-.593a1.123 1.123 0 0 0-.092-.002zm8.204.397c-.99 0-1.606.533-1.652 1.256h.777c.072-.358.369-.586.845-.586.502 0 .803.266.803.711v.309l-1.097.064c-.951.054-1.488.484-1.488 1.184 0 .72.548 1.207 1.332 1.207.526 0 1.032-.281 1.264-.727h.019v.659h.788v-2.76c0-.803-.62-1.317-1.591-1.317zm1.94.072l1.446 4.009c0 .003-.073.24-.073.247-.125.41-.33.571-.711.571-.069 0-.206 0-.267-.015v.666c.06.011.267.019.335.019.83 0 1.226-.312 1.568-1.283l1.5-4.214h-.868l-1.012 3.259h-.015l-1.013-3.26zm-1.167 2.189v.316c0 .521-.45.917-1.024.917-.442 0-.731-.228-.731-.579 0-.342.278-.56.769-.593z"/></svg>`,
  google_pay: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3.963 7.235A3.963 3.963 0 00.422 9.419a3.963 3.963 0 000 3.559 3.963 3.963 0 003.541 2.184c1.07 0 1.97-.352 2.627-.957.748-.69 1.18-1.71 1.18-2.916a4.722 4.722 0 00-.07-.806H3.964v1.526h2.14a1.835 1.835 0 01-.79 1.205c-.356.241-.814.379-1.35.379-1.034 0-1.911-.697-2.225-1.636a2.375 2.375 0 010-1.517c.314-.94 1.191-1.636 2.225-1.636a2.152 2.152 0 011.52.594l1.132-1.13a3.808 3.808 0 00-2.652-1.033zm6.501.55v6.9h.886V11.89h1.465c.603 0 1.11-.196 1.522-.588a1.911 1.911 0 00.635-1.464 1.92 1.92 0 00-.635-1.456 2.125 2.125 0 00-1.522-.598zm2.427.85a1.156 1.156 0 01.823.365 1.176 1.176 0 010 1.686 1.171 1.171 0 01-.877.357H11.35V8.635h1.487a1.156 1.156 0 01.054 0zm4.124 1.175c-.842 0-1.477.308-1.907.925l.781.491c.288-.417.68-.626 1.175-.626a1.255 1.255 0 01.856.323 1.009 1.009 0 01.366.785v.202c-.34-.193-.774-.289-1.3-.289-.617 0-1.11.145-1.479.434-.37.288-.554.677-.554 1.165a1.476 1.476 0 00.525 1.156c.35.308.785.463 1.305.463.61 0 1.098-.27 1.465-.81h.038v.655h.848v-2.909c0-.61-.19-1.09-.568-1.44-.38-.35-.896-.525-1.551-.525zm2.263.154l1.946 4.422-1.098 2.38h.915L24 9.963h-.965l-1.368 3.391h-.02l-1.406-3.39zm-2.146 2.368c.494 0 .88.11 1.156.33 0 .372-.147.696-.44.973a1.413 1.413 0 01-.997.414 1.081 1.081 0 01-.69-.232.708.708 0 01-.293-.578c0-.257.12-.47.363-.647.24-.173.54-.26.9-.26Z"/></svg>`,
  cash_app: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.59 3.475a5.1 5.1 0 00-3.05-3.05c-1.31-.42-2.5-.42-4.92-.42H8.36c-2.4 0-3.61 0-4.9.4a5.1 5.1 0 00-3.05 3.06C0 4.765 0 5.965 0 8.365v7.27c0 2.41 0 3.6.4 4.9a5.1 5.1 0 003.05 3.05c1.3.41 2.5.41 4.9.41h7.28c2.41 0 3.61 0 4.9-.4a5.1 5.1 0 003.06-3.06c.41-1.3.41-2.5.41-4.9v-7.25c0-2.41 0-3.61-.41-4.91zm-6.17 4.63l-.93.93a.5.5 0 01-.67.01 5 5 0 00-3.22-1.18c-.97 0-1.94.32-1.94 1.21 0 .9 1.04 1.2 2.24 1.65 2.1.7 3.84 1.58 3.84 3.64 0 2.24-1.74 3.78-4.58 3.95l-.26 1.2a.49.49 0 01-.48.39H9.63l-.09-.01a.5.5 0 01-.38-.59l.28-1.27a6.54 6.54 0 01-2.88-1.57v-.01a.48.48 0 010-.68l1-.97a.49.49 0 01.67 0c.91.86 2.13 1.34 3.39 1.32 1.3 0 2.17-.55 2.17-1.42 0-.87-.88-1.1-2.54-1.72-1.76-.63-3.43-1.52-3.43-3.6 0-2.42 2.01-3.6 4.39-3.71l.25-1.23a.48.48 0 01.48-.38h1.78l.1.01c.26.06.43.31.37.57l-.27 1.37c.9.3 1.75.77 2.48 1.39l.02.02c.19.2.19.5 0 .68z"/></svg>`,
  paypal: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z"/></svg>`,
  venmo: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.772 13.119c-.267 0-.381-.251-.38-.655 0-.533.121-1.575.712-1.575.267 0 .357.243.357.598 0 .533-.13 1.632-.689 1.632Zm.502-3.377c-1.677 0-2.405 1.285-2.405 2.658 0 1.042.421 1.874 1.693 1.874 1.717 0 2.438-1.406 2.438-2.763 0-1.025-.462-1.769-1.726-1.769Zm-3.833 0c-.558 0-.964.17-1.393.477-.154-.275-.462-.477-.932-.477-.542 0-.947.219-1.247.437l-.04-.364H13.54l-.688 4.354h1.506l.479-3.053c.129-.065.323-.154.518-.154.145 0 .267.049.267.267 0 .056-.016.145-.024.218l-.429 2.722h1.498l.478-3.053c.138-.073.324-.154.51-.154.146 0 .268.049.268.267 0 .056-.017.145-.025.218l-.429 2.722h1.499l.461-2.908c.025-.153.049-.388.049-.549 0-.582-.267-.97-1.037-.97Zm-6.871 0c-.575 0-.98.219-1.287.421l-.017-.348H8.962l-.689 4.354H9.78l.478-3.053c.13-.065.324-.154.518-.154.147 0 .268.049.268.242 0 .081-.024.227-.032.299l-.422 2.666h1.499l.462-2.908c.024-.153.049-.388.049-.549 0-.582-.268-.97-1.03-.97Zm-5.631 1.834c.041-.485.413-.824.697-.824.162 0 .299.097.299.291 0 .404-.713.533-.996.533Zm.843-1.834c-1.604 0-2.382 1.39-2.382 2.698 0 1.01.478 1.817 1.814 1.817.527 0 1.07-.113 1.418-.282l.186-1.26c-.494.25-.874.347-1.271.347-.365 0-.64-.194-.64-.687.826-.008 2.252-.347 2.252-1.453 0-.687-.494-1.18-1.377-1.18Zm-4.239.267c.089.186.146.412.146.743 0 .606-.429 1.494-.777 2.06l-.373-2.989L0 9.969l.705 4.2h1.757c.77-1.01 1.718-2.448 1.718-3.554 0-.347-.073-.622-.235-.889l-1.402.283Z"/></svg>`,
  zelle: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.559 24h-2.841a.483.483 0 0 1-.483-.483v-2.765H5.638a.667.667 0 0 1-.666-.666v-2.234a.67.67 0 0 1 .142-.412l8.139-10.382h-7.25a.667.667 0 0 1-.667-.667V3.914c0-.367.299-.666.666-.666h4.23V.483c0-.266.217-.483.483-.483h2.841c.266 0 .483.217.483.483v2.765h4.323c.367 0 .666.299.666.666v2.137a.67.67 0 0 1-.141.41l-8.19 10.481h7.665c.367 0 .666.299.666.666v2.477a.667.667 0 0 1-.666.667h-4.32v2.765a.483.483 0 0 1-.483.483Z"/></svg>`,
};

const METHODS = [
  { id: 'card', label: 'Card' },
  { id: 'apple_pay', label: 'Apple Pay' },
  { id: 'google_pay', label: 'Google Pay' },
  { id: 'cash_app', label: 'Cash App' },
  { id: 'paypal', label: 'PayPal' },
  { id: 'venmo', label: 'Venmo' },
  { id: 'zelle', label: 'Zelle' },
  { id: 'cash', label: 'Cash' },
];

// settled away from the app, so there is nothing to probe or tokenise
const OFFLINE = ['zelle', 'cash'];

async function buildMethods() {
  const available = ['card'];

  // each wallet reports its own availability; an unsupported one is never offered
  for (const id of ['apple_pay', 'google_pay', 'cash_app']) {
    if (await squareWalletAvailable(id)) available.push(id);
  }
  for (const id of await paypalMethodsAvailable()) available.push(id);
  // Zelle and cash need no provider, so they are always on offer
  OFFLINE.forEach(id => available.push(id));

  const tabs = document.getElementById('method-tabs');
  tabs.innerHTML = available.map((id) => {
    const m = METHODS.find(x => x.id === id);
    return `<button type="button" class="pay-method${id === 'card' ? ' active' : ''}"
              role="tab" data-method="${id}">
              <span class="pm-head"><span class="pm-icon" aria-hidden="true">${ICONS[id] || ICONS.card}</span>${esc(m.label)}</span>
              <span class="pm-right"><span class="pm-fee">${esc(rateLabel(id))}</span>
              <span class="pm-total"></span></span></button>`;
  }).join('');

  tabs.querySelectorAll('.pay-method').forEach((btn) => {
    btn.addEventListener('click', () => selectMethod(btn.dataset.method));
  });

  // a single option is not a choice worth showing
  tabs.hidden = available.length < 2;
  refreshTabTotals();
  syncMethodAvailability();
}

const rateLabel = (method) => {
  const rate = feeRate(method);
  return rate ? `+${(rate * 100).toFixed(rate * 100 % 1 ? 2 : 0)}%` : 'no fee';
};

// what each method would actually cost, for the amount currently selected
function refreshTabTotals() {
  const subtotal = subtotalNow();
  document.querySelectorAll('.pay-method').forEach((btn) => {
    const el = btn.querySelector('.pm-total');
    if (el) el.textContent = money(round2(subtotal + round2(subtotal * feeRate(btn.dataset.method))));
  });
}

async function selectMethod(method) {
  if (!termsAccepted()) return;
  activeMethod = method;
  clearPayError();

  document.querySelectorAll('.pay-method').forEach((b) => {
    b.classList.toggle('active', b.dataset.method === method);
  });
  document.querySelectorAll('.pay-panel').forEach((p) => {
    p.hidden = p.dataset.method !== method;
  });

  renderFeeSummary();
  renderDepositNote();
  document.getElementById('pay-amount').textContent = money(amountNow());
  if (method !== 'card' && !OFFLINE.includes(method)) await mountMethod(method);
}

const squarePaymentRequest = () => payments.paymentRequest({
  countryCode: 'US',
  currencyCode: 'USD',
  total: { amount: amountNow().toFixed(2), label: 'Tour Rider' },
});

/** Probes a Square wallet without showing it; the SDK throws when unsupported. */
async function squareWalletAvailable(method) {
  try {
    const amount = amountNow();
    const pr = squarePaymentRequest();
    let instance = null;
    if (method === 'apple_pay') instance = await payments.applePay(pr);
    else if (method === 'google_pay') instance = await payments.googlePay(pr);
    else if (method === 'cash_app') instance = await payments.cashAppPay(pr, cashAppOptions());
    if (!instance) return false;
    probed[method] = { instance, amount };
    return true;
  } catch {
    return false;
  }
}

// reuses what the availability probe already built, provided the total has not moved
function takeProbed(method, amount) {
  const held = probed[method];
  delete probed[method];
  if (!held) return null;
  if (held.amount === amount) return held.instance;
  held.instance?.destroy?.().catch(() => {});
  return null;
}

// a re-mount must not inherit the previous mount's click listener
function resetNode(id) {
  const old = document.getElementById(id);
  const fresh = old.cloneNode(false);
  old.replaceWith(fresh);
  return fresh;
}

const cashAppOptions = () => ({
  redirectURL: window.location.href,
  referenceId: String(quote.id || ''),
});

async function mountMethod(method, force = false) {
  const amount = amountNow();
  const already = mounted[method];
  if (already && already.amount === amount && !force) return;

  busy(true);
  try {
    if (already?.instance?.destroy) {
      try { await already.instance.destroy(); } catch { /* already gone */ }
    }
    delete mounted[method];

    if (method === 'apple_pay') await mountApplePay(amount);
    else if (method === 'google_pay') await mountGooglePay(amount);
    else if (method === 'cash_app') await mountCashApp(amount);
    else if (method === 'paypal' || method === 'venmo') await mountPaypal(method, amount);
  } catch (err) {
    payError('That payment method could not be loaded. Please choose another.');
  } finally {
    busy(false);
  }
}

async function mountApplePay(amount) {
  const applePay = takeProbed('apple_pay', amount) || await payments.applePay(squarePaymentRequest());
  mounted.apple_pay = { instance: applePay, amount };

  // Apple requires tokenize() in the click itself, so nothing may be awaited first
  resetNode('apple-pay-button').addEventListener('click', (e) => {
    e.preventDefault();
    if (!termsAccepted()) return payError('Please accept the terms and conditions before paying.');
    applePay.tokenize()
      .then(result => handleSquareResult('apple_pay', result))
      .catch(() => payError('Apple Pay could not complete. Please try another method.'));
  });
}

async function mountGooglePay(amount) {
  const googlePay = takeProbed('google_pay', amount) || await payments.googlePay(squarePaymentRequest());
  resetNode('google-pay-button');
  await googlePay.attach('#google-pay-button', { buttonSizeMode: 'fill' });
  mounted.google_pay = { instance: googlePay, amount };

  // bound after attach, because Square swaps the container element out
  document.getElementById('google-pay-button').addEventListener('click', async (e) => {
    e.preventDefault();
    if (!termsAccepted()) return payError('Please accept the terms and conditions before paying.');
    try {
      handleSquareResult('google_pay', await googlePay.tokenize());
    } catch {
      payError('Google Pay could not complete. Please try another method.');
    }
  });
}

async function mountCashApp(amount) {
  const cashAppPay = takeProbed('cash_app', amount)
    || await payments.cashAppPay(squarePaymentRequest(), cashAppOptions());
  resetNode('cash-app-pay');
  await cashAppPay.attach('#cash-app-pay', { shape: 'semiround', width: 'full' });
  mounted.cash_app = { instance: cashAppPay, amount };

  // Cash App hands the token back through an event rather than a promise
  cashAppPay.addEventListener('ontokenization', (event) => {
    const { tokenResult, error } = event.detail || {};
    if (error) return payError('Cash App Pay could not complete. Please try another method.');
    if (!termsAccepted()) return payError('Please accept the terms and conditions before paying.');
    handleSquareResult('cash_app', tokenResult);
  });
}

async function handleSquareResult(method, result) {
  if (!result || result.status !== 'OK') {
    return payError(result?.errors?.[0]?.message || 'That payment could not be authorised.');
  }
  await submitSquare(method, result.token);
}

// ── PayPal and Venmo ─────────────────────────────────────────────────────────

let paypalReady = null;

async function paypalMethodsAvailable() {
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/paypal/config`);
    const cfg = await res.json();
    if (!cfg.enabled || !cfg.clientId) return [];

    await loadScript('https://www.paypal.com/sdk/js'
      + `?client-id=${encodeURIComponent(cfg.clientId)}`
      + '&currency=USD&intent=capture&enable-funding=venmo&components=buttons');
    paypalReady = true;

    const out = ['paypal'];
    // Venmo is US-only and device dependent, so it is offered only when eligible
    try {
      if (window.paypal.Buttons({ fundingSource: window.paypal.FUNDING.VENMO }).isEligible()) {
        out.push('venmo');
      }
    } catch { /* no Venmo on this device */ }
    return out;
  } catch {
    return [];
  }
}

async function mountPaypal(method, amount) {
  if (!paypalReady) throw new Error('paypal');
  const containerId = method === 'venmo' ? 'venmo-buttons' : 'paypal-buttons';
  document.getElementById(containerId).innerHTML = '';

  const buttons = window.paypal.Buttons({
    fundingSource: method === 'venmo' ? window.paypal.FUNDING.VENMO : window.paypal.FUNDING.PAYPAL,
    style: { layout: 'vertical', height: 48 },
    // the server sets the amount from the stored quote; the browser only approves it
    createOrder: async () => {
      const data = await postJson('/api/paypal/order', { method });
      if (!data.success) throw new Error(data.error || 'Could not start the payment.');
      return data.id;
    },
    onApprove: async (data) => {
      const res = await postJson('/api/paypal/capture', { method, orderId: data.orderID });
      if (!res.success) throw new Error(res.error || 'Payment could not be completed.');
      succeed(res);
    },
    onError: (err) => payError(err?.message || 'The payment could not be completed. Please try again.'),
  });

  await buttons.render(`#${containerId}`);
  mounted[method] = { instance: buttons, amount };
}

// ── Submission ───────────────────────────────────────────────────────────────

async function postJson(path, extra) {
  const res = await fetch(`${CONFIG.API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      paymentOption: selectedOption(),
      acceptedTerms: termsAccepted(),
      ...extra,
    }),
  });
  return res.json().catch(() => ({ success: false, error: 'Payment could not be completed.' }));
}

async function onPayCard() {
  const btn = document.getElementById('pay-button');
  clearPayError();

  if (!termsAccepted()) {
    return payError('Please accept the terms and conditions before paying.');
  }

  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = 'Processing…';

  try {
    const result = await card.tokenize();
    if (result.status !== 'OK') {
      throw new Error(result.errors?.[0]?.message || 'Please check your card details.');
    }
    await submitSquare('card', result.token, { saveCard: savingCard() });
  } catch (err) {
    payError(err.message || 'Payment failed. Please try again.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = original;
  }
}

async function submitSquare(method, sourceId, extra = {}) {
  busy(true);
  try {
    const data = await postJson('/api/square/pay', { method, sourceId, ...extra });
    if (!data.success) throw new Error(data.error || 'Payment could not be completed.');
    succeed(data);
  } catch (err) {
    payError(err.message || 'Payment failed. Please try again.');
  } finally {
    busy(false);
  }
}

async function chooseOffline(method) {
  clearPayError();
  if (!termsAccepted()) {
    return payError('Please accept the terms and conditions before continuing.');
  }

  const btn = document.getElementById(`${method}-choose`);
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Saving…';

  try {
    const data = await postJson('/api/offline/choose', { method });
    if (!data.success) throw new Error(data.error || 'Could not record your choice.');

    hide('pay-state');
    document.getElementById('done-title').textContent = 'Booking held';
    document.getElementById('done-note').textContent =
      `${data.instructions} ${money(data.amountDue)} is due.`
      + (data.remainingBalance > 0 ? ` The remaining ${money(data.remainingBalance)} is due on the day of your trip.` : '');
    show('done-state');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    payError(err.message || 'Something went wrong. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

function succeed(data) {
  hide('pay-state');
  const paid = money(data.amountPaid);
  const fee = data.processingFee > 0 ? ` (${money(data.subtotal)} plus a ${money(data.processingFee)} ${data.method} fee)` : '';

  let note;
  if (mode === 'balance') {
    note = `We've received ${paid}${fee}. Your booking is settled in full. A receipt is on its way to your inbox.`;
  } else if (data.balanceByLink) {
    note = `We've taken ${paid}${fee}. ${money(data.remainingBalance)} is due on the day of your trip, and we'll email you a payment link that morning. A receipt is on its way to your inbox.`;
  } else if (data.remainingBalance > 0) {
    note = `We've charged ${paid}${fee}. The remaining ${money(data.remainingBalance)} will be charged to the same card on the morning of your trip. A receipt is on its way to your inbox.`;
  } else {
    note = `We've charged ${paid}${fee} in full. A receipt is on its way to your inbox.`;
  }

  document.getElementById('done-note').textContent = note;
  show('done-state');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', init);
