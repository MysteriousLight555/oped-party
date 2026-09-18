/** HTML 排行榜报告：单文件自包含，可直接发群里打开 */
import { songTitle, biliLink } from './stats.js'

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function scoreClass(v) {
  if (v == null) return 'score'
  if (v >= 9) return 'score s-god'
  if (v >= 8) return 'score s-hot'
  if (v >= 7) return 'score s-good'
  return 'score'
}

function personChips(part, persons) {
  const chips = (persons || [])
    .filter(pn => typeof part.scores?.[pn] === 'number')
    .map(pn => `<i class="pc">${esc(pn)}<b>${part.scores[pn]}</b></i>`)
    .join('')
  return chips || '<span class="dim">—</span>'
}

function tagPills(tags) {
  return (tags || []).map(t => `<em class="tag">${esc(t)}</em>`).join('')
}

function songCell(session, part) {
  const link = biliLink(session, part.page)
  const name = esc(songTitle(part))
  return link
    ? `<a class="song" href="${link}" target="_blank">${name}</a><span class="go">↗</span>`
    : `<span class="song">${name}</span>`
}

function fmtDur(sec) {
  if (!sec) return ''
  const m = Math.floor(sec / 60)
  const s = String(sec % 60).padStart(2, '0')
  return `${m}:${s}`
}

const CSS = `
:root{--pink:#fb7299;--blue:#00aeec;--ink:#18191c;--muted:#9499a0;--bg:#f3f4f8;--card:#fff;--line:#e6e8ec}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.65 -apple-system,"Segoe UI","Microsoft YaHei","PingFang SC","Hiragino Sans GB",sans-serif}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
.hero{background:linear-gradient(120deg,#fb7299 0%,#f25d8e 40%,#23ade5 125%);color:#fff;padding:44px 20px 54px;text-align:center}
.hero h1{margin:0 0 10px;font-size:30px;letter-spacing:1px}
.hero .sub{margin:0;opacity:.92;font-size:14px}
.hero .nav{margin-top:16px;font-size:13px}
.hero .nav a{color:#fff;margin:0 10px;opacity:.9}
main{max-width:1080px;margin:-30px auto 0;padding:0 16px 40px}
section{background:var(--card);border-radius:14px;box-shadow:0 2px 14px rgba(0,0,0,.06);padding:22px 24px;margin-bottom:22px}
h2{font-size:19px;margin:0 0 16px;display:flex;align-items:center;gap:8px}
h2::before{content:"";width:4px;height:18px;border-radius:2px;background:linear-gradient(180deg,var(--pink),var(--blue))}
.podium{display:flex;gap:14px;flex-wrap:wrap}
.pcard{flex:1 1 240px;border-radius:14px;padding:18px;color:#fff;position:relative;min-width:220px}
.pcard .medal{font-size:26px}
.pcard .psong{font-size:17px;font-weight:600;margin:6px 0 2px}
.pcard .pmeta{font-size:13px;opacity:.92}
.pcard .pavg{position:absolute;top:16px;right:18px;font-size:26px;font-weight:700}
.p1{background:linear-gradient(135deg,#f7a35c,#f25d5d)}
.p2{background:linear-gradient(135deg,#8fa4b8,#6e8ba3)}
.p3{background:linear-gradient(135deg,#d29a6a,#b87c50)}
table{width:100%;border-collapse:collapse;font-size:14px}
th{color:var(--muted);font-weight:500;text-align:left;padding:8px 10px;border-bottom:2px solid var(--line);white-space:nowrap}
td{padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
tr:hover td{background:#fafbfd}
.num{font-variant-numeric:tabular-nums}
.rank{color:var(--muted);font-weight:600}
.top1 .rank,.top2 .rank,.top3 .rank{color:var(--pink)}
.score{font-weight:700;font-size:15px;font-variant-numeric:tabular-nums}
.s-god{color:#f25d5d}.s-hot{color:#fb7299}.s-good{color:#23ade5}
.pc{font-style:normal;background:#f1f2f4;border-radius:6px;padding:1px 7px;margin:1px 3px 1px 0;display:inline-block;font-size:12.5px;color:#61666d}
.pc b{margin-left:5px;color:var(--ink)}
.tag{font-style:normal;background:#fff0f4;color:var(--pink);border:1px solid #ffd6e2;border-radius:20px;padding:0 9px;font-size:12px;display:inline-block;margin:1px 3px 1px 0}
.star{color:#f7a35c;font-weight:600;white-space:nowrap}
.cmt{color:#61666d;font-size:13px;max-width:230px}
.dim{color:var(--muted)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}
.pbox h3{margin:0 0 10px;font-size:15px}
.pbox .pavggiven{color:var(--muted);font-size:12.5px;font-weight:400;margin-left:6px}
.pbox ol{margin:0;padding-left:22px}
.pbox li{margin:3px 0;font-size:14px}
.mini{color:var(--muted);font-size:13px}
.mini li{margin:2px 0}
.favbox ul{margin:0;padding-left:20px;font-size:14px}
footer{text-align:center;color:var(--muted);font-size:12.5px;padding:10px 0 30px}
@media(max-width:640px){td,th{padding:6px 6px}.cmt{max-width:140px}.hero h1{font-size:22px}}
`

function baseHtml(title, body) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
${body}
<footer>由 OP/ED 鉴赏会小工具生成 · ${new Date().toLocaleString('zh-CN')}</footer>
</body>
</html>`
}

function podium(st, session) {
  const medals = ['🥇', '🥈', '🥉']
  const classes = ['p1', 'p2', 'p3']
  return st.ranked
    .slice(0, 3)
    .map((r, i) => {
      const p = r.part
      const pr = p.parsed || {}
      return `<div class="pcard ${classes[i]}">
<div class="medal">${medals[i]}</div>
<div class="pavg">${r.avg ?? '—'}</div>
<div class="psong">「${esc(songTitle(p))}」</div>
<div class="pmeta">${esc(pr.artist || '')}${pr.anime ? ` · 《${esc(pr.anime)}》` : ''}${pr.kind ? ` · ${esc(pr.kind)}` : ''}</div>
<div class="pmeta">★ ${r.favCount} 人收藏</div>
</div>`
    })
    .join('')
}

function boardTable(st, session) {
  const dimHead = st.dims.map(d => `<th>${esc(d.name)}</th>`).join('')
  const rows = st.ranked
    .map((r, i) => {
      const p = r.part
      const pr = p.parsed || {}
      return `<tr class="${i < 3 ? `top${i + 1}` : ''}">
<td class="num rank">${i + 1}</td>
<td>${songCell(session, p)}${pr.artist ? `<div class="mini">${esc(pr.artist)}</div>` : ''}</td>
<td class="mini">${esc(pr.anime || '')}${pr.kind ? `<div>${esc(pr.kind)} · ${fmtDur(p.duration)}</div>` : ''}</td>
<td class="num"><span class="${scoreClass(r.avg)}">${r.avg ?? '—'}</span></td>
<td>${personChips(p, st.persons)}</td>
${st.dims
  .map(
    d =>
      `<td class="num ${scoreClass(r.dims[d.key])}">${r.dims[d.key] ?? '<span class="dim">—</span>'}</td>`
  )
  .join('')}
<td class="star">${r.favCount ? `★ ${r.favCount}` : ''}</td>
<td>${tagPills(p.tags)}</td>
<td class="cmt">${esc(p.comment || '')}</td>
</tr>`
    })
    .join('')
  return `<table>
<thead><tr><th>#</th><th>曲名</th><th>番剧</th><th>均分</th><th>各人评分</th>${dimHead}<th>收藏</th><th>标签</th><th>短评</th></tr></thead>
<tbody>${rows}</tbody>
</table>`
}

function renderSessionHtml(session, st) {
  const date = new Date(session.createdAt).toLocaleDateString('zh-CN')
  const videoLink = session.bvid
    ? `<a href="https://www.bilibili.com/video/${esc(session.bvid)}" target="_blank" style="color:#fff">${esc(session.videoTitle || session.bvid)}</a>`
    : esc(session.videoTitle || '')
  const dimSections = st.dimBoards
    .map(
      b => `<section id="dim-${esc(b.dim.key)}">
<h2>${esc(b.dim.name)}榜 Top ${b.top.length}</h2>
<table><tbody>
${b.top
  .map(
    (r, i) => `<tr><td class="num rank">${i + 1}</td><td>${songCell(session, r.part)}</td>
<td class="mini">${esc(r.part.parsed?.artist || '')}</td>
<td class="num ${scoreClass(r.dims[b.dim.key])}">${r.dims[b.dim.key]}</td></tr>`
  )
  .join('')}
</tbody></table></section>`
    )
    .join('')

  const personSection = st.personTops.length
    ? `<section id="persons"><h2>每人 Top 5</h2><div class="cols">
${st.personTops.map(
  t => `<div class="pbox"><h3>${esc(t.person)}${t.avgGiven != null ? `<span class="pavggiven">均出手分 ${t.avgGiven}</span>` : ''}</h3>
<ol>${t.top.map(r => `<li>「${songCell(session, r.part)}」 <span class="num ${scoreClass(r.part.scores[t.person])}">${r.part.scores[t.person]}</span>${r.part.parsed?.artist ? `<div class="mini">${esc(r.part.parsed.artist)}</div>` : ''}</li>`).join('')}</ol></div>`
).join('')}
</div></section>`
    : ''

  const favSection = st.favorites.length
    ? `<section id="fav"><h2>收藏夹 ★</h2><div class="favbox"><ul>
${st.favorites
  .map(
    r =>
      `<li>${songCell(session, r.part)}${r.part.parsed?.artist ? ` <span class="mini">${esc(r.part.parsed.artist)}</span>` : ''} —— ${esc((r.part.favorites || []).join('、'))}</li>`
  )
  .join('')}
</ul></div></section>`
    : ''

  const restSection =
    st.unscored.length || st.skipped.length
      ? `<section id="rest"><h2>未评 / 跳过</h2>
${st.unscored.length ? `<p class="mini">未评 ${st.unscored.length} 首：${st.unscored.map(r => esc(songTitle(r.part))).join('、')}</p>` : ''}
${st.skipped.length ? `<p class="mini">跳过 ${st.skipped.length} 首：${st.skipped.map(p => esc(songTitle(p))).join('、')}</p>` : ''}
</section>`
      : ''

  return baseHtml(
    `${session.name} · 排行榜`,
    `<div class="hero">
<h1>${esc(session.name)}</h1>
<p class="sub">${videoLink} · ${date} · ${st.persons.length} 人参与 · 评了 ${st.votedCount}/${st.totalActive} 首</p>
<p class="nav"><a href="#board">总榜</a>${st.dimBoards.map(b => `<a href="#dim-${esc(b.dim.key)}">${esc(b.dim.name)}榜</a>`).join('')}<a href="#fav">收藏</a><a href="#persons">个人榜</a></p>
</div>
<main>
${st.ranked.length ? `<section class="podium-sec" style="padding:0;background:none;box-shadow:none">${podium(st, session)}</section>` : ''}
<section id="board"><h2>总榜（${st.votedCount} 首）</h2>${st.ranked.length ? boardTable(st, session) : '<p class="mini">还没有任何评分。</p>'}</section>
${dimSections}
${favSection}
${personSection}
${restSection}
</main>`
  )
}

function renderAllHtml(sessions, st) {
  const artistRows = st.byArtist
    .map(
      (a, i) =>
        `<tr><td class="num rank">${i + 1}</td><td>${esc(a.name)}</td><td class="num">${a.songCount}</td>
<td class="num"><span class="${scoreClass(a.avg)}">${a.avg ?? '—'}</span></td>
<td class="mini">「${esc(a.best?.song || '')}」${a.best?.avg != null ? ` (${a.best.avg})` : ''}</td>
<td class="star">${a.favCount ? `★ ${a.favCount}` : ''}</td></tr>`
    )
    .join('')
  const animeRows = st.byAnime
    .map(
      (a, i) =>
        `<tr><td class="num rank">${i + 1}</td><td>《${esc(a.name)}》</td><td class="num">${a.songCount}</td>
<td class="num"><span class="${scoreClass(a.avg)}">${a.avg ?? '—'}</span></td>
<td class="mini">「${esc(a.best?.song || '')}」${a.best?.avg != null ? ` (${a.best.avg})` : ''}</td>
<td class="star">${a.favCount ? `★ ${a.favCount}` : ''}</td></tr>`
    )
    .join('')

  const boardRows = st.board
    .map((s, i) => {
      const src = s.sources[0]
      const link = biliLink(src.session, src.part.page)
      const name = link
        ? `<a class="song" href="${link}" target="_blank">${esc(s.song)}</a>`
        : `<span class="song">${esc(s.song)}</span>`
      return `<tr class="${i < 3 ? `top${i + 1}` : ''}">
<td class="num rank">${i + 1}</td>
<td>${name}${s.artist ? `<div class="mini">${esc(s.artist)}</div>` : ''}</td>
<td class="mini">${s.anime.map(a => `《${esc(a)}》`).join('')}</td>
<td class="num"><span class="${scoreClass(s.avg)}">${s.avg ?? '—'}</span></td>
<td class="num mini">${s.voterCount} 票</td>
<td class="star">${s.favCount ? `★ ${s.favCount}` : ''}</td>
<td class="mini">${s.sources.map(x => esc(x.session.name)).join('、')}</td>
</tr>`
    })
    .join('')

  const reviewCards = st.reviews
    .map(
      r => `<div class="pbox">
<h3>${esc(r.session.name)} <span class="mini">${new Date(r.session.createdAt).toLocaleDateString('zh-CN')}</span></h3>
<ol>${r.top3.map(x => `<li>「${esc(songTitle(x.part))}」 <span class="${scoreClass(x.avg)}">${x.avg}</span></li>`).join('') || '<li class="mini">暂无评分</li>'}</ol>
</div>`
    )
    .join('')

  return baseHtml(
    '全期总榜',
    `<div class="hero">
<h1>🏆 全期总榜</h1>
<p class="sub">${sessions.length} 期鉴赏会 · ${st.board.length} 首上榜</p>
<p class="nav"><a href="#board">总榜</a><a href="#artist">歌手榜</a><a href="#anime">番剧榜</a><a href="#reviews">各期回顾</a></p>
</div>
<main>
<section id="board"><h2>歌曲总榜（跨期去重）</h2><table>
<thead><tr><th>#</th><th>曲名</th><th>番剧</th><th>均分</th><th>票数</th><th>收藏</th><th>出现期次</th></tr></thead>
<tbody>${boardRows}</tbody></table></section>
<section id="artist"><h2>歌手榜 Top ${st.byArtist.length}</h2><table>
<thead><tr><th>#</th><th>歌手</th><th>曲目</th><th>均分</th><th>最佳曲</th><th>收藏</th></tr></thead>
<tbody>${artistRows}</tbody></table></section>
<section id="anime"><h2>番剧榜 Top ${st.byAnime.length}</h2><table>
<thead><tr><th>#</th><th>番剧</th><th>曲目</th><th>均分</th><th>最佳曲</th><th>收藏</th></tr></thead>
<tbody>${animeRows}</tbody></table></section>
<section id="reviews"><h2>各期回顾</h2><div class="cols">${reviewCards}</div></section>
</main>`
  )
}

export { renderSessionHtml, renderAllHtml }
