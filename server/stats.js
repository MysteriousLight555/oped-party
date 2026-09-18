/** 榜单统计：单期与跨期聚合，供 HTML/MD/XLSX 三种报告共用
 *
 * 评分体系：总分是每人的主观总评（独立给出，绝不加权平均）；
 * 维度分只是"参考坐标系"——按权重归一化算出参考分 ref，
 * 反差值 Δ = 主观总评 − ref（正=情怀溢价，负=套路压分），允许并鼓励脱节。
 * 争议指数 = 一首歌所有人总分的标准差，用来一眼定位"吵得最凶"的曲子。
 */

export function enabledDims(config) {
  return (config.dimensions || []).filter(d => d.enabled)
}

export function round1(x) {
  return x == null ? null : Math.round(x * 100) / 100
}

export function round2(x) {
  return x == null ? null : Math.round(x * 100) / 100
}

/** 争议指数的热度线：跨度 1~10 时约 1.62 分起算"吵翻" */
export function hotThreshold(config) {
  const range = (config.scoreMax ?? 10) - (config.scoreMin ?? 1)
  return round2(Math.max(0.8, range * 0.18))
}

function avgOf(values) {
  const v = values.filter(x => typeof x === 'number' && !Number.isNaN(x))
  if (!v.length) return null
  return v.reduce((a, b) => a + b, 0) / v.length
}

function stdOf(values) {
  if (values.length < 2) return 0
  const m = values.reduce((a, b) => a + b, 0) / values.length
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / values.length)
}

/** 维度权重归一化（缺权重按等权处理） */
function dimWeights(dims) {
  const ws = dims.map(d => (typeof d.weight === 'number' && d.weight > 0 ? d.weight : 0))
  const sum = ws.reduce((a, b) => a + b, 0)
  if (sum <= 0) return dims.map(() => 1 / dims.length)
  return ws.map(w => w / sum)
}

/** 维度参考分：有哪项算哪项，权重按已有项重新归一化；一项都没有 → null */
export function refScoreOf(dimValues, dims) {
  const weights = dimWeights(dims)
  const pairs = []
  dims.forEach((d, i) => {
    const v = dimValues[d.key]
    if (typeof v === 'number' && !Number.isNaN(v)) pairs.push([v, weights[i]])
  })
  const wsum = pairs.reduce((a, [, w]) => a + w, 0)
  if (!pairs.length || wsum <= 0) return null
  return pairs.reduce((a, [v, w]) => a + v * (w / wsum), 0)
}

export function partStats(part, config) {
  const dims = enabledDims(config)
  const scoreEntries = Object.entries(part.scores || {}).filter(([, v]) => typeof v === 'number')
  const dimAvg = {}
  for (const d of dims) {
    const ds = (part.dimScores || {})[d.key] || {}
    dimAvg[d.key] = round1(avgOf(Object.values(ds).filter(v => typeof v === 'number')))
  }

  // 每人：主观总评 + 参考分 + 反差值 + 个人标签/短评（报告里的"评价构成"）
  const persons = {}
  const scoreVals = []
  const refVals = []
  const bothScores = []
  for (const [who, v] of scoreEntries) {
    scoreVals.push(v)
    const dv = {}
    for (const d of dims) {
      const x = ((part.dimScores || {})[d.key] || {})[who]
      if (typeof x === 'number') dv[d.key] = x
    }
    const ref = round2(refScoreOf(dv, dims))
    if (ref != null) {
      refVals.push(ref)
      bothScores.push(v)
    }
    persons[who] = {
      score: v,
      ref,
      div: ref != null ? round2(v - ref) : null,
      tags: (part.personTags || {})[who] || [],
      comment: (part.personComments || {})[who] || ''
    }
  }

  const refAvg = round2(avgOf(refVals))
  const divAvg = refAvg != null ? round2(avgOf(bothScores) - refAvg) : null
  const std = round2(stdOf(scoreVals))

  return {
    avg: round1(avgOf(scoreEntries.map(([, v]) => v))),
    refAvg,
    div: divAvg,
    std,
    hot: std > 0 && std >= hotThreshold(config) && scoreEntries.length >= 2,
    persons,
    dims: dimAvg,
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

/** 收集一首曲子的所有标签事件（集体标签一次 + 各人标签各一次），供标签情绪统计 */
export function tagEventsOf(part) {
  const events = []
  for (const t of part.tags || []) events.push(t)
  for (const tags of Object.values(part.personTags || {})) {
    for (const t of tags || []) events.push(t)
  }
  return events
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

  // 争议焦点：按总分标准差排，最少两人打分才有"吵"可言
  const controversial = ranked
    .filter(r => r.std > 0 && r.voters.length >= 2)
    .sort((a, b) => b.std - a.std)
    .slice(0, 8)

  // 反差榜：主观总评与维度参考分脱节最远的曲子
  const withDiv = ranked.filter(r => r.div != null)
  const premiums = withDiv.filter(r => r.div > 0).sort((a, b) => b.div - a.div).slice(0, 5)
  const penalties = withDiv.filter(r => r.div < 0).sort((a, b) => a.div - b.div).slice(0, 5)

  // 标签情绪：集体 + 个人一起数
  const tagCount = new Map()
  for (const p of parts) {
    if (p.skipped) continue
    for (const t of tagEventsOf(p)) tagCount.set(t, (tagCount.get(t) || 0) + 1)
  }
  const tagStats = [...tagCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return {
    ranked,
    unscored: active.filter(r => !r.scored),
    skipped: parts.filter(p => p.skipped),
    dimBoards,
    personTops,
    controversial,
    premiums,
    penalties,
    tagStats,
    hotLine: hotThreshold(config),
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
          // 每次出现携带 (主观总评, 参考分) 对，跨期算反差
          pairs: [],
          favs: new Set(),
          tags: [],
          sources: []
        })
      }
      const e = map.get(key)
      if (pr.anime) e.animeSet.add(pr.anime)
      for (const [who, v] of Object.entries(p.scores || {})) {
        if (typeof v === 'number') e.scores.push(v)
      }
      for (const [who, ps] of Object.entries(row.persons || {})) {
        if (ps.ref != null) e.pairs.push([ps.score, ps.ref])
      }
      for (const [dk, dv] of Object.entries(p.dimScores || {})) {
        e.dimScores[dk] = e.dimScores[dk] || []
        for (const v of Object.values(dv)) {
          if (typeof v === 'number') e.dimScores[dk].push(v)
        }
      }
      for (const f of p.favorites || []) e.favs.add(f)
      for (const t of tagEventsOf(p)) e.tags.push(t)
      e.sources.push({ session, part: p })
    }
  }

  const songs = [...map.values()].map(e => {
    const pairScores = e.pairs.map(([s]) => s)
    const pairRefs = e.pairs.map(([, r]) => r)
    const refAvg = round2(avgOf(pairRefs))
    return {
      song: e.song,
      artist: e.artist,
      anime: [...e.animeSet],
      kind: e.kind,
      scores: e.scores,
      tags: e.tags,
      avg: round1(avgOf(e.scores)),
      refAvg,
      div: refAvg != null ? round2(avgOf(pairScores) - refAvg) : null,
      std: round2(stdOf(e.scores)),
      voterCount: e.scores.length,
      favCount: e.favs.size,
      favs: [...e.favs],
      dims: Object.fromEntries(
        Object.entries(e.dimScores).map(([k, v]) => [k, round1(avgOf(v))])
      ),
      sources: e.sources
    }
  })
  const board = songs
    .filter(s => s.avg != null)
    .sort((a, b) => b.avg - a.avg || b.favCount - a.favCount)

  const hotLine = hotThreshold(config)
  const controversial = board
    .filter(s => s.std > 0 && s.voterCount >= 2)
    .sort((a, b) => b.std - a.std)
    .slice(0, 8)

  const tagCount = new Map()
  for (const s of songs) for (const t of s.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1)
  const tagStats = [...tagCount.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

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
    controversial,
    tagStats,
    hotLine,
    reviews,
    dims: enabledDims(config),
    persons: config.persons || []
  }
}
