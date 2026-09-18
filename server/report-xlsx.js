/** Excel 报告（exceljs）：总榜 / 争议分析 / 每人明细 / 分维度 / 标签统计 / 收藏 / 未评
 *  反差 = 主观总评 − 维度参考分；争议 = 总分标准差
 */
import ExcelJS from 'exceljs'
import { songTitle, biliLink } from './stats.js'

const HEAD_FILL = 'FFFCD6E5' // bilibili 粉浅色
const HEAD_FONT = { bold: true, color: { argb: 'FF61666D' } }

function styleHeader(sheet) {
  const row = sheet.getRow(1)
  row.font = HEAD_FONT
  row.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEAD_FILL } }
  })
  row.height = 22
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
}

function linkCell(cell, url, text) {
  cell.value = { text: text || url, hyperlink: url }
  cell.font = { color: { argb: 'FF00AEEC' }, underline: true }
}

function fmtDvg(x) {
  if (x == null) return null
  const v = Math.round(x * 10) / 10
  return (v > 0 ? '+' : '') + v.toFixed(1)
}

export async function buildSessionWorkbook(session, st) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'OP/ED 鉴赏会'
  wb.created = new Date()

  // ---- 总榜
  const ws = wb.addWorksheet('总榜')
  ws.columns = [
    { header: '排名', key: 'rank', width: 6 },
    { header: '曲名', key: 'song', width: 34 },
    { header: '歌手', key: 'artist', width: 22 },
    { header: '番剧', key: 'anime', width: 22 },
    { header: '类型', key: 'kind', width: 9 },
    { header: '均分', key: 'avg', width: 8 },
    { header: `争议(标准差,≥${st.hotLine}🔥)`, key: 'std', width: 16 },
    { header: '反差(主观-参考)', key: 'dvg', width: 15 },
    { header: '维度参考分', key: 'ref', width: 11 },
    ...st.persons.map(p => ({ header: p, key: `p_${p}`, width: 9 })),
    ...st.dims.map(d => ({ header: `${d.name}均分`, key: `d_${d.key}`, width: 11 })),
    { header: '收藏人数', key: 'fav', width: 9 },
    { header: '收藏人', key: 'favWho', width: 18 },
    { header: '标签', key: 'tags', width: 18 },
    { header: '短评', key: 'comment', width: 30 },
    { header: 'B站', key: 'link', width: 7 }
  ]
  st.ranked.forEach((r, i) => {
    const p = r.part
    const pr = p.parsed || {}
    const row = {
      rank: i + 1,
      song: songTitle(p),
      artist: pr.artist || '',
      anime: pr.anime || '',
      kind: pr.kind || '',
      avg: r.avg,
      std: r.voters.length >= 2 ? (r.hot ? `🔥 ${r.std}` : r.std) : null,
      dvg: fmtDvg(r.div),
      ref: r.refAvg,
      ...Object.fromEntries(st.persons.map(pn => [`p_${pn}`, p.scores?.[pn] ?? null])),
      ...Object.fromEntries(st.dims.map(d => [`d_${d.key}`, r.dims[d.key] ?? null])),
      fav: r.favCount || null,
      favWho: (p.favorites || []).join('、'),
      tags: (p.tags || []).join('、'),
      comment: p.comment || ''
    }
    const added = ws.addRow(row)
    const link = biliLink(session, p.page)
    if (link) linkCell(added.getCell('link'), link, '打开')
  })
  styleHeader(ws)

  // ---- 争议分析：逐人摊开评价构成（总分/参考/反差/个人标签/个人短评）
  const wh = wb.addWorksheet('争议分析')
  wh.columns = [
    { header: '争议', key: 'std', width: 12 },
    { header: '曲名', key: 'song', width: 32 },
    { header: '评分人', key: 'person', width: 10 },
    { header: '主观总分', key: 'score', width: 9 },
    ...st.dims.map(d => ({ header: `${d.name}(${d.weight ?? ''})`, key: `d_${d.key}`, width: 11 })),
    { header: '维度参考', key: 'ref', width: 9 },
    { header: '反差', key: 'dvg', width: 8 },
    { header: '个人标签', key: 'ptags', width: 22 },
    { header: '个人短评', key: 'pcomment', width: 34 },
    { header: '全场标签', key: 'tags', width: 18 },
    { header: '全场短评', key: 'comment', width: 30 }
  ]
  for (const r of st.controversial) {
    const p = r.part
    const perRows = Object.entries(r.persons || {}).filter(([, x]) => typeof x.score === 'number')
    perRows.forEach(([pn, x], idx) => {
      const dimVals = Object.fromEntries(
        st.dims.map(d => [
          `d_${d.key}`,
          ((p.dimScores || {})[d.key] || {})[pn] ?? null
        ])
      )
      wh.addRow({
        std: idx === 0 ? (r.hot ? `🔥 ${r.std}` : r.std) : null,
        song: idx === 0 ? songTitle(p) : null,
        person: pn,
        score: x.score,
        ...dimVals,
        ref: x.ref,
        dvg: fmtDvg(x.div),
        ptags: (x.tags || []).join('、'),
        pcomment: x.comment || '',
        tags: idx === 0 ? (p.tags || []).join('、') : null,
        comment: idx === 0 ? p.comment || '' : null
      })
    })
    wh.addRow({})
  }
  styleHeader(wh)

  // ---- 每人明细
  const wd = wb.addWorksheet('每人明细')
  wd.columns = [
    { header: 'P', key: 'page', width: 6 },
    { header: '曲名', key: 'song', width: 34 },
    ...st.persons.map(p => ({ header: p, key: `p_${p}`, width: 10 })),
    { header: '收藏', key: 'fav', width: 16 },
    { header: '标签', key: 'tags', width: 18 },
    { header: '短评', key: 'comment', width: 30 }
  ]
  for (const p of session.parts || []) {
    if (p.skipped) continue
    wd.addRow({
      page: p.page,
      song: songTitle(p),
      ...Object.fromEntries(st.persons.map(pn => [`p_${pn}`, p.scores?.[pn] ?? null])),
      fav: (p.favorites || []).join('、'),
      tags: (p.tags || []).join('、'),
      comment: p.comment || ''
    })
  }
  styleHeader(wd)

  // ---- 分维度
  if (st.dims.length) {
    const wx = wb.addWorksheet('分维度')
    wx.columns = [
      { header: '排名', key: 'rank', width: 6 },
      { header: '曲名', key: 'song', width: 34 },
      { header: '歌手', key: 'artist', width: 22 },
      ...st.dims.map(d => ({ header: d.name, key: `d_${d.key}`, width: 10 }))
    ]
    st.ranked.forEach((r, i) => {
      wx.addRow({
        rank: i + 1,
        song: songTitle(r.part),
        artist: r.part.parsed?.artist || '',
        ...Object.fromEntries(st.dims.map(d => [`d_${d.key}`, r.dims[d.key] ?? null]))
      })
    })
    styleHeader(wx)
  }

  // ---- 标签统计
  if (st.tagStats.length) {
    const wt = wb.addWorksheet('标签统计')
    wt.columns = [
      { header: '标签', key: 'tag', width: 26 },
      { header: '次数', key: 'count', width: 8 }
    ]
    st.tagStats.forEach(t => wt.addRow({ tag: t.name, count: t.count }))
    styleHeader(wt)
  }

  // ---- 收藏
  if (st.favorites.length) {
    const wf = wb.addWorksheet('收藏夹')
    wf.columns = [
      { header: '曲名', key: 'song', width: 34 },
      { header: '歌手', key: 'artist', width: 22 },
      { header: '番剧', key: 'anime', width: 22 },
      { header: '收藏人', key: 'who', width: 22 }
    ]
    st.favorites.forEach(r => {
      wf.addRow({
        song: songTitle(r.part),
        artist: r.part.parsed?.artist || '',
        anime: r.part.parsed?.anime || '',
        who: (r.part.favorites || []).join('、')
      })
    })
    styleHeader(wf)
  }

  // ---- 未评/跳过
  if (st.unscored.length || st.skipped.length) {
    const wu = wb.addWorksheet('未评与跳过')
    wu.columns = [
      { header: '状态', key: 'state', width: 8 },
      { header: 'P', key: 'page', width: 6 },
      { header: '标题', key: 'title', width: 50 }
    ]
    st.unscored.forEach(r =>
      wu.addRow({ state: '未评', page: r.part.page, title: r.part.title })
    )
    st.skipped.forEach(p => wu.addRow({ state: '跳过', page: p.page, title: p.title }))
    styleHeader(wu)
  }

  return wb.xlsx.writeBuffer()
}

export async function buildAllWorkbook(sessions, st) {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'OP/ED 鉴赏会'

  const ws = wb.addWorksheet('歌曲总榜')
  ws.columns = [
    { header: '排名', key: 'rank', width: 6 },
    { header: '曲名', key: 'song', width: 34 },
    { header: '歌手', key: 'artist', width: 22 },
    { header: '番剧', key: 'anime', width: 26 },
    { header: '均分', key: 'avg', width: 8 },
    { header: `争议(标准差,≥${st.hotLine}🔥)`, key: 'std', width: 16 },
    { header: '反差(主观-参考)', key: 'dvg', width: 15 },
    { header: '票数', key: 'votes', width: 8 },
    { header: '收藏', key: 'fav', width: 8 },
    { header: '出现期次', key: 'sessions', width: 30 }
  ]
  st.board.forEach((s, i) => {
    ws.addRow({
      rank: i + 1,
      song: s.song,
      artist: s.artist,
      anime: s.anime.join('、'),
      avg: s.avg,
      std: s.voterCount >= 2 ? (s.std >= st.hotLine ? `🔥 ${s.std}` : s.std) : null,
      dvg: fmtDvg(s.div),
      votes: s.voterCount,
      fav: s.favCount || null,
      sessions: s.sources.map(x => x.session.name).join('、')
    })
  })
  styleHeader(ws)

  if (st.tagStats.length) {
    const wt = wb.addWorksheet('标签统计')
    wt.columns = [
      { header: '标签', key: 'tag', width: 26 },
      { header: '次数', key: 'count', width: 8 }
    ]
    st.tagStats.forEach(t => wt.addRow({ tag: t.name, count: t.count }))
    styleHeader(wt)
  }

  const wa = wb.addWorksheet('歌手榜')
  wa.columns = [
    { header: '排名', key: 'rank', width: 6 },
    { header: '歌手', key: 'name', width: 24 },
    { header: '曲目数', key: 'count', width: 9 },
    { header: '均分', key: 'avg', width: 8 },
    { header: '最佳曲', key: 'best', width: 34 },
    { header: '收藏', key: 'fav', width: 8 }
  ]
  st.byArtist.forEach((a, i) => {
    wa.addRow({
      rank: i + 1,
      name: a.name,
      count: a.songCount,
      avg: a.avg,
      best: a.best ? `「${a.best.song}」(${a.best.avg ?? '—'})` : '',
      fav: a.favCount || null
    })
  })
  styleHeader(wa)

  const wn = wb.addWorksheet('番剧榜')
  wn.columns = [
    { header: '排名', key: 'rank', width: 6 },
    { header: '番剧', key: 'name', width: 28 },
    { header: '曲目数', key: 'count', width: 9 },
    { header: '均分', key: 'avg', width: 8 },
    { header: '最佳曲', key: 'best', width: 34 },
    { header: '收藏', key: 'fav', width: 8 }
  ]
  st.byAnime.forEach((a, i) => {
    wn.addRow({
      rank: i + 1,
      name: a.name,
      count: a.songCount,
      avg: a.avg,
      best: a.best ? `「${a.best.song}」(${a.best.avg ?? '—'})` : '',
      fav: a.favCount || null
    })
  })
  styleHeader(wn)

  return wb.xlsx.writeBuffer()
}
