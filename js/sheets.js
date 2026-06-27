// Shared utilities — loaded before page-specific scripts.

async function fetchVehicles() {
  const range = encodeURIComponent(`${CONFIG.SHEET_NAME}!A:J`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${range}?key=${CONFIG.API_KEY}`;

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message || `HTTP ${res.status}`);
  }

  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) return [];

  // Normalise header names: lowercase, strip all non-alphanumeric chars.
  // "Vehicle Make" → "vehiclemake", "Aff. Price" → "affprice", "S/N" → "sn"
  const headers = rows[0].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));

  return rows.slice(1)
    .filter(row => row.some(c => String(c || '').trim()))
    .map(row => {
      const v = {};
      headers.forEach((h, i) => { v[h] = String(row[i] || '').trim(); });
      return v;
    });
}

// Fire-and-forget POST to Apps Script.
// no-cors + text/plain avoids the preflight; we can't read the response body.
async function saveVehicles(vehicles) {
  const payload = Array.isArray(vehicles) ? vehicles : [vehicles];
  await fetch(CONFIG.APPS_SCRIPT_URL, {
    method:  'POST',
    mode:    'no-cors',
    headers: { 'Content-Type': 'text/plain' },
    body:    JSON.stringify(payload),
  });
}

function formatPrice(price) {
  const n = parseFloat(String(price).replace(/[^0-9.]/g, ''));
  if (isNaN(n)) return price || '—';
  return '$' + n.toLocaleString('en-US');
}

function vehicleTitle(v) {
  return [v.vehiclemake, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Generate a unique S/N when the admin doesn't supply one.
function generateSN() {
  return String(Date.now());
}

// Map flexible column names from an uploaded spreadsheet to our schema.
// Handles both the user's own sheet format and other common variations.
function normalizeRow(row, headerMap) {
  const get = (...keys) => {
    for (const k of keys) {
      if (headerMap[k] !== undefined) return String(row[headerMap[k]] || '').trim();
    }
    return '';
  };

  return {
    sn:          get('sn', 'serialnumber', 'serial', 'no', 'number', '#'),
    vehiclemake: get('vehiclemake', 'make', 'manufacturer', 'brand'),
    model:       get('model', 'vehiclemodel'),
    year:        get('year', 'yr', 'modelyear'),
    capacity:    get('capacity', 'seats', 'passengers', 'pax'),
    luggage:     get('luggage', 'luggage', 'bags', 'luggagespace'),
    type:        get('type', 'vehicletype', 'category', 'class'),
    affprice:    get('affprice', 'affiliateprice', 'affprice', 'cheapestprice', 'lowprice', 'startingprice'),
    retprice:    get('retprice', 'retailprice', 'price', 'cost', 'standardprice'),
    pics:        get('pics', 'pic', 'image', 'imageurl', 'photo', 'photourl', 'picture'),
  };
}