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
    .forEach(el => el.addEventListener('change', syncStopover));
  syncStopover();

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

// the rule is only worth stating while it is being broken
function syncMinTrip() {
  const pickup = document.getElementById('pickupTime').value;
  const dropoff = document.getElementById('finalDropoffTime').value;
  const booked = pickup && dropoff ? tripMinutes(pickup, dropoff) : null;
  document.getElementById('min-trip-warning').hidden = booked === null || booked >= MIN_TRIP_HOURS * 60;
}

const ADDRESS_FIELDS = ['pickupAddress', 'stopoverAddress', 'dropoffAddress'];

// coordinates come free with the autocomplete pick; they are sent with the quote
// so the admin map never has to geocode the addresses again
const tripCoords = { pickup: null, stopover: null, dropoff: null };
const tripMapStore = {};
const COORD_KEY = { pickupAddress: 'pickup', stopoverAddress: 'stopover', dropoffAddress: 'dropoff' };

function onAddressPicked(fieldId, coords) {
  const key = COORD_KEY[fieldId];
  if (!key) return;
  tripCoords[key] = coords;
  drawTripMap();
}

function drawTripMap() {
  const field = document.getElementById('trip-map-field');
  const el = document.getElementById('trip-map');
  if (!field || !el) return;
  const any = Object.values(tripCoords).some(Boolean);
  field.hidden = !any;
  if (any) renderTripMap(el, tripCoords, tripMapStore);
}

// a stop-over only makes sense on a round trip
function syncStopover() {
  const isRoundTrip = document.querySelector('input[name="tripType"]:checked')?.value === 'roundtrip';
  document.getElementById('stopover-field').hidden = !isRoundTrip;
  // clear it so a hidden value can't be submitted
  if (!isRoundTrip) {
    document.getElementById('stopoverAddress').value = '';
    if (typeof tripCoords !== 'undefined') { tripCoords.stopover = null; drawTripMap(); }
  }
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
  if (booked === null || booked < MIN_TRIP_HOURS * 60) {
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
    stopoverAddress: val('stopoverAddress'),
    dropoffAddress: val('dropoffAddress'),
    name: val('name'),
    phone: val('phone'),
    email: val('email'),
    message: val('message'),
    pickupCoords: tripCoords.pickup,
    stopoverCoords: tripCoords.stopover,
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
