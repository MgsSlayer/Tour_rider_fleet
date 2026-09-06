// =============================================================
// Static site build — pre-renders vehicle data into real HTML.
// Run at deploy time (`npm run build`) on Netlify.
//
// IMPORTANT: SECTIONS/CITIES below must be kept in sync by hand with
// js/index.js — there's no shared module between the browser scripts
// (loaded as plain <script> tags, no bundler) and this Node build script.
// =============================================================

const fs   = require('fs');
const path = require('path');

const ROOT    = path.join(__dirname, '..');
const DIST    = path.join(ROOT, 'dist');
const RIDES_PREFIX = 'rides'; // Cloudflare Worker forwards pathname unchanged — origin must mirror /rides/...
const RIDES_DIR = path.join(DIST, RIDES_PREFIX);
const SLUG_MAP_FILE = path.join(__dirname, 'slug-map.json');

const SHEET_ID   = '1eCD0tvBgKIUcrbff0ee-QYz7O8ltQWe5TZackzg8bq8'; // same sheet as config.js
const SHEET_NAME = 'Fleetsheet';
const SITE_ORIGIN = 'https://tour-rider.com';
const BASE_PATH   = '/rides/'; // public URL prefix, also mirrored in the origin's own file structure

// Server-side key, set in Netlify's dashboard (Site settings → Environment
// variables). Deliberately NOT read from config.js — that file's key is for
// the client-side runtime fetch only.
const API_KEY = process.env.SHEETS_API_KEY;

// Mirrors SECTIONS in js/index.js.
const SECTIONS = [
  { id: 'party-buses',  title: 'Party Buses',                          slug: 'party-buses',
    types: ['party bus', 'partybus', 'party', 'sprinter limo'] },
  { id: 'vans-buses',   title: 'Vans, Buses & Coaches',                slug: 'vans-buses-coaches',
    types: ['standard', 'multipurpose', 'van', 'bus', 'coach', 'minibus', 'mini bus', 'shuttle', 'jet', 'executive'] },
  { id: 'limos-suvs',   title: 'Stretch Limos, SUVs & Exotics',        slug: 'stretch-limos-suvs',
    types: ['limo', 'limousine', 'suv', 'exotic', 'stretch', 'luxury', 'sedan'] },
];
const OTHER_SECTION = { id: 'other', title: 'Other Vehicles', slug: 'other-vehicles' };

// Mirrors CITIES in js/index.js.
const CITIES = [
  { id: 'nynj',  label: 'NY/NJ', slug: null, // no dedicated page — root index covers NY/NJ
    match: ['nynj', 'ny/nj', 'ny', 'nj', 'nyc', 'new york', 'new jersey'] },
  { id: 'miami', label: 'Miami', slug: 'miami',
    match: ['miami', 'florida', 'fl'] },
];

// ── SEO / structured-data constants ─────────────────────────────────────────

const OG_SITE_NAME  = 'Tour Rider Party Bus Limo Service New York';
const TWITTER_SITE  = '@tour_rider';

const BUSINESS = {
  name: 'Tour Rider',
  telephone: '+1-917-822-2713',
  email: 'booking@tour-rider.com',
  url: SITE_ORIGIN,
  // NOTE: no Facebook URL exists anywhere in the current site footer to
  // source here — omitted rather than invented. Add it once you have the
  // real profile URL.
  sameAs: [
    'https://www.x.com/tour_rider',
    'https://www.instagram.com/tour_rider',
  ],
};

function fail(message) {
  console.error(`\n✖ Build failed: ${message}\n`);
  process.exit(1);
}

// ── Fetch + parse (mirrors js/sheets.js's fetchVehicles, server-side) ──────

async function fetchVehiclesServerSide() {
  if (!API_KEY) {
    fail('SHEETS_API_KEY environment variable is not set. Add it in Netlify → Site settings → Environment variables.');
  }

  const range = encodeURIComponent(`${SHEET_NAME}!A:L`);
  const url   = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${range}?key=${API_KEY}`;

  let res;
  try {
    res = await fetch(url);
  } catch (err) {
    fail(`Could not reach the Google Sheets API — ${err.message}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    fail(`Google Sheets API returned HTTP ${res.status}. ${body}`);
  }

  const data = await res.json();
  const rows = data.values || [];
  if (rows.length < 2) fail('Sheet returned no data rows.');

  const headers = rows[0].map(h => String(h).trim().toLowerCase().replace(/[^a-z0-9]/g, ''));

  const vehicles = rows.slice(1)
    .filter(row => row.some(c => String(c || '').trim()))
    .map(row => {
      const v = {};
      headers.forEach((h, i) => { v[h] = String(row[i] || '').trim(); });
      return v;
    })
    .filter(v => (v.pics || '').trim()); // only vehicles with at least one photo

  if (vehicles.length === 0) {
    fail('Fetched the sheet successfully, but zero vehicles qualified (need at least one photo each). Refusing to deploy an empty site.');
  }

  return vehicles;
}

// ── Helpers shared with the client scripts ─────────────────────────────────

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function vehicleTitle(v) {
  return [v.vehiclemake, v.model].filter(Boolean).join(' ') || 'Unknown Vehicle';
}

function vehicleCity(v) {
  const s = (v.city || v.state || '').toLowerCase().trim();
  if (!s) return 'nynj';
  const opt = CITIES.find(o => o.match.some(k => s.includes(k)));
  return opt ? opt.id : 'nynj';
}

function groupVehicles(vehicles) {
  const groups = SECTIONS.map(s => ({ ...s, vehicles: [] }));
  const other  = { ...OTHER_SECTION, vehicles: [] };

  vehicles.forEach(v => {
    const type = (v.type || '').toLowerCase().trim();
    const matched = groups.find(g => g.types.some(t => type.includes(t)));
    (matched || other).vehicles.push(v);
  });

  const result = groups.filter(g => g.vehicles.length > 0);
  if (other.vehicles.length > 0) result.push(other);

  result.forEach(g => g.vehicles.sort((a, b) => {
    const ca = parseInt(a.capacity, 10);
    const cb = parseInt(b.capacity, 10);
    return (isNaN(ca) ? Infinity : ca) - (isNaN(cb) ? Infinity : cb);
  }));

  return result;
}

// ── SEO helpers ──────────────────────────────────────────────────────────────

function truncate(str, max) {
  if (str.length <= max) return str;
  const cut = str.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

// Descriptive alt text from real vehicle data — mirrored in js/vehicle.js's
// renderImages() so client-side takeover doesn't strip it. Keep both in sync.
function altTextFor(v, index) {
  const capacity = (v.capacity || '').trim();
  const type     = (v.type || '').trim().toLowerCase();
  const subject  = (capacity && type) ? `${capacity} passenger ${type}` : vehicleTitle(v);
  return index === 0
    ? `${subject} available for rental in NYC — exterior`
    : `${subject} interior, photo ${index + 1}`;
}

function vehicleSeoTitle(v) {
  const capacity = (v.capacity || '').trim();
  const type     = (v.type || '').trim();
  const base = (capacity && type)
    ? `${capacity} Passenger ${type} Rental NYC`
    : `${vehicleTitle(v)} Rental NYC`;
  return truncate(`${base} | Tour Rider`, 60);
}

function vehicleSeoDescription(v) {
  const parts = [];
  if (v.capacity) parts.push(`${v.capacity}-passenger`);
  if (v.type) parts.push(v.type.toLowerCase());
  const subject = parts.length ? parts.join(' ') : vehicleTitle(v).toLowerCase();
  return truncate(`Book this ${subject} for your NYC, NJ or Miami event. Request a free quote from Tour Rider today.`, 155);
}

// Serializes + round-trip validates (fails the build on malformed JSON) +
// escapes "<" so the payload can never break out of its <script> tag.
function jsonLdScript(obj) {
  const json = JSON.stringify(obj);
  try {
    JSON.parse(json);
  } catch (err) {
    fail(`Generated invalid JSON-LD: ${err.message}`);
  }
  return `<script type="application/ld+json">${json.replace(/</g, '\\u003c')}</script>`;
}

function localBusinessBlock() {
  return {
    '@type': 'LocalBusiness',
    '@id': `${SITE_ORIGIN}/#business`,
    name: BUSINESS.name,
    telephone: BUSINESS.telephone,
    email: BUSINESS.email,
    url: BUSINESS.url,
    areaServed: [
      { '@type': 'State', name: 'New York' },
      { '@type': 'State', name: 'New Jersey' },
      { '@type': 'City', name: 'Miami', containedInPlace: { '@type': 'State', name: 'Florida' } },
    ],
    sameAs: BUSINESS.sameAs,
  };
}

function breadcrumbBlock(items) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

function itemListBlock(name, vehicleUrls) {
  return {
    '@type': 'ItemList',
    name,
    itemListElement: vehicleUrls.map((url, i) => ({ '@type': 'ListItem', position: i + 1, url })),
  };
}

function vehicleSchemaBlock(v, canonicalUrl, photoUrls) {
  const block = {
    '@type': 'Vehicle',
    name: vehicleTitle(v),
    image: photoUrls,
    url: canonicalUrl,
    brand: { '@id': `${SITE_ORIGIN}/#business` },
    provider: { '@id': `${SITE_ORIGIN}/#business` },
  };
  if (v.capacity) {
    const n = parseInt(v.capacity, 10);
    block.vehicleSeatingCapacity = {
      '@type': 'QuantitativeValue',
      value: isNaN(n) ? v.capacity : n,
      unitText: 'passengers',
    };
  }
  return block;
}

// ── Slugs — stable across builds, warned rather than silently renamed ──────

function slugify(s) {
  return String(s).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function freshSlugFor(v) {
  const capacity = (v.capacity || '').trim();
  const type     = (v.type || '').trim();
  if (capacity && type) return slugify(`${capacity}-passenger-${type}`);
  if (v.vehiclemake || v.model) return slugify(`${v.vehiclemake || ''} ${v.model || ''}`);
  return `vehicle-${v.sn}`;
}

// Distinguishes "genuinely missing" from "present but empty/corrupt" so the
// caller can decide whether ALLOW_EMPTY_SLUG_MAP should excuse it.
function loadSlugMap() {
  let raw;
  try {
    raw = fs.readFileSync(SLUG_MAP_FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { map: {}, status: 'missing' };
    throw err;
  }

  if (!raw.trim()) return { map: {}, status: 'empty' };

  try {
    const map = JSON.parse(raw);
    return { map, status: 'ok' };
  } catch {
    return { map: {}, status: 'corrupt' };
  }
}

function assignSlugs(vehicles, existingMap) {
  const map  = { ...existingMap };
  const used = new Set(Object.values(map));
  const warnings = [];
  const newlyAssigned = [];

  vehicles.forEach(v => {
    const sn    = v.sn;
    const fresh = freshSlugFor(v);

    if (map[sn]) {
      if (map[sn] !== fresh) {
        warnings.push(`S/N ${sn}: data now suggests slug "${fresh}", keeping existing "${map[sn]}" stable.`);
      }
      return;
    }

    let candidate = fresh;
    let n = 2;
    while (used.has(candidate)) candidate = `${fresh}-${n++}`;
    used.add(candidate);
    map[sn] = candidate;
    newlyAssigned.push({ sn, slug: candidate });
  });

  return { map, warnings, newlyAssigned };
}

// ── HTML templates ──────────────────────────────────────────────────────────

const rel = (depth, p) => (depth === 0 ? p : '../'.repeat(depth) + p);

function pageShell({ depth, urlPath, title, description, bodyHtml, extraScripts = '', ogImage, jsonLd }) {
  const canonical = `${SITE_ORIGIN}${BASE_PATH}${urlPath}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escHtml(description)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${canonical}">
  <link rel="icon" type="image/png" href="${rel(depth, 'css/logo_tour_ride-removebg-preview-1-3-300x175.png')}">
  <link rel="stylesheet" href="${rel(depth, 'css/styles.css')}">

  <meta property="og:title" content="${escHtml(title)}">
  <meta property="og:description" content="${escHtml(description)}">
  <meta property="og:url" content="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="en_US">
  <meta property="og:site_name" content="${escHtml(OG_SITE_NAME)}">
  ${ogImage ? `<meta property="og:image" content="${escHtml(ogImage)}">` : ''}

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="${TWITTER_SITE}">

  ${jsonLdScript(jsonLd)}
</head>
<body>

<header>
  <div class="header-inner">
    <a class="logo" href="https://tour-rider.com/">
      <img src="${rel(depth, 'css/logo_tour_ride-removebg-preview-1-3-300x175.png')}" alt="Tour Rider" class="logo-img">
    </a>
    <button class="nav-toggle" aria-label="Toggle menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
    <nav id="main-nav">
      <a href="https://tour-rider.com/">Home</a>
      <a href="${rel(depth, 'index.html')}">Rides</a>
      <a href="https://tour-rider.com/merch/">Merch</a>
      <a href="https://tour-rider.com/about-us/">About us</a>
      <a href="https://tour-rider.com/contact-us/">Contact us</a>
      <a href="https://tour-rider.com/request-quote/" class="btn-gold">Request quote</a>
    </nav>
  </div>
  <div class="header-contact">
    <div class="header-contact-inner">
      <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m2 7 10 7 10-7"/></svg> booking@tour-rider.com</span>
      <span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.06 11a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 2.98 0h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.09 7.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 21 15z"/></svg> 917-822-2713</span>
    </div>
  </div>
</header>

<main>
${bodyHtml}
</main>

<footer>
  <p>© Tour Rider — NYC Limo &amp; Party Bus Rentals</p>
</footer>

<script src="${rel(depth, 'config.js')}"></script>
<script src="${rel(depth, 'js/sheets.js')}"></script>
${extraScripts}
<script>
  const toggle = document.querySelector('.nav-toggle');
  const nav    = document.getElementById('main-nav');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', open);
  });
  nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
    nav.classList.remove('open');
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded', false);
  }));
</script>

</body>
</html>
`;
}

function cardHtml(v, depth, slugMap) {
  const title = vehicleTitle(v);
  const urls  = (v.pics || '').split('|').map(u => u.trim()).filter(Boolean);
  const slug  = slugMap[v.sn];
  const img   = urls[0]
    ? `<img src="${escHtml(urls[0])}" alt="${escHtml(altTextFor(v, 0))}" loading="lazy" onerror="this.src='${rel(depth, 'css/placeholder.svg')}'">`
    : `<img src="${rel(depth, 'css/placeholder.svg')}" alt="No image" class="card-img-placeholder">`;

  return `
    <a class="vehicle-card" href="${rel(depth, `${slug}/`)}">
      <div class="card-image">
        ${img}
        ${v.type ? `<span class="type-badge">${escHtml(v.type)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(title)}</div>
        <div class="card-meta">
          ${v.capacity ? `<span class="card-meta-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>${escHtml(v.capacity)} pax</span>` : ''}
          ${v.luggage  ? `<span class="card-meta-item"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>Luggage: ${escHtml(v.luggage)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

function sectionHtml(group, depth, slugMap) {
  return `
    <div class="vehicle-section open" id="${group.id}">
      <div class="section-header">
        <button type="button" class="section-toggle" aria-expanded="true">
          <span class="section-title-text">${escHtml(group.title)}</span>
          <span class="section-count">${group.vehicles.length}</span>
          <svg class="section-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="section-collapse">
        <div class="vehicle-grid">${group.vehicles.map(v => cardHtml(v, depth, slugMap)).join('')}</div>
      </div>
    </div>`;
}

function listingBody(groups, depth, slugMap, heading, count) {
  const sections = groups.length
    ? groups.map(g => sectionHtml(g, depth, slugMap)).join('')
    : `<div class="empty-state"><h3>No vehicles found</h3></div>`;

  return `
  <div class="page-header">
    <h1><span>${escHtml(heading)}</span></h1>
    <p id="count">${count} vehicle${count !== 1 ? 's' : ''}</p>
  </div>

  <div class="filters">
    <div class="search-box" id="search-box">
      <input type="text" id="search" placeholder="Search by city…" aria-label="Search vehicles">
    </div>
    <select class="filter-select" id="city-picker" aria-label="Select city">
      <option value="nynj">NY/NJ</option>
      <option value="miami">Miami</option>
    </select>
  </div>

  <div id="loading" class="loading" style="display:none">
    <div class="spinner"></div>
    <p>Loading vehicles…</p>
  </div>

  <div id="empty-state" class="empty-state" style="display:none">
    <h3>No vehicles found</h3>
    <p>Try adjusting your search.</p>
  </div>

  <div id="sections-container">${sections}</div>`;
}

function vehiclePageBody(v, depth) {
  const title = vehicleTitle(v);
  const urls  = (v.pics || '').split('|').map(u => u.trim()).filter(Boolean);
  const imagesHtml = urls.length
    ? urls.map((u, i) => `<img src="${escHtml(u)}" alt="${escHtml(altTextFor(v, i))}" ${i === 0 ? '' : 'loading="lazy"'} onerror="this.src='${rel(depth, 'css/placeholder.svg')}'">`).join('')
    : `<img src="${rel(depth, 'css/placeholder.svg')}" alt="No image available" class="detail-img-placeholder">`;

  // Mirrors vehicle.html's exact skeleton (same ids) so js/vehicle.js's
  // progressive enhancement finds every element it expects — just with the
  // loading/error/content visibility flipped so real content shows with no JS.
  return `
  <div id="loading" class="loading" style="display:none">
    <div class="spinner"></div>
    <p>Loading vehicle details…</p>
  </div>

  <div id="error-state" style="display:none">
    <div class="breadcrumb">
      <a href="${rel(depth, 'index.html')}">← Back to listings</a>
    </div>
    <div class="alert alert-error" id="error-msg"></div>
  </div>

  <div id="vehicle-content" style="display:block">

    <div class="breadcrumb">
      <a href="${rel(depth, 'index.html')}">Listings</a>
      <span class="breadcrumb-sep">/</span>
      <span id="page-title">${escHtml(title)}</span>
    </div>

    <div class="vehicle-detail">
      <div>
        <div class="detail-image-wrap" id="image-wrap">${imagesHtml}</div>
      </div>

      <div class="detail-sidebar">
        <h1 class="detail-title" id="detail-title">${escHtml(title)}</h1>
        <span class="type-pill" id="detail-type-badge" style="${v.type ? '' : 'display:none'}">${escHtml(v.type)}</span>

        <div class="specs-grid">
          <div class="spec-item"><div class="spec-label">Make</div><div class="spec-value" id="spec-make">${escHtml(v.vehiclemake) || '—'}</div></div>
          <div class="spec-item"><div class="spec-label">Model</div><div class="spec-value" id="spec-model">${escHtml(v.model) || '—'}</div></div>
          <div class="spec-item"><div class="spec-label">Type</div><div class="spec-value" id="spec-type">${escHtml(v.type) || '—'}</div></div>
          <div class="spec-item"><div class="spec-label">Capacity</div><div class="spec-value" id="spec-capacity">${v.capacity ? `${escHtml(v.capacity)} passengers` : '—'}</div></div>
          <div class="spec-item"><div class="spec-label">Luggage</div><div class="spec-value" id="spec-luggage">${escHtml(v.luggage) || '—'}</div></div>
        </div>

        <p class="tolls-note">Tolls and travel time apply outside NYC.</p>

        <div class="detail-actions">
          <a class="btn-gold" href="https://tour-rider.com/request-quote/">Get quote</a>
          <button class="share-btn" id="share-btn">🔗 Copy Link</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Fullscreen image viewer -->
  <div class="lightbox" id="lightbox">
    <button class="lightbox-close" id="lightbox-close" aria-label="Close">&times;</button>
    <button class="carousel-btn carousel-prev" id="lightbox-prev" aria-label="Previous photo">&#8249;</button>
    <img class="lightbox-img" id="lightbox-img" src="" alt="">
    <button class="carousel-btn carousel-next" id="lightbox-next" aria-label="Next photo">&#8250;</button>
    <div class="carousel-dots" id="lightbox-dots"></div>
  </div>`;
}

// ── Filesystem helpers ──────────────────────────────────────────────────────

// Every generated/copied site file lives under dist/rides/... so the origin
// structure mirrors the public URL exactly (the Cloudflare Worker forwards
// url.pathname unchanged — it does not strip the /rides prefix).
function write(relPath, content) {
  const full = path.join(RIDES_DIR, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// DECISION: admin.html is published at dist/rides/admin.html (reachable at
// https://tour-rider.com/rides/admin.html), not dist/admin.html. It needs
// the exact same css/js/config.js assets as every other page, and those are
// only copied under dist/rides/ — putting admin.html outside that directory
// would break its relative asset paths. The netlify.toml noindex header is
// set to match this path; if you ever move admin.html, update both.
function copyStaticAssets() {
  fs.cpSync(path.join(ROOT, 'css'), path.join(RIDES_DIR, 'css'), { recursive: true });
  fs.mkdirSync(path.join(RIDES_DIR, 'js'), { recursive: true });
  ['sheets.js', 'index.js', 'vehicle.js', 'admin.js'].forEach(f =>
    fs.copyFileSync(path.join(ROOT, 'js', f), path.join(RIDES_DIR, 'js', f)));
  fs.copyFileSync(path.join(ROOT, 'config.js'), path.join(RIDES_DIR, 'config.js'));
  fs.copyFileSync(path.join(ROOT, 'admin.html'), path.join(RIDES_DIR, 'admin.html'));
  fs.copyFileSync(path.join(ROOT, 'vehicle.html'), path.join(RIDES_DIR, 'vehicle.html'));
}

// Netlify only reads _redirects from the publish root (dist/), never from a
// subdirectory — unlike every other generated file, this one must NOT go
// under dist/rides/, even though its rule contents reference /rides paths.
function writeAtPublishRoot(relPath, content) {
  const full = path.join(DIST, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

// ── Build ────────────────────────────────────────────────────────────────────

async function build() {
  console.log('Fetching Fleetsheet…');
  const vehicles = await fetchVehiclesServerSide();
  console.log(`Fetched ${vehicles.length} vehicles (with at least one photo).`);

  const slugState = loadSlugMap();
  if (slugState.status !== 'ok' && process.env.ALLOW_EMPTY_SLUG_MAP !== '1') {
    fail(
      `scripts/slug-map.json is ${slugState.status} (path: ${SLUG_MAP_FILE}), but the sheet returned ` +
      `${vehicles.length} vehicle(s). This file must be committed to git — without it, every slug ` +
      `regenerates on next build and every indexed/bookmarked URL breaks.\n\n` +
      `  If this is genuinely a first run, set ALLOW_EMPTY_SLUG_MAP=1 to proceed once, then IMMEDIATELY ` +
      `commit the slug-map.json this run generates.`
    );
  }

  const { map: slugMap, warnings, newlyAssigned } = assignSlugs(vehicles, slugState.map);
  fs.writeFileSync(SLUG_MAP_FILE, JSON.stringify(slugMap, null, 2) + '\n');
  if (warnings.length) {
    console.warn('\n⚠ Slug warnings (existing slugs kept stable, not renamed):');
    warnings.forEach(w => console.warn(`  - ${w}`));
    console.log('');
  }
  if (newlyAssigned.length) {
    console.log(`\n⚠ REMINDER: scripts/slug-map.json changed — ${newlyAssigned.length} new slug(s) assigned:`);
    newlyAssigned.forEach(({ sn, slug }) => console.log(`  - S/N ${sn} -> ${slug}`));
    console.log('  Commit this file now, or the next build on a fresh checkout will lose these assignments.\n');
  }

  fs.rmSync(DIST, { recursive: true, force: true });
  copyStaticAssets();

  const sitemapUrls = [];

  const vehicleUrl = v => `${SITE_ORIGIN}${BASE_PATH}${slugMap[v.sn]}/`;
  const homeCrumb  = { name: 'Home', url: SITE_ORIGIN };
  const ridesCrumb = { name: 'Rides', url: `${SITE_ORIGIN}${BASE_PATH}` };

  // 1. Root index — every vehicle, all cities
  const allGroups = groupVehicles(vehicles);
  write('index.html', pageShell({
    depth: 0,
    urlPath: '',
    title: 'NYC Party Bus & Limo Rentals — Full Fleet | Tour Rider',
    description: truncate('Browse Tour Rider\'s full fleet of party buses, limos, vans and SUVs serving NYC, NJ and Miami. Request your free quote today.', 155),
    bodyHtml: listingBody(allGroups, 0, slugMap, 'Rides', vehicles.length),
    extraScripts: `<script src="js/index.js"></script>`,
    jsonLd: {
      '@context': 'https://schema.org',
      '@graph': [
        localBusinessBlock(),
        breadcrumbBlock([homeCrumb, ridesCrumb]),
        itemListBlock('All Vehicles', vehicles.map(vehicleUrl)),
      ],
    },
  }));
  sitemapUrls.push('');

  // 2. Category pages — that category's vehicles, all cities
  [...SECTIONS, OTHER_SECTION].forEach(section => {
    const group = allGroups.find(g => g.id === section.id);
    if (!group) return; // no vehicles in this category right now
    const catCrumb = { name: group.title, url: `${SITE_ORIGIN}${BASE_PATH}${section.slug}/` };
    write(`${section.slug}/index.html`, pageShell({
      depth: 1,
      urlPath: `${section.slug}/`,
      title: truncate(`${group.title} Rentals NYC & NJ`, 47) + ' | Tour Rider',
      description: truncate(`Rent a ${group.title.toLowerCase()} in NYC, NJ or Miami. ${group.vehicles.length} vehicles available — request your free quote from Tour Rider.`, 155),
      bodyHtml: listingBody([group], 1, slugMap, group.title, group.vehicles.length),
      extraScripts: `<script src="../js/index.js"></script>`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          localBusinessBlock(),
          breadcrumbBlock([homeCrumb, ridesCrumb, catCrumb]),
          itemListBlock(group.title, group.vehicles.map(vehicleUrl)),
        ],
      },
    }));
    sitemapUrls.push(section.slug);
  });

  // 3. City pages — every category, filtered to that city
  CITIES.filter(c => c.slug).forEach(city => {
    const cityVehicles = vehicles.filter(v => vehicleCity(v) === city.id);
    const cityGroups   = groupVehicles(cityVehicles);
    const cityCrumb    = { name: `${city.label} Rides`, url: `${SITE_ORIGIN}${BASE_PATH}${city.slug}/` };
    write(`${city.slug}/index.html`, pageShell({
      depth: 1,
      urlPath: `${city.slug}/`,
      title: city.id === 'miami' ? 'Party Bus & Limo Rentals Miami | Tour Rider' : truncate(`${city.label} Vehicle Rentals`, 47) + ' | Tour Rider',
      description: truncate(`Party buses, limos, vans and SUVs available for rent in ${city.label}. Request your free quote from Tour Rider today.`, 155),
      bodyHtml: listingBody(cityGroups, 1, slugMap, `${city.label} Rides`, cityVehicles.length),
      extraScripts: `<script src="../js/index.js"></script>`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          localBusinessBlock(),
          breadcrumbBlock([homeCrumb, ridesCrumb, cityCrumb]),
          itemListBlock(`${city.label} Rides`, cityVehicles.map(vehicleUrl)),
        ],
      },
    }));
    sitemapUrls.push(city.slug);
  });

  // 4. One page per vehicle
  const redirectLines = [];
  vehicles.forEach(v => {
    const slug  = slugMap[v.sn];
    const urls  = (v.pics || '').split('|').map(u => u.trim()).filter(Boolean);
    const canonicalUrl = `${SITE_ORIGIN}${BASE_PATH}${slug}/`;
    write(`${slug}/index.html`, pageShell({
      depth: 1,
      urlPath: `${slug}/`,
      title: vehicleSeoTitle(v),
      description: vehicleSeoDescription(v),
      bodyHtml: vehiclePageBody(v, 1),
      extraScripts: `<script src="../js/vehicle.js"></script>`,
      ogImage: urls[0],
      jsonLd: {
        '@context': 'https://schema.org',
        '@graph': [
          localBusinessBlock(),
          vehicleSchemaBlock(v, canonicalUrl, urls),
        ],
      },
    }));
    sitemapUrls.push(slug);
    redirectLines.push(`${BASE_PATH}vehicle.html  sn=${v.sn}  ${BASE_PATH}${slug}/  301`);
  });

  // Legacy vehicle.html?sn=... links/bookmarks -> new slug URLs. The
  // Cloudflare Worker forwards url.pathname unchanged (no prefix stripping),
  // so both the source AND target here carry the full /rides prefix — this
  // file must sit at the true publish root for Netlify to read it as
  // redirect rules at all (see writeAtPublishRoot).
  writeAtPublishRoot('_redirects', redirectLines.join('\n') + '\n');

  // Sitemap — admin.html deliberately excluded.
  const urlEntries = sitemapUrls.map(u =>
    `  <url><loc>${SITE_ORIGIN}${BASE_PATH}${u ? u + '/' : ''}</loc></url>`).join('\n');
  write('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>\n`);

  console.log(`\n✔ Build complete: ${vehicles.length} vehicles, ${sitemapUrls.length} pages written to dist/rides/\n`);
}

build().catch(err => fail(err.stack || err.message));
