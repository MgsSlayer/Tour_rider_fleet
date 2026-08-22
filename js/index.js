// Section definitions — add any type aliases your sheet uses under `types`.
const SECTIONS = [
  {
    id:    'party-buses',
    title: 'Party Buses',
    types: ['party bus', 'partybus', 'party'],
  },
  {
    id:    'vans-buses',
    title: 'Vans, Buses & Coaches',
    types: ['standard', 'multipurpose', 'van', 'bus', 'coach', 'minibus', 'mini bus', 'shuttle', 'sprinter limo', 'jet', 'executive'],
  },
  {
    id:    'limos-suvs',
    title: 'Stretch Limos, SUVs & Exotics',
    types: ['limo', 'limousine', 'suv', 'exotic', 'stretch', 'luxury', 'sedan'],
  },
];

let allVehicles = [];

async function init() {
  const loading    = document.getElementById('loading');
  const emptyState = document.getElementById('empty-state');
  const container  = document.getElementById('sections-container');
  const searchInput = document.getElementById('search');
  const countEl    = document.getElementById('count');
  const sectionJump      = document.getElementById('section-jump');
  const sectionJumpBtn   = document.getElementById('section-jump-btn');
  const sectionJumpLabel = document.getElementById('section-jump-label');
  const sectionJumpList  = document.getElementById('section-jump-list');
  const SECTION_JUMP_PLACEHOLDER = 'Jump to section…';
  const searchBox    = document.getElementById('search-box');
  const searchToggle = document.getElementById('search-toggle');

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

  // Mobile: search collapses to an icon; tapping it expands the input over
  // the section dropdown's space until it's cleared/closed again.
  searchToggle.addEventListener('click', () => {
    searchBox.classList.add('active');
    searchInput.focus();
  });
  searchInput.addEventListener('blur', () => {
    if (!searchInput.value.trim()) searchBox.classList.remove('active');
  });
  searchInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      searchInput.value = '';
      searchInput.blur();
      renderSections(allVehicles);
    }
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

  sectionJumpBtn.addEventListener('click', () => {
    const open = sectionJump.classList.toggle('open');
    sectionJumpBtn.setAttribute('aria-expanded', open);
  });

  sectionJumpList.addEventListener('click', e => {
    const opt = e.target.closest('.custom-select-option');
    if (!opt) return;
    sectionJump.classList.remove('open');
    sectionJumpBtn.setAttribute('aria-expanded', 'false');
    document.getElementById(opt.dataset.id).scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  document.addEventListener('click', e => {
    if (!sectionJump.contains(e.target)) {
      sectionJump.classList.remove('open');
      sectionJumpBtn.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sectionJump.classList.contains('open')) {
      sectionJump.classList.remove('open');
      sectionJumpBtn.setAttribute('aria-expanded', 'false');
    }
  });

  renderSections(allVehicles);
  searchInput.addEventListener('input', () => {
    const q = searchInput.value.toLowerCase().trim();
    const filtered = q
      ? allVehicles.filter(v =>
          [v.vehiclemake, v.model, v.type, v.year].join(' ').toLowerCase().includes(q))
      : allVehicles;
    renderSections(filtered);
  });

  function renderSections(vehicles) {
    loading.style.display = 'none';
    container.innerHTML   = '';

    if (vehicles.length === 0) {
      emptyState.style.display = 'block';
      countEl.textContent      = '0 vehicles';
      sectionJumpLabel.textContent = SECTION_JUMP_PLACEHOLDER;
      sectionJumpList.innerHTML    = '';
      return;
    }
    emptyState.style.display = 'none';
    countEl.textContent = `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}`;

    const groups = groupVehicles(vehicles);

    sectionJumpLabel.textContent = SECTION_JUMP_PLACEHOLDER;
    sectionJumpList.innerHTML = groups.map(g =>
      `<li class="custom-select-option" role="option" data-id="${g.id}">${escHtml(g.title)}</li>`
    ).join('');

    groups.forEach(group => {
      if (group.vehicles.length === 0) return;

      const section = document.createElement('div');
      section.className = 'vehicle-section';
      section.id        = group.id;

      section.innerHTML = `
        <div class="section-header">
          <span class="section-title-text">${group.title}</span>
          <span class="section-count">${group.vehicles.length}</span>
        </div>
        <div class="vehicle-grid">${group.vehicles.map(cardHtml).join('')}</div>`;

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