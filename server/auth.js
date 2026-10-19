/** 轻量身份与权限：主持人密钥 + 按房间签发的参与者凭证
 *
 * 设计目标（熟人局够用即可）：
 * - 本机直连（127.0.0.1 且没有经过代理/隧道）自动视为主持人，日常不用输密钥；
 * - 通过 cloudflared 隧道或局域网访问时，主持人页面需要「房间管理密钥」；
 * - 朋友从邀请链接加入后拿到只属于「这一期 + 这个人」的签名凭证，
 *   只能写自己的分数，碰不到配置、删除、备份等管理接口。
 */
import crypto from 'node:crypto'
import path from 'node:path'
import { DATA_DIR, readJson, writeJson } from './store.js'

const AUTH_PATH = path.join(DATA_DIR, 'auth.json')

function createAuthFile() {
  const data = {
    hostKey: crypto.randomBytes(9).toString('base64url'),
    secret: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString()
  }
  writeJson(AUTH_PATH, data)
  return data
}

function loadAuthFile() {
  const existing = readJson(AUTH_PATH, null)
  if (existing?.hostKey && existing?.secret) return existing
  return createAuthFile()
}

const AUTH = loadAuthFile()

export function getHostKey() {
  return AUTH.hostKey
}

export function verifyHostKey(key) {
  return Boolean(key) && safeEqual(String(key), AUTH.hostKey)
}

function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest()
  const hb = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(ha, hb)
}

/** 请求是不是从 cloudflared / 反向代理转发进来的（转发头由代理写入，客户端伪造成本低但熟人局足够） */
export function isForwarded(req) {
  return Boolean(
    req.headers['cf-connecting-ip'] ||
      req.headers['cf-ray'] ||
      req.headers['x-forwarded-for'] ||
      req.headers['x-real-ip']
  )
}

/** 本机直连：没有经过代理，Host 也是本机名，且来源是环回地址 */
export function isDirectLocal(req) {
  if (isForwarded(req)) return false
  const hostName = String(req.headers?.host || '')
    .replace(/:\d+$/, '')
    .toLowerCase()
  const localNames = ['127.0.0.1', 'localhost', '::1', '[::1]']
  // 公网域名 + 没有转发头（少见代理）时不认成本机
  if (hostName && !localNames.includes(hostName)) return false
  const ip = String(req.socket?.remoteAddress || '')
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}

/** 主持人：本机直连，或持有正确的房间管理密钥（请求头或 HttpOnly Cookie） */
export function isHost(req) {
  const key = String(req.headers['x-host-key'] || '')
  if (key && safeEqual(key, AUTH.hostKey)) return true
  // 报告 / 备份是浏览器直接打开或下载的链接，带不了自定义请求头，用一个 HttpOnly Cookie 兜底
  const cookieKey = readCookie(req, 'oped_host')
  if (cookieKey && safeEqual(cookieKey, AUTH.hostKey)) return true
  return isDirectLocal(req)
}

function readCookie(req, name) {
  const raw = String(req.headers?.cookie || '')
  for (const part of raw.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim())
      } catch {
        return part.slice(i + 1).trim()
      }
    }
  }
  return ''
}

function sign(payload) {
  return crypto.createHmac('sha256', AUTH.secret).update(payload).digest('base64url')
}

/** 参与者凭证：只绑定一期 + 一个人，默认 60 天有效 */
export function issueParticipantToken(sessionId, person) {
  const body = Buffer.from(
    JSON.stringify({ sid: String(sessionId), person: String(person), exp: Date.now() + 60 * 86400000 })
  ).toString('base64url')
  return `${body}.${sign(body)}`
}

export function verifyParticipantToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const i = token.lastIndexOf('.')
  const body = token.slice(0, i)
  const sig = token.slice(i + 1)
  if (!body || !sig) return null
  try {
    if (!safeEqual(sig, sign(body))) return null
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8'))
    if (!data?.sid || !data?.person) return null
    if (data.exp && Date.now() > Number(data.exp)) return null
    return { sessionId: String(data.sid), person: String(data.person) }
  } catch {
    return null
  }
}

export function participantFromReq(req) {
  return verifyParticipantToken(String(req.headers['x-participant-token'] || ''))
}

// ---------- 房间口令防爆破：同一来源 + 同一期，10 分钟内最多错 8 次 ----------
const pinAttempts = new Map()

function attemptKey(req, sessionId) {
  const ip = String(
    req.headers['cf-connecting-ip'] || req.socket?.remoteAddress || 'unknown'
  )
  return `${ip}|${sessionId}`
}

export function pinThrottled(req, sessionId) {
  const rec = pinAttempts.get(attemptKey(req, sessionId))
  if (!rec) return false
  if (Date.now() > rec.resetAt) {
    pinAttempts.delete(attemptKey(req, sessionId))
    return false
  }
  return rec.count >= 8
}

export function notePinFailure(req, sessionId) {
  const k = attemptKey(req, sessionId)
  const now = Date.now()
  const rec = pinAttempts.get(k)
  if (!rec || now > rec.resetAt) pinAttempts.set(k, { count: 1, resetAt: now + 10 * 60 * 1000 })
  else rec.count += 1
}

export function clearPinFailures(req, sessionId) {
  pinAttempts.delete(attemptKey(req, sessionId))
}
