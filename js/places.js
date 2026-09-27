// Shared Google Places address autocomplete.
// Loaded by any page that wants address suggestions; safe to include when the
// Maps key is absent, in which case it simply does nothing.

const MIN_QUERY_CHARS = 3;
const QUERY_DEBOUNCE_MS = 300;

// shared, so a second guard can recognise a replay issued by the first
let replayingInput = false;

/**
 * Places bills per keystroke when a lookup is abandoned, so we withhold input
 * events from the widget until the field holds a plausible query and typing has
 * paused. The guard sits in the capture phase on `document`, which runs before
 * the widget's own listeners; when conditions are met we replay one event so it
 * queries exactly once.
 */
function throttleAutocomplete(el) {
  // attaching twice would deadlock: each guard would block the other's replay
  if (el.dataset.acThrottled) return;
  el.dataset.acThrottled = '1';

  let timer = null;

  document.addEventListener('input', (e) => {
    if (e.target !== el) return;
    if (replayingInput) { replayingInput = false; return; }

    e.stopPropagation();
    clearTimeout(timer);
    if (el.value.trim().length < MIN_QUERY_CHARS) return;

    timer = setTimeout(() => {
      replayingInput = true;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, QUERY_DEBOUNCE_MS);
  }, true);
}

function loadGoogleMaps() {
  return new Promise((resolve) => {
    // config.js declares `const CONFIG` — scoped, never a window property
    const key = typeof CONFIG !== 'undefined' ? CONFIG.MAPS_API_KEY : null;
    if (!key) return resolve(false);
    if (window.google?.maps?.places) return resolve(true);
    if (document.getElementById('gmaps-sdk')) {
      // another caller is already loading it — wait for that script
      document.getElementById('gmaps-sdk')
        .addEventListener('load', () => resolve(true), { once: true });
      return;
    }
    const s = document.createElement('script');
    s.id = 'gmaps-sdk';
    s.src = `https://maps.googleapis.com/maps/api/js?key=${key}&libraries=places,geometry`;
    s.async = true;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
}

/** Attaches throttled address autocomplete to one input. */
function attachAddressAutocomplete(el, onPlace) {
  if (!el || !window.google?.maps?.places) return null;

  throttleAutocomplete(el);

  const ac = new google.maps.places.Autocomplete(el, {
    types: ['address'],
    componentRestrictions: { country: 'us' },
    // geometry rides along with the Place Details call we already make, so the
    // coordinates cost nothing extra and save geocoding the address later
    fields: ['formatted_address', 'geometry.location'],
  });

  ac.addListener('place_changed', () => {
    const place = ac.getPlace();
    if (place?.formatted_address) el.value = place.formatted_address;
    const loc = place?.geometry?.location;
    if (onPlace) {
      onPlace(loc ? { lat: loc.lat(), lng: loc.lng() } : null, el.value);
    }
  });

  // Enter picks a suggestion — it must not submit the form as well
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && document.querySelector('.pac-container:not([style*="display: none"])')) {
      e.preventDefault();
    }
  });

  return ac;
}

/** Loads the SDK if needed, then attaches to every given input. */
async function initAddressAutocomplete(ids, onPlace) {
  const loaded = await loadGoogleMaps();
  if (!loaded) return false;
  ids.forEach((id) => attachAddressAutocomplete(
    document.getElementById(id),
    onPlace ? (coords, address) => onPlace(id, coords, address) : null
  ));
  return true;
}
