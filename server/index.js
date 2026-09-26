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
import { fetchVideo, resolveBvid } from './bili.js'
import { parseTitle, applyDescEnhance } from './parse.js'
import { sessionStats, allStats, sessionConfig } from './stats.js'
import { renderSessionHtml, renderAllHtml } from './report-html.js'
import { renderSessionMd, renderAllMd } from './report-md.js'
import { buildSessionWorkbook, buildAllWorkbook } from './report-xlsx.js'
import { renderSheetHtml } from './sheet.js'
import { loadAiConfig, saveAiConfig, aiInfo, generateReview, testConnection, aiParseTitles } from './ai.js'
import {
  ncmStatus,
  matchPart,
  playSong,
  qrCreate,
  qrPoll,
  loadAuth,
  saveAuthPatch,
  searchKeyword,
  searchSong,
  syncToPlaylist,
  heartSong,
  listCreatedPlaylists,
  listPlaylistSongs,
  listHeartSongs,
  removeFromPlaylist,
  getLyric
} from './ncm.js'

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
  try {
    // 入参可以是 BV 号、含 BV 的分享文本或 b23.tv 短链
    let bvid = await resolveBvid(String(req.query.bvid || '').trim())
    if (!/^BV[a-zA-Z0-9]{8,12}$/.test(bvid)) {
      return res.status(400).json({ error: 'BV 号格式不正确（支持 BV 号、分享文本、b23.tv 短链）' })
    }
    const video = await fetchVideo(bvid, { refresh: req.query.refresh === '1' })
    ok(res).json(video)
  } catch (e) {
    res.status(502).json({ error: `B站接口调用失败：${e.message}` })
  }
})

// ---------- 期次 ----------
app.post('/api/sessions', async (req, res) => {
  const body = req.body || {}
  let source = { videoTitle: '', cover: '', bvid: '', desc: '', rawParts: [] }

  try {
    if (body.mode === 'manual') {
      const lines = (body.lines || [])
        .map(l => String(l).trim())
        .filter(Boolean)
      if (!lines.length) return res.status(400).json({ error: '粘贴的列表为空' })
      source = { videoTitle: String(body.manualTitle || '手动导入').trim(), cover: '', bvid: '', rawParts: lines.map((l, i) => ({ page: i + 1, cid: 0, part: l, duration: 0 })) }
    } else {
      // 入参兼容：纯 BV 号 / 含 BV 的分享文本 / b23.tv 短链
      let bvid = String(body.bvid || '').trim()
      if (!/(BV[a-zA-Z0-9]{8,12})/.test(bvid) && /b23\.tv/i.test(bvid)) {
        try {
          bvid = await resolveBvid(bvid)
        } catch (e) {
          return res.status(502).json({ error: `短链解析失败：${e.message}。可改用「手动粘贴列表」导入。` })
        }
        if (!bvid) {
          return res.status(400).json({ error: '短链里没找到 BV 号，请确认链接有效，或改用「手动粘贴列表」导入' })
        }
      }
      const m = bvid.match(/(BV[a-zA-Z0-9]{8,12})/)
      bvid = m ? m[1] : ''
      if (!bvid) {
        return res.status(400).json({ error: 'BV 号格式不正确，形如 BV1bFTB6GEjW（也支持 b23.tv 短链）' })
      }
      const video = await fetchVideo(bvid, { refresh: body.refresh === true })
      source = {
        videoTitle: video.title,
        cover: video.cover,
        bvid,
        desc: video.desc || '',
        rawParts: video.parts
      }
    }
  } catch (e) {
    return res.status(502).json({ error: `拉取分P失败：${e.message}。可改用「手动粘贴列表」导入。` })
  }

  // 建期即快照：把当前全局配置凝固成本期设置，之后与全局解耦（可在「本期设置」里单独调整）
  const cfg = loadConfig()
  const session = {
    id: newSessionId(),
    name: String(body.name || '').trim() || source.videoTitle || '新的一期',
    bvid: source.bvid,
    videoTitle: source.videoTitle,
    cover: source.cover,
    desc: source.desc || '',
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
      personTags: {},
      personComments: {},
      favorites: [],
      comment: '',
      tags: [],
      skipped: false
    })),
    settings: {
      persons: [...cfg.persons],
      dimensions: structuredClone(cfg.dimensions),
      tags: [...cfg.tags],
      scoreMin: cfg.scoreMin,
      scoreMax: cfg.scoreMax
    },
    followGlobal: false
  }
  // 标题解析不理想时，用视频简介里的曲目单兜底（条目数与分P数一致才做位置对齐）
  const enhancedByDesc = applyDescEnhance(session.parts, source.desc)
  saveSession(session)
  ok(res).json({ ...session, enhancedByDesc })
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
      noGlobal: !!s.noGlobal,
      followGlobal: !!s.followGlobal,
      hasSettings: !!s.settings,
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
  // 报告用本期生效配置（快照或跟随全局），旧期次的反差值不会被改全局追溯影响
  const config = sessionConfig(session, loadConfig())
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
  const all = listSessions()
  if (!all.length) return res.status(404).json({ error: '还没有任何期次' })
  // 「不计入全期总榜」的期次（轻量临时场）不参与跨期聚合
  const sessions = all.filter(s => !s.noGlobal)
  if (!sessions.length) {
    return res.status(404).json({ error: '所有期次都设置了「不计入全期总榜」，没有可聚合的数据' })
  }
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
  const { person, score, fav, personTags, personComment, dim } = req.body || {}
  if (!person || typeof person !== 'string') {
    return res.status(400).json({ error: '缺少 person' })
  }
  if (dim !== undefined) {
    // 维度分（手机打分页用）：{ person, dim: 维度key, score }，score null = 清除
    const dimKey = String(dim)
    part.dimScores = part.dimScores || {}
    part.dimScores[dimKey] = part.dimScores[dimKey] || {}
    if (score === null || score === '') {
      delete part.dimScores[dimKey][person]
    } else {
      const n = Number(score)
      if (Number.isNaN(n)) return res.status(400).json({ error: '维度分不是数字' })
      part.dimScores[dimKey][person] = n
    }
    saveSession(s)
    return ok(res).json({ page: part.page, dimScores: part.dimScores })
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
  if (personTags !== undefined) {
    part.personTags = part.personTags || {}
    if (Array.isArray(personTags) && personTags.length) {
      part.personTags[person] = [...new Set(personTags.map(t => String(t).trim()).filter(Boolean))]
    } else {
      delete part.personTags[person]
    }
  }
  if (personComment !== undefined) {
    part.personComments = part.personComments || {}
    const c = String(personComment ?? '').trim()
    if (c) part.personComments[person] = c
    else delete part.personComments[person]
  }
  saveSession(s)
  ok(res).json({
    page: part.page,
    scores: part.scores,
    favorites: part.favorites,
    personTags: part.personTags,
    personComments: part.personComments
  })
})

// ---------- 离线个人打分单（单文件 HTML，发给同学自己填） ----------
app.get('/api/sessions/:id/sheet', (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: '期次不存在' })
  const html = renderSheetHtml(session, sessionConfig(session, loadConfig()))
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
  // 本期有快照且未跟随全局时，新成员先进本期名单（全局模板也同步，方便下期沿用）
  const useSnapshot = s.followGlobal !== true && s.settings && Array.isArray(s.settings.dimensions)
  const added = []
  let total = 0
  let favTotal = 0
  let tagTotal = 0

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
    if (useSnapshot && !(s.settings.persons || []).includes(person)) {
      s.settings.persons = s.settings.persons || []
      s.settings.persons.push(person)
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
    // 个人标签（离线打分单 v2 起携带）：合并去重，不覆盖已有
    for (const [page, tags] of Object.entries(sheet.tags || {})) {
      const part = s.parts.find(p => p.page === Number(page))
      if (!part || !Array.isArray(tags)) continue
      part.personTags = part.personTags || {}
      const merged = new Set(part.personTags[person] || [])
      for (const t of tags) {
        const s2 = String(t).trim()
        if (s2) merged.add(s2)
      }
      if (merged.size) part.personTags[person] = [...merged]
      tagTotal++
    }
  }

  if (added.length) saveConfig(config)
  saveSession(s)
  ok(res).json({ addedPersons: added, scores: total, favorites: favTotal, tags: tagTotal })
})

// ---------- AI 锐评（DeepSeek） ----------
// Key 存 data/ai.json，独立于 config，任何接口都不明文回传
app.get('/api/ai/config', (req, res) => ok(res).json(aiInfo(loadAiConfig())))

app.put('/api/ai/config', (req, res) => {
  const ai = saveAiConfig(req.body || {})
  ok(res).json(aiInfo(ai))
})

app.post('/api/ai/test', async (req, res) => {
  try {
    const reply = await testConnection(loadAiConfig())
    ok(res).json({ ok: true, reply })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

app.post('/api/sessions/:id/ai-review', async (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: '期次不存在' })
  const config = sessionConfig(session, loadConfig())
  const st = sessionStats(session, config)
  try {
    const text = await generateReview(session, st, config, loadAiConfig())
    const review = { text, model: loadAiConfig().model, createdAt: new Date().toISOString() }
    session.aiReviews = [review, ...(session.aiReviews || [])].slice(0, 5)
    saveSession(session)
    ok(res).json({ review, total: session.aiReviews.length })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ---------- 网易云音乐（开放平台直连） ----------
app.get('/api/ncm/status', async (req, res) => {
  ok(res).json(await ncmStatus())
})

// 扫码登录：创建二维码 / 轮询状态
app.get('/api/ncm/login/qr', async (req, res) => {
  const r = await qrCreate()
  if (r.error) return res.status(400).json(r)
  ok(res).json(r)
})

app.get('/api/ncm/login/qr/:uniKey', async (req, res) => {
  ok(res).json(await qrPoll(req.params.uniKey))
})

// 匹配某一分P到网易云曲库，结果缓存进 part.ncm
app.post('/api/ncm/match', async (req, res) => {
  const { sessionId, page } = req.body || {}
  const s = getSession(sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const part = s.parts.find(p => p.page === Number(page))
  if (!part) return res.status(404).json({ error: '分P不存在' })

  const auth = loadAuth()
  if (!auth.appId || !auth.privateKey) {
    return res.status(400).json({ error: '网易云未配置：缺少 appId/privateKey（data/ncm-auth.json）' })
  }
  if (!loadAuth().userToken) {
    return res.status(400).json({ error: '网易云未登录：请先完成扫码登录（设置页或 /api/ncm/login/qr）' })
  }

  const r = await matchPart(auth, part)
  if (!r.ok) {
    const code = r.needLogin ? 401 : 502
    return res.status(code).json({ error: `网易云匹配失败：${r.error}`, keyword: r.keyword })
  }
  const song = r.song
  part.ncm = {
    id: song.id,
    encryptedId: song.encryptedId,
    name: song.name,
    artist: song.artist,
    album: song.album,
    cover: song.cover,
    payPlayFlag: song.payPlayFlag,
    vipFlag: song.vipFlag,
    keyword: r.keyword,
    matchedAt: new Date().toISOString()
  }
  saveSession(s)
  ok(res).json(part.ncm)
})

// 用 CLI 在本机播放（需 CLI 自己的登录态 + mpv）
app.post('/api/ncm/play', async (req, res) => {
  const { sessionId, page } = req.body || {}
  const s = getSession(sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const part = s.parts.find(p => p.page === Number(page))
  if (!part?.ncm) return res.status(400).json({ error: '这一分P还没匹配网易云歌曲' })
  const r = await playSong(part)
  if (!r.ok) return res.status(502).json({ error: `播放失败：${r.error}` })
  ok(res).json({ started: true })
})

// ---------- 收藏同步到网易云歌单 ----------
app.get('/api/ncm/playlist', (req, res) => {
  ok(res).json({ playlistId: loadAuth().ncmPlaylistId || '' })
})

app.put('/api/ncm/playlist', (req, res) => {
  const playlistId = String(req.body?.playlistId || '').trim()
  if (!playlistId) return res.status(400).json({ error: 'playlistId 不能为空' })
  saveAuthPatch({ ncmPlaylistId: playlistId })
  ok(res).json({ playlistId })
})

// 把当期所有被★收藏（且已匹配网易云）的歌批量加入目标歌单
app.post('/api/ncm/sync-favorites', async (req, res) => {
  const { sessionId } = req.body || {}
  const s = getSession(sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const auth = loadAuth()
  const playlistId = auth.ncmPlaylistId
  if (!playlistId) return res.status(400).json({ error: '未配置目标歌单 ID（设置页 → 网易云音乐）' })
  if (!auth.userToken) return res.status(401).json({ error: '网易云登录已过期，请重新扫码' })

  const favParts = (s.parts || []).filter(p => !p.skipped && p.favorites?.length && p.ncm?.encryptedId)
  if (!favParts.length) {
    return res.status(400).json({ error: '没有可同步的收藏（需要既被★收藏、又已🎵匹配网易云的歌）' })
  }
  const ids = [...new Set(favParts.map(p => p.ncm.encryptedId))]
  const r = await syncToPlaylist(auth, playlistId, ids)
  if (!r.ok) {
    return res.status(502).json({ error: r.error, ...r.partial })
  }
  libCache.clear()
  ok(res).json({
    songs: ids.length,
    parts: favParts.length,
    added: r.added,
    duplicate: r.duplicate
  })
})

// 用户创建的歌单列表（设置页选择目标歌单用）
app.get('/api/ncm/playlists', async (req, res) => {
  const r = await listCreatedPlaylists(loadAuth())
  if (!r.ok) return res.status(502).json({ error: r.error })
  ok(res).json(r.playlists)
})

// 红心同步：当期所有被★收藏（且已匹配）的歌加红心
app.post('/api/ncm/heart-favorites', async (req, res) => {
  const { sessionId } = req.body || {}
  const s = getSession(sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const auth = loadAuth()
  if (!auth.userToken) return res.status(401).json({ error: '网易云登录已过期，请重新扫码' })

  const favParts = (s.parts || []).filter(p => !p.skipped && p.favorites?.length && p.ncm?.encryptedId)
  if (!favParts.length) {
    return res.status(400).json({ error: '没有可同步的收藏（需要既被★收藏、又已🎵匹配网易云的歌）' })
  }
  const ids = [...new Set(favParts.map(p => p.ncm.encryptedId))]
  let hearted = 0
  const failed = []
  const paidSkipped = []
  for (const id of ids) {
    const r = await heartSong(auth, id, true)
    if (r.ok) hearted++
    else if (r.paid) paidSkipped.push(id)
    else failed.push({ id, error: r.error })
  }
  libCache.clear()
  ok(res).json({ songs: ids.length, hearted, paidSkipped: paidSkipped.length, failed })
})

// ---------- 网易云：远端资料库状态（红心/目标歌单已收录哪些歌） ----------
const libCache = new Map() // key -> {at, sets}

async function ncmLibrarySets(auth) {
  const key = `${auth.ncmPlaylistId || ''}`
  const hit = libCache.get(key)
  if (hit && Date.now() - hit.at < 60000) return hit.sets
  const heart = await listHeartSongs(auth)
  const target = auth.ncmPlaylistId
    ? await listPlaylistSongs(auth, auth.ncmPlaylistId)
    : { ok: false, error: '未配置目标歌单' }
  const sets = {
    heartIds: heart.ok ? new Set(heart.songs.map(x => x.encryptedId)) : null,
    heartError: heart.ok ? null : heart.error,
    targetIds: target.ok ? new Set(target.songs.map(x => x.encryptedId)) : null,
    targetError: target.ok ? null : target.error
  }
  libCache.set(key, { at: Date.now(), sets })
  return sets
}

app.get('/api/ncm/library/:sessionId', async (req, res) => {
  const s = getSession(req.params.sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const auth = loadAuth()
  if (!auth.userToken) return res.status(401).json({ error: '网易云登录已过期，请重新扫码' })
  try {
    const sets = await ncmLibrarySets(auth)
    const parts = {}
    for (const p of s.parts || []) {
      if (!p.ncm?.encryptedId) continue
      parts[p.page] = {
        hearted: sets.heartIds ? sets.heartIds.has(p.ncm.encryptedId) : null,
        inPlaylist: sets.targetIds ? sets.targetIds.has(p.ncm.encryptedId) : null
      }
    }
    ok(res).json({
      parts,
      heartCount: sets.heartIds ? sets.heartIds.size : null,
      targetCount: sets.targetIds ? sets.targetIds.size : null,
      heartError: sets.heartError,
      targetError: sets.targetError
    })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// ---------- 网易云：歌词（结果缓存进 part.ncm.lyric，报告直接可用） ----------
const lyricJobs = new Map() // sessionId -> {running, done, total}

async function fetchPartLyric(session, part) {
  const r = await getLyric(loadAuth(), part.ncm.encryptedId)
  if (!r.ok) throw new Error(r.error)
  part.ncm.lyric = { text: r.text, trans: r.trans, noLyric: r.noLyric, fetchedAt: new Date().toISOString() }
  saveSession(session)
  return part.ncm.lyric
}

app.get('/api/ncm/lyric/:sessionId/:page', async (req, res) => {
  const s = getSession(req.params.sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const part = s.parts.find(p => p.page === Number(req.params.page))
  if (!part?.ncm?.encryptedId) return res.status(400).json({ error: '这一分P还没匹配网易云歌曲' })
  if (part.ncm.lyric) return ok(res).json({ ...part.ncm.lyric, cached: true })
  try {
    const lyric = await fetchPartLyric(s, part)
    ok(res).json({ ...lyric, cached: false })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// 后台预取本期全部歌词（报告要附歌词本时先点这个）
app.post('/api/ncm/lyric-prefetch/:sessionId', async (req, res) => {
  const s = getSession(req.params.sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const auth = loadAuth()
  if (!auth.userToken) return res.status(401).json({ error: '网易云登录已过期，请重新扫码' })
  const job = lyricJobs.get(s.id)
  if (job?.running) return ok(res).json({ started: true, ...job })
  const targets = (s.parts || []).filter(p => p.ncm?.encryptedId && !p.ncm.lyric)
  const state = { running: true, done: 0, total: targets.length }
  lyricJobs.set(s.id, state)
  ok(res).json({ started: true, ...state })
  ;(async () => {
    try {
      for (const p of targets) {
        try {
          await fetchPartLyric(s, p)
        } catch {
          /* 单首失败不阻断预取 */
        }
        state.done++
        await new Promise(r => setTimeout(r, 250))
      }
    } finally {
      state.running = false
    }
  })()
})

app.get('/api/ncm/lyric-prefetch/:sessionId', (req, res) => {
  const job = lyricJobs.get(req.params.sessionId)
  ok(res).json(job || { running: false, done: 0, total: 0 })
})

// ---------- 网易云：换版本（搜索候选 + 手动选定） ----------
app.post('/api/ncm/search', async (req, res) => {
  const keyword = String(req.body?.keyword || '').trim()
  if (!keyword) return res.status(400).json({ error: '缺少搜索关键词' })
  const r = await searchSong(loadAuth(), keyword)
  if (!r.ok) return res.status(r.needLogin ? 401 : 502).json({ error: r.error })
  ok(res).json({ songs: r.songs.slice(0, 10) })
})

app.post('/api/ncm/set-song', (req, res) => {
  const { sessionId, page, song } = req.body || {}
  const s = getSession(sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const part = s.parts.find(p => p.page === Number(page))
  if (!part) return res.status(404).json({ error: '分P不存在' })
  if (!song?.id) return res.status(400).json({ error: '缺少歌曲信息' })
  part.ncm = {
    id: String(song.id),
    encryptedId: String(song.encryptedId || ''),
    name: String(song.name || ''),
    artist: String(song.artist || ''),
    album: String(song.album || ''),
    cover: String(song.cover || ''),
    payPlayFlag: Boolean(song.payPlayFlag),
    vipFlag: Boolean(song.vipFlag),
    keyword: part.ncm?.keyword || String(song.keyword || ''),
    matchedAt: new Date().toISOString()
  }
  saveSession(s)
  ok(res).json(part.ncm)
})

// 撤销本期同步：取消红心 + 从目标歌单移除（只动本期★收藏且已匹配的歌）
app.post('/api/ncm/undo-sync', async (req, res) => {
  const { sessionId, hearts = true, playlist = true } = req.body || {}
  const s = getSession(sessionId)
  if (!s) return res.status(404).json({ error: '期次不存在' })
  const auth = loadAuth()
  if (!auth.userToken) return res.status(401).json({ error: '网易云登录已过期，请重新扫码' })
  const favParts = (s.parts || []).filter(p => !p.skipped && p.favorites?.length && p.ncm?.encryptedId)
  if (!favParts.length) {
    return res.status(400).json({ error: '本期没有已★收藏且已匹配网易云的歌，无需撤销' })
  }
  if (playlist && !auth.ncmPlaylistId) {
    return res.status(400).json({ error: '未配置目标歌单（设置页 → 网易云音乐），本次未做任何改动' })
  }
  const ids = [...new Set(favParts.map(p => p.ncm.encryptedId))]
  const result = { songs: ids.length, unhearted: 0, heartFailed: [], removed: 0 }
  if (hearts) {
    for (const id of ids) {
      const r = await heartSong(auth, id, false)
      if (r.ok) result.unhearted++
      else result.heartFailed.push({ id, error: r.error })
    }
  }
  if (playlist) {
    if (!auth.ncmPlaylistId) return res.status(400).json({ error: '未配置目标歌单，无法从歌单移除' })
    const r = await removeFromPlaylist(auth, auth.ncmPlaylistId, ids)
    if (!r.ok) return res.status(502).json({ error: r.error, ...result })
    result.removed = r.removed
  }
  libCache.clear()
  ok(res).json(result)
})

// ---------- 数据备份 / 恢复（不含 data/ncm-auth.json 凭证与缓存） ----------
app.get('/api/backup', (req, res) => {
  const bundle = {
    app: 'oped-party-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    config: loadConfig(),
    sessions: listSessions()
  }
  const day = new Date().toISOString().slice(0, 10)
  sendFile(res, {
    format: 'json',
    baseName: `oped-party-backup-${day}`,
    inline: false,
    content: JSON.stringify(bundle)
  })
})

app.post('/api/restore', (req, res) => {
  const b = req.body || {}
  if (b.app !== 'oped-party-backup' || !b.config) {
    return res.status(400).json({ error: '不是本工具导出的备份文件' })
  }
  saveConfig(b.config)
  let n = 0
  const ids = []
  for (const s of Array.isArray(b.sessions) ? b.sessions : []) {
    if (s?.id && Array.isArray(s.parts)) {
      saveSession(s)
      ids.push(s.id)
      n++
    }
  }
  ok(res).json({ configRestored: true, sessionsRestored: n, sessionIds: ids })
})

// AI 标题识别：分P标题批量结构化，只补空/弱字段，不覆盖已解析和人工修正的信息
app.post('/api/sessions/:id/ai-parse', async (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: '期次不存在' })
  try {
    const list = await aiParseTitles(loadAiConfig(), session.parts.map(p => p.title))
    let applied = 0
    session.parts.forEach((p, i) => {
      const e = list[i]
      if (!e) return
      const cur = p.parsed
      const next = { ...cur }
      const fill = (key, val) => {
        // song === title 说明正则没解析出来，视为弱字段允许补
        const weak = key === 'song' ? !cur.song || cur.song === p.title : !cur[key]
        if (val && weak && val !== p.title) {
          next[key] = val
          applied++
        }
      }
      fill('kind', e.kind)
      fill('anime', e.anime)
      fill('song', e.song)
      fill('artist', e.artist)
      p.parsed = next
    })
    saveSession(session)
    ok(res).json({ applied, parts: session.parts.map(p => p.parsed) })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
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
