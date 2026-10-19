import express from 'express'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import QRCode from 'qrcode'
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
import {
  getHostKey,
  isHost,
  isDirectLocal,
  isForwarded,
  participantFromReq,
  issueParticipantToken,
  pinThrottled,
  notePinFailure,
  clearPinFailures,
  verifyHostKey
} from './auth.js'
import {
  HttpError,
  addMember,
  applyOps,
  cleanMemberName,
  membersOf,
  missingBeforeFinish,
  newPin,
  normalizeScore,
  normalizeSession,
  participantSession,
  progressOf,
  stageOf
} from './party.js'
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
app.disable('x-powered-by')
app.use(express.json({ limit: '8mb' }))

// 鉴赏会进行中优先保证服务不倒：单个异步接口漏了 catch 时只记日志，不退出进程
process.on('unhandledRejection', e => {
  console.error('[oped-party] unhandledRejection:', e)
})

const ok = res => res.type('application/json; charset=utf-8')

// ---------- 权限中间件 ----------
function hostOnly(req, res, next) {
  if (!isHost(req)) {
    return res.status(403).json({
      error: '需要主持人权限。通过公网/其他设备访问时，请在首页输入房间管理密钥。',
      code: 'HOST_ONLY'
    })
  }
  next()
}

/** 同步/异步处理器统一兜底，HttpError 直接回 4xx */
const wrap = fn => (req, res, next) => {
  try {
    const r = fn(req, res, next)
    if (r && typeof r.then === 'function') r.catch(e => fail(res, e))
  } catch (e) {
    fail(res, e)
  }
}

function fail(res, e) {
  if (e instanceof HttpError) {
    return res.status(e.status).json({ error: e.message, ...e.extra })
  }
  console.error('[oped-party]', e)
  res.status(500).json({ error: `服务器内部错误：${e.message}` })
}

function loadParty(req, res, config) {
  const s = getSession(req.params.id)
  if (!s) {
    res.status(404).json({ error: '期次不存在' })
    return null
  }
  normalizeSession(s, config)
  return s
}

function actorOf(req, session) {
  if (isHost(req)) return { role: 'host' }
  const token = participantFromReq(req)
  if (token && token.sessionId === session.id) {
    return { role: 'participant', person: token.person }
  }
  return null
}

// API 一律不缓存：大屏/手机每几秒轮询，拿到旧数据会显示错歌
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store')
  next()
})

// 主持人用密钥访问后，顺手种一个 HttpOnly Cookie：
// 报告预览 / 备份下载是浏览器直接导航，没法带 x-host-key 请求头
app.use((req, res, next) => {
  const key = String(req.headers['x-host-key'] || '')
  if (key && verifyHostKey(key) && !String(req.headers.cookie || '').includes('oped_host=')) {
    res.cookie('oped_host', key, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 30 * 86400000,
      path: '/'
    })
  }
  next()
})

// ---------- 身份 / 邀请 ----------
app.get('/api/access', (req, res) => {
  const token = participantFromReq(req)
  ok(res).json({
    host: isHost(req),
    direct: isDirectLocal(req),
    forwarded: isForwarded(req),
    participant: token ? { sessionId: token.sessionId, person: token.person } : null
  })
})

app.post('/api/host/claim', (req, res) => {
  const key = String(req.body?.key || '').trim()
  if (!key) return res.status(400).json({ error: '请输入房间管理密钥' })
  if (!verifyHostKey(key)) {
    return res.status(403).json({ error: '密钥不对（可在启动窗口或本机设置页查看）' })
  }
  res.cookie('oped_host', key, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 86400000,
    path: '/'
  })
  ok(res).json({ host: true })
})

app.get('/api/host/key', hostOnly, (req, res) => {
  ok(res).json({ key: getHostKey() })
})

app.get(
  '/api/qr',
  hostOnly,
  wrap(async (req, res) => {
    const text = String(req.query.text || '').trim()
    if (!text) return res.status(400).json({ error: '缺少二维码内容' })
    if (text.length > 1200) return res.status(400).json({ error: '内容太长' })
    const svg = await QRCode.toString(text, {
      type: 'svg',
      margin: 1,
      width: 240,
      color: { dark: '#18191c', light: '#ffffff' }
    })
    res.type('image/svg+xml; charset=utf-8').send(svg)
  })
)

// ---------- 配置 ----------
app.get('/api/config', (req, res) => ok(res).json(loadConfig()))

app.put('/api/config', hostOnly, (req, res) => {
  const cfg = req.body || {}
  if (!Array.isArray(cfg.persons) || !Array.isArray(cfg.dimensions) || !Array.isArray(cfg.tags)) {
    return res.status(400).json({ error: 'config 格式不正确' })
  }
  saveConfig(cfg)
  ok(res).json(cfg)
})

// ---------- B 站视频信息 ----------
app.get('/api/bili/video', hostOnly, async (req, res) => {
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
app.post('/api/sessions', hostOnly, async (req, res) => {
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
    rev: 0,
    members: [...(cfg.persons || [])],
    pin: newPin(),
    stage: { currentPage: null, blind: false, revealed: false, updatedAt: null },
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
  normalizeSession(session, cfg)
  session.stage.currentPage = session.parts.find(p => !p.skipped)?.page ?? null
  saveSession(session)
  ok(res).json({ ...session, enhancedByDesc })
})

app.get('/api/sessions', hostOnly, (req, res) => {
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
      total: st.totalActive,
      voted: st.votedCount,
      complete: st.completeCount,
      members: st.members.length,
      skipped: st.skipped.length
    }
  })
  ok(res).json(list)
})

app.get('/api/sessions/:id', (req, res) => {
  const config = loadConfig()
  const s = loadParty(req, res, config)
  if (!s) return
  const actor = actorOf(req, s)
  if (!actor) {
    return res.status(403).json({ error: '请先通过邀请链接加入本场', code: 'NEED_JOIN' })
  }
  if (actor.role === 'participant') {
    return ok(res).json(participantSession(s, config, actor.person))
  }
  const live = progressOf(s, config)
  ok(res).json({
    ...s,
    members: live.members,
    progress: live.progress,
    totalActive: live.totalActive,
    votedCount: live.votedCount,
    completeCount: live.completeCount
  })
})

/** 字段级合并写入：工作台自动保存走这里，只提交"我改过的格子"，不会整期回写 */
app.put(
  '/api/sessions/:id/patch',
  wrap((req, res) => {
    const config = loadConfig()
    const s = loadParty(req, res, config)
    if (!s) return
    const actor = actorOf(req, s)
    if (!actor) return res.status(403).json({ error: '没有权限修改本场', code: 'NEED_JOIN' })
    if (s.done) {
      return res.status(409).json({
        error: '本场已结束并锁定评分，需要主持人重新开放才能修改',
        code: 'SESSION_CLOSED'
      })
    }
    const ops = Array.isArray(req.body?.ops) ? req.body.ops : []
    const revBefore = Number(s.rev) || 0
    const baseRev = req.body?.baseRev
    if (!ops.length) {
      return ok(res).json({ saved: false, changed: 0, rev: revBefore, conflicts: [] })
    }
    const r = applyOps(s, ops, { config, actor })
    if (r.changed > 0) saveSession(s)
    ok(res).json({
      saved: r.changed > 0,
      changed: r.changed,
      rev: Number(s.rev) || revBefore,
      updatedAt: s.updatedAt || null,
      conflicts: r.conflicts,
      conflict: baseRev !== undefined && Number(baseRev) !== revBefore
    })
  })
)

/** 期名 / 本场成员 / 房间口令（都只改元信息，绝不碰分数） */
app.put('/api/sessions/:id', hostOnly, (req, res) => {
  const config = loadConfig()
  const s = loadParty(req, res, config)
  if (!s) return
  const body = req.body || {}
  if (typeof body.name === 'string' && body.name.trim()) {
    s.name = body.name.trim().slice(0, 80)
  }
  if (Array.isArray(body.members)) {
    s.members = body.members.map(cleanMemberName).filter(Boolean).slice(0, 60)
    membersOf(s, config)
  }
  if (body.pin !== undefined) {
    const pin = String(body.pin ?? '').trim()
    if (pin && !/^\d{4,8}$/.test(pin)) {
      return res.status(400).json({ error: '房间口令必须是 4~8 位数字' })
    }
    s.pin = pin
  }
  if (typeof body.followGlobal === 'boolean') {
    s.followGlobal = body.followGlobal
  }
  if (
    body.settings === null ||
    (body.settings && typeof body.settings === 'object' && Array.isArray(body.settings.dimensions))
  ) {
    s.settings = body.settings
  }
  if (typeof body.noGlobal === 'boolean') {
    s.noGlobal = body.noGlobal
  }
  saveSession(s)
  ok(res).json({
    saved: true,
    rev: s.rev,
    name: s.name,
    members: s.members,
    pin: s.pin,
    followGlobal: !!s.followGlobal,
    settings: s.settings ?? null,
    noGlobal: !!s.noGlobal
  })
})

app.delete('/api/sessions/:id', hostOnly, (req, res) => {
  deleteSession(req.params.id)
  ok(res).json({ deleted: true })
})

// ---------- 当前曲 / 独立评分 / 结束锁定 ----------
app.put(
  '/api/sessions/:id/stage',
  hostOnly,
  wrap((req, res) => {
    const config = loadConfig()
    const s = loadParty(req, res, config)
    if (!s) return
    const body = req.body || {}
    if (body.currentPage !== undefined) {
      if (body.currentPage === null) {
        s.stage.currentPage = null
      } else {
        const page = Number(body.currentPage)
        if (!s.parts.some(p => p.page === page)) {
          return res.status(400).json({ error: '这一首不存在' })
        }
        if (s.stage.currentPage !== page && s.stage.blind) s.stage.revealed = false
        s.stage.currentPage = page
      }
    }
    if (body.blind !== undefined) {
      const blind = Boolean(body.blind)
      if (blind && !s.stage.blind) s.stage.revealed = false
      s.stage.blind = blind
    }
    if (body.revealed !== undefined) s.stage.revealed = Boolean(body.revealed)
    s.stage.updatedAt = new Date().toISOString()
    saveSession(s)
    ok(res).json({ stage: s.stage, rev: s.rev })
  })
)

app.post(
  '/api/sessions/:id/finish',
  hostOnly,
  wrap((req, res) => {
    const config = loadConfig()
    const s = loadParty(req, res, config)
    if (!s) return
    const missing = missingBeforeFinish(s, config)
    if (missing.length && req.body?.force !== true) {
      return res.status(409).json({
        error: `还有 ${missing.length} 首没有评齐，列出漏评后可以强制结束`,
        code: 'MISSING_REVIEWS',
        missing
      })
    }
    s.done = true
    saveSession(s)
    ok(res).json({
      done: true,
      rev: s.rev,
      missingCount: missing.length,
      missing
    })
  })
)

app.post('/api/sessions/:id/reopen', hostOnly, (req, res) => {
  const config = loadConfig()
  const s = loadParty(req, res, config)
  if (!s) return
  s.done = false
  saveSession(s)
  ok(res).json({ done: false, rev: s.rev })
})

// ---------- 参与者：加入房间 ----------
app.get('/api/join/sessions', (req, res) => {
  const config = loadConfig()
  const list = listSessions().map(s => {
    const live = progressOf(s, config)
    return {
      id: s.id,
      name: s.name,
      createdAt: s.createdAt,
      done: Boolean(s.done),
      memberCount: live.members.length,
      total: live.totalActive,
      complete: live.completeCount
    }
  })
  ok(res).json(list)
})

app.get('/api/join/:id', (req, res) => {
  const config = loadConfig()
  const s = loadParty(req, res, config)
  if (!s) return
  const live = progressOf(s, config)
  ok(res).json({
    id: s.id,
    name: s.name,
    createdAt: s.createdAt,
    done: Boolean(s.done),
    members: live.members,
    memberCount: live.members.length,
    total: live.totalActive,
    complete: live.completeCount,
    pinRequired: Boolean(s.pin),
    blind: stageOf(s).blind
  })
})

app.post(
  '/api/sessions/:id/join',
  wrap((req, res) => {
    const config = loadConfig()
    const s = loadParty(req, res, config)
    if (!s) return
    if (pinThrottled(req, s.id)) {
      return res.status(429).json({ error: '口令尝试太多次，请 10 分钟后再试' })
    }
    const person = cleanMemberName(req.body?.person)
    if (!person) return res.status(400).json({ error: '请填写你的名字' })
    const pin = String(req.body?.pin ?? '').trim()
    if (s.pin && pin !== s.pin) {
      notePinFailure(req, s.id)
      return res.status(403).json({ error: '房间口令不对，问一下主持人', code: 'BAD_PIN' })
    }
    clearPinFailures(req, s.id)
    const members = membersOf(s, config)
    if (s.done && !members.includes(person)) {
      return res.status(409).json({ error: '本场已经结束，不能再加入', code: 'SESSION_CLOSED' })
    }
    if (!members.includes(person)) {
      if (s.done) return res.status(409).json({ error: '本场已经结束', code: 'SESSION_CLOSED' })
      addMember(s, person, config)
      saveSession(s)
    }
    const token = issueParticipantToken(s.id, person)
    ok(res).json({
      token,
      person,
      session: participantSession(s, config, person)
    })
  })
)

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

app.get('/api/sessions/:id/report/:format', hostOnly, async (req, res) => {
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

app.get('/api/reports/all/:format', hostOnly, async (req, res) => {
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
app.put(
  '/api/sessions/:id/part/:page',
  wrap((req, res) => {
    const config = loadConfig()
    const s = loadParty(req, res, config)
    if (!s) return
    const actor = actorOf(req, s)
    if (!actor) return res.status(403).json({ error: '没有权限修改本场', code: 'NEED_JOIN' })
    if (s.done) {
      return res.status(409).json({
        error: '本场已结束并锁定评分，需要主持人重新开放才能修改',
        code: 'SESSION_CLOSED'
      })
    }
    const page = Number(req.params.page)
    const part = s.parts.find(p => p.page === page)
    if (!part) return res.status(404).json({ error: '分P不存在' })
    const { score, fav, personTags, personComment, dim } = req.body || {}
    const person = cleanMemberName(req.body?.person)
    if (!person) return res.status(400).json({ error: '缺少 person' })

    const ops = []
    // 维度分请求里 score 是"该维度的分"，不能再当成总分写一遍
    if (dim !== undefined) ops.push({ t: 'dim', page, dim: String(dim), person, value: score })
    else if (score !== undefined) ops.push({ t: 'score', page, person, value: score })
    if (fav !== undefined) ops.push({ t: 'fav', page, person, value: Boolean(fav) })
    if (personTags !== undefined) ops.push({ t: 'tags', page, person, value: personTags })
    if (personComment !== undefined) ops.push({ t: 'personComment', page, person, value: personComment })
    if (!ops.length) return res.status(400).json({ error: '没有要保存的内容' })

    const r = applyOps(s, ops, { config, actor })
    if (r.changed > 0) saveSession(s)
    const visiblePart = actor.role === 'participant'
      ? participantSession(s, config, actor.person).parts.find(p => p.page === page)
      : part
    ok(res).json({
      page: part.page,
      scores: visiblePart.scores,
      dimScores: visiblePart.dimScores,
      favorites: visiblePart.favorites,
      personTags: visiblePart.personTags,
      personComments: visiblePart.personComments,
      rev: s.rev,
      saved: r.changed > 0,
      conflicts: r.conflicts
    })
  })
)

// ---------- 离线个人打分单（单文件 HTML，发给同学自己填） ----------
app.get('/api/sessions/:id/sheet', hostOnly, (req, res) => {
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
app.post('/api/sessions/:id/import', hostOnly, (req, res) => {
  const config = loadConfig()
  const s = loadParty(req, res, config)
  if (!s) return
  if (s.done) {
    return res.status(409).json({
      error: '本场已结束并锁定评分，请先重新开放再导入',
      code: 'SESSION_CLOSED'
    })
  }
  const body = req.body || {}
  const sheets = Array.isArray(body) ? body : Array.isArray(body.sheets) ? body.sheets : [body]
  // 本期有快照且未跟随全局时，新成员先进本期名单（全局模板也同步，方便下期沿用）
  const useSnapshot = s.followGlobal !== true && s.settings && Array.isArray(s.settings.dimensions)
  const added = []
  let total = 0
  let favTotal = 0
  let tagTotal = 0
  let invalid = 0

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
    const person = cleanMemberName(sheet.person)
    if (!person) continue
    if (!membersOf(s, config).includes(person)) {
      addMember(s, person, config)
      added.push(person)
    }
    if (useSnapshot && !(s.settings.persons || []).includes(person)) {
      s.settings.persons = s.settings.persons || []
      s.settings.persons.push(person)
    }
    for (const [page, score] of Object.entries(sheet.scores || {})) {
      const part = s.parts.find(p => p.page === Number(page))
      if (!part) continue
      try {
        const n = normalizeScore(score, config)
        if (n === null) {
          delete (part.scores || {})[person]
        } else {
          part.scores = part.scores || {}
          part.scores[person] = n
          total++
        }
      } catch {
        invalid++
      }
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

  saveSession(s)
  ok(res).json({
    addedPersons: added,
    scores: total,
    favorites: favTotal,
    tags: tagTotal,
    invalid
  })
})

// ---------- AI 锐评（DeepSeek） ----------
app.use('/api/ai', hostOnly)
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

app.post('/api/sessions/:id/ai-review', hostOnly, async (req, res) => {
  const session = getSession(req.params.id)
  if (!session) return res.status(404).json({ error: '期次不存在' })
  const config = sessionConfig(session, loadConfig())
  const st = sessionStats(session, config)
  try {
    const text = await generateReview(session, st, config, loadAiConfig())
    const review = { text, model: loadAiConfig().model, createdAt: new Date().toISOString() }
    const latest = getSession(session.id)
    if (!latest) return res.status(404).json({ error: '期次不存在' })
    latest.aiReviews = [review, ...(latest.aiReviews || [])].slice(0, 5)
    saveSession(latest)
    ok(res).json({ review, total: latest.aiReviews.length })
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
})

// ---------- 网易云音乐（开放平台直连） ----------
// 涉及账号凭证、本机播放和歌单写入，全部只开放给主持人
app.use('/api/ncm', hostOnly)

app.get('/api/ncm/status', async (req, res) => {
  try {
    ok(res).json(await ncmStatus())
  } catch (e) {
    // 没装 mpv / CLI 探测失败时不要让整个服务倒下
    ok(res).json({
      configured: false,
      loggedIn: false,
      expireAt: null,
      tokenRemainingHours: 0,
      canAutoRefresh: false,
      mpv: false,
      error: e.message
    })
  }
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
  const latest = getSession(s.id)
  const latestPart = latest?.parts.find(p => p.page === part.page)
  if (!latestPart) return res.status(404).json({ error: '期次或分P已删除' })
  latestPart.ncm = {
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
  saveSession(latest)
  ok(res).json(latestPart.ncm)
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
  const songId = part.ncm.encryptedId
  const r = await getLyric(loadAuth(), songId)
  if (!r.ok) throw new Error(r.error)
  const latest = getSession(session.id)
  const latestPart = latest?.parts.find(p => p.page === part.page)
  if (!latestPart || latestPart.ncm?.encryptedId !== songId) {
    throw new Error('期次或歌曲已变更，请重新获取歌词')
  }
  const lyric = { text: r.text, trans: r.trans, noLyric: r.noLyric, fetchedAt: new Date().toISOString() }
  latestPart.ncm.lyric = lyric
  saveSession(latest)
  return lyric
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
app.get('/api/backup', hostOnly, (req, res) => {
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

app.post('/api/restore', hostOnly, (req, res) => {
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

app.use((err, req, res, next) => {
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '请求体不是合法的 JSON' })
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体太大' })
  }
  console.error('[oped-party] unhandled', err)
  if (res.headersSent) return next(err)
  res.status(500).json({ error: '服务器内部错误' })
})

app.use((req, res) => res.status(404).json({ error: 'not found' }))

app.listen(PORT, HOST, () => {
  const lan = Object.values(os.networkInterfaces())
    .flat()
    .find(i => i && i.family === 'IPv4' && !i.internal)?.address
  console.log(`[oped-party] 本机地址：http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`)
  if (lan) console.log(`[oped-party] 局域网地址：http://${lan}:${PORT}（同一 WiFi 的朋友可用）`)
  console.log(`[oped-party] 数据目录 ${DATA_DIR}`)
  console.log(`[oped-party] 房间管理密钥 hostKey：${getHostKey()}`)
  console.log('[oped-party] 本机直连自动识别为主持人；通过公网/其他设备打开主持人页面时输入上面的密钥。')
}).on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 已被占用——鉴赏会小站可能已经在运行了，直接打开 http://${HOST}:${PORT} 即可。`)
    process.exit(0)
  }
  throw e
})
