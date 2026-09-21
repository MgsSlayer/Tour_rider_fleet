// Quote request form. Vehicle comes from ?sn=; without one we fall back to a picker.

let chosenVehicle = null;

async function init() {
  const form = document.getElementById('quote-form');
  const sn = new URLSearchParams(window.location.search).get('sn');

  // no trip can be booked for a past date
  document.getElementById('date').min = new Date().toISOString().split('T')[0];

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

  form.querySelectorAll('input[name="tripType"]')
    .forEach(el => el.addEventListener('change', syncStopover));
  syncStopover();

  form.addEventListener('submit', onSubmit);

  // address suggestions are a nicety — the form works fine without them
  loadGoogleMaps().then(loaded => { if (loaded) initAddressAutocomplete(); });
}

const ADDRESS_FIELDS = ['pickupAddress', 'stopoverAddress', 'dropoffAddress'];

function loadGoogleMaps() {
  return new Promise(resolve => {
    if (!CONFIG.MAPS_API_KEY) return resolve(false);
    if (window.google?.maps?.places) return resolve(true);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${CONFIG.MAPS_API_KEY}&libraries=places`;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

function initAddressAutocomplete() {
  ADDRESS_FIELDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;

    const ac = new google.maps.places.Autocomplete(el, {
      types: ['address'],
      componentRestrictions: { country: 'us' },
      fields: ['formatted_address'],
    });

    ac.addListener('place_changed', () => {
      const place = ac.getPlace();
      if (place?.formatted_address) el.value = place.formatted_address;
    });

    // Enter picks a suggestion — it must not submit the form as well
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' && document.querySelector('.pac-container:not([style*="display: none"])')) {
        e.preventDefault();
      }
    });
  });
}

// a stop-over only makes sense on a round trip
function syncStopover() {
  const isRoundTrip = document.querySelector('input[name="tripType"]:checked')?.value === 'roundtrip';
  document.getElementById('stopover-field').hidden = !isRoundTrip;
  // clear it so a hidden value can't be submitted
  if (!isRoundTrip) document.getElementById('stopoverAddress').value = '';
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

  if (!chosenVehicle) return showAlert('Please choose a vehicle first.');
  if (!form.checkValidity()) return showAlert('Please fill in all the required fields.');

  const val = (id) => document.getElementById(id).value.trim();
  const cap = parseInt(chosenVehicle.capacity, 10);
  const passengers = Number(val('passengers'));
  if (!Number.isNaN(cap) && cap > 0 && passengers > cap) {
    return showAlert(`This vehicle seats up to ${cap} passengers.`);
  }

  const payload = {
    vehicleSn: chosenVehicle.sn,
    vehicleName: vehicleTitle(chosenVehicle),
    vehicleType: chosenVehicle.type,
    vehicleCapacity: chosenVehicle.capacity,
    tripType: form.querySelector('input[name="tripType"]:checked').value,
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
  };

  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    const res = await fetch(`${CONFIG.API_BASE}/api/quotes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);

    form.style.display = 'none';
    document.getElementById('vehicle-box').style.display = 'none';
    document.getElementById('success').style.display = 'block';
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showAlert(err.message || 'Something went wrong. Please try again.');
    btn.disabled = false;
    btn.textContent = 'Send request';
  }
}

document.addEventListener('DOMContentLoaded', init);
