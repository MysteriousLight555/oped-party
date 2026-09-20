/**
 * 网易云音乐开放平台直连集成（个人开发者）。
 *
 * 协议（2026-09-20 实测逆向并验证）：
 *  - 网关 https://openncm.music.163.com，全参数走 query
 *  - 签名：除 sign 外按 key ASCII 排序 k=v& 连接 → RSA-SHA256(应用私钥) → base64
 *  - device.os/channel/brand 走白名单（用 ncmcli 值），clientIp 必填
 *  - 设备流扫码登录的 token 绑定 deviceId，全程必须同一设备身份
 *  - 匿名 token 仅部分接口可用；搜索等业务接口需要扫码登录的用户 token
 *
 * 凭证全部存 data/ncm-auth.json（已被 .gitignore 覆盖），不进仓库、不回传。
 */
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const AUTH_PATH = path.join(ROOT, 'data', 'ncm-auth.json')

const BASE = 'https://openncm.music.163.com'
const SEARCH_PATH = '/openapi/music/basic/complex/search'
const ANON_PATH = '/openapi/music/basic/oauth2/login/anonymous'
const QR_CREATE_PATH = '/openapi/music/basic/user/oauth2/qrcodekey/get/v2'
const QR_POLL_PATH = '/openapi/music/basic/oauth2/device/login/qrcode/get'
const REFRESH_PATH = '/openapi/music/basic/user/oauth2/token/refresh/v2'
const PLAYLIST_SONGS_PATH = '/openapi/music/basic/playlist/song/list/get/v5'
const PLAYLIST_STAR_PATH = '/openapi/music/basic/playlist/star/get/v2'
const PLAYLIST_BATCH_DELETE_PATH = '/openapi/music/basic/playlist/song/batch/delete'
const LYRIC_PATH = '/openapi/music/basic/song/lyric/get/v2'

function loadAuth() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf-8'))
  } catch {
    return {}
  }
}

export { loadAuth }

function saveAuthPatch(patch) {
  const auth = { ...loadAuth(), ...patch }
  fs.mkdirSync(path.dirname(AUTH_PATH), { recursive: true })
  fs.writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2))
  return auth
}

export { saveAuthPatch }

function hasKey(auth) {
  return Boolean(auth.appId && auth.privateKey)
}

function pem(auth) {
  return (
    '-----BEGIN PRIVATE KEY-----\n' +
    String(auth.privateKey).replace(/(.{64})/g, '$1\n') +
    '\n-----END PRIVATE KEY-----'
  )
}

function deviceJson(auth) {
  return JSON.stringify({
    deviceType: 'openapi',
    os: 'ncmcli',
    appVer: '0.1.7',
    channel: 'ncmcli',
    model: 'Windows_x64_cli',
    brand: 'ncmcli',
    osVer: '10.0.26200',
    clientIp: auth.clientIp || '127.0.0.1',
    deviceId: auth.deviceId
  })
}

async function signedCall(auth, method, apiPath, biz = {}, accessToken) {
  const withTs = {
    appId: auth.appId,
    signType: 'RSA_SHA256',
    timestamp: String(Date.now()),
    device: deviceJson(auth),
    bizContent: JSON.stringify(biz)
  }
  if (accessToken) withTs.accessToken = accessToken
  const canonical = Object.keys(withTs)
    .sort()
    .map(k => `${k}=${withTs[k]}`)
    .join('&')
  const signer = crypto.createSign('RSA-SHA256')
  signer.update(canonical)
  const sig = signer.sign(pem(auth), 'base64')
  const qs = Object.keys({ ...withTs, sign: sig })
    .map(k => `${k}=${encodeURIComponent(k === 'sign' ? sig : withTs[k])}`)
    .join('&')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(BASE + apiPath + '?' + qs, {
      method,
      headers: { 'User-Agent': 'ncm-0.1.7', Referer: 'https://music.163.com/' },
      signal: controller.signal
    })
    const text = await res.text()
    try {
      return { http: res.status, json: JSON.parse(text) }
    } catch {
      return { http: res.status, body: text.slice(0, 300) }
    }
  } finally {
    clearTimeout(timer)
  }
}

async function anonToken(auth) {
  const r = await signedCall(auth, 'POST', ANON_PATH, { clientId: auth.appId })
  return r.json?.data?.accessToken || ''
}

/** 有效用户 token；不存在或已过期返回 ''（同步版，仅用于状态展示） */
function validUserToken(auth) {
  if (!auth.userToken) return ''
  if (auth.userExpireAt && Date.now() > auth.userExpireAt) return ''
  return auth.userToken
}

/**
 * 用 refreshToken 续期（AT/RT 同时滚动）。需要 data/ncm-auth.json 里有
 * appSecret（刷新接口要求 clientId+clientSecret+refreshToken 三件套）。
 * 成功后新 token 直接落盘，返回 true。
 */
async function refreshUserToken(auth) {
  if (!auth.refreshToken || !auth.appSecret) return false
  const r = await signedCall(
    auth,
    'GET',
    REFRESH_PATH,
    { clientId: auth.appId, clientSecret: auth.appSecret, refreshToken: auth.refreshToken },
    auth.userToken || undefined
  )
  const d = r.json?.data
  if (r.json?.code === 200 && d?.accessToken) {
    saveAuthPatch({
      userToken: d.accessToken,
      refreshToken: d.refreshToken || auth.refreshToken,
      userExpireAt: Date.now() + (d.expiresTime ? d.expiresTime * 1000 - 60000 : 6 * 86400000)
    })
    return true
  }
  return false
}

/** 业务调用用：过期先自动续期，续不了才返回空 */
async function userToken(auth) {
  if (!auth.userToken) return ''
  if (!auth.userExpireAt || Date.now() <= auth.userExpireAt) return auth.userToken
  const refreshed = await refreshUserToken(auth)
  if (!refreshed) return ''
  return loadAuth().userToken
}

/**
 * 带登录态的业务调用：token 过期(1406)/未授权(301)时先试一次 refreshToken 续期再重试，
 * 避免临界点报错。返回 {token, r}，token 为空表示无法登录。
 */
async function authedCall(auth, method, apiPath, biz = {}) {
  let token = await userToken(auth)
  if (!token) token = await anonToken(auth)
  let r = await signedCall(auth, method, apiPath, biz, token || undefined)
  const code = r.json?.code
  if ((code === 1406 || code === 301 || code === 1408) && auth.refreshToken && auth.appSecret) {
    const ok = await refreshUserToken(auth)
    if (ok) {
      token = loadAuth().userToken
      r = await signedCall(auth, method, apiPath, biz, token)
    }
  }
  return { token, r }
}

// ---------- 对外状态 ----------
export async function ncmStatus() {
  const auth = loadAuth()
  const token = validUserToken(auth)
  const mpv = await mpvCheck()
  return {
    configured: hasKey(auth),
    loggedIn: Boolean(token),
    expireAt: auth.userExpireAt || null,
    tokenRemainingHours: token ? Math.max(0, Math.round(((auth.userExpireAt || 0) - Date.now()) / 3600000)) : 0,
    canAutoRefresh: Boolean(auth.refreshToken && auth.appSecret),
    mpv
  }
}

import { spawn as _spawn } from 'node:child_process'
function mpvCheck() {
  return new Promise(resolve => {
    const w = _spawn('where', ['mpv'], { windowsHide: true })
    let out = ''
    w.stdout.on('data', d => (out += d))
    w.on('close', code => resolve(code === 0 && out.trim().length > 0))
    w.on('error', () => resolve(false))
  })
}

// ---------- 扫码登录（服务端驱动，供设置页/脚本使用） ----------
const qrSessions = new Map() // uniKey -> {status, token}

export async function qrCreate() {
  const auth = loadAuth()
  if (!hasKey(auth)) return { error: '先在 data/ncm-auth.json 配置 appId 和 privateKey' }
  if (!auth.deviceId) {
    saveAuthPatch({ deviceId: 'ncmcli_' + crypto.randomBytes(8).toString('hex') })
  }
  let token = validUserToken(auth)
  if (!token) token = await userToken(auth)
  if (!token) token = await anonToken(auth)
  const r = await signedCall(auth, 'GET', QR_CREATE_PATH, { type: 2, expiredKey: '300' }, token)
  const uniKey = r.json?.data?.uniKey
  const qrUrl = r.json?.data?.qrCodeUrl
  if (!uniKey) return { error: `二维码创建失败：${JSON.stringify(r.json || r.body).slice(0, 150)}` }
  qrSessions.set(uniKey, { status: 801 })
  return { uniKey, qrUrl }
}

export async function qrPoll(uniKey) {
  const auth = loadAuth()
  let token = validUserToken(auth)
  if (!token) token = await userToken(auth)
  if (!token) token = await anonToken(auth)
  const r = await signedCall(auth, 'GET', QR_POLL_PATH, { key: uniKey, clientId: auth.appId }, token)
  const d = r.json?.data || {}
  const status = d.status ?? 0
  if (status === 803) {
    const raw = d.accessToken
    const t = typeof raw === 'string' ? raw : raw?.accessToken || ''
    if (t) {
      saveAuthPatch({
        userToken: t,
        refreshToken: (typeof raw === 'object' && raw?.refreshToken) || '',
        userExpireAt: Date.now() + (raw?.expireTime ? raw.expireTime * 1000 - 60000 : 86400000)
      })
      qrSessions.set(uniKey, { status: 803 })
      return { status: 803, saved: true }
    }
    return { status: 803, saved: false, raw: JSON.stringify(d).slice(0, 200) }
  }
  return { status, msg: d.msg }
}

// ---------- 搜索匹配 ----------
function normalizeSong(s) {
  return {
    id: s.originalId != null ? String(s.originalId) : '',
    encryptedId: s.id || '',
    name: s.name || '',
    artist: (s.fullArtists || s.artists || []).map(a => a.name).join('/'),
    album: s.album?.name || '',
    cover: s.coverImgUrl || '',
    durationMs: s.duration || 0,
    payPlayFlag: Boolean(s.payPlayFlag),
    vipFlag: Boolean(s.vipFlag)
  }
}

export async function searchSong(auth, keyword) {
  const { r } = await authedCall(auth, 'GET', SEARCH_PATH, { keyword })
  const j = r.json
  if (j?.code === 301 || j?.code === 1406 || j?.code === 1408) {
    return { ok: false, needLogin: true, error: j.message || '需要重新扫码登录' }
  }
  const songs = (j?.data?.songs || []).map(normalizeSong)
  return { ok: true, songs }
}

/** 从解析后的曲名取搜索关键词：优先「／」后的原文，剥 CV 标注 */
export function searchKeyword(parsed) {
  const song = String(parsed?.song || '').trim()
  let name = song
  if (song.includes('／')) {
    const orig = song.split('／').slice(1).join('／').trim()
    if (orig) name = orig
  }
  const artist = String(parsed?.artist || '')
    .replace(/（?\(?\s*CV\s*[.：:）)]\s*[^)）]*\)）?/gi, '')
    .replace(/\s*&\s*$/, '')
    .trim()
  return { keyword: `${name} ${artist}`.trim(), name, artist }
}

/** 兼容旧接口：匹配某一分P（在路由层读 auth） */
export async function matchPart(auth, part) {
  const { keyword } = searchKeyword(part.parsed)
  if (!keyword) return { ok: false, error: '没有可用的搜索关键词' }
  const r = await searchSong(auth, keyword)
  if (!r.ok) return r
  const song = r.songs[0]
  if (!song) return { ok: false, error: '没有搜索结果' }
  return { ok: true, song, keyword }
}

// ---------- 收藏同步：批量添加到歌单 ----------
const BATCH_LIKE_PATH = '/openapi/music/basic/playlist/song/batch/like'
const BATCH_SIZE = 50
const HEART_PATH = '/openapi/music/basic/playlist/song/like/v2'
const PLAYLIST_CREATED_PATH = '/openapi/music/basic/playlist/created/get/v2'

/** 红心/取消红心一首歌（songId 为加密 ID）。返回 {ok, paid?} */
export async function heartSong(auth, encryptedId, isLike = true) {
  const { r } = await authedCall(auth, 'GET', HEART_PATH, { songId: encryptedId, isLike })
  const j = r.json
  if (j?.code === 200) return { ok: true }
  const msg = j?.message || j?.msg || JSON.stringify(j).slice(0, 120)
  const paid = /购买|songfee|付费/i.test(msg)
  return { ok: false, error: msg, paid }
}

/** 用户创建的歌单列表（含末尾的红心歌单，specialType=5） */
export async function listCreatedPlaylists(auth) {
  const out = []
  let offset = 0
  for (let page = 0; page < 5; page++) {
    const { r } = await authedCall(auth, 'GET', PLAYLIST_CREATED_PATH, { limit: 500, offset })
    const records = r.json?.data?.records
    if (!Array.isArray(records)) {
      if (page === 0) return { ok: false, error: r.json?.message || '获取歌单列表失败' }
      break
    }
    for (const p of records) {
      out.push({
        id: p.id,
        name: p.name || '',
        trackCount: p.trackCount || 0,
        specialType: p.specialType || 0,
        isHeart: p.specialType === 5
      })
    }
    const total = r.json?.data?.recordCount ?? out.length
    offset += records.length
    if (offset >= total || !records.length) break
  }
  return { ok: true, playlists: out }
}

/**
 * 把加密 ID 列表分批加入歌单（须是自己的歌单）。
 * 返回 {added, duplicate, results:[{ids, data}]}
 */
export async function syncToPlaylist(auth, playlistId, encryptedIds) {
  let added = 0
  let duplicate = 0
  const results = []
  for (let i = 0; i < encryptedIds.length; i += BATCH_SIZE) {
    const chunk = encryptedIds.slice(i, i + BATCH_SIZE)
    const { r } = await authedCall(auth, 'GET', BATCH_LIKE_PATH, { playlistId, songIdList: chunk })
    const j = r.json
    if (j?.code !== 200 && j?.code !== undefined && j?.data !== true && !Array.isArray(j?.data)) {
      return {
        ok: false,
        error: `批量添加失败：${j?.message || j?.msg || JSON.stringify(j).slice(0, 120)}`,
        partial: { added, duplicate }
      }
    }
    // data:true = 全部成功；data:[] = 全部重复；其他数组 = 部分结果
    if (j?.data === true) {
      added += chunk.length
    } else if (Array.isArray(j?.data)) {
      if (!j.data.length) duplicate += chunk.length
      else {
        added += j.data.length
        duplicate += chunk.length - j.data.length
      }
    } else {
      added += chunk.length
    }
    results.push({ ids: chunk.length, data: j?.data })
  }
  return { ok: true, added, duplicate, results }
}

// ---------- 歌单/红心内容读取（同步预览、已入库标记用） ----------
function normalizeTrack(t) {
  return {
    encryptedId: t.id || '',
    name: t.name || '',
    artist: (t.fullArtists || t.artists || []).map(a => a.name).join('/'),
    album: t.album?.name || '',
    cover: t.coverImgUrl || '',
    durationMs: t.duration || 0,
    liked: Boolean(t.liked)
  }
}

/** 某个歌单内的全部歌曲（v5 接口，500/页） */
export async function listPlaylistSongs(auth, playlistId) {
  const out = []
  let offset = 0
  for (let page = 0; page < 20; page++) {
    const { r } = await authedCall(auth, 'GET', PLAYLIST_SONGS_PATH, {
      playlistId,
      limit: 500,
      offset
    })
    const j = r.json
    if (j?.code !== 200) {
      if (page === 0) return { ok: false, error: j?.message || '获取歌单内容失败' }
      break
    }
    const tracks = j?.data?.tracks
    if (!Array.isArray(tracks)) {
      if (page === 0) return { ok: false, error: j?.subCode === '10007' ? '歌单不存在或为空' : '获取歌单内容失败' }
      break
    }
    for (const t of tracks) out.push(normalizeTrack(t))
    const total = j?.data?.trackCount ?? out.length
    offset += tracks.length
    if (offset >= total || !tracks.length) break
  }
  return { ok: true, songs: out, trackCount: out.length }
}

/**
 * 用户红心歌单全部歌曲。个人开发者无 star/get/v2 权限（实测「应用未授权当前接口」），
 * 但 created/get/v2 的末尾就挂着红心歌单（specialType=5），拿 id 后用 v5 读歌曲列表。
 */
export async function listHeartSongs(auth) {
  const pl = await listCreatedPlaylists(auth)
  if (!pl.ok) return pl
  const heart = pl.playlists.find(p => p.isHeart)
  if (!heart) return { ok: false, error: '歌单列表里没有找到红心歌单（specialType=5）' }
  const songs = await listPlaylistSongs(auth, heart.id)
  if (!songs.ok) return songs
  return {
    ok: true,
    songs: songs.songs,
    trackCount: heart.trackCount || songs.trackCount,
    playlistId: heart.id,
    name: heart.name
  }
}

/** 从自己的歌单批量移除歌曲（撤销入库用） */
export async function removeFromPlaylist(auth, playlistId, encryptedIds) {
  let removed = 0
  let missing = 0
  for (let i = 0; i < encryptedIds.length; i += BATCH_SIZE) {
    const chunk = encryptedIds.slice(i, i + BATCH_SIZE)
    const { r } = await authedCall(auth, 'GET', PLAYLIST_BATCH_DELETE_PATH, {
      playlistId,
      songIdList: chunk
    })
    const j = r.json
    if (j?.code !== 200) {
      return {
        ok: false,
        error: `批量移除失败：${j?.message || j?.msg || JSON.stringify(j).slice(0, 120)}`,
        partial: { removed }
      }
    }
    if (j?.data === true) removed += chunk.length
    else if (Array.isArray(j?.data)) {
      removed += j.data.length
      missing += chunk.length - j.data.length
    } else removed += chunk.length
  }
  return { ok: true, removed, missing }
}

// ---------- 歌词（逐行 + 翻译） ----------
export async function getLyric(auth, encryptedId) {
  const { r } = await authedCall(auth, 'GET', LYRIC_PATH, { songId: encryptedId })
  const j = r.json
  if (j?.code !== 200) return { ok: false, error: j?.message || '获取歌词失败' }
  const d = j?.data || {}
  return {
    ok: true,
    text: String(d.lyric || d.txtLyric || ''),
    trans: String(d.transLyric || ''),
    noLyric: Boolean(d.noLyric || d.pureMusic)
  }
}
// ---------- CLI 播放（可选能力：需用户另行 ncm-cli login + 安装 mpv） ----------
export async function playSong(part) {
  const { spawn } = await import('node:child_process')
  const require_ = (await import('node:module')).createRequire(import.meta.url)
  let bin
  try {
    const pkg = require_('@music163/ncm-cli/package.json')
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['ncm-cli']
    bin = path.join(path.dirname(require_.resolve('@music163/ncm-cli/package.json')), rel)
  } catch {
    return { ok: false, error: '未安装 @music163/ncm-cli' }
  }
  const args = [bin, 'play', '--song']
  if (part.ncm.encryptedId) args.push('--encrypted-id', part.ncm.encryptedId)
  if (part.ncm.id) args.push('--original-id', part.ncm.id)
  return new Promise(resolve => {
    const child = _spawn(process.execPath, args, { windowsHide: true })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve({ ok: false, error: 'ncm-cli 播放超时' })
    }, 20000)
    child.stdout.on('data', d => (out += d))
    child.stderr.on('data', d => (err += d))
    child.on('error', e => {
      clearTimeout(timer)
      resolve({ ok: false, error: e.message })
    })
    child.on('close', () => {
      clearTimeout(timer)
      const text = out + err
      if (/未登录|PRIVATE_KEY|mpv|请先/i.test(text) && text.length < 500) {
        resolve({ ok: false, error: text.trim().split('\n')[0] })
      } else {
        resolve({ ok: true })
      }
    })
  })
}
