import type {
  AiConfigInfo,
  AiReview,
  Config,
  NcmLibStatus,
  NcmSong,
  Session,
  SessionMeta
} from './types'

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
    req<{
      configured: boolean
      loggedIn: boolean
      expireAt: number | null
      tokenRemainingHours: number
      canAutoRefresh: boolean
      mpv: boolean
    }>('/ncm/status'),
  ncmLoginQr: () => req<{ uniKey: string; qrUrl: string }>('/ncm/login/qr'),
  ncmLoginPoll: (uniKey: string) =>
    req<{ status: number; msg?: string; saved?: boolean }>(`/ncm/login/qr/${encodeURIComponent(uniKey)}`),
  ncmMatch: (sessionId: string, page: number) =>
    req<NcmSong>('/ncm/match', {
      method: 'POST',
      body: JSON.stringify({ sessionId, page })
    }),
  ncmGetPlaylist: () => req<{ playlistId: string }>('/ncm/playlist'),
  ncmSetPlaylist: (playlistId: string) =>
    req<{ playlistId: string }>('/ncm/playlist', {
      method: 'PUT',
      body: JSON.stringify({ playlistId })
    }),
  ncmSyncFavorites: (sessionId: string) =>
    req<{ songs: number; parts: number; added: number; duplicate: number }>('/ncm/sync-favorites', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    }),
  ncmHeartFavorites: (sessionId: string) =>
    req<{ songs: number; hearted: number; paidSkipped: number; failed: Array<{ id: string; error: string }> }>(
      '/ncm/heart-favorites',
      { method: 'POST', body: JSON.stringify({ sessionId }) }
    ),
  ncmPlaylists: () =>
    req<Array<{ id: string; name: string; trackCount: number; isHeart: boolean }>>('/ncm/playlists'),
  ncmPlay: (sessionId: string, page: number) =>
    req<{ started: boolean }>('/ncm/play', {
      method: 'POST',
      body: JSON.stringify({ sessionId, page })
    }),

  // 远端资料库状态（哪些歌已红心/已入目标歌单）
  ncmLibrary: (sessionId: string) => req<NcmLibStatus>(`/ncm/library/${sessionId}`),

  // 歌词（查看即缓存进期次；预取供报告歌词本用）
  ncmLyric: (sessionId: string, page: number) =>
    req<{ text: string; trans?: string; noLyric?: boolean; cached?: boolean }>(
      `/ncm/lyric/${sessionId}/${page}`
    ),
  ncmLyricPrefetchStart: (sessionId: string) =>
    req<{ started: boolean; running: boolean; done: number; total: number }>(
      `/ncm/lyric-prefetch/${sessionId}`,
      { method: 'POST' }
    ),
  ncmLyricPrefetchStatus: (sessionId: string) =>
    req<{ running: boolean; done: number; total: number }>(`/ncm/lyric-prefetch/${sessionId}`),

  // 换版本：搜索候选 + 手动选定
  ncmSearch: (keyword: string) =>
    req<{ songs: NcmSong[] }>('/ncm/search', { method: 'POST', body: JSON.stringify({ keyword }) }),
  ncmSetSong: (sessionId: string, page: number, song: Record<string, unknown>) =>
    req<NcmSong>('/ncm/set-song', {
      method: 'POST',
      body: JSON.stringify({ sessionId, page, song })
    }),

  // 撤销本期同步（取消红心 / 移出目标歌单）
  ncmUndoSync: (sessionId: string, hearts: boolean, playlist: boolean) =>
    req<{ songs: number; unhearted: number; heartFailed: Array<{ id: string; error: string }>; removed: number }>(
      '/ncm/undo-sync',
      { method: 'POST', body: JSON.stringify({ sessionId, hearts, playlist }) }
    ),

  // 数据备份 / 恢复
  backupUrl: '/api/backup',
  restoreBackup: (bundle: unknown) =>
    req<{ configRestored: boolean; sessionsRestored: number }>('/restore', {
      method: 'POST',
      body: JSON.stringify(bundle)
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
