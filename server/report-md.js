/** Markdown 报告：与 HTML 报告同源数据 */
import { songTitle, biliLink } from './stats.js'

function renderSessionMd(session, st) {
  const lines = []
  lines.push(`# ${session.name} · 排行榜`, '')
  lines.push(
    `- 视频：${session.bvid ? `[${session.videoTitle || session.bvid}](https://www.bilibili.com/video/${session.bvid})` : session.videoTitle || '—'}`
  )
  lines.push(`- 日期：${new Date(session.createdAt).toLocaleDateString('zh-CN')}`)
  lines.push(`- 参与：${st.persons.join('、') || '—'}（${st.persons.length} 人）`)
  lines.push(`- 评分：${st.votedCount}/${st.totalActive} 首`, '')

  if (st.ranked.length) {
    lines.push('## 🏆 前三', '')
    st.ranked.slice(0, 3).forEach((r, i) => {
      const p = r.part
      const pr = p.parsed || {}
      lines.push(
        `${i + 1}. **「${songTitle(p)}」** ${pr.artist || ''}${pr.anime ? `《${pr.anime}》` : ''} —— 均分 **${r.avg}**${r.favCount ? `，★${r.favCount} 人收藏` : ''}`
      )
    })
    lines.push('')

    const dimHead = st.dims.map(d => `${d.name}均分`).join(' | ')
    lines.push('## 总榜', '')
    lines.push(
      `| # | 曲名 | 歌手 | 番剧 | 均分 | 各人评分${dimHead ? ` | ${dimHead}` : ''} | 收藏 | 标签 | 短评 |`
    )
    lines.push(`|---|---|---|---|---|---|${st.dims.map(() => '---').join('|')}|---|---|---|`)
    st.ranked.forEach((r, i) => {
      const p = r.part
      const pr = p.parsed || {}
      const per = st.persons
        .filter(pn => typeof p.scores?.[pn] === 'number')
        .map(pn => `${pn} ${p.scores[pn]}`)
        .join('；')
      const dims = st.dims.map(d => (r.dims[d.key] ?? '—')).join(' | ')
      lines.push(
        `| ${i + 1} | ${songTitle(p)}${biliLink(session, p.page) ? ` ([B站](${biliLink(session, p.page)}))` : ''} | ${pr.artist || ''} | ${pr.anime || ''} | **${r.avg ?? '—'}** | ${per || '—'}${dimHead ? ` | ${dims}` : ''} | ${r.favCount ? `★${r.favCount}` : ''} | ${(p.tags || []).join('、')} | ${p.comment || ''} |`
      )
    })
    lines.push('')
  }

  for (const b of st.dimBoards) {
    lines.push(`## ${b.dim.name}榜 Top ${b.top.length}`, '')
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
  lines.push(`${sessions.length} 期鉴赏会 · ${st.board.length} 首上榜`, '')

  lines.push('## 歌曲总榜（跨期去重）', '')
  lines.push('| # | 曲名 | 歌手 | 番剧 | 均分 | 票数 | 收藏 | 期次 |')
  lines.push('|---|---|---|---|---|---|---|---|')
  st.board.forEach((s, i) => {
    lines.push(
      `| ${i + 1} | ${s.song} | ${s.artist} | ${s.anime.map(a => `《${a}》`).join('')} | **${s.avg ?? '—'}** | ${s.voterCount} | ${s.favCount ? `★${s.favCount}` : ''} | ${s.sources.map(x => x.session.name).join('、')} |`
    )
  })
  lines.push('')

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
