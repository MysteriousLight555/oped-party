import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  loadConfig,
  saveConfig,
  listSessions,
  getSession,
  saveSession,
  deleteSession,
  newSessionId,
  DATA_DIR
} from './store.js'
import { fetchVideo } from './bili.js'
import { parseTitle } from './parse.js'
import { sessionStats, allStats } from './stats.js'
import { renderSessionHtml, renderAllHtml } from './report-html.js'
import { renderSessionMd, renderAllMd } from './report-md.js'
import { buildSessionWorkbook, buildAllWorkbook } from './report-xlsx.js'
import { renderSheetHtml } from './sheet.js'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
// 端口避开常见服务（4310 是 OpenTelemetry 默认端口，本机可能有采集端点占用 IPv6 侧）
const PORT = Number(process.env.PORT || 18890)
const HOST = process.env.HOST || '127.0.0.1'
const app = express()
app.use(express.json({ limit: '8mb' }))

const ok = res => res.type('application/json; charset=utf-8')

// ---------- 配置 ----------
app.get('/api/config', (req, res) => ok(res).json(loadConfig()))

app.put('/api/config', (req, res) => {
  const cfg = req.body || {}
  if (!Array.isArray(cfg.persons) || !Array.isArray(cfg.dimensions) || !Array.isArray(cfg.tags)) {
    return res.status(400).json({ error: 'config 格式不正确' })
  }
  saveConfig(cfg)
  ok(res).json(cfg)
})

// ---------- B 站视频信息 ----------
app.get('/api/bili/video', async (req, res) => {
  const bvid = String(req.query.bvid || '').trim()
  if (!/^BV[a-zA-Z0-9]{8,12}$/.test(bvid)) {
    return res.status(400).json({ error: 'BV 号格式不正确' })
  }
  try {
    const video = await fetchVideo(bvid, { refresh: req.query.refresh === '1' })
    ok(res).json(video)
  } catch (e) {
    res.status(502).json({ error: `B站接口调用失败：${e.message}` })
  }
})

// ---------- 期次 ----------
app.post('/api/sessions', async (req, res) => {
  const body = req.body || {}
  let source = { videoTitle: '', cover: '', bvid: '', rawParts: [] }

  try {
    if (body.mode === 'manual') {
      const lines = (body.lines || [])
        .map(l => String(l).trim())
        .filter(Boolean)
      if (!lines.length) return res.status(400).json({ error: '粘贴的列表为空' })
      source = { videoTitle: String(body.manualTitle || '手动导入').trim(), cover: '', bvid: '', rawParts: lines.map((l, i) => ({ page: i + 1, cid: 0, part: l, duration: 0 })) }
    } else {
      const bvid = String(body.bvid || '').trim()
      if (!/^BV[a-zA-Z0-9]{8,12}$/.test(bvid)) {
        return res.status(400).json({ error: 'BV 号格式不正确，形如 BV1bFTB6GEjW' })
      }
      const video = await fetchVideo(bvid, { refresh: body.refresh === true })
      source = {
        videoTitle: video.title,
        cover: video.cover,
        bvid,
        rawParts: video.parts
      }
    }
  } catch (e) {
    return res.status(502).json({ error: `拉取分P失败：${e.message}。可改用「手动粘贴列表」导入。` })
  }

  const session = {
    id: newSessionId(),
    name: String(body.name || '').trim() || source.videoTitle || '新的一期',
    bvid: source.bvid,
    videoTitle: source.videoTitle,
    cover: source.cover,
    createdAt: new Date().toISOString(),
    done: false,
    parts: source.rawParts.map(p => ({
      page: p.page,
      cid: p.cid || 0,
      title: p.part,
      duration: p.duration || 0,
      parsed: parseTitle(p.part),
      scores: {},
      dimScores: {},
      favorites: [],
      comment: '',
      tags: [],
      skipped: false
    }))
  }
  saveSession(session)
  ok(res).json(session)
})

app.get('/api/sessions', (req, res) => {
  const config = loadConfig()
  const list = listSessions().map(s => {
    const st = sessionStats(s, config)
    return {
      id: s.id,
      name: s.name,
      bvid: s.bvid,
      videoTitle: s.videoTitle,
      createdAt: s.createdAt,
      done: s.done,
      total: s.parts.length,
      voted: st.votedCount,
      skipped: st.skipped.length
    }
  })
  ok(res).json(list)
})

app.get('/api/sessions/:id', (req, res) => {
  const s = getSession(req.params.id)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  ok(res).json(s)
})

app.put('/api/sessions/:id', (req, res) => {
  const s = getSession(req.params.id)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const body = req.body || {}
  saveSession({ ...body, id: s.id })
  ok(res).json({ saved: true })
})

app.delete('/api/sessions/:id', (req, res) => {
  deleteSession(req.params.id)
  ok(res).json({ deleted: true })
})

// ---------- 报告 ----------
const MIME = {
  html: 'text/html; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  json: 'application/json; charset=utf-8'
}

function sendFile(res, { format, baseName, inline, content }) {
  const ext = format === 'md' ? 'md' : format
  res.setHeader('Content-Type', MIME[format] || 'application/octet-stream')
  res.setHeader(
    'Content-Disposition',
    `${inline ? 'inline' : 'attachment'}; filename="report.${ext}"; filename*=UTF-8''${encodeURIComponent(`${baseName}.${ext}`)}`
  )
  if (Buffer.isBuffer(content)) res.send(content)
  else res.send(String(content))
}

app.get('/api/sessions/:id/report/:format', async (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: '期次不存在' })
  const config = loadConfig()
  const st = sessionStats(session, config)
  const { format } = req.params
  const inline = req.query.inline === '1'
  const base = `${session.name}-排行榜`

  try {
    if (format === 'html') return sendFile(res, { format, baseName: base, inline, content: renderSessionHtml(session, st) })
    if (format === 'md') return sendFile(res, { format, baseName: base, inline, content: renderSessionMd(session, st) })
    if (format === 'xlsx') return sendFile(res, { format, baseName: base, inline, content: await buildSessionWorkbook(session, st) })
    if (format === 'json') return sendFile(res, { format, baseName: base, inline, content: JSON.stringify({ config, session }, null, 2) })
    res.status(400).json({ error: '不支持的格式' })
  } catch (e) {
    res.status(500).json({ error: `报告生成失败：${e.message}` })
  }
})

app.get('/api/reports/all/:format', async (req, res) => {
  const sessions = listSessions()
  if (!sessions.length) return res.status(404).json({ error: '还没有任何期次' })
  const config = loadConfig()
  const st = allStats(sessions, config)
  const { format } = req.params
  const inline = req.query.inline === '1'
  const base = '全期总榜'

  try {
    if (format === 'html') return sendFile(res, { format, baseName: base, inline, content: renderAllHtml(sessions, st) })
    if (format === 'md') return sendFile(res, { format, baseName: base, inline, content: renderAllMd(sessions, st) })
    if (format === 'xlsx') return sendFile(res, { format, baseName: base, inline, content: await buildAllWorkbook(sessions, st) })
    if (format === 'json') return sendFile(res, { format, baseName: base, inline, content: JSON.stringify({ config, sessions }, null, 2) })
    res.status(400).json({ error: '不支持的格式' })
  } catch (e) {
    res.status(500).json({ error: `报告生成失败：${e.message}` })
  }
})

// ---------- 单曲级合并写入（悬浮面板 / 在线个人打分页共用，避免整份覆盖竞态） ----------
app.put('/api/sessions/:id/part/:page', (req, res) => {
  const s = getSession(req.params.id)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const part = s.parts.find(p => p.page === Number(req.params.page))
  if (!part) return res.status(404).json({ error: '分P不存在' })
  const { person, score, fav } = req.body || {}
  if (!person || typeof person !== 'string') {
    return res.status(400).json({ error: '缺少 person' })
  }
  if (score !== undefined) {
    if (score === null || score === '') {
      delete part.scores[person]
    } else {
      const n = Number(score)
      if (Number.isNaN(n)) return res.status(400).json({ error: '分数不是数字' })
      part.scores[person] = n
    }
  }
  if (fav !== undefined) {
    part.favorites = part.favorites || []
    const i = part.favorites.indexOf(person)
    if (fav && i < 0) part.favorites.push(person)
    if (!fav && i >= 0) part.favorites.splice(i, 1)
  }
  saveSession(s)
  ok(res).json({ page: part.page, scores: part.scores, favorites: part.favorites })
})

// ---------- 离线个人打分单（单文件 HTML，发给同学自己填） ----------
app.get('/api/sessions/:id/sheet', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: '期次不存在' })
  const html = renderSheetHtml(session, loadConfig())
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="sheet.html"; filename*=UTF-8''${encodeURIComponent(`${session.name}-打分单.html`)}`
  )
  res.send(html)
})

// ---------- 导入个人打分单 JSON（支持一次多份） ----------
app.post('/api/sessions/:id/import', (req, res) => {
  const s = getSession(req.params.id)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const body = req.body || {}
  const sheets = Array.isArray(body) ? body : Array.isArray(body.sheets) ? body.sheets : [body]
  const config = loadConfig()
  config.persons = config.persons || []
  const added = []
  let total = 0
  let favTotal = 0

  for (const sheet of sheets) {
    if (!sheet || typeof sheet !== 'object') continue
    if (sheet.app !== 'oped-party-sheet') {
      return res.status(400).json({ error: '不是本工具导出的打分单文件' })
    }
    if (sheet.sessionId && sheet.sessionId !== s.id) {
      return res.status(400).json({
        error: `「${sheet.sessionName || sheet.sessionId}」的打分单不属于这一期「${s.name}」`
      })
    }
    const person = String(sheet.person || '').trim()
    if (!person) continue
    if (!config.persons.includes(person)) {
      config.persons.push(person)
      added.push(person)
    }
    for (const [page, score] of Object.entries(sheet.scores || {})) {
      const part = s.parts.find(p => p.page === Number(page))
      if (!part) continue
      const n = Number(score)
      if (Number.isNaN(n)) continue
      part.scores = part.scores || {}
      part.scores[person] = Math.round(n)
      total++
    }
    for (const page of sheet.favorites || []) {
      const part = s.parts.find(p => p.page === Number(page))
      if (!part) continue
      part.favorites = part.favorites || []
      if (!part.favorites.includes(person)) part.favorites.push(person)
      favTotal++
    }
  }

  if (added.length) saveConfig(config)
  saveSession(s)
  ok(res).json({ addedPersons: added, scores: total, favorites: favTotal })
})

// ---------- 前端静态资源 ----------
const DIST = path.join(ROOT, 'dist')
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST))
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(path.join(DIST, 'index.html'))
    }
    next()
  })
}

app.use((req, res) => res.status(404).json({ error: 'not found' }))

app.listen(PORT, HOST, () => {
  console.log(`[oped-party] http://${HOST}:${PORT}  （数据目录 ${DATA_DIR}）`)
}).on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用——鉴赏会小站可能已经在运行了，直接打开 http://${HOST}:${PORT} 即可。`)
    process.exit(0)
  }
  throw e
})
