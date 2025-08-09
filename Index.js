// ESPN NFL scoreboard (no key). Filter Packers, keep LIVE + last 3 most recent.
async function fetchScores() {
  try {
    const sb = await fetchJSON(
      'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard',
      { headers: { 'User-Agent': 'PackersPulse/1.0 (+github-actions)' }, timeoutMs: 15000 }
    );

    const events = Array.isArray(sb?.events) ? sb.events : [];
    let games = [];

    for (const ev of events) {
      const comp = (ev?.competitions || [])[0];
      if (!comp) continue;

      const cTeams = (comp.competitors || []).map(x => ({
        name: x?.team?.displayName || '',
        abbr: x?.team?.abbreviation || '',
        score: x?.score ?? '',
        homeAway: x?.homeAway || ''
      }));

      // ✅ JS uses || (not "or")
    const isPackers = cTeams.some(t => t.name === 'Green Bay Packers' || t.abbr === 'GB');
      if (!isPackers) continue;

      const status = comp?.status?.type?.state || ev?.status?.type?.state || '';
      const shortDetail = comp?.status?.type?.shortDetail || '';
      const date = ev?.date || comp?.date || new Date().toISOString();

      const away = cTeams.find(t => t.homeAway === 'away') || { abbr: '?', score: '' };
      const home = cTeams.find(t => t.homeAway === 'home') || { abbr: '?', score: '' };

      const label = `${away.abbr} ${away.score} @ ${home.abbr} ${home.score}${shortDetail ? ' • ' + shortDetail : ''}`;
      games.push({ label, live: status === 'in', date });
    }

    // Sort: LIVE first, then newest
    games.sort((a, b) => (b.live ? 1 : 0) - (a.live ? 1 : 0) || new Date(b.date) - new Date(a.date));

    // Keep 4 (LIVE counts as one of the four)
    if (games.length > 4) games = games.slice(0, 4);

    return { updated_at: new Date().toISOString(), games };
  } catch (e) {
    console.log('Scores error:', e?.message || e);
    return { updated_at: new Date().toISOString(), games: [] };
  }
}
