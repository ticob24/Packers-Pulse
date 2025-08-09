// Packers Pulse fetcher (Node 18+, CommonJS).
// If all sources return 0 items, we PRESERVE the previous docs/data.json instead of overwriting with empty.

const fs = require('fs');
const crypto = require('crypto');
const Parser = require('rss-parser');

const parser = new Parser({
  requestOptions: {
    headers: { 'User-Agent': 'PackersPulse/1.0 (+github-actions)' },
    timeout: 15000
  }
});

const NOW = new Date();
const DAY_MS = 24 * 3600 * 1000;

const QUERIES = [
  'Green Bay Packers',
  'Packers trade OR rumor',
  'Jordan Love',
  'Brian Gutekunst',
  'Matt LaFleur',
  '#GoPackGo'
];

const RSS_FEEDS = [
  'https://news.google.com/rss/search?q=Green%20Bay%20Packers&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=Packers%20trade&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=Jordan%20Love%20Packers&hl=en-US&gl=US&ceid=US:en'
];

const REDDIT_FEEDS = [
  'https://www.reddit.com/r/GreenBayPackers/.json?limit=50'
];

function hash(s) { return crypto.createHash('sha1').update(String(s||'')).digest('hex'); }
function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function fetchJSON(url, { headers = {}, timeoutMs = 15000, retries = 2, pauseMs = 900 } = {}) {
  let lastErr;
  for (let i=0;i<=retries;i++){
    try{
      const ctrl = new AbortController();
      const t = setTimeout(()=>ctrl.abort(), timeoutMs);
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    }catch(e){
      lastErr = e;
      if (i<retries) await sleep(pauseMs);
    }
  }
  throw lastErr;
}

function safeISO(s){
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

async function fetchBluesky(query, limit=20){
  const u = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
  u.searchParams.set('q', query);
  u.searchParams.set('limit', String(limit));
  const data = await fetchJSON(u.toString(), {
    headers: { 'User-Agent': 'PackersPulse/1.0 (+github-actions)' },
    timeoutMs: 12000
  });
  const posts = Array.isArray(data?.posts) ? data.posts : [];
  return posts.map(p=>{
    const text = p?.record?.text || '';
    const handle = p?.author?.handle || '';
    const postId = (p?.uri||'').split('/').pop() || '';
    return {
      source: 'Bluesky',
      source_id: p?.uri || hash(text),
      author: handle,
      title: text.slice(0,120),
      text,
      url: handle && postId ? `https://bsky.app/profile/${handle}/post/${postId}` : '',
      created_at: safeISO(p?.indexedAt),
      score: 1.0
    };
  });
}

async function fetchRss(url){
  const feed = await parser.parseURL(url);
  return (feed.items||[]).map(it=>({
    source: 'GoogleNews',
    source_id: it.link || it.guid || hash(it.title||''),
    author: String(it.creator || it.source || ''),
    title: it.title || '',
    text: it.contentSnippet || '',
    url: it.link || '',
    created_at: safeISO(it.isoDate || it.pubDate || NOW.toISOString()),
    score: 1.2
  }));
}

async function fetchReddit(url){
  const data = await fetchJSON(url, {
    headers: { 'User-Agent': 'PackersPulse/1.0 (github actions)' },
    timeoutMs: 12000
  });
  return (data?.data?.children||[]).map(c=>c.data).map(d=>({
    source: 'Reddit',
    source_id: d?.id || hash(d?.title||''),
    author: d?.author || '',
    title: d?.title || '',
    text: d?.selftext || '',
    url: d?.url || (d?.permalink ? `https://www.reddit.com${d.permalink}` : ''),
    created_at: safeISO(d?.created_utc ? new Date(d.created_utc*1000).toISOString() : NOW.toISOString()),
    score: 1.1
  }));
}

function normalize(items){
  const seen = new Set();
  const out = [];
  for (const it of items){
    if (!it) continue;
    const urlKey = (it.url||'').split('?')[0];
    const key = urlKey || hash((it.title||'') + '|' + (it.text||''));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  for (const it of out){
    const age = NOW - new Date(it.created_at);
    const recency = Math.max(0, 1 - age/DAY_MS);
    it.score = (it.score || 1) + recency;
  }
  out.sort((a,b)=> (b.score||0) - (a.score||0) || new Date(b.created_at) - new Date(a.created_at));
  return out;
}

function escapeHtml(s=''){ return s.replace(/[&<>]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }
function buildDigest(items){
  const top = items.slice(0,10);
  if (!top.length) return '<p>No new items yet. Check back after the next update.</p>';
  const firstTitle = top[0].title || (top[0].text ? top[0].text.slice(0,120) : 'multiple developing items');
  const bullets = top.slice(0,8).map(it=>`• ${escapeHtml(it.title || (it.text||'').slice(0,120))} (${it.source})`).join(' ');
  return `<p>Packers buzz in the last day centers on ${escapeHtml(firstTitle)}.</p><p>Highlights: ${bullets}</p><p>This feed merges Bluesky, Google News, and Reddit and ranks by recency + relevance.</p>`;
}

function readPrevious(){
  try{
    const raw = fs.readFileSync('docs/data.json','utf8');
    return JSON.parse(raw);
  }catch{ return null; }
}

async function main(){
  let items = [];
  let b=0,rss=0,rd=0;

  for (const q of QUERIES){
    try{
      const chunk = await fetchBluesky(q, 15);
      b += chunk.length;
      items.push(...chunk);
      await sleep(900);
    }catch(e){ console.log('Bluesky error:', e?.message||e); }
  }

  for (const url of RSS_FEEDS){
    try{
      const chunk = await fetchRss(url);
      rss += chunk.length;
      items.push(...chunk);
    }catch(e){ console.log('RSS error:', e?.message||e); }
  }

  for (const url of REDDIT_FEEDS){
    try{
      const chunk = await fetchReddit(url);
      rd += chunk.length;
      items.push(...chunk);
    }catch(e){ console.log('Reddit error:', e?.message||e); }
  }

  console.log(`Counts → Bluesky: ${b} • RSS: ${rss} • Reddit: ${rd}`);

  const merged = normalize(items);

  if (merged.length === 0){
    const prev = readPrevious();
    if (prev && Array.isArray(prev.items) && prev.items.length){
      console.log(`All sources empty; preserving previous ${prev.items.length} items.`);
      fs.writeFileSync('docs/data.json', JSON.stringify(prev, null, 2));
      fs.writeFileSync('docs/digest.html', buildDigest(prev.items));
      return;
    }
  }

  if (!fs.existsSync('docs')) fs.mkdirSync('docs', { recursive: true });
  const data = { generated_at: new Date().toISOString(), items: merged };
  fs.writeFileSync('docs/data.json', JSON.stringify(data, null, 2));
  fs.writeFileSync('docs/digest.html', buildDigest(merged));
  console.log(`Wrote ${merged.length} items at ${data.generated_at}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
