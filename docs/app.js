// Register service worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(()=>{}));
}

const feedEl = document.getElementById('feed');
const digestEl = document.getElementById('digestContent');
const updatedEl = document.getElementById('updated');
const qEl = document.getElementById('q');
const clearEl = document.getElementById('clear');

let allItems = [];

async function load() {
  try {
    const [dataRes, digestRes] = await Promise.all([
      fetch('./data.json', { cache: 'no-store' }),
      fetch('./digest.html', { cache: 'no-store' })
    ]);
    const data = await dataRes.json();
    allItems = data.items || [];
    updatedEl.textContent = new Date(data.generated_at).toLocaleString();
    digestEl.innerHTML = await digestRes.text();
    render(allItems);
  } catch (e) {
    digestEl.textContent = 'Failed to load data. Pull to refresh or try again later.';
  }
}

function render(items) {
  const q = (qEl.value || '').toLowerCase();
  const filtered = items.filter(it => !q || (it.text || '').toLowerCase().includes(q) || (it.author||'').toLowerCase().includes(q));
  feedEl.innerHTML = filtered.map(it => `
    <li class="item">
      <div class="meta"><span class="badge">${it.source}</span> • ${new Date(it.created_at).toLocaleString()}</div>
      <a href="${it.url}" target="_blank" rel="noopener">${it.title || (it.text?.slice(0,140) + '...')}</a>
      ${it.text ? `<div>${escapeHtml(it.text)}</div>` : ''}
      <div class="meta">${it.author ? `@${escapeHtml(it.author)} • ` : ''}${it.score ? `score ${it.score.toFixed(1)}` : ''}</div>
    </li>`).join('');
}

function escapeHtml(s) {
  return s.replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

qEl.addEventListener('input', () => render(allItems));
clearEl.addEventListener('click', () => { qEl.value=''; render(allItems); });

load();
