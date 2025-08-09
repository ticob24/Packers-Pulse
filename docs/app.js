// Service worker (v4)
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw-v4.js').catch(()=>{}));
}

const feedEl = document.getElementById('feed');
const digestEl = document.getElementById('digestContent');
const updatedEl = document.getElementById('updated');

const qEl = document.getElementById('q');
const clearEl = document.getElementById('clear');
const timeEl = document.getElementById('timeRange');
const srcEl = document.getElementById('sourceFilter');

const scoresWrap = document.getElementById('scores');
const scoresNote = document.getElementById('scoresNote');

let allItems = [];
let filtered = [];
let visibleCount = 5; // start with 5

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
    applyFilters();
    setupShowMore();
    loadScores(); // start scores polling
  } catch (e) {
    digestEl.textContent = 'Failed to load data. Pull to refresh or try again later.';
  }
}

function withinRange(d, rangeVal) {
  if (rangeVal === 'all') return true;
  const now = Date.now();
  if (rangeVal === '7d') return (now - d) <= 7*24*3600*1000;
  const hours = Number(rangeVal); // '24' or '48'
  return (now - d) <= hours*3600*1000;
}

function applyFilters() {
  const q = (qEl.value || '').toLowerCase();
  const src = srcEl.value;
  const range = timeEl.value;

  filtered = allItems.filter(it => {
    const d = new Date(it.created_at).getTime();
    const matchText = !q || (it.title||'').toLowerCase().includes(q) || (it.text||'').toLowerCase().includes(q) || (it.author||'').toLowerCase().includes(q);
    const matchSrc = (src === 'all') || (it.source === src);
    const matchTime = withinRange(d, range);
    return matchText && matchSrc && matchTime;
  });

  visibleCount = 5; // reset page size whenever filters change
  render();
}

function render() {
  const items = filtered.slice(0, visibleCount);
  feedEl.innerHTML = items.map(toListItem).join('');
  for (const li of feedEl.querySelectorAll('.item')) {
    li.addEventListener('click', () => li.classList.toggle('expanded'));
  }
  renderShowMore();
}

function toListItem(it) {
  const title = it.title || (it.text ? it.text.slice(0, 140) : '(no title)');
  const preview = (it.text || '').slice(0, 160);
  const full = it.text && it.text.length > 160 ? it.text : '';
  return `
    <li class="item">
      <div class="meta"><span class="badge">${it.source}</span> • ${new Date(it.created_at).toLocaleString()}</div>
      <div class="title"><a href="${it.url}" target="_blank" rel="noopener">${escapeHtml(title)}</a></div>
      <div class="more">${escapeHtml(preview)} ${full ? '… Tap to expand' : ''}</div>
      <div class="full">${full ? escapeHtml(full) + '<br><a href="'+it.url+'" target="_blank" rel="noopener">Open link ↗</a>' : ''}</div>
      <div class="meta">${it.author ? '@'+escapeHtml(it.author)+' • ' : ''}${it.score ? 'score '+Number(it.score).toFixed(1) : ''}</div>
    </li>`;
}

function setupShowMore() {
  const container = document.createElement('div');
  container.id = 'moreWrap';
  container.style.textAlign = 'center';
  container.style.marginTop = '8px';
  feedEl.parentElement.appendChild(container);
  renderShowMore();
}

function renderShowMore() {
  const wrap = document.getElementById('moreWrap');
  if (!wrap) return;
  const moreLeft = filtered.length - visibleCount;
  wrap.innerHTML = '';

  if (moreLeft > 0) {
    const btn = document.createElement('button');
    btn.textContent = `Show more (${moreLeft})`
    btn.onclick = () => { visibleCount += 10; render(); };
    wrap.appendChild(btn);
  } else if (filtered.length > 5) {
    const less = document.createElement('button');
    less.textContent = 'Show less';
    less.onclick = () => { visibleCount = 5; render(); };
    wrap.appendChild(less);
  }
}

function escapeHtml(s) { return (s||'').replace(/[&<>]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

qEl?.addEventListener('input', applyFilters);
clearEl?.addEventListener('click', () => { qEl.value=''; srcEl.value='all'; timeEl.value='24'; applyFilters(); });
timeEl?.addEventListener('change', applyFilters);
srcEl?.addEventListener('change', applyFilters);

load();

// ---------- Scores ----------
const WORKER_URL = ''; // paste your Cloudflare Worker URL here when ready
async function loadScoresOnce() {
  try {
    const url = WORKER_URL || './scores.json';
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('scores fetch '+res.status);
    const data = await res.json();
    renderScores(data);
  } catch (e) {
    scoresNote.textContent = 'Scores unavailable';
  }
}
function renderScores(data){
  scoresWrap.innerHTML = (data.games||[]).slice(0,4).map(g => `
    <div class="badge" style="padding:6px 10px;border-radius:999px;border:1px solid #d7e2db">
      ${g.live ? '🟢 LIVE ' : ''}${escapeHtml(g.label)}
    </div>`).join('');
  scoresNote.textContent = data.updated_at ? `Updated ${new Date(data.updated_at).toLocaleTimeString()}` : '';
}
function startScoresPolling(){
  loadScoresOnce();
  setInterval(loadScoresOnce, 30000);
}
function loadScores(){ startScoresPolling(); }
