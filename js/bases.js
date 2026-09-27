// Base locations — the yards repositioning is measured from.
// Auth and the api() helper come from requests.js, loaded before this file.

let editingBaseId = null;

async function loadBases() {
  const list = document.getElementById('bases-list');
  if (!list) return;
  list.innerHTML = '<div class="state-msg">Loading…</div>';

  try {
    const { bases } = await api('/api/bases');
    if (!bases.length) {
      list.innerHTML = '<div class="state-msg">No bases saved. Add one above, '
        + 'without any, no repositioning fee is ever applied.</div>';
      return;
    }
    list.innerHTML = bases.map(b => `
      <div class="base-row" data-id="${b._id}">
        <div>
          <div class="base-label">${esc(b.label)}</div>
          <div class="base-address">${esc(b.address)}</div>
        </div>
        <div class="base-actions">
          <button type="button" class="base-edit">Edit</button>
          <button type="button" class="base-delete">Remove</button>
        </div>
      </div>`).join('');

    list.querySelectorAll('.base-row').forEach(row => {
      const b = bases.find(x => x._id === row.dataset.id);
      row.querySelector('.base-edit').addEventListener('click', () => startEdit(b));
      row.querySelector('.base-delete').addEventListener('click', () => removeBase(b));
    });
  } catch (err) {
    list.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function basesMsg(text, kind = 'ok') {
  const el = document.getElementById('bases-msg');
  el.innerHTML = text ? `<div class="alert alert-${kind}">${esc(text)}</div>` : '';
}

function startEdit(base) {
  editingBaseId = base._id;
  document.getElementById('base-label').value = base.label;
  document.getElementById('base-address').value = base.address;
  document.getElementById('base-save').textContent = 'Save changes';
  document.getElementById('base-cancel').style.display = 'inline-block';
  document.getElementById('base-label').focus();
}

function resetBaseForm() {
  editingBaseId = null;
  document.getElementById('base-form').reset();
  document.getElementById('base-save').textContent = 'Add base';
  document.getElementById('base-cancel').style.display = 'none';
}

async function removeBase(base) {
  const confirmed = await openModal({
    title: 'Remove this base?',
    message: `"${base.label}" will no longer be used when working out repositioning.`,
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!confirmed) return;

  try {
    await api(`/api/bases/${base._id}`, { method: 'DELETE' });
    basesMsg(`Removed ${base.label}.`);
    loadBases();
  } catch (err) {
    basesMsg(err.message, 'error');
  }
}

async function onBaseSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('base-save');
  const body = JSON.stringify({
    label: document.getElementById('base-label').value.trim(),
    address: document.getElementById('base-address').value.trim(),
  });

  btn.disabled = true;
  try {
    if (editingBaseId) await api(`/api/bases/${editingBaseId}`, { method: 'PATCH', body });
    else await api('/api/bases', { method: 'POST', body });
    basesMsg(editingBaseId ? 'Base updated.' : 'Base added.');
    resetBaseForm();
    loadBases();
  } catch (err) {
    basesMsg(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('base-form');
  if (!form) return;
  form.addEventListener('submit', onBaseSubmit);
  document.getElementById('base-cancel').addEventListener('click', resetBaseForm);

  // Load the Maps SDK only when the Bases tab is actually opened, rather than on
  // every dashboard visit. Not a billing concern (maps bill per map, not per
  // script) but there is no reason to fetch it for admins who never come here.
  let placesReady = false;
  document.querySelectorAll('.side-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.pane === 'pane-bases' && !placesReady) {
        placesReady = true;
        initAddressAutocomplete(['base-address']);
      }
    });
  });

  // load lazily, the first time the tab is opened
  let loaded = false;
  document.querySelectorAll('.side-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      if (tab.dataset.pane === 'pane-bases' && !loaded) { loaded = true; loadBases(); }
    });
  });
});
