// Packers Pulse fetcher (Node 18+). Writes docs/data.json, docs/digest.html, docs/scores.json.
// Requires: "rss-parser" dependency in package.json.

const fs = require('fs');
const crypto = require('crypto');
const Parser = require('rss-parser');

const parser = new Parser({
  requestOptions: {
    headers: { 'User-Agent': 'PackersPulse/1.0 (+github-actions)' },
    timeout: 20000
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

const NEWS_FEEDS = [
  'https://news.google.com/rss/search?q=Green%20Bay%20Packers&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=Jordan%20Love%20Packers&hl=en-US&gl=US&ceid=US:en',
  'https://news.google.com/rss/search?q=Packers%20trade%20OR%20rumor&hl=en-US&gl=US&ceid=US:en',
  'https://www.bing.com/news/search?q=Green+Bay+Packers&format=rss',
  'https://www.bing.com/news/search?q=Jordan+Love+Packers&format=rss',
  'https://news.search.yahoo.com/rss?p=Green+Bay+Packers',
  'https://www.packers.com/rss/news',
  'https://www.acmepackingcompany.com/rss/index.xml'
];

const REDDIT_FEEDS = [
  'https://www.reddit.com/r/GreenBayPackers/.json?limit=50'
];

function hash(s) { return crypto.createHash('sha1').update(String(s || '')).digest('hex'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function safeISO(s) { const d = new Date(s); return isNaN(d) ? new Date().toISOString() : d.toISOString(); }
function escapeHtml(s=''){ return s.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])); }

async function fetchJSON(url, { headers = {}, timeoutMs = 15000, retries = 2, pauseMs = 700 } = {}) {
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

function logSample(prefix, arr, n=3){
  const t = (arr||[]).slice(0,n).map(x => (x.title || x.text || '').slice(0,80));
  console.log(`${prefix} sample:`, t.length ? t : '(none)');
}

async function fetchBluesky(query, limit=15){
  try{
    const u = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
    u.searchParams.set('q', query);
    u.searchParams.set('limit', String(limit));
    const data = await fetchJSON(u.toString(), {
      headers: { 'User-Agent': 'PackersPulse/1.0 (+github-actions)' },
      timeoutMs: 12000
    });
    const posts = Array.isArray(data?.posts) ? data.posts : [];
    const mapped = posts.map(p=>{
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
    logSample(`Bluesky("${query}")`, mapped);
    return mapped;
  }catch(e){
    console.log('Bluesky error:', e?.message||e);
    return [];
  }
}

async function fetchRss(url){
  try{
    const feed = await parser.parseURL(url);
    const mapped = (feed.items||[]).map(it=>({
      source: 'News',
      source_id: it.link || it.guid || hash(it.title||''),
      author: String(it.creator || it.source || ''),
      title: it.title || '',
      text: it.contentSnippet || it.content || '',
      url: it.link || '',
      created_at: safeISO(it.isoDate || it.pubDate || NOW.toISOString()),
      score: 1.25
    }));
    logSample(`RSS(${url.split('/')[2]})`, mapped);
    return mapped;
  }catch(e){
    console.log('RSS error:', url, e?.message||e);
    return [];
  }
}

async function fetchReddit(url){
  try{
    const data = await fetchJSON(url, {
      headers: { 'User-Agent': 'PackersPulse/1.0 (github-actions)' },
      timeoutMs: 12000
    });
    const mapped = (data?.data?.children||[]).map(c=>c.data).map(d=>({
      source: 'Reddit',
      source_id: d?.id || hash(d?.title||''),
      author: d?.author || '',
      title: d?.title || '',
      text: d?.selftext || '',
      url: d?.url || (d?.permalink ? `https://www.reddit.com${d.permalink}` : ''),
      created_at: safeISO(d?.created_utc ? new Date(d.created_utc*1000).toISOString() : NOW.toISOString()),
      score: 1.1
    }));
    logSample('Reddit', mapped);
    return mapped;
  }catch(e){
    console.log('Reddit error:', e?.message||e);
    return [];
  }
}

// ESPN NFL scoreboard → Packers only, LIVE + last 3
async function fetchScores(){
  try{
    const sb = await fetchJSON(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      { headers: { 'User-Agent':'PackersPulse/1.0 (+github-actions)' }, timeoutMs: 15000 }
    );
    const events = Array.isArray(sb?.events) ? sb.events : [];
    let games = [];
    for (const ev of events){
      const comp = (ev?.competitions||[])[0];
      if (!comp) continue;
      const cTeams = (comp.competitors||[]).map(x=>({
        name: x?.team?.displayName || '',
        abbr: x?.team?.abbreviation || '',
        score: x?.score ?? '',
        homeAway: x?.homeAway || ''
      }));
      // IMPORTANT: use || (not "or")
      const isPackers = cTeams.some(t => t.name === 'Green Bay Packers' || t.abbr === 'GB');
      if (!isPackers) continue;

      const status = comp?.status?.type?.state || ev?.status?.type?.state || '';
      const shortDetail = comp?.status?.type?.shortDetail || '';
      const date = ev?.date || comp?.date || new Date().toISOString();
      const away = cTeams.find(t => t.homeAway === 'away') || { abbr:'?', score:'' };
      const home = cTeams.find(t => t.homeAway === 'home') || { abbr:'?', score:'' };
      const label = `${away.abbr} ${away.score} @ ${home.abbr} ${home.score}${shortDetail ? ' • '+shortDetail : ''}`;
      games.push({ label, live: status === 'in', date });
    }
    games.sort((a,b)=> (b.live?1:0)-(a.live?1:0) || new Date(b.date)-new Date(a.date));
    if (games.length>4) games = games.slice(0,4);
    return { updated_at: new Date().toISOString(), games };
  }catch(e){
    console.log('Scores error:', e?.message||e);
    return { updated_at: new Date().toISOString(), games: [] };
  }
}

function normalize(items){
  const seen = new Set();
  const out = [];
  for (const it of items){
    if (!it) continue;
    const key = (it.url||'').split('?')[0] || hash((it.title||'') + '|' + (it.text||''));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  for (const it of out){
    const age = NOW - new Date(it.created_at);
    const recency = Math.max(0, 1 - age/DAY_MS);
    it.score = (it.score||1) + recency;
  }
  out.sort((a,b)=> (b.score||0)-(a.score||0) || new Date(b.created_at)-new Date(a.created_at));
  return out;
}

function buildDigest(items){
  const top = items.slice(0,10);
  if (!top.length) return '<p>No new items yet. Check back after the next update.</p>';
  const first = top[0].title || (top[0].text||'').slice(0,120) || 'multiple developing items';
  const bullets = top.slice(0,8).map(it=>`• ${escapeHtml(it.title || (it.text||'').slice(0,120))} (${it.source})`).join(' ');
  return `<p>Packers buzz in the last day centers on ${escapeHtml(first)}.</p><p>Highlights: ${bullets}</p><p>Merged Bluesky, News, and Reddit; ranked by recency + relevance.</p>`;
}

function readPrevious(){
  try{
    const raw = fs.readFileSync('docs/data.json','utf8');
    return JSON.parse(raw);
  }catch{ return null; }
}

async function main(){
  let items = [];
  let b=0, rss=0, rd=0;

  for (const q of QUERIES){
    const chunk = await fetchBluesky(q, 15);
    b += chunk.length; items.push(...chunk);
    await sleep(600);
  }
  for (const url of NEWS_FEEDS){
    const chunk = await fetchRss(url);
    rss += chunk.length; items.push(...chunk);
  }
  for (const url of REDDIT_FEEDS){
    const chunk = await fetchReddit(url);
    rd += chunk.length; items.push(...chunk);
  }

  console.log(`Counts → Bluesky: ${b} • RSS: ${rss} • Reddit: ${rd}`);

  const merged = normalize(items);
  if (merged.length === 0){
    const prev = readPrevious();
    if (prev?.items?.length){
      console.log(`All sources empty; preserving previous ${prev.items.length} items.`);
      fs.writeFileSync('docs/data.json', JSON.stringify(prev, null, 2));
      fs.writeFileSync('docs/digest.html', buildDigest(prev.items));
    } else {
      const data = { generated_at: new Date().toISOString(), items: [] };
      fs.writeFileSync('docs/data.json', JSON.stringify(data, null, 2));
      fs.writeFileSync('docs/digest.html', buildDigest([]));
    }
  } else {
    const data = { generated_at: new Date().toISOString(), items: merged };
    fs.writeFileSync('docs/data.json', JSON.stringify(data, null, 2));
    fs.writeFileSync('docs/digest.html', buildDigest(merged));
    console.log(`Wrote ${merged.length} items at ${data.generated_at}`);
  }

  const scores = await fetchScores();
  fs.writeFileSync('docs/scores.json', JSON.stringify(scores, null, 2));
  console.log(`Scores: ${scores.games.length} item(s)`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
