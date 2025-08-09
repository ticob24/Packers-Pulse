// Frontend loader with fallbacks (v5)
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
let visibleCount = 5;

async function loadAll() {
  const sources = ['./data.json', './data/merged.json'];
  let data = null, digest = '<p>No digest yet.</p>';

  for (const url of sources) {
    try {
      const res = await fetch(url + '?t=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        const j = await res.json();
        if (j && Array.isArray(j.items)) { data = j; break; }
      }
    } catch {}
  }
  try {
    const d = await fetch('./digest.html?t=' + Date.now(), { cache: 'no-store' });
    if (d.ok) digest = await d.text();
  } catch {}

  if (!data) {
    try {
      const cached = localStorage.getItem('pp_last_data');
      if (cached) data = JSON.parse(cached);
    } catch {}
  }

  if (!data) {
    feedEl.innerHTML = '<li class="item">No data yet — check back soon.</li>';
    return;
  }

  localStorage.setItem('pp_last_data', JSON.stringify(data));
  allItems = data.items || [];
  updatedEl.textContent = new Date(data.generated_at).toLocaleString();
  digestEl.innerHTML = digest;
  applyFilters();
  setupShowMore();

  loadScores(); // after UI mounts
}

function withinRange(d, rangeVal) {
  if (rangeVal === 'all') return true;
  const now = Date.now();
  if (rangeVal === '7d') return (now - d) <= 7*24*3600*1000;
  const hours = Number(rangeVal);
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

  visibleCount = 5;
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

async function loadScoresOnce() {
  try {
    const res = await fetch('./scores.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error('scores ' + res.status);
    const data = await res.json();
    scoresWrap.innerHTML = (data.games||[]).slice(0,4).map(g => `
      <div class="badge" style="padding:6px 10px;border-radius:999px;border:1px solid #d7e2db">
        ${g.live ? '🟢 LIVE ' : ''}${escapeHtml(g.label)}
      </div>`).join('');
    scoresNote.textContent = data.updated_at ? 'Updated ' + new Date(data.updated_at).toLocaleTimeString() : '';
  } catch {
    scoresWrap.innerHTML = '<span class="muted">Scores unavailable</span>';
  }
}
function loadScores(){ loadScoresOnce(); setInterval(loadScoresOnce, 30000); }

loadAll();
