import type { Config, Session, SessionMeta } from './types'

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + url, {
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}) as { error?: string })
    throw new Error((e as { error?: string }).error || `请求失败（${res.status}）`)
  }
  return res.json() as Promise<T>
}

export const api = {
  getConfig: () => req<Config>('/config'),
  saveConfig: (cfg: Config) =>
    req<Config>('/config', { method: 'PUT', body: JSON.stringify(cfg) }),

  getBiliVideo: (bvid: string) => req<unknown>(`/bili/video?bvid=${encodeURIComponent(bvid)}`),

  createSession: (payload: Record<string, unknown>) =>
    req<Session>('/sessions', { method: 'POST', body: JSON.stringify(payload) }),
  listSessions: () => req<SessionMeta[]>('/sessions'),
  getSession: (id: string) => req<Session>(`/sessions/${id}`),
  saveSession: (s: Session) =>
    req<{ saved: boolean }>(`/sessions/${s.id}`, { method: 'PUT', body: JSON.stringify(s) }),
  deleteSession: (id: string) => req<{ deleted: boolean }>(`/sessions/${id}`, { method: 'DELETE' }),

  sessionReport: (id: string, fmt: 'html' | 'md' | 'xlsx' | 'json', inline = false) =>
    `/api/sessions/${id}/report/${fmt}${inline ? '?inline=1' : ''}`,
  allReport: (fmt: 'html' | 'md' | 'xlsx' | 'json', inline = false) =>
    `/api/reports/all/${fmt}${inline ? '?inline=1' : ''}`
}

export function download(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}
