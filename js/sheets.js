// Shared utilities — loaded before page-specific scripts.

// the backend reads the sheet, which is private; this list carries no prices or owner details
async function fetchVehicles() {
  const res = await fetch(`${CONFIG.API_BASE}/api/vehicles`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.vehicles || [];
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
    city:        get('city', 'state', 'location', 'market'),
  };
}