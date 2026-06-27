async function init() {
  const sn = new URLSearchParams(window.location.search).get('sn');

  if (!sn) { showError('No vehicle ID in URL.'); return; }

  try {
    const vehicles = await fetchVehicles();
    const vehicle  = vehicles.find(v => v.sn === sn);
    if (!vehicle) { showError('Vehicle not found. It may have been removed or the link may be incorrect.'); return; }
    renderVehicle(vehicle);
  } catch (err) {
    showError(`Failed to load vehicle: ${escHtml(err.message)}`);
  }
}

function renderVehicle(v) {
  const title = vehicleTitle(v);
  document.title = `${title} — Tour Rider`;

  document.getElementById('page-title').textContent   = title;
  document.getElementById('detail-title').textContent = title;

  if (v.type) {
    const badge = document.getElementById('detail-type-badge');
    badge.textContent   = v.type;
    badge.style.display = 'inline-block';
  }

  // Parse pipe-separated image URLs
  const imageUrls = (v.pics || '')
    .split('|')
    .map(u => u.trim())
    .filter(Boolean);

  renderImages(document.getElementById('image-wrap'), imageUrls, title);

  setSpec('spec-make',     v.vehiclemake);
  setSpec('spec-model',    v.model);
  setSpec('spec-type',     v.type);
  setSpec('spec-capacity', v.capacity ? `${v.capacity} passengers` : '');
  setSpec('spec-luggage',  v.luggage);

  document.getElementById('share-btn').addEventListener('click', () => {
    const btn = document.getElementById('share-btn');
    navigator.clipboard.writeText(window.location.href).then(() => {
      btn.textContent = '✓ Link Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = '🔗 Copy Link'; btn.classList.remove('copied'); }, 2000);
    });
  });

  document.getElementById('loading').style.display         = 'none';
  document.getElementById('vehicle-content').style.display = 'block';
}

function renderImages(wrap, urls, title) {
  if (urls.length === 0) {
    const img = document.createElement('img');
    img.src       = 'css/placeholder.svg';
    img.alt       = 'No image available';
    img.className = 'detail-img-placeholder';
    wrap.appendChild(img);
    return;
  }

  if (urls.length === 1) {
    const img   = document.createElement('img');
    img.src     = urls[0];
    img.alt     = title;
    img.onerror = () => { img.src = 'css/placeholder.svg'; };
    wrap.appendChild(img);
    return;
  }

  // ── Multi-image carousel ──────────────────────────────────────
  const track = document.createElement('div');
  track.className = 'carousel-track';

  urls.forEach((url, i) => {
    const slide = document.createElement('div');
    slide.className = 'carousel-slide';
    const img    = document.createElement('img');
    img.src      = url;
    img.alt      = `${title} — photo ${i + 1}`;
    img.loading  = i === 0 ? 'eager' : 'lazy';
    img.onerror  = () => { img.src = 'css/placeholder.svg'; };
    slide.appendChild(img);
    track.appendChild(slide);
  });

  const prevBtn = makeBtn('carousel-btn carousel-prev', '&#8249;', 'Previous photo');
  const nextBtn = makeBtn('carousel-btn carousel-next', '&#8250;', 'Next photo');

  const dotsWrap = document.createElement('div');
  dotsWrap.className = 'carousel-dots';
  const dots = urls.map((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
    dotsWrap.appendChild(dot);
    return dot;
  });

  let current = 0;

  function goTo(index) {
    current = Math.max(0, Math.min(index, urls.length - 1));
    track.scrollTo({ left: current * track.offsetWidth, behavior: 'smooth' });
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
  }

  // Dot clicks
  dots.forEach((dot, i) => dot.addEventListener('click', () => goTo(i)));

  prevBtn.addEventListener('click', () => goTo(current - 1));
  nextBtn.addEventListener('click', () => goTo(current + 1));

  // Sync dots when user swipes
  track.addEventListener('scroll', () => {
    const idx = Math.round(track.scrollLeft / track.offsetWidth);
    if (idx !== current) {
      current = idx;
      dots.forEach((d, i) => d.classList.toggle('active', i === current));
    }
  }, { passive: true });

  wrap.appendChild(track);
  wrap.appendChild(prevBtn);
  wrap.appendChild(nextBtn);
  wrap.appendChild(dotsWrap);
}

function makeBtn(className, html, label) {
  const btn = document.createElement('button');
  btn.className             = className;
  btn.innerHTML             = html;
  btn.setAttribute('aria-label', label);
  return btn;
}

function setSpec(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value || '—';
}

function showError(msg) {
  document.getElementById('loading').style.display      = 'none';
  document.getElementById('error-state').style.display  = 'block';
  document.getElementById('error-msg').innerHTML        = msg;
}

document.addEventListener('DOMContentLoaded', init);