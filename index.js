// Node 18+ required. Uses global fetch.
// Pulls Bluesky + Google News RSS + Reddit and writes docs/data.json and docs/digest.html

const fs = require('fs');
const crypto = require('crypto');
const Parser = require('rss-parser');
const parser = new Parser();

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

function hash(s) {
  return crypto.createHash('sha1').update(s || '').digest('hex');
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchBluesky(query, limit = 20) {
  const url = new URL('https://public.api.bsky.app/xrpc/app.bsky.feed.searchPosts');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));

  const res = await fetch(url, { headers: { 'User-Agent': 'PackersPulse/1.0' } });
  if (!res.ok) throw new Error(`Bluesky ${res.status}`);
  const data = await res.json();

  return (data.posts || []).map(p => {
    const text = p?.record?.text || '';
    const handle = p?.author?.handle || '';
    const postId = (p?.uri || '').split('/').pop() || '';
    return {
      source: 'Bluesky',
      source_id: p?.uri || '',
      author: handle,
      title: text.slice(0, 120),
      text,
      url: handle && postId ? `https://bsky.app/profile/${handle}/post/${postId}` : '',
      created_at: p?.indexedAt || new Date().toISOString(),
      score: 1.0
    };
  });
}

async function fetchRss(url) {
  const feed = await parser.parseURL(url);
  return (feed.items || []).map(it => ({
    source: 'GoogleNews',
    source_id: it.link || it.guid || hash(it.title),
    author: (it.creator || it.source || '') + '',
    title: it.title || '',
    text: it.contentSnippet || '',
    url: it.link || '',
    created_at: it.isoDate || it.pubDate || new Date().toISOString(),
    score: 1.2
  }));
}

async function fetchReddit(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'PackersPulse/1.0' } });
  if (!res.ok) throw new Error(`Reddit ${res.status}`);
  const data = await res.json();
  return (data?.data?.children || []).map(c => c.data).map(d => ({
    source: 'Reddit',
    source_id: d.id,
    author: d.author,
    title: d.title || '',
    text: d.selftext || '',
    url: d.url || `https://www.reddit.com${d.permalink}`,
    created_at: new Date(d.created_utc * 1000).toISOString(),
    score: 1.1
  }));
}

function normalize(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const key = it.url ? it.url.split('?')[0] : hash((it.title || '') + (it.text || ''));
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  for (const it of out) {
    const age = NOW - new Date(it.created_at);
    const recency = Math.max(0, 1 - age / DAY_MS);
    it.score = (it.score || 1) + recency; // 1..2
  }
  out.sort((a, b) => (b.score || 0) - (a.score || 0) || new Date(b.created_at) - new Date(a.created_at));
  return out;
}

function escapeHtml(s = '') {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function buildDigest(items) {
  const top = items.slice(0, 10);
  if (!top.length) {
    return '<p>No new items yet. Check back after the first hourly update.</p>';
  }
  const firstTitle = top[0].title || top[0].text?.slice(0, 120) || 'multiple developing items';
  const bullets = top.slice(0, 8).map(it => `• ${escapeHtml(it.title || it.text?.slice(0, 120) || '')} (${it.source})`).join(' ');
  const p1 = `Packers buzz in the last day centers on ${escapeHtml(firstTitle)}.`;
  const p2 = bullets ? `Highlights: ${bullets}` : '';
  const p3 = 'This feed merges Bluesky, Google News, and Reddit, removes near-duplicates, and ranks by recency and relevance.';
  return `<p>${p1}</p><p>${p2}</p><p>${p3}</p>`;
}

async function main() {
  let items = [];

  for (const q of QUERIES) {
    try { items.push(...await fetchBluesky(q, 20)); await sleep(600); } catch {}
  }
  for (const u of RSS_FEEDS) {
    try { items.push(...await fetchRss(u)); } catch {}
  }
  for (const u of REDDIT_FEEDS) {
    try { items.push(...await fetchReddit(u)); } catch {}
  }

  const merged = normalize(items);

  const data = { generated_at: new Date().toISOString(), items: merged };
  fs.writeFileSync('docs/data.json', JSON.stringify(data, null, 2));
  fs.writeFileSync('docs/digest.html', buildDigest(merged));

  console.log(`Wrote ${merged.length} items`);
}

main().catch(err => { console.error(err); process.exit(1); });
