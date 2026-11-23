// The vehicle owner's accept or decline page. The token in the link is the only key: no login.

const token = new URLSearchParams(window.location.search).get('token');
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TRIP_TYPES = { roundtrip: 'Round trip', 'one-way': 'One way', shuttle: 'Shuttle' };

// the owner's answer, or why there's nothing to answer, as the page reports it
const OUTCOMES = {
  accepted: ['alert-ok', "You've confirmed you're available. Thank you, we'll be in touch if the booking goes ahead."],
  declined: ['alert-ok', "You've told us you're not available. Thank you for letting us know."],
  closed: ['alert-error', 'This request has been closed. No action is needed.'],
};

function show(id) {
  ['loading', 'error-state', 'ask-state', 'done-state'].forEach((s) => { $(s).hidden = s !== id; });
}

function fail(message) {
  $('error-msg').textContent = message;
  show('error-state');
}

const rows = (r) => [
  ['Vehicle', `${r.vehicle.name}${r.vehicle.sn ? ` · S/N ${r.vehicle.sn}` : ''}`],
  ['Date', r.date],
  ['Time', r.dropoffTime ? `${r.pickupTime} to ${r.dropoffTime}` : `${r.pickupTime} pick-up`],
  ['Trip type', TRIP_TYPES[r.tripType] || r.tripType],
  ['Passengers', r.passengers],
  ['Pick-up area', r.pickupArea],
  r.stops ? ['Stop-overs', r.stops] : null,
  ['Drop-off area', r.dropoffArea],
  r.reference ? ['Reference', r.reference] : null,
].filter(Boolean).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');

function done(request) {
  const [kind, text] = OUTCOMES[request.closed && request.status === 'pending' ? 'closed' : request.status] || OUTCOMES.closed;
  $('done-msg').className = `alert ${kind}`;
  $('done-msg').textContent = text;
  $('done-details').innerHTML = rows(request);
  show('done-state');
}

async function respond(decision) {
  const buttons = [$('accept-btn'), $('decline-btn')];
  buttons.forEach((b) => { b.disabled = true; });
  $('form-msg').hidden = true;
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/availability/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, decision, reason: decision === 'decline' ? $('decline-reason').value.trim() : undefined }),
    });
    const data = await res.json().catch(() => ({}));
    // already answered, or closed meanwhile: the reply still carries the request, so show where it stands
    if (res.ok || (res.status === 409 && data.status)) return done(data);
    throw new Error(data.error || 'Could not record your answer. Please try again.');
  } catch (err) {
    $('form-msg').textContent = err.message;
    $('form-msg').hidden = false;
    buttons.forEach((b) => { b.disabled = false; });
  }
}

async function init() {
  if (!token) return fail('This link is missing its access code. Please use the link from your email.');
  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/availability?token=${encodeURIComponent(token)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error || 'This request could not be loaded.');
    if (data.status !== 'pending' || data.closed) return done(data);
    $('trip-details').innerHTML = rows(data);
    show('ask-state');
  } catch {
    return fail('This request could not be loaded. Please check your connection and try again.');
  }
}

$('accept-btn').addEventListener('click', () => respond('accept'));
// a decline is asked twice: the first tap opens the reason box, the second sends it
$('decline-btn').addEventListener('click', () => {
  if ($('decline-box').hidden) {
    $('decline-box').hidden = false;
    $('decline-btn').textContent = 'Confirm: not available';
    $('decline-reason').focus();
    return;
  }
  respond('decline');
});

init();
