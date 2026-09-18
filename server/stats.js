/** 榜单统计：单期与跨期聚合，供 HTML/MD/XLSX 三种报告共用 */

export function enabledDims(config) {
  return (config.dimensions || []).filter(d => d.enabled)
}

export function round1(x) {
  return x == null ? null : Math.round(x * 100) / 100
}

function avgOf(values) {
  const v = values.filter(x => typeof x === 'number' && !Number.isNaN(x))
  if (!v.length) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

export function partStats(part, config) {
  const scoreEntries = Object.entries(part.scores || {}).filter(([, v]) => typeof v === 'number')
  const dims = {}
  for (const d of enabledDims(config)) {
    const ds = (part.dimScores || {})[d.key] || {}
    dims[d.key] = round1(avgOf(Object.values(ds).filter(v => typeof v === 'number')))
  }
  return {
    avg: round1(avgOf(scoreEntries.map(([, v]) => v))),
    dims,
    favCount: (part.favorites || []).length,
    voters: scoreEntries.map(([who]) => who),
    scored: scoreEntries.length > 0
  }
}

export function songTitle(p) {
  const pr = p.parsed || {}
  return pr.song || p.title
}

export function biliLink(session, page) {
  return session.bvid ? `https://www.bilibili.com/video/${session.bvid}/?p=${page}` : ''
}

export function sessionStats(session, config) {
  const parts = session.parts || []
  const active = parts
    .filter(p => !p.skipped)
    .map(p => ({ part: p, ...partStats(p, config) }))
  const ranked = active
    .filter(r => r.scored)
    .sort((a, b) => b.avg - a.avg || b.favCount - a.favCount)

  const dimBoards = enabledDims(config)
    .map(dim => ({
      dim,
      top: ranked
        .filter(r => r.dims[dim.key] != null)
        .sort((a, b) => b.dims[dim.key] - a.dims[dim.key])
        .slice(0, 10)
    }))
    .filter(b => b.top.length > 0)

  const personTops = (config.persons || [])
    .map(person => {
      const mine = ranked.filter(r => typeof r.part.scores?.[person] === 'number')
      return {
        person,
        avgGiven: round1(avgOf(mine.map(r => r.part.scores[person]))),
        top: mine
          .slice()
          .sort(
            (a, b) =>
              b.part.scores[person] - a.part.scores[person] || b.avg - a.avg
          )
          .slice(0, 5)
      }
    })
    .filter(t => t.top.length > 0)

  return {
    ranked,
    unscored: active.filter(r => !r.scored),
    skipped: parts.filter(p => p.skipped),
    dimBoards,
    personTops,
    favorites: ranked.filter(r => r.favCount > 0).sort((a, b) => b.favCount - a.favCount),
    dims: enabledDims(config),
    persons: config.persons || [],
    votedCount: ranked.length,
    totalActive: active.length
  }
}

function normKey(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000／/]/g, '')
}

export function allStats(sessions, config) {
  const map = new Map()
  for (const session of sessions) {
    const st = sessionStats(session, config)
    for (const row of st.ranked) {
      const p = row.part
      const pr = p.parsed || {}
      const key = normKey(pr.song) + '::' + normKey(pr.artist)
      if (!map.has(key)) {
        map.set(key, {
          song: songTitle(p),
          artist: pr.artist || '',
          animeSet: new Set(),
          kind: pr.kind || '',
          scores: [],
          dimScores: {},
          favs: new Set(),
          sources: []
        })
      }
      const e = map.get(key)
      if (pr.anime) e.animeSet.add(pr.anime)
      for (const [who, v] of Object.entries(p.scores || {})) {
        if (typeof v === 'number') e.scores.push(v)
      }
      for (const [dk, dv] of Object.entries(p.dimScores || {})) {
        e.dimScores[dk] = e.dimScores[dk] || []
        for (const v of Object.values(dv)) {
          if (typeof v === 'number') e.dimScores[dk].push(v)
        }
      }
      for (const f of p.favorites || []) e.favs.add(f)
      e.sources.push({ session, part: p })
    }
  }

  const songs = [...map.values()].map(e => ({
    song: e.song,
    artist: e.artist,
    anime: [...e.animeSet],
    kind: e.kind,
    scores: e.scores,
    avg: round1(avgOf(e.scores)),
    voterCount: e.scores.length,
    favCount: e.favs.size,
    favs: [...e.favs],
    dims: Object.fromEntries(
      Object.entries(e.dimScores).map(([k, v]) => [k, round1(avgOf(v))])
    ),
    sources: e.sources
  }))
  const board = songs
    .filter(s => s.avg != null)
    .sort((a, b) => b.avg - a.avg || b.favCount - a.favCount)

  function groupBy(getKeys) {
    const g = new Map()
    for (const s of songs) {
      const keys = getKeys(s).filter(Boolean)
      for (const k of keys) {
        if (!g.has(k)) g.set(k, { name: k, songCount: 0, scores: [], favCount: 0, best: null })
        const e = g.get(k)
        e.songCount += 1
        e.scores.push(...s.scores)
        e.favCount += s.favCount
        if (!e.best || s.avg > e.best.avg) e.best = s
      }
    }
    return [...g.values()]
      .map(e => ({
        name: e.name,
        songCount: e.songCount,
        avg: round1(avgOf(e.scores)),
        favCount: e.favCount,
        best: e.best
      }))
      .sort((a, b) => b.avg - a.avg || b.songCount - a.songCount)
  }

  const reviews = sessions.map(session => ({
    session,
    top3: sessionStats(session, config).ranked.slice(0, 3)
  }))

  return {
    board,
    byArtist: groupBy(s => [s.artist]).slice(0, 15),
    byAnime: groupBy(s => s.anime).slice(0, 15),
    reviews,
    dims: enabledDims(config),
    persons: config.persons || []
  }
}
