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
    types: ['standard', 'multipurpose', 'van', 'bus', 'coach', 'minibus', 'mini bus', 'shuttle'],
  },
  {
    id:    'limos-suvs',
    title: 'Stretch Limos, SUVs & Exotics',
    types: ['limo', 'limousine', 'suv', 'jet', 'exotic', 'stretch', 'luxury'],
  },
];

let allVehicles = [];

async function init() {
  const loading    = document.getElementById('loading');
  const emptyState = document.getElementById('empty-state');
  const container  = document.getElementById('sections-container');
  const searchInput = document.getElementById('search');
  const countEl    = document.getElementById('count');

  try {
    allVehicles = await fetchVehicles();
  } catch (err) {
    loading.innerHTML = `<div class="alert alert-error">Could not load vehicles: ${escHtml(err.message)}<br>Check your API key and Sheet ID in config.js.</div>`;
    return;
  }

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
      return;
    }
    emptyState.style.display = 'none';
    countEl.textContent = `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}`;

    const groups = groupVehicles(vehicles);

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
  }
}

function groupVehicles(vehicles) {
  const groups = SECTIONS.map(s => ({ ...s, vehicles: [] }));
  const other  = { id: 'other', title: 'Other Vehicles', vehicles: [] };

  vehicles.forEach(v => {
    const type    = (v.type || '').toLowerCase().trim();
    const matched = groups.find(g =>
      g.types.some(t => type === t || type.includes(t) || t.includes(type))
    );
    (matched || other).vehicles.push(v);
  });

  const result = groups.filter(g => g.vehicles.length > 0);
  if (other.vehicles.length > 0) result.push(other);
  return result;
}

function cardHtml(v) {
  const title    = vehicleTitle(v);
  const firstPic = (v.pics || '').split('|')[0].trim();
  const imgHtml  = firstPic
    ? `<img src="${escHtml(firstPic)}" alt="${escHtml(title)}" loading="lazy" onerror="this.src='css/placeholder.svg'">`
    : `<img src="css/placeholder.svg" alt="No image" class="card-img-placeholder">`;

  return `
    <a class="vehicle-card" href="vehicle.html?sn=${encodeURIComponent(v.sn)}">
      <div class="card-image">
        ${imgHtml}
        ${v.type ? `<span class="type-badge">${escHtml(v.type)}</span>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title">${escHtml(title)}</div>
        <div class="card-meta">
          ${v.capacity ? `<span class="card-meta-item">👥 ${escHtml(v.capacity)} pax</span>`      : ''}
          ${v.luggage  ? `<span class="card-meta-item">🧳 Luggage: ${escHtml(v.luggage)}</span>` : ''}
        </div>
      </div>
    </a>`;
}

document.addEventListener('DOMContentLoaded', init);