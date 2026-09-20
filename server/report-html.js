/** HTML 排行榜报告：单文件自包含，可直接发群里打开
 *  反差/争议体系：总分=主观总评（独立），反差=主观−维度参考，争议=总分标准差
 */
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

function fmtDvg(x) {
  if (x == null) return ''
  const v = Math.round(x * 10) / 10
  return (v > 0 ? '+' : '') + v.toFixed(1)
}

function dvgSpan(x, cls = 'dv') {
  if (x == null) return '<span class="dim">—</span>'
  return `<span class="${cls} ${x >= 0 ? 'pos' : 'neg'}">Δ${fmtDvg(x)}</span>`
}

function stdCell(std, hot, voters) {
  if (std == null || voters < 2) return '<span class="dim">—</span>'
  return hot ? `<span class="fire">🔥 ${std}</span>` : String(std)
}

function personChips(personsMap, persons) {
  const chips = (persons || [])
    .filter(pn => typeof personsMap?.[pn]?.score === 'number')
    .map(pn => {
      const x = personsMap[pn]
      const dv = x.ref != null ? dvgSpan(x.div) : ''
      return `<i class="pc">${esc(pn)}<b>${x.score}</b>${dv}</i>`
    })
    .join('')
  return chips || '<span class="dim">—</span>'
}

function tagPills(tags) {
  return (tags || []).map(t => `<em class="tag">${esc(t)}</em>`).join('')
}

function songCell(session, part) {
  const link = biliLink(session, part.page)
  const name = esc(songTitle(part))
  const cover = part.ncm?.cover
    ? `<img class="cover" src="${esc(part.ncm.cover)}" loading="lazy" alt="">`
    : ''
  const title = link
    ? `<a class="song" href="${link}" target="_blank">${name}</a><span class="go">↗</span>`
    : `<span class="song">${name}</span>`
  const ncm = part.ncm?.id
    ? ` <a class="ncm" href="https://music.163.com/#/song?id=${esc(part.ncm.id)}" target="_blank" title="网易云音乐试听">♪</a>`
    : ''
  return `${cover}<span class="songwrap">${title}${ncm}</span>`
}

function lyricLines(lrc) {
  return String(lrc || '')
    .split('\n')
    .map(l => l.replace(/^\[[^\]]*\]\s*/, '').trimEnd())
    .filter(l => l.trim().length > 0)
}

function lyricSection(st) {
  const withLyric = st.ranked.filter(
    r => r.part.ncm?.lyric && !r.part.ncm.lyric.noLyric && (r.part.ncm.lyric.text || r.part.ncm.lyric.trans)
  )
  if (!withLyric.length) return ''
  const cards = withLyric
    .map(r => {
      const p = r.part
      const ly = p.ncm.lyric
      const cover = p.ncm.cover ? `<img class="lcover" src="${esc(p.ncm.cover)}" loading="lazy" alt="">` : ''
      const orig = lyricLines(ly.text).join('\n')
      const trans = lyricLines(ly.trans).join('\n')
      const body = trans
        ? `<div class="lbody"><pre class="ltext">${esc(orig)}</pre><pre class="ltext trans">${esc(trans)}</pre></div>`
        : `<div class="lbody"><pre class="ltext">${esc(orig)}</pre></div>`
      return `<details class="lcard">
<summary>${cover}<span class="lsong">「${esc(songTitle(p))}」</span>
<span class="lartist">${esc(p.ncm.artist || p.parsed?.artist || '')}</span></summary>
${body}
</details>`
    })
    .join('')
  return `<section id="lyrics"><h2>📄 歌词本</h2>
<p class="legend">网易云官方歌词，日文歌附中文翻译（工作台「预取歌词」后生成）。</p>
<div class="lgrid">${cards}</div></section>`
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
.legend{color:var(--muted);font-size:12.5px;margin:-8px 0 14px;line-height:1.7}
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
.dv{font-style:normal;font-size:10.5px;font-weight:600;border-radius:4px;padding:0 4px;margin-left:5px;vertical-align:1px;white-space:nowrap}
.dv.pos{color:#c24545;background:#fdeeee}
.dv.neg{color:#2a6fb8;background:#eaf3fc}
td .dv,.dvg2{font-size:12px}
.fire{color:#e25822;font-weight:700}
.tag{font-style:normal;background:#fff0f4;color:var(--pink);border:1px solid #ffd6e2;border-radius:20px;padding:0 9px;font-size:12px;display:inline-block;margin:1px 3px 1px 0}
.tag.w2{font-size:13.5px;padding:1px 11px}
.tag.w3{font-size:15px;padding:2px 13px;font-weight:600}
.tagcloud{line-height:2.4}
.star{color:#f7a35c;font-weight:600;white-space:nowrap}
.cover{width:40px;height:40px;border-radius:8px;object-fit:cover;vertical-align:middle;margin-right:8px;box-shadow:0 1px 4px rgba(0,0,0,.15)}
.songwrap{display:inline-block;vertical-align:middle}
.ncm{font-weight:700;color:#c20c0c;margin-left:6px}
.pcover{width:34px;height:34px;border-radius:8px;vertical-align:-9px;margin-right:6px;object-fit:cover;border:1px solid rgba(255,255,255,.4)}
.lgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
.lcard{border:1px solid var(--line);border-radius:12px;padding:10px 14px;background:#fff}
.lcard summary{cursor:pointer;display:flex;align-items:center;gap:10px;list-style:none}
.lcard summary::-webkit-details-marker{display:none}
.lcard[open] summary{border-bottom:1px dashed var(--line);padding-bottom:8px;margin-bottom:8px}
.lcover{width:44px;height:44px;border-radius:8px;object-fit:cover;flex-shrink:0}
.lsong{font-weight:600}
.lartist{color:var(--muted);font-size:12.5px}
.lbody{display:flex;gap:14px;flex-wrap:wrap}
.ltext{flex:1 1 220px;margin:0;font-size:13px;line-height:1.9;white-space:pre-wrap;color:#30333a;max-height:340px;overflow:auto;font-family:inherit}
.ltext.trans{color:#61666d;background:#faf7f5;border-radius:8px;padding:8px}
.cmt{color:#61666d;font-size:13px;max-width:230px}
.dim{color:var(--muted)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}
.pbox h3{margin:0 0 10px;font-size:15px}
.pbox .pavggiven{color:var(--muted);font-size:12.5px;font-weight:400;margin-left:6px}
.pbox ol{margin:0;padding-left:22px}
.pbox li{margin:3px 0;font-size:14px}
.hcard{border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.hcard .htop{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px}
.hcard .hstd{color:#e25822;font-weight:700;white-space:nowrap}
.hcard ol{margin:6px 0 0;padding-left:0;list-style:none}
.hcard li{margin:7px 0;font-size:13.5px;line-height:1.7}
.hcard .cmt2{color:#61666d}
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

const LEGEND =
  '总分是每人独立打出的<b>主观总评</b>，不与维度分换算 · ' +
  '<span class="dv pos">Δ+</span>=情怀溢价 / <span class="dv neg">Δ−</span>=套路压分（反差 = 主观总评 − 维度参考分，参考分按 音乐本体/音画定制/本格共鸣 加权）· ' +
  '争议 = 大家总分的标准差'

function podium(st, session) {
  const medals = ['🥇', '🥈', '🥉']
  const classes = ['p1', 'p2', 'p3']
  return st.ranked
    .slice(0, 3)
    .map((r, i) => {
      const p = r.part
      const pr = p.parsed || {}
      const dvg = r.div != null ? `<div class="pmeta">反差 ${fmtDvg(r.div)}（主观 vs 维度参考）</div>` : ''
      const cover = p.ncm?.cover ? `<img class="pcover" src="${esc(p.ncm.cover)}" loading="lazy" alt="">` : ''
      return `<div class="pcard ${classes[i]}">
<div class="medal">${medals[i]}</div>
<div class="pavg">${r.avg ?? '—'}</div>
<div class="psong">${cover}「${esc(songTitle(p))}」</div>
<div class="pmeta">${esc(pr.artist || '')}${pr.anime ? ` · 《${esc(pr.anime)}》` : ''}${pr.kind ? ` · ${esc(pr.kind)}` : ''}</div>
<div class="pmeta">★ ${r.favCount} 人收藏</div>${dvg}
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
<td class="num">${stdCell(r.std, r.hot, r.voters.length)}</td>
<td class="num">${dvgSpan(r.div, 'dv dvg2')}</td>
<td>${personChips(r.persons, st.persons)}</td>
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
<thead><tr><th>#</th><th>曲名</th><th>番剧</th><th>均分</th><th title="大家总分的标准差，越大越吵">争议</th><th title="主观总评 − 维度参考分">反差</th><th>各人评分</th>${dimHead}<th>收藏</th><th>标签</th><th>短评</th></tr></thead>
<tbody>${rows}</tbody>
</table>`
}

function hotSection(st, session) {
  if (!st.controversial.length) return ''
  const cards = st.controversial
    .map(r => {
      const p = r.part
      const pr = p.parsed || {}
      const lines = Object.entries(r.persons || {})
        .filter(([, x]) => typeof x.score === 'number')
        .sort((a, b) => b[1].score - a[1].score)
        .map(([who, x]) => {
          const bits = [`<b>${esc(who)}</b> <span class="score">${x.score}</span>`]
          if (x.ref != null) {
            bits.push(dvgSpan(x.div))
            bits.push(`<span class="mini">参考 ${x.ref}</span>`)
          }
          if (x.tags?.length) bits.push(tagPills(x.tags))
          if (x.comment) bits.push(`<span class="cmt2">“${esc(x.comment)}”</span>`)
          return `<li>${bits.join(' ')}</li>`
        })
        .join('')
      const collective =
        p.tags?.length || p.comment
          ? `<div class="mini" style="margin-top:8px;border-top:1px dashed var(--line);padding-top:8px">${p.tags?.length ? tagPills(p.tags) : ''} ${p.comment ? esc(p.comment) : ''}</div>`
          : ''
      return `<div class="hcard">
<div class="htop"><span>${songCell(session, p)} <span class="mini">${esc(pr.artist || '')}</span></span><span class="hstd">🔥 ${r.std}</span></div>
<ol>${lines}</ol>${collective}
</div>`
    })
    .join('')
  return `<section id="hot"><h2>🔥 争议焦点</h2>
<p class="legend">总分标准差 ≥ ${st.hotLine} 判定为吵翻。这里的"评价构成"逐人摊开——同一首歌，谁给的是情怀分、谁给的是套路分，一眼见底。</p>
<div class="cols">${cards}</div></section>`
}

function dvgSection(st, session) {
  if (!st.premiums.length && !st.penalties.length) return ''
  const row = r =>
    `<li>${songCell(session, r.part)} ${dvgSpan(r.div, 'dv dvg2')} <span class="mini">主观 ${r.avg} vs 维度参考 ${r.refAvg}</span>${r.part.tags?.length ? ` ${tagPills(r.part.tags)}` : ''}</li>`
  return `<section id="dvg"><h2>⚖️ 反差榜</h2>
<p class="legend">反差 = 主观总评 − 维度参考分。正得越狠，越接近"编曲差点意思，但我情投意合"的本格溢价；负得越狠，越接近"写得再合格，也齁得我发慌"的套路罚分。这一栏是老饕的骄傲与倔强，不许被均分吃掉。</p>
<div class="cols">
${st.premiums.length ? `<div class="pbox"><h3>💗 本格溢价 Top ${st.premiums.length}</h3><ol>${st.premiums.map(row).join('')}</ol></div>` : ''}
${st.penalties.length ? `<div class="pbox"><h3>🧪 套路罚分 Top ${st.penalties.length}</h3><ol>${st.penalties.map(row).join('')}</ol></div>` : ''}
</div></section>`
}

function tagSection(st) {
  if (!st.tagStats.length) return ''
  const max = st.tagStats[0].count
  const pills = st.tagStats
    .map(t => {
      const ratio = t.count / max
      const cls = ratio >= 0.66 ? 'w3' : ratio >= 0.33 ? 'w2' : ''
      return `<em class="tag ${cls}">${esc(t.name)} × ${t.count}</em>`
    })
    .join('')
  return `<section id="tags"><h2>🏷️ 标签情绪统计</h2>
<p class="legend">集体标签与每个人的个人标签一起计数。「工业糖精」「拼好曲式-生硬」扎堆出现，就是全场对工业套路的合围。</p>
<div class="tagcloud">${pills}</div></section>`
}

function renderSessionHtml(session, st) {
  const date = new Date(session.createdAt).toLocaleDateString('zh-CN')
  const videoLink = session.bvid
    ? `<a href="https://www.bilibili.com/video/${esc(session.bvid)}" target="_blank" style="color:#fff">${esc(session.videoTitle || session.bvid)}</a>`
    : esc(session.videoTitle || '')
  const dimSections = st.dimBoards
    .map(
      b => `<section id="dim-${esc(b.dim.key)}">
<h2>${esc(b.dim.name)}榜 Top ${b.top.length}${b.dim.weight != null ? ` <span class="mini">权重 ${b.dim.weight}%</span>` : ''}</h2>
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

  const navBits = [
    '<a href="#board">总榜</a>',
    st.controversial.length ? '<a href="#hot">争议焦点</a>' : '',
    st.premiums.length || st.penalties.length ? '<a href="#dvg">反差榜</a>' : '',
    st.tagStats.length ? '<a href="#tags">标签</a>' : '',
    ...st.dimBoards.map(b => `<a href="#dim-${esc(b.dim.key)}">${esc(b.dim.name)}榜</a>`),
    '<a href="#fav">收藏</a>',
    '<a href="#persons">个人榜</a>',
    st.ranked.some(r => r.part.ncm?.lyric) ? '<a href="#lyrics">歌词本</a>' : ''
  ].filter(Boolean)

  return baseHtml(
    `${session.name} · 排行榜`,
    `<div class="hero">
<h1>${esc(session.name)}</h1>
<p class="sub">${videoLink} · ${date} · ${st.persons.length} 人参与 · 评了 ${st.votedCount}/${st.totalActive} 首</p>
<p class="nav">${navBits.join('')}</p>
</div>
<main>
${st.ranked.length ? `<section class="podium-sec" style="padding:0;background:none;box-shadow:none">${podium(st, session)}</section>` : ''}
<section id="board"><h2>总榜（${st.votedCount} 首）</h2>${st.ranked.length ? `<p class="legend">${LEGEND}</p>${boardTable(st, session)}` : '<p class="mini">还没有任何评分。</p>'}</section>
${hotSection(st, session)}
${dvgSection(st, session)}
${tagSection(st)}
${dimSections}
${favSection}
${personSection}
${lyricSection(st)}
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
<td class="num">${stdCell(s.std, s.std >= st.hotLine, s.voterCount)}</td>
<td class="num">${dvgSpan(s.div, 'dv dvg2')}</td>
<td class="num mini">${s.voterCount} 票</td>
<td class="star">${s.favCount ? `★ ${s.favCount}` : ''}</td>
<td class="mini">${s.sources.map(x => esc(x.session.name)).join('、')}</td>
</tr>`
    })
    .join('')

  const hotSection =
    st.controversial.length
      ? `<section id="hot"><h2>🔥 争议焦点（跨期）</h2>
<p class="legend">总分标准差 ≥ ${st.hotLine} 判定为吵翻。</p>
<table><thead><tr><th>#</th><th>曲名</th><th>争议</th><th>均分</th><th>反差</th><th>番剧</th><th>期次</th></tr></thead>
<tbody>${st.controversial
        .map(
          (s, i) =>
            `<tr><td class="num rank">${i + 1}</td><td>${esc(s.song)}${s.artist ? ` <span class="mini">${esc(s.artist)}</span>` : ''}</td>
<td class="num"><span class="fire">🔥 ${s.std}</span></td>
<td class="num"><span class="${scoreClass(s.avg)}">${s.avg ?? '—'}</span></td>
<td class="num">${dvgSpan(s.div, 'dv dvg2')}</td>
<td class="mini">${s.anime.map(a => `《${esc(a)}》`).join('')}</td>
<td class="mini">${s.sources.map(x => esc(x.session.name)).join('、')}</td></tr>`
        )
        .join('')}</tbody></table></section>`
      : ''

  const tagSection = st.tagStats.length
    ? `<section id="tags"><h2>🏷️ 标签情绪统计</h2><div class="tagcloud">${st.tagStats
        .map(t => `<em class="tag">${esc(t.name)} × ${t.count}</em>`)
        .join('')}</div></section>`
    : ''

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
<section id="board"><h2>歌曲总榜（跨期去重）</h2><p class="legend">${LEGEND}</p><table>
<thead><tr><th>#</th><th>曲名</th><th>番剧</th><th>均分</th><th>争议</th><th>反差</th><th>票数</th><th>收藏</th><th>出现期次</th></tr></thead>
<tbody>${boardRows}</tbody></table></section>
${hotSection}
${tagSection}
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
