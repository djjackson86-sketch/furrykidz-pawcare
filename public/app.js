// app.js — shared fetch helpers
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong.');
  return data;
}

function toast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function fmtCurrency(n) { return 'R' + Number(n).toFixed(2); }

// Reads a <input type=file> into a base64 data URL for storage/sending to the server.
function fileToBase64(fileInput) {
  return new Promise((resolve) => {
    const file = fileInput.files[0];
    if (!file) return resolve(null);
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });
}

// Treatment status badges: Bravecto/tick&flea lasts ~12 weeks (84 days), deworming ~90 days.
function treatmentStatus(dateStr, validDays) {
  if (!dateStr) return { label: 'No record', cls: 'unknown' };
  const days = (Date.now() - new Date(dateStr).getTime()) / 86400000;
  if (days < 0) return { label: 'Scheduled', cls: 'ok' };
  if (days > validDays) return { label: 'Overdue', cls: 'overdue' };
  if (days > validDays - 14) return { label: 'Due soon', cls: 'due-soon' };
  return { label: 'Up to date', cls: 'ok' };
}

// Mobile table helper: turns every data table into labelled card rows below 760px.
// It runs after dynamic renders too, so admin/customer tables remain readable on phones.
function enhanceResponsiveTables(root = document) {
  root.querySelectorAll('table').forEach((table) => {
    table.classList.add('responsive-table');
    const headers = Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim());
    table.querySelectorAll('tbody tr').forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        const label = headers[i] || (i === tr.children.length - 1 ? 'Actions' : '');
        if (label) td.setAttribute('data-label', label);
      });
    });
  });
}

function installMobileEnhancements() {
  enhanceResponsiveTables();
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((m) => {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1) enhanceResponsiveTables(node);
      });
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installMobileEnhancements);
} else {
  installMobileEnhancements();
}
