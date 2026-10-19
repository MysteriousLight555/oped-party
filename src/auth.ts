/** 前端身份存储：主持人密钥 + 每期参与者凭证（都只存在浏览器本地） */
import { reactive } from 'vue'

export interface AccessInfo {
  host: boolean
  direct: boolean
  forwarded: boolean
  participant: { sessionId: string; person: string } | null
}

const HOST_KEY_STORAGE = 'oped-host-key'
const TOKEN_PREFIX = 'oped-participant-'
const PERSON_PREFIX = 'oped-person-'

export const auth = reactive<AccessInfo & { checked: boolean }>({
  checked: false,
  host: false,
  direct: false,
  forwarded: false,
  participant: null
})

function lsGet(key: string): string {
  try {
    return localStorage.getItem(key) || ''
  } catch {
    return ''
  }
}

function lsSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* 隐私模式下忽略 */
  }
}

function lsDel(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function getHostKey(): string {
  return lsGet(HOST_KEY_STORAGE)
}

export function setHostKey(key: string) {
  const v = String(key || '').trim()
  if (v) lsSet(HOST_KEY_STORAGE, v)
}

export function clearHostKey() {
  lsDel(HOST_KEY_STORAGE)
}

export function participantTokenKey(sessionId: string) {
  return `${TOKEN_PREFIX}${sessionId}`
}

export function getParticipantToken(sessionId: string): string {
  return lsGet(participantTokenKey(sessionId))
}

export function getParticipantPerson(sessionId: string): string {
  return lsGet(`${PERSON_PREFIX}${sessionId}`)
}

export function setParticipantToken(sessionId: string, token: string, person: string) {
  lsSet(participantTokenKey(sessionId), token)
  lsSet(`${PERSON_PREFIX}${sessionId}`, person)
}

export function clearParticipant(sessionId: string) {
  lsDel(participantTokenKey(sessionId))
  lsDel(`${PERSON_PREFIX}${sessionId}`)
}

function sessionIdFromUrl(url: string): string {
  // 同时兼容路由 /session/<id>/sheet 与接口 /sessions/<id>
  const m = String(url || '').match(/\/sessions?\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

/** 请求要带的身份头：主持人密钥 + 当前期次的参与者凭证 */
export function authHeaders(url = ''): Record<string, string> {
  const headers: Record<string, string> = {}
  const hostKey = getHostKey()
  if (hostKey) headers['x-host-key'] = hostKey
  const sid = sessionIdFromUrl(url)
  const token = sid ? getParticipantToken(sid) : ''
  if (token) headers['x-participant-token'] = token
  return headers
}

/** 地址栏 ?hostkey=xxx：主持人换设备时可直接带密钥进入，读完后从地址栏抹掉 */
export function adoptHostKeyFromUrl() {
  try {
    const url = new URL(window.location.href)
    const key = url.searchParams.get('hostkey')
    if (!key) return
    setHostKey(key)
    url.searchParams.delete('hostkey')
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  } catch {
    /* ignore */
  }
}

export async function ensureAccess(force = false): Promise<AccessInfo> {
  if (auth.checked && !force) return auth
  try {
    const headers: Record<string, string> = {}
    if (getHostKey()) headers['x-host-key'] = getHostKey()
    // access 只关心当前页面对应的那一期凭证
    const currentSid = sessionIdFromUrl(window.location.hash.replace(/^#/, '/'))
    const token = currentSid ? getParticipantToken(currentSid) : ''
    if (token) headers['x-participant-token'] = token
    const res = await fetch('/api/access', { headers })
    if (!res.ok) throw new Error('access failed')
    const data = (await res.json()) as AccessInfo
    auth.host = Boolean(data.host)
    auth.direct = Boolean(data.direct)
    auth.forwarded = Boolean(data.forwarded)
    auth.participant = data.participant || null
    auth.checked = true
  } catch {
    auth.checked = true
  }
  return auth
}
