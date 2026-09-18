/** Markdown 报告：与 HTML 报告同源数据
 *  反差/争议体系：反差 = 主观总评 − 维度参考分；争议 = 总分标准差
 */
import { songTitle, biliLink } from './stats.js'

function fmtDvg(x) {
  if (x == null) return null
  const v = Math.round(x * 10) / 10
  return (v > 0 ? '+' : '') + v.toFixed(1)
}

function renderSessionMd(session, st) {
  const lines = []
  lines.push(`# ${session.name} · 排行榜`, '')
  lines.push(
    `- 视频：${session.bvid ? `[${session.videoTitle || session.bvid}](https://www.bilibili.com/video/${session.bvid})` : session.videoTitle || '—'}`
  )
  lines.push(`- 日期：${new Date(session.createdAt).toLocaleDateString('zh-CN')}`)
  lines.push(`- 参与：${st.persons.join('、') || '—'}（${st.persons.length} 人）`)
  lines.push(`- 评分：${st.votedCount}/${st.totalActive} 首`)
  lines.push(
    `- 说明：总分为每人独立的主观总评；反差 = 主观总评 − 维度参考分（正=情怀溢价，负=套路压分）；争议 = 总分标准差，≥ ${st.hotLine} 记 🔥`,
    ''
  )

  if (st.ranked.length) {
    lines.push('## 🏆 前三', '')
    st.ranked.slice(0, 3).forEach((r, i) => {
      const p = r.part
      const pr = p.parsed || {}
      lines.push(
        `${i + 1}. **「${songTitle(p)}」** ${pr.artist || ''}${pr.anime ? `《${pr.anime}》` : ''} —— 均分 **${r.avg}**${r.div != null ? `（反差 ${fmtDvg(r.div)}）` : ''}${r.favCount ? `，★${r.favCount} 人收藏` : ''}`
      )
    })
    lines.push('')

    const dimHead = st.dims.map(d => `${d.name}均分`).join(' | ')
    lines.push('## 总榜', '')
    lines.push(
      `| # | 曲名 | 歌手 | 番剧 | 均分 | 争议 | 反差 | 各人评分${dimHead ? ` | ${dimHead}` : ''} | 收藏 | 标签 | 短评 |`
    )
    lines.push(
      `|---|---|---|---|---|---|---|---|${st.dims.map(() => '---').join('|')}|---|---|---|`
    )
    st.ranked.forEach((r, i) => {
      const p = r.part
      const pr = p.parsed || {}
      const per = st.persons
        .filter(pn => typeof p.scores?.[pn] === 'number')
        .map(pn => {
          const x = r.persons?.[pn]
          const dvg = x?.ref != null && x?.div != null ? `(${fmtDvg(x.div)})` : ''
          return `${pn} ${p.scores[pn]}${dvg}`
        })
        .join('；')
      const dims = st.dims.map(d => (r.dims[d.key] ?? '—')).join(' | ')
      const std = r.voters.length >= 2 ? `${r.std}${r.hot ? ' 🔥' : ''}` : '—'
      const dvg = r.div != null ? fmtDvg(r.div) : '—'
      lines.push(
        `| ${i + 1} | ${songTitle(p)}${biliLink(session, p.page) ? ` ([B站](${biliLink(session, p.page)}))` : ''} | ${pr.artist || ''} | ${pr.anime || ''} | **${r.avg ?? '—'}** | ${std} | ${dvg} | ${per || '—'}${dimHead ? ` | ${dims}` : ''} | ${r.favCount ? `★${r.favCount}` : ''} | ${(p.tags || []).join('、')} | ${p.comment || ''} |`
      )
    })
    lines.push('')
  }

  if (st.controversial.length) {
    lines.push('## 🔥 争议焦点', '')
    lines.push(`总分标准差 ≥ ${st.hotLine} 判定为吵翻；逐人摊开评价构成：`, '')
    for (const r of st.controversial) {
      lines.push(
        `### 「${songTitle(r.part)}」${r.part.parsed?.artist ? ` — ${r.part.parsed.artist}` : ''}（争议 ${r.std}）`,
        ''
      )
      for (const [who, x] of Object.entries(r.persons || {}).sort(
        (a, b) => b[1].score - a[1].score
      )) {
        const bits = [`- **${who} ${x.score}**`]
        if (x.ref != null) bits.push(`反差 ${fmtDvg(x.div)}（维度参考 ${x.ref}）`)
        if (x.tags?.length) bits.push(`标签：${x.tags.join('、')}`)
        if (x.comment) bits.push(`短评：${x.comment}`)
        lines.push(bits.join('，'))
      }
      if (r.part.tags?.length) lines.push(`- 全场标签：${r.part.tags.join('、')}`)
      if (r.part.comment) lines.push(`- 全场短评：${r.part.comment}`)
      lines.push('')
    }
  }

  if (st.premiums.length || st.penalties.length) {
    lines.push('## ⚖️ 反差榜', '')
    lines.push(
      '反差 = 主观总评 − 维度参考分：正=情怀溢价（糙但真情/情投意合），负=套路罚分（合格但齁）。',
      ''
    )
    if (st.premiums.length) {
      lines.push('**本格溢价 Top**', '')
      st.premiums.forEach(r =>
        lines.push(
          `- 「${songTitle(r.part)}」 ${fmtDvg(r.div)}（主观 ${r.avg} vs 参考 ${r.refAvg}）`
        )
      )
      lines.push('')
    }
    if (st.penalties.length) {
      lines.push('**套路罚分 Top**', '')
      st.penalties.forEach(r =>
        lines.push(
          `- 「${songTitle(r.part)}」 ${fmtDvg(r.div)}（主观 ${r.avg} vs 参考 ${r.refAvg}）`
        )
      )
      lines.push('')
    }
  }

  if (st.tagStats.length) {
    lines.push('## 🏷️ 标签情绪统计', '')
    lines.push(
      st.tagStats.map(t => `${t.name} × ${t.count}`).join('、'),
      ''
    )
  }

  for (const b of st.dimBoards) {
    lines.push(`## ${b.dim.name}榜 Top ${b.top.length}${b.dim.weight != null ? `（权重 ${b.dim.weight}%）` : ''}`, '')
    b.top.forEach((r, i) => {
      lines.push(
        `${i + 1}. 「${songTitle(r.part)}」 ${r.part.parsed?.artist || ''} —— ${b.dim.name} ${r.dims[b.dim.key]}`
      )
    })
    lines.push('')
  }

  if (st.favorites.length) {
    lines.push('## ★ 收藏夹', '')
    st.favorites.forEach(r => {
      lines.push(
        `- 「${songTitle(r.part)}」 —— ${(r.part.favorites || []).join('、')}`
      )
    })
    lines.push('')
  }

  for (const t of st.personTops) {
    lines.push(`## ${t.person} 的 Top 5${t.avgGiven != null ? `（均出手分 ${t.avgGiven}）` : ''}`, '')
    t.top.forEach(r => {
      lines.push(`- ${r.part.scores[t.person]} 分：「${songTitle(r.part)}」`)
    })
    lines.push('')
  }

  if (st.unscored.length) {
    lines.push(`## 未评（${st.unscored.length} 首）`, '')
    lines.push(st.unscored.map(r => songTitle(r.part)).join('、'), '')
  }
  if (st.skipped.length) {
    lines.push(`## 跳过（${st.skipped.length} 首）`, '')
    lines.push(st.skipped.map(p => songTitle(p)).join('、'), '')
  }

  return lines.join('\n')
}

function renderAllMd(sessions, st) {
  const lines = []
  lines.push('# 🏆 全期总榜', '')
  lines.push(`${sessions.length} 期鉴赏会 · ${st.board.length} 首上榜`)
  lines.push(
    `反差 = 主观总评 − 维度参考分；争议 = 总分标准差，≥ ${st.hotLine} 记 🔥`,
    ''
  )

  lines.push('## 歌曲总榜（跨期去重）', '')
  lines.push('| # | 曲名 | 歌手 | 番剧 | 均分 | 争议 | 反差 | 票数 | 收藏 | 期次 |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  st.board.forEach((s, i) => {
    const std = s.voterCount >= 2 ? `${s.std}${s.std >= st.hotLine ? ' 🔥' : ''}` : '—'
    lines.push(
      `| ${i + 1} | ${s.song} | ${s.artist} | ${s.anime.map(a => `《${a}》`).join('')} | **${s.avg ?? '—'}** | ${std} | ${s.div != null ? fmtDvg(s.div) : '—'} | ${s.voterCount} | ${s.favCount ? `★${s.favCount}` : ''} | ${s.sources.map(x => x.session.name).join('、')} |`
    )
  })
  lines.push('')

  if (st.controversial.length) {
    lines.push('## 🔥 争议焦点（跨期）', '')
    st.controversial.forEach((s, i) => {
      lines.push(
        `${i + 1}. 「${s.song}」 ${s.artist || ''} —— 争议 ${s.std}，均分 ${s.avg}${s.div != null ? `，反差 ${fmtDvg(s.div)}` : ''}`
      )
    })
    lines.push('')
  }

  if (st.tagStats.length) {
    lines.push('## 🏷️ 标签情绪统计', '')
    lines.push(st.tagStats.map(t => `${t.name} × ${t.count}`).join('、'), '')
  }

  lines.push(`## 歌手榜 Top ${st.byArtist.length}`, '')
  lines.push('| # | 歌手 | 曲目数 | 均分 | 最佳曲 | 收藏 |')
  lines.push('|---|---|---|---|---|---|')
  st.byArtist.forEach((a, i) => {
    lines.push(
      `| ${i + 1} | ${a.name} | ${a.songCount} | **${a.avg ?? '—'}** | 「${a.best?.song || ''}」${a.best?.avg != null ? ` (${a.best.avg})` : ''} | ${a.favCount ? `★${a.favCount}` : ''} |`
    )
  })
  lines.push('')

  lines.push(`## 番剧榜 Top ${st.byAnime.length}`, '')
  lines.push('| # | 番剧 | 曲目数 | 均分 | 最佳曲 | 收藏 |')
  lines.push('|---|---|---|---|---|---|')
  st.byAnime.forEach((a, i) => {
    lines.push(
      `| ${i + 1} | 《${a.name}》 | ${a.songCount} | **${a.avg ?? '—'}** | 「${a.best?.song || ''}」${a.best?.avg != null ? ` (${a.best.avg})` : ''} | ${a.favCount ? `★${a.favCount}` : ''} |`
    )
  })
  lines.push('')

  lines.push('## 各期回顾', '')
  for (const r of st.reviews) {
    lines.push(`### ${r.session.name}（${new Date(r.session.createdAt).toLocaleDateString('zh-CN')}）`)
    if (r.top3.length) {
      r.top3.forEach((x, i) =>
        lines.push(`${i + 1}. 「${songTitle(x.part)}」 ${x.part.parsed?.artist || ''} —— ${x.avg}`)
      )
    } else {
      lines.push('暂无评分')
    }
    lines.push('')
  }
  return lines.join('\n')
}

export { renderSessionMd, renderAllMd }
