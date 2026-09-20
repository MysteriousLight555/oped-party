import type { AiConfigInfo, AiReview, Config, NcmSong, Session, SessionMeta } from './types'

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
    `/api/reports/all/${fmt}${inline ? '?inline=1' : ''}`,

  /** 单曲级合并写入：只动一个人的总分/收藏/个人标签，避免整份覆盖 */
  patchPart: (
    id: string,
    page: number,
    body: {
      person: string
      score?: number | null
      fav?: boolean
      personTags?: string[]
      personComment?: string | null
    }
  ) =>
    req<{
      page: number
      scores: Record<string, number>
      favorites: string[]
      personTags: Record<string, string[]>
      personComments: Record<string, string>
    }>(
      `/sessions/${id}/part/${page}`,
      { method: 'PUT', body: JSON.stringify(body) }
    ),
  sheetUrl: (id: string) => `/api/sessions/${id}/sheet`,
  importSheets: (id: string, sheets: unknown[]) =>
    req<{ addedPersons: string[]; scores: number; favorites: number; tags: number }>(
      `/sessions/${id}/import`,
      { method: 'POST', body: JSON.stringify(sheets) }
    ),

  // ---------- AI 锐评（DeepSeek） ----------
  getAiConfig: () => req<AiConfigInfo>('/ai/config'),
  saveAiConfig: (body: {
    baseUrl?: string
    model?: string
    apiKey?: string
    clearKey?: boolean
    anonymize?: boolean
  }) => req<AiConfigInfo>('/ai/config', { method: 'PUT', body: JSON.stringify(body) }),
  testAi: () => req<{ ok: boolean; reply: string }>('/ai/test', { method: 'POST' }),
  aiReview: (id: string) =>
    req<{ review: AiReview; total: number }>(`/sessions/${id}/ai-review`, { method: 'POST' }),

  ncmStatus: () =>
    req<{ installed: boolean; appId: boolean; privateKey: boolean; player: string; mpv: boolean }>(
      '/ncm/status'
    ),
  ncmMatch: (sessionId: string, page: number) =>
    req<NcmSong>('/ncm/match', {
      method: 'POST',
      body: JSON.stringify({ sessionId, page })
    }),
  ncmPlay: (sessionId: string, page: number) =>
    req<{ started: boolean }>('/ncm/play', {
      method: 'POST',
      body: JSON.stringify({ sessionId, page })
    })
}

export function download(url: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = ''
  document.body.appendChild(a)
  a.click()
  a.remove()
}
