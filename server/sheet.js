/** 离线个人打分单：单文件自包含 HTML，同学在自己电脑/手机上点分后导出 JSON 发回 */

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const CSS = `
:root{--pink:#fb7299;--ink:#18191c;--muted:#9499a0;--card:#fff;--line:#e6e8ec}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:#f3f4f8;color:var(--ink);font:15px/1.6 -apple-system,"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif}
.head{background:linear-gradient(120deg,#fb7299,#f25d8e 45%,#23ade5 130%);color:#fff;padding:22px 16px;text-align:center}
.head h1{margin:0 0 6px;font-size:20px}
.head p{margin:0;opacity:.9;font-size:13px}
.wrap{max-width:720px;margin:-18px auto 0;padding:0 12px 60px}
.bar{background:var(--card);border-radius:12px;padding:14px 16px;box-shadow:0 2px 12px rgba(0,0,0,.06);margin-bottom:12px}
.bar .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
select,input.txt{border:1px solid #dcdfe6;border-radius:8px;padding:8px 10px;font-size:15px;outline:none}
select:focus,input.txt:focus{border-color:var(--pink)}
#personCustom{display:none;flex:1}
.progress{color:var(--muted);font-size:13px;margin-left:auto}
.rowlist{display:flex;flex-direction:column;gap:8px}
.item{background:var(--card);border-radius:12px;padding:10px 14px;box-shadow:0 1px 6px rgba(0,0,0,.04)}
.item .t{display:flex;align-items:baseline;gap:8px;margin-bottom:6px}
.item .num{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;flex-shrink:0}
.item .song{font-weight:600;font-size:15px}
.item .meta{color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item.hide{display:none}
.scores{display:flex;gap:5px;flex-wrap:wrap;align-items:center}
.sb{min-width:34px;height:32px;border-radius:16px;border:1px solid #dcdfe6;background:#fff;font-size:14px;font-variant-numeric:tabular-nums;cursor:pointer;color:var(--ink)}
.sb:hover{border-color:var(--pink);color:var(--pink)}
.sb.on{background:var(--pink);border-color:var(--pink);color:#fff;font-weight:700}
.fav{border:none;background:none;font-size:20px;color:#d5d8db;cursor:pointer;padding:0 2px}
.fav.on{color:#f7a35c}
input.big{width:90px;height:32px;border-radius:8px;border:1px solid #dcdfe6;font-size:15px;text-align:center}
.tags{margin-top:7px;display:flex;flex-wrap:wrap;gap:5px}
.tags:empty{display:none}
.tg{border:1px solid #e3e5e9;background:#fff;color:#61666d;border-radius:20px;padding:2px 10px;font-size:12px;cursor:pointer;font-family:inherit}
.tg:hover{border-color:var(--pink);color:var(--pink)}
.tg.on{background:#fff0f4;border-color:#ffd6e2;color:var(--pink);font-weight:600}
.tgtip{color:var(--muted);font-size:11.5px;margin-right:2px;align-self:center}
.footbar{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);padding:10px 16px;display:flex;gap:10px;justify-content:center;box-shadow:0 -2px 10px rgba(0,0,0,.05)}
.footbar button{border:none;border-radius:10px;padding:12px 26px;font-size:16px;cursor:pointer}
#exportBtn{background:linear-gradient(120deg,#fb7299,#f06292);color:#fff;font-weight:600}
#exportBtn:disabled{opacity:.45}
.tip{color:var(--muted);font-size:12.5px;margin:8px 2px 0}
`

const APP_JS = `
const S = window.__SHEET__
const state = { person: '', custom: '', scores: {}, favs: new Set(), tags: {} }

const personSel = document.getElementById('personSel')
const personCustom = document.getElementById('personCustom')
const listEl = document.getElementById('list')
const exportBtn = document.getElementById('exportBtn')
const searchEl = document.getElementById('search')
const progressEl = document.getElementById('progress')

personSel.innerHTML =
  '<option value="">选择你是谁…</option>' +
  S.persons.map(p => '<option>' + esc(p) + '</option>').join('') +
  '<option value="__custom__">✎ 其他人…</option>'
personSel.onchange = () => {
  personCustom.style.display = personSel.value === '__custom__' ? 'block' : 'none'
  updateBtn()
}
personCustom.oninput = updateBtn

searchEl.oninput = () => {
  const kw = searchEl.value.trim().toLowerCase()
  document.querySelectorAll('.item').forEach(el => {
    el.classList.toggle('hide', kw && !el.dataset.kw.includes(kw))
  })
}

function me() {
  return personSel.value === '__custom__' ? personCustom.value.trim() : personSel.value
}
function updateBtn() {
  exportBtn.disabled = !me()
  const n = Object.keys(state.scores).length
  progressEl.textContent = '已评 ' + n + '/' + S.parts.length
}

const useButtons = S.scoreMax - S.scoreMin + 1 <= 10

for (const p of S.parts) {
  const item = document.createElement('div')
  item.className = 'item'
  item.dataset.kw = (p.song + ' ' + p.artist + ' ' + p.anime + ' ' + p.title).toLowerCase()

  const t = document.createElement('div')
  t.className = 't'
  const num = document.createElement('span')
  num.className = 'num'
  num.textContent = 'P' + p.page
  const song = document.createElement('span')
  song.className = 'song'
  song.textContent = '「' + p.song + '」'
  t.append(num, song)
  if (p.artist || p.anime) {
    const meta = document.createElement('div')
    meta.className = 'meta'
    meta.textContent = [p.artist, p.anime ? '《' + p.anime + '》' : '', p.kind].filter(Boolean).join(' · ')
    t.append(meta)
  }
  item.append(t)

  const sc = document.createElement('div')
  sc.className = 'scores'
  if (useButtons) {
    for (let v = S.scoreMin; v <= S.scoreMax; v++) {
      const b = document.createElement('button')
      b.className = 'sb'
      b.textContent = v
      b.onclick = () => {
        if (state.scores[p.page] === v) {
          delete state.scores[p.page]
          b.classList.remove('on')
        } else {
          state.scores[p.page] = v
          item.querySelectorAll('.sb').forEach(x => x.classList.remove('on'))
          b.classList.add('on')
        }
        updateBtn()
      }
      sc.append(b)
    }
  } else {
    const inp = document.createElement('input')
    inp.className = 'big'
    inp.type = 'number'
    inp.min = S.scoreMin
    inp.max = S.scoreMax
    inp.placeholder = S.scoreMin + '-' + S.scoreMax
    inp.oninput = () => {
      const v = Number(inp.value)
      if (inp.value === '' || Number.isNaN(v)) delete state.scores[p.page]
      else state.scores[p.page] = v
      updateBtn()
    }
    sc.append(inp)
  }
  const fav = document.createElement('button')
  fav.className = 'fav'
  fav.textContent = '★'
  fav.title = '收藏'
  fav.onclick = () => {
    if (state.favs.has(p.page)) {
      state.favs.delete(p.page)
      fav.classList.remove('on')
    } else {
      state.favs.add(p.page)
      fav.classList.add('on')
    }
  }
  sc.append(fav)
  item.append(sc)

  // 个人标签：解释"为什么我给这个分"（工业糖精 / 情怀暴击…），导入后进报告的反差注解
  if (S.tags.length) {
    const tagsEl = document.createElement('div')
    tagsEl.className = 'tags'
    const tip = document.createElement('span')
    tip.className = 'tgtip'
    tip.textContent = '标签：'
    tagsEl.append(tip)
    for (const t of S.tags) {
      const b = document.createElement('button')
      b.className = 'tg'
      b.textContent = t
      b.onclick = () => {
        if (!me()) {
          alert('先在上面选好你是谁')
          return
        }
        const cur = new Set(state.tags[p.page] || [])
        if (cur.has(t)) {
          cur.delete(t)
          b.classList.remove('on')
        } else {
          cur.add(t)
          b.classList.add('on')
        }
        if (cur.size) state.tags[p.page] = [...cur]
        else delete state.tags[p.page]
      }
      tagsEl.append(b)
    }
    item.append(tagsEl)
  }

  listEl.append(item)
}
updateBtn()

exportBtn.onclick = () => {
  const person = me()
  if (!person) return
  const payload = {
    app: 'oped-party-sheet',
    v: 2,
    sessionId: S.sessionId,
    sessionName: S.sessionName,
    person,
    scores: state.scores,
    favorites: [...state.favs],
    tags: state.tags
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = S.sessionName + '-' + person + '-打分.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  alert('已导出「' + a.download + '」，把这个文件发回给主持人就行！')
}

window.addEventListener('beforeunload', e => {
  if (Object.keys(state.scores).length && exportBtn.disabled === false) e.preventDefault()
})
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
`

export function renderSheetHtml(session, config) {
  const data = {
    sessionId: session.id,
    sessionName: session.name,
    scoreMin: config.scoreMin ?? 1,
    scoreMax: config.scoreMax ?? 10,
    persons: config.persons || [],
    tags: config.tags || [],
    parts: (session.parts || [])
      .filter(p => !p.skipped)
      .map(p => ({
        page: p.page,
        title: p.title,
        kind: p.parsed?.kind || '',
        song: p.parsed?.song || p.title,
        artist: p.parsed?.artist || '',
        anime: p.parsed?.anime || ''
      }))
  }
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(session.name)} · 个人打分单</title>
<style>${CSS}</style>
</head>
<body>
<div class="head">
  <h1>${esc(session.name)}</h1>
  <p>个人打分单 · 选好你的名字，听完一首点一首</p>
</div>
<div class="wrap">
  <div class="bar">
    <div class="row">
      <select id="personSel"></select>
      <input id="personCustom" class="txt" placeholder="输入你的名字">
      <span class="progress" id="progress"></span>
    </div>
    <div class="row" style="margin-top:8px">
      <input id="search" class="txt" placeholder="搜索曲名 / 歌手 / 番剧" style="flex:1">
    </div>
    <p class="tip">点分数即选中，再点一下取消；★ 收藏；「标签」是你自己的情绪判断（如 工业糖精 / 情怀暴击），可帮主持人解释你的反差分。全部评完点底部「导出打分结果」，把 JSON 文件发回群里/会议聊天。</p>
  </div>
  <div class="rowlist" id="list"></div>
</div>
<div class="footbar">
  <button id="exportBtn" disabled>导出打分结果</button>
</div>
<script>window.__SHEET__ = ${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>${APP_JS}</script>
</body>
</html>`
}
