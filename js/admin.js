// ── Auth ────────────────────────────────────────────────────────────────────

function checkAuth() {
  if (sessionStorage.getItem('adminAuth') === CONFIG.ADMIN_PASSWORD) {
    showPanel();
  } else {
    document.getElementById('auth-gate').style.display   = 'block';
    document.getElementById('admin-panel').style.display = 'none';
  }
}

document.getElementById('auth-form').addEventListener('submit', e => {
  e.preventDefault();
  const pw = document.getElementById('password-input').value;
  if (pw === CONFIG.ADMIN_PASSWORD) {
    sessionStorage.setItem('adminAuth', pw);
    showPanel();
  } else {
    document.getElementById('auth-error').style.display = 'flex';
    document.getElementById('password-input').value = '';
    document.getElementById('password-input').focus();
  }
});

document.getElementById('logout-btn').addEventListener('click', () => {
  sessionStorage.removeItem('adminAuth');
  location.reload();
});

function showPanel() {
  document.getElementById('auth-gate').style.display   = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  document.getElementById('logout-btn').style.display  = 'block';
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// ── Add Vehicle Form ─────────────────────────────────────────────────────────

document.getElementById('add-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn     = document.getElementById('add-submit-btn');
  const alertEl = document.getElementById('add-alert');

  btn.disabled    = true;
  btn.textContent = 'Saving…';
  alertEl.style.display = 'none';

  const fd = new FormData(e.target);
  const vehicle = {
    sn:          fd.get('sn') || generateSN(),
    vehiclemake: fd.get('vehiclemake'),
    model:       fd.get('model'),
    year:        fd.get('year'),
    capacity:    fd.get('capacity'),
    luggage:     fd.get('luggage'),
    type:        fd.get('type'),
    affprice:    fd.get('affprice'),
    retprice:    fd.get('retprice'),
    pics:        fd.get('pics'),
  };

  try {
    await saveVehicles([vehicle]);
    showAlert(alertEl, 'success', `Vehicle added (S/N: ${vehicle.sn}). It will appear on the site within a few seconds.`);
    e.target.reset();
  } catch (err) {
    showAlert(alertEl, 'error', `Failed to save: ${err.message}`);
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Add Vehicle';
  }
});

// ── Bulk Upload ───────────────────────────────────────────────────────────────

let pendingVehicles = [];

const dropZone  = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  const file = e.dataTransfer.files[0];
  if (file) handleFile(file);
});
fileInput.addEventListener('change', e => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

async function handleFile(file) {
  const alertEl = document.getElementById('upload-alert');
  alertEl.style.display = 'none';
  document.getElementById('preview-wrap').style.display = 'none';
  pendingVehicles = [];
  document.getElementById('upload-btn').disabled = true;

  try {
    const rows = await parseFile(file);
    if (rows.length === 0) throw new Error('No data rows found — check the file has a header row and data rows below it.');

    // Auto-assign S/N if missing
    let counter = Date.now();
    pendingVehicles = rows.map(r => ({
      ...r,
      sn: r.sn || String(counter++),
    }));

    renderPreview(pendingVehicles);
    showAlert(alertEl, 'info', `Found ${pendingVehicles.length} vehicle${pendingVehicles.length !== 1 ? 's' : ''}. Review below then click "Upload".`);
  } catch (err) {
    showAlert(alertEl, 'error', `Parse error: ${err.message}`);
  }
}

function parseFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'csv') {
      const reader = new FileReader();
      reader.onload  = e => { try { resolve(parseRows(csvToRows(e.target.result))); } catch(err) { reject(err); } };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsText(file);

    } else if (['xlsx', 'xls'].includes(ext)) {
      if (typeof XLSX === 'undefined') { reject(new Error('Excel library not loaded. Refresh and try again.')); return; }
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const wb   = XLSX.read(e.target.result, { type: 'array' });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
          resolve(parseRows(data));
        } catch(err) { reject(err); }
      };
      reader.onerror = () => reject(new Error('Could not read file.'));
      reader.readAsArrayBuffer(file);

    } else {
      reject(new Error('Unsupported format — please upload a .csv or .xlsx file.'));
    }
  });
}

function csvToRows(text) {
  return text.split(/\r?\n/).filter(l => l.trim()).map(line => {
    const cells = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"')            { inQ = !inQ; }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = ''; }
      else                       { cur += ch; }
    }
    cells.push(cur.trim());
    return cells;
  });
}

function parseRows(rows) {
  if (rows.length < 2) return [];
  const headerMap = {};
  rows[0].forEach((h, i) => {
    // Same normalisation as sheets.js: lowercase, strip non-alphanumeric
    const key = String(h || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    headerMap[key] = i;
  });
  return rows.slice(1)
    .filter(row => row.some(c => String(c || '').trim()))
    .map(row => normalizeRow(row.map(c => String(c || '')), headerMap));
}

function renderPreview(vehicles) {
  document.getElementById('preview-count').textContent = `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}`;

  const tbody = document.getElementById('preview-tbody');
  tbody.innerHTML = vehicles.map(v => {
    const ok = v.vehiclemake && v.model;
    return `<tr class="${ok ? '' : 'row-error'}">
      <td>${escHtml(v.sn)}</td>
      <td>${escHtml(v.vehiclemake || '⚠ Missing')}</td>
      <td>${escHtml(v.model || '⚠ Missing')}</td>
      <td>${escHtml(v.type)}</td>
      <td>${escHtml(v.affprice)}</td>
      <td>${escHtml(v.retprice)}</td>
    </tr>`;
  }).join('');

  document.getElementById('preview-wrap').style.display  = 'block';
  document.getElementById('upload-btn').disabled = vehicles.length === 0;
}

document.getElementById('upload-btn').addEventListener('click', async () => {
  if (!pendingVehicles.length) return;

  const btn     = document.getElementById('upload-btn');
  const alertEl = document.getElementById('upload-alert');

  btn.disabled    = true;
  btn.textContent = 'Uploading…';

  try {
    await saveVehicles(pendingVehicles);
    showAlert(alertEl, 'success', `${pendingVehicles.length} vehicle${pendingVehicles.length !== 1 ? 's' : ''} uploaded! They will appear on the site within a few seconds.`);
    pendingVehicles = [];
    document.getElementById('preview-wrap').style.display = 'none';
    fileInput.value = '';
  } catch (err) {
    showAlert(alertEl, 'error', `Upload failed: ${err.message}`);
    btn.disabled = false;
  } finally {
    btn.textContent = 'Upload Vehicles';
  }
});

// CSV template download
document.getElementById('template-link').addEventListener('click', () => {
  const csv = [
    'S/N,Vehicle Make,Model,Year,Capacity,Luggage,Type,Aff. Price,Ret. Price,Pics',
    '1,Ford,E450,,15,Yes,Party Bus,180,200,https://example.com/photo.jpg',
    '2,Mercedes,Sprinter,2022,12,Yes,Luxury Van,250,300,https://example.com/photo2.jpg',
  ].join('\n');
  const a   = document.createElement('a');
  a.href    = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = 'vehicle-template.csv';
  a.click();
  URL.revokeObjectURL(a.href);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function showAlert(el, type, message) {
  el.className     = `alert alert-${type}`;
  el.textContent   = message;
  el.style.display = 'flex';
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

document.addEventListener('DOMContentLoaded', checkAuth);