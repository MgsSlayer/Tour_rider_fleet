// Shared photo lightbox. Needs the #lightbox markup and the .lightbox styles
// from styles.css; used by the vehicle detail page and the admin dashboard.

let lightboxShow = null;

function initLightbox() {
  const lightbox = document.getElementById('lightbox');
  const closeBtn  = document.getElementById('lightbox-close');
  const prevBtn   = document.getElementById('lightbox-prev');
  const nextBtn   = document.getElementById('lightbox-next');

  closeBtn.addEventListener('click', closeLightbox);
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });
  prevBtn.addEventListener('click', () => lightboxShow && lightboxShow(-1));
  nextBtn.addEventListener('click', () => lightboxShow && lightboxShow(1));

  document.addEventListener('keydown', e => {
    if (!lightbox.classList.contains('open')) return;
    if (e.key === 'Escape')     closeLightbox();
    if (e.key === 'ArrowLeft')  lightboxShow && lightboxShow(-1);
    if (e.key === 'ArrowRight') lightboxShow && lightboxShow(1);
  });
}

function openLightbox(urls, title, startIndex) {
  const lightbox = document.getElementById('lightbox');
  const img       = document.getElementById('lightbox-img');
  const prevBtn   = document.getElementById('lightbox-prev');
  const nextBtn   = document.getElementById('lightbox-next');
  const dotsWrap  = document.getElementById('lightbox-dots');

  const multi = urls.length > 1;
  prevBtn.style.display  = multi ? 'flex' : 'none';
  nextBtn.style.display  = multi ? 'flex' : 'none';
  dotsWrap.style.display = multi ? 'flex' : 'none';

  dotsWrap.innerHTML = '';
  const dots = urls.map((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'carousel-dot';
    dot.addEventListener('click', () => show(i, true));
    dotsWrap.appendChild(dot);
    return dot;
  });

  let current = startIndex;

  function show(index, absolute) {
    current = Math.max(0, Math.min(absolute ? index : current + index, urls.length - 1));
    img.src = urls[current];
    img.alt = `${title} — photo ${current + 1}`;
    dots.forEach((d, i) => d.classList.toggle('active', i === current));
  }

  lightboxShow = delta => show(delta, false);
  show(startIndex, true);

  lightbox.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.body.style.overflow = '';
  lightboxShow = null;
}