// Quote request form. Vehicle comes from ?sn=; without one we fall back to a picker.
// custom-quote.html reuses it with no vehicle at all — the admin matches one later.

let chosenVehicle = null;
const OPEN_REQUEST = document.getElementById('quote-form')?.dataset.kind === 'open';

async function init() {
  const form = document.getElementById('quote-form');
  const sn = new URLSearchParams(window.location.search).get('sn');

  // no trip can be booked for a past date
  document.getElementById('date').min = new Date().toISOString().split('T')[0];

  if (!OPEN_REQUEST) {
    try {
      const vehicles = await fetchVehicles();
      if (sn) {
        chosenVehicle = vehicles.find(v => v.sn === sn) || null;
        if (!chosenVehicle) {
          showAlert('That vehicle could not be found. Pick another from the fleet.');
          showPicker(vehicles);
        } else {
          renderChosen(chosenVehicle);
        }
      } else {
        showPicker(vehicles);
      }
    } catch (err) {
      showAlert(`Could not load vehicle details: ${escHtml(err.message)}`);
    }
  }

  form.querySelectorAll('input[name="tripType"]')
    .forEach(el => el.addEventListener('change', syncTripType));
  document.getElementById('add-stop').addEventListener('click', addStop);
  wireRoundTripDropoff();
  syncTripType();

  ['pickupTime', 'finalDropoffTime'].forEach((id) => {
    document.getElementById(id).addEventListener('input', syncMinTrip);
    document.getElementById(id).addEventListener('change', syncMinTrip);
  });
  syncMinTrip();

  form.addEventListener('submit', onSubmit);

  // address suggestions are a nicety — the form works fine without them
  initAddressAutocomplete(ADDRESS_FIELDS, onAddressPicked);
}

// mirrors the server rule; the server is what actually enforces it
const MIN_TRIP_HOURS = 3;

// a drop-off at or before pick-up means the trip runs past midnight
function tripMinutes(pickup, dropoff) {
  const mins = (t) => {
    const [h, m] = String(t).split(':').map(Number);
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
  };
  const a = mins(pickup);
  const b = mins(dropoff);
  if (a === null || b === null) return null;
  return b > a ? b - a : b - a + 24 * 60;
}

// the rule is only worth stating while it is being broken; the custom quote page has no minimum
function syncMinTrip() {
  const warning = document.getElementById('min-trip-warning');
  if (!warning) return;
  const pickup = document.getElementById('pickupTime').value;
  const dropoff = document.getElementById('finalDropoffTime').value;
  const booked = pickup && dropoff ? tripMinutes(pickup, dropoff) : null;
  warning.hidden = booked === null || booked >= MIN_TRIP_HOURS * 60;
}

const ADDRESS_FIELDS = ['pickupAddress', 'dropoffAddress'];

// coordinates come free with the autocomplete pick; they are sent with the quote
// so the admin map never has to geocode the addresses again
const tripCoords = { pickup: null, dropoff: null };
const stopCoords = new Map();   // stop input id -> {lat,lng}
const tripMapStore = {};
const COORD_KEY = { pickupAddress: 'pickup', dropoffAddress: 'dropoff' };

// mirrors the server limit
const MAX_STOPS = 5;
let stopSeq = 0;

const isRoundTrip = () => document.querySelector('input[name="tripType"]:checked')?.value === 'roundtrip';
const stopInputs = () => [...document.querySelectorAll('#stops input')];

// a round trip ends where it began, so drop-off follows pick-up until the customer changes it
let dropoffEdited = false;

function mirrorPickup() {
  if (!isRoundTrip() || dropoffEdited) return;
  document.getElementById('dropoffAddress').value = document.getElementById('pickupAddress').value;
  tripCoords.dropoff = tripCoords.pickup;
}

function wireRoundTripDropoff() {
  const pickup = document.getElementById('pickupAddress');
  const dropoff = document.getElementById('dropoffAddress');
  pickup.addEventListener('change', () => { mirrorPickup(); drawTripMap(); });
  // clearing the drop-off hands it back to the pick-up
  dropoff.addEventListener('change', () => {
    dropoffEdited = dropoff.value.trim() !== '' && dropoff.value !== pickup.value;
  });
}

function onAddressPicked(fieldId, coords) {
  const key = COORD_KEY[fieldId];
  if (!key) return;
  tripCoords[key] = coords;
  if (key === 'pickup') mirrorPickup();
  if (key === 'dropoff') {
    dropoffEdited = document.getElementById('dropoffAddress').value !== document.getElementById('pickupAddress').value;
  }
  drawTripMap();
}

// pick-up, the stops in order, then drop-off: the keys the trip map understands
function tripPoints() {
  const points = { pickup: tripCoords.pickup, dropoff: tripCoords.dropoff };
  stopInputs().forEach((input, i) => { points[`stop${i + 1}`] = stopCoords.get(input.id) || null; });
  return points;
}

function drawTripMap() {
  const field = document.getElementById('trip-map-field');
  const el = document.getElementById('trip-map');
  if (!field || !el) return;
  const points = tripPoints();
  const any = Object.values(points).some(Boolean);
  field.hidden = !any;
  if (any) renderTripMap(el, points, tripMapStore);
}

// a copied drop-off is only right for a round trip; any other trip type starts it blank
function syncTripType() {
  const pickup = document.getElementById('pickupAddress');
  const dropoff = document.getElementById('dropoffAddress');
  if (isRoundTrip()) {
    if (!dropoff.value.trim()) dropoffEdited = false;
    mirrorPickup();
  } else if (!dropoffEdited && dropoff.value && dropoff.value === pickup.value) {
    dropoff.value = '';
    tripCoords.dropoff = null;
  }
  drawTripMap();
}

function addStop() {
  if (stopInputs().length >= MAX_STOPS) return;
  const id = `stop-${++stopSeq}`;
  const row = document.createElement('div');
  row.className = 'stop-row';
  row.innerHTML = `
    <label for="${id}"></label>
    <div class="stop-input">
      <input type="text" id="${id}" maxlength="200" autocomplete="off">
      <button type="button" class="stop-remove">&times;</button>
    </div>`;
  document.getElementById('stops').appendChild(row);

  const input = row.querySelector('input');
  row.querySelector('.stop-remove').addEventListener('click', () => {
    row.remove();
    stopCoords.delete(id);
    syncStops();
    drawTripMap();
  });
  // suggestions attach once the Maps script is in; the field works without them
  loadGoogleMaps().then((ok) => {
    if (ok) attachAddressAutocomplete(input, (coords) => { stopCoords.set(id, coords); drawTripMap(); });
  });

  syncStops();
  input.focus();
}

// numbers the stops in route order and hides the button at the limit
function syncStops() {
  stopInputs().forEach((input, i) => {
    const row = input.closest('.stop-row');
    row.querySelector('label').textContent = `Stop-over ${i + 1}`;
    row.querySelector('.stop-remove').setAttribute('aria-label', `Remove stop-over ${i + 1}`);
  });
  document.getElementById('add-stop').hidden = stopInputs().length >= MAX_STOPS;
}

function renderChosen(v) {
  const title = vehicleTitle(v);
  const img = (v.pics || '').split('|').map(s => s.trim()).filter(Boolean)[0];
  const meta = [v.type, v.capacity ? `${v.capacity} passengers` : '', v.year].filter(Boolean).join(' · ');

  document.getElementById('vehicle-box').innerHTML = `
    <div class="chosen-vehicle">
      ${img ? `<img src="${escHtml(img)}" alt="${escHtml(title)}">` : ''}
      <div class="cv-body">
        <div class="cv-name">${escHtml(title)}</div>
        <div class="cv-meta">${escHtml(meta)}</div>
      </div>
    </div>`;

  const cap = parseInt(v.capacity, 10);
  const passengers = document.getElementById('passengers');
  if (!Number.isNaN(cap) && cap > 0) {
    passengers.max = cap;
    passengers.parentElement.querySelector('.hint')?.remove();
    passengers.insertAdjacentHTML('afterend', `<div class="hint">This vehicle seats up to ${cap}.</div>`);
  }
}

function showPicker(vehicles) {
  const wrap = document.getElementById('vehicle-picker');
  const select = document.getElementById('vehicle-select');
  select.innerHTML = '<option value="">Select a vehicle…</option>' +
    vehicles.map(v => `<option value="${escHtml(v.sn)}">${escHtml(vehicleTitle(v))}${v.capacity ? ` — ${escHtml(v.capacity)} pax` : ''}</option>`).join('');
  select.addEventListener('change', () => {
    chosenVehicle = vehicles.find(v => v.sn === select.value) || null;
    if (chosenVehicle) renderChosen(chosenVehicle);
  });
  wrap.style.display = 'block';
}

function showAlert(msg, kind = 'error') {
  const el = document.getElementById('alert');
  el.className = `alert alert-${kind}`;
  el.textContent = msg;
  el.style.display = 'block';
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideAlert() { document.getElementById('alert').style.display = 'none'; }

async function onSubmit(e) {
  e.preventDefault();
  hideAlert();

  const btn = document.getElementById('submit-btn');
  const form = e.target;

  if (!OPEN_REQUEST && !chosenVehicle) return showAlert('Please choose a vehicle first.');
  if (!form.checkValidity()) return showAlert('Please fill in all the required fields.');

  const val = (id) => document.getElementById(id).value.trim();
  const picked = (name) => form.querySelector(`input[name="${name}"]:checked`)?.value;
  const cap = parseInt(chosenVehicle?.capacity, 10);
  const passengers = Number(val('passengers'));
  if (!Number.isNaN(cap) && cap > 0 && passengers > cap) {
    return showAlert(`This vehicle seats up to ${cap} passengers.`);
  }

  const booked = tripMinutes(val('pickupTime'), val('finalDropoffTime'));
  if (!OPEN_REQUEST && (booked === null || booked < MIN_TRIP_HOURS * 60)) {
    return showAlert(`Trips run for a minimum of ${MIN_TRIP_HOURS} hours. Please adjust your pick-up or drop-off time.`);
  }

  const payload = {
    ...(OPEN_REQUEST
      ? { vehicleCategory: val('vehicleCategory'), city: val('city') }
      : {
        vehicleSn: chosenVehicle.sn,
        vehicleName: vehicleTitle(chosenVehicle),
        vehicleType: chosenVehicle.type,
        vehicleCapacity: chosenVehicle.capacity,
      }),
    tripType: picked('tripType'),
    date: val('date'),
    pickupTime: val('pickupTime'),
    finalDropoffTime: val('finalDropoffTime'),
    passengers,
    pickupAddress: val('pickupAddress'),
    // blank stop fields are left out rather than sent
    stopovers: stopInputs()
      .map((input) => ({ address: input.value.trim(), coords: stopCoords.get(input.id) || null }))
      .filter((stop) => stop.address),
    dropoffAddress: val('dropoffAddress'),
    name: val('name'),
    phone: val('phone'),
    email: val('email'),
    message: val('message'),
    pickupCoords: tripCoords.pickup,
    dropoffCoords: tripCoords.dropoff,
  };

  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/quotes${OPEN_REQUEST ? '/open' : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    form.style.display = 'none';
    const box = document.getElementById('vehicle-box');
    if (box) box.style.display = 'none';
    document.getElementById('success').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showAlert(err.message || 'Something went wrong. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Send request';
  }
}

document.addEventListener('DOMContentLoaded', init);
