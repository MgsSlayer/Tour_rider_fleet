// Section definitions — add any type aliases your sheet uses under `types`.
const SECTIONS = [
  {
    id:    'party-buses',
    title: 'Party Buses',
    types: ['party bus', 'partybus', 'party', 'sprinter limo'],
  },
  {
    id:    'vans-buses',
    title: 'Vans, Buses & Coaches',
    types: ['standard', 'multipurpose', 'van', 'bus', 'coach', 'minibus', 'mini bus', 'shuttle', 'jet', 'executive'],
  },
  {
    id:    'limos-suvs',
    title: 'Stretch Limos, SUVs & Exotics',
    types: ['limo', 'limousine', 'suv', 'exotic', 'stretch', 'luxury', 'sedan'],
  },
];

// City picker — add match aliases here as the sheet's City column varies.
const CITIES = [
  { id: 'nynj',  label: 'NY/NJ', match: ['nynj', 'ny/nj', 'ny', 'nj', 'nyc', 'new york', 'new jersey'] },
  { id: 'miami', label: 'Miami', match: ['miami', 'florida', 'fl'] },
];

let allVehicles = [];

async function init() {
  const loading    = document.getElementById('loading');
  const emptyState = document.getElementById('empty-state');
  const container  = document.getElementById('sections-container');
  const searchInput = document.getElementById('search');
  const countEl    = document.getElementById('count');

  const openSections = new Set();  // section ids the user has manually expanded
  const cityPicker = document.getElementById('city-picker');
  let selectedCity = cityPicker.value;

  // Cards animate in as they scroll into view
  const revealSupported = 'IntersectionObserver' in window;
  const revealObserver = revealSupported ? new IntersectionObserver((entries, obs) => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('in-view');
      obs.unobserve(entry.target);
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }) : null;

  function revealCards() {
    const cards = container.querySelectorAll('.vehicle-card:not(.in-view)');
    if (!revealSupported) { cards.forEach(c => c.classList.add('in-view')); return; }
    cards.forEach(c => revealObserver.observe(c));
  }

  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchInput.blur();
      applyFilters();
    }
  });

  cityPicker.addEventListener('change', () => {
    selectedCity = cityPicker.value;
    applyFilters();
  });

  try {
    allVehicles = await fetchVehicles();
  } catch (err) {
    loading.innerHTML = `<div class="alert alert-error">Could not load vehicles: ${escHtml(err.message)}<br>Check your API key and Sheet ID in config.js.</div>`;
    return;
  }

  // Only list vehicles that have at least one photo
  allVehicles = allVehicles.filter(v => (v.pics || '').trim());

  // Prev/next/dot clicks on a card's mini-carousel — stop them from
  // triggering the card's own link navigation.
  container.addEventListener('click', e => {
    const btn = e.target.closest('.carousel-prev, .carousel-next, .carousel-dot');
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();

    const wrap  = btn.closest('.card-image');
    const track = wrap.querySelector('.carousel-track');
    const dots  = [...wrap.querySelectorAll('.carousel-dot')];
    let current = Math.max(0, dots.findIndex(d => d.classList.contains('active')));

    if (btn.classList.contains('carousel-prev'))      current = Math.max(0, current - 1);
    else if (btn.classList.contains('carousel-next')) current = Math.min(dots.length - 1, current + 1);
    else                                               current = dots.indexOf(btn);

    track.scrollTo({ left: current * track.offsetWidth, behavior: 'smooth' });
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
  });

  // Category blocks are collapsed by default — click the header to reveal
  // its vehicles. Several can stay open at once (no accordion collapse).
  container.addEventListener('click', e => {
    const toggle = e.target.closest('.section-toggle');
    if (!toggle) return;
    const section = toggle.closest('.vehicle-section');
    const open = section.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
    if (open) openSections.add(section.id); else openSections.delete(section.id);
  });

  searchInput.addEventListener('input', applyFilters);
  applyFilters();

  function applyFilters() {
    const q = searchInput.value.toLowerCase().trim();
    // Typing searches by city directly (independent of the dropdown, so
    // it isn't gated behind whatever city the dropdown currently shows).
    // With no query, the dropdown's selected city drives the list.
    const filtered = q
      ? allVehicles.filter(v => cityLabel(v).includes(q))
      : allVehicles.filter(v => vehicleCity(v) === selectedCity);
    // While actively searching, force-open every matching section so
    // results are visible without an extra click; clearing the search
    // reverts sections to whatever the user had manually opened.
    renderSections(filtered, !!q);
  }

  function renderSections(vehicles, forceOpen) {
    loading.style.display = 'none';
    container.innerHTML   = '';

    if (vehicles.length === 0) {
      emptyState.style.display = 'block';
      countEl.textContent      = '0 vehicles';
      return;
    }
    emptyState.style.display = 'none';
    countEl.textContent = `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}`;

    const groups = groupVehicles(vehicles);

    groups.forEach(group => {
      if (group.vehicles.length === 0) return;

      const isOpen = forceOpen || openSections.has(group.id);

      const section = document.createElement('div');
      section.className = 'vehicle-section' + (isOpen ? ' open' : '');
      section.id        = group.id;

      section.innerHTML = `
        <button type="button" class="section-toggle" aria-expanded="${isOpen}">
          <span class="section-title-text">${group.title}</span>
          <span class="section-count">${group.vehicles.length}</span>
          <svg class="section-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="section-collapse">
          <div class="vehicle-grid">${group.vehicles.map(cardHtml).join('')}</div>
        </div>`;

      container.appendChild(section);
    });

    // Sync dots when a card's images are swiped directly (scroll doesn't bubble)
    container.querySelectorAll('.carousel-track').forEach(track => {
      track.addEventListener('scroll', () => {
        const dots = track.parentElement.querySelectorAll('.carousel-dot');
        if (!dots.length) return;
        const idx = Math.round(track.scrollLeft / track.offsetWidth);
        dots.forEach((d, i) => d.classList.toggle('active', i === idx));
      }, { passive: true });
    });

    revealCards();
  }
}

// Reads either a "City" or "State" sheet column (whichever the header says),
// and defaults rows with no value to NY/NJ.
function vehicleCity(v) {
  const s = (v.city || v.state || '').toLowerCase().trim();
  if (!s) return 'nynj';
  const opt = CITIES.find(o => o.match.some(k => s.includes(k)));
  return opt ? opt.id : 'nynj';
}

// Lowercased label text for a vehicle's resolved city, e.g. 'nynj' -> 'ny/nj', 'miami' -> 'miami'.
function cityLabel(v) {
  const opt = CITIES.find(c => c.id === vehicleCity(v));
  return opt ? opt.label.toLowerCase() : '';
}

function groupVehicles(vehicles) {
  const groups = SECTIONS.map(s => ({ ...s, vehicles: [] }));
  const other  = { id: 'other', title: 'Other Vehicles', vehicles: [] };

  vehicles.forEach(v => {
    const type    = (v.type || '').toLowerCase().trim();
    const matched = groups.find(g =>
      g.types.some(t => type.includes(t))
    );
    (matched || other).vehicles.push(v);
  });

  const result = groups.filter(g => g.vehicles.length > 0);
  if (other.vehicles.length > 0) result.push(other);

  // Smallest passenger capacity first within each section; unknown capacity goes last
  result.forEach(g => g.vehicles.sort((a, b) => {
    const ca = parseInt(a.capacity, 10);
    const cb = parseInt(b.capacity, 10);
    return (isNaN(ca) ? Infinity : ca) - (isNaN(cb) ? Infinity : cb);
  }));

  return result;
}

function cardHtml(v) {
  const title = vehicleTitle(v);
  const urls  = (v.pics || '').split('|').map(u => u.trim()).filter(Boolean);

  let imgHtml;
  if (urls.length === 0) {
    imgHtml = `<img src="css/placeholder.svg" alt="No image" class="card-img-placeholder">`;
  } else if (urls.length === 1) {
    imgHtml = `<img src="${escHtml(urls[0])}" alt="${escHtml(title)}" loading="lazy" onerror="this.src='css/placeholder.svg'">`;
  } else {
    imgHtml = `
      <div class="carousel-track">
        ${urls.map((u, i) => `<div class="carousel-slide"><img src="${escHtml(u)}" alt="${escHtml(title)} — photo ${i + 1}" loading="lazy" onerror="this.src='css/placeholder.svg'"></div>`).join('')}
      </div>
      <button type="button" class="carousel-btn carousel-prev" aria-label="Previous photo">&#8249;</button>
      <button type="button" class="carousel-btn carousel-next" aria-label="Next photo">&#8250;</button>
      <div class="carousel-dots">
        ${urls.map((_, i) => `<span class="carousel-dot${i === 0 ? ' active' : ''}"></span>`).join('')}
      </div>`;
  }

  return `
    <a class="vehicle-card" href="vehicle.html?sn=${encodeURIComponent(v.sn)}">
      <div class="card-image">
        ${imgHtml}
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

document.addEventListener('DOMContentLoaded', init);
