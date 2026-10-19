/** 手机打分页的可靠保存队列：
 * - 点一下立刻改界面，后台按顺序提交；
 * - 网络失败/断网时留在本地（localStorage），联网或点"重试"后继续；
 * - 被服务端明确拒绝（本场已结束、被移出成员等）才回滚并提示。
 */
import { computed, ref } from 'vue'
import { api, ApiError } from './api'
import type { Part } from './types'

export interface PatchBody {
  person: string
  score?: number | null
  dim?: string
  fav?: boolean
  personTags?: string[]
  personComment?: string | null
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error' | 'offline'

interface PendingItem {
  id: string
  key: string
  page: number
  body: PatchBody
  at: number
}

export interface QueueOptions {
  sessionId: string
  onError?: (error: ApiError, body: PatchBody) => void
  onSaved?: (body: PatchBody, rev: number) => void
}

const RETRY_BASE = 4000
const RETRY_MAX = 30000

function fieldKey(body: PatchBody): string {
  if (body.dim !== undefined) return `dim:${body.dim}`
  if (body.score !== undefined) return 'score'
  if (body.fav !== undefined) return 'fav'
  if (body.personTags !== undefined) return 'tags'
  if (body.personComment !== undefined) return 'comment'
  return 'misc'
}

export function applyPatchBody(part: Part, body: PatchBody): void {
  const person = body.person
  if (!person) return
  if (body.dim !== undefined) {
    part.dimScores = part.dimScores || {}
    part.dimScores[body.dim] = part.dimScores[body.dim] || {}
    if (body.score === null || body.score === undefined) delete part.dimScores[body.dim][person]
    else part.dimScores[body.dim][person] = body.score
    return
  }
  if (body.score !== undefined) {
    if (body.score === null) delete part.scores[person]
    else part.scores[person] = body.score
  }
  if (body.fav !== undefined) {
    part.favorites = part.favorites || []
    const i = part.favorites.indexOf(person)
    if (body.fav && i < 0) part.favorites.push(person)
    if (!body.fav && i >= 0) part.favorites.splice(i, 1)
  }
  if (body.personTags !== undefined) {
    part.personTags = part.personTags || {}
    if (body.personTags.length) part.personTags[person] = [...body.personTags]
    else delete part.personTags[person]
  }
  if (body.personComment !== undefined) {
    part.personComments = part.personComments || {}
    const text = String(body.personComment ?? '').trim()
    if (text) part.personComments[person] = text
    else delete part.personComments[person]
  }
}

export function createSheetSaveQueue(opts: QueueOptions) {
  const storageKey = `oped-sheet-pending-${opts.sessionId}`
  const status = ref<SaveStatus>('idle')
  const savedAt = ref('')
  const lastError = ref('')
  const pending = ref<PendingItem[]>([])
  const reverts = new Map<string, () => void>()
  const pendingCount = computed(() => pending.value.length)
  const busy = computed(() => status.value === 'saving')

  let flushing = false
  let disposed = false
  let retryTimer: number | undefined
  let attempts = 0

  function persist() {
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          v: 1,
          ops: pending.value.map(({ id, key, page, body, at }) => ({ id, key, page, body, at }))
        })
      )
    } catch {
      /* 存储满/隐私模式：至少内存里还能重试 */
    }
  }

  function restore(): PendingItem[] {
    try {
      const raw = localStorage.getItem(storageKey)
      if (!raw) return []
      const data = JSON.parse(raw)
      if (!Array.isArray(data?.ops)) return []
      return data.ops.filter(
        (x: PendingItem) => x && x.body && typeof x.page === 'number' && x.body.person
      )
    } catch {
      return []
    }
  }

  function clearRetry() {
    window.clearTimeout(retryTimer)
    retryTimer = undefined
  }

  function scheduleRetry(delay: number) {
    clearRetry()
    if (disposed) return
    retryTimer = window.setTimeout(() => {
      void flush()
    }, delay)
  }

  function remove(id: string) {
    pending.value = pending.value.filter(x => x.id !== id)
  }

  function enqueue(page: number, body: PatchBody, revert?: () => void) {
    if (disposed || body.person === undefined || body.person === '') return
    const key = `${body.person}:${page}:${fieldKey(body)}`
    // 同一格连续点：只保留最后一次，避免无意义的请求风暴
    for (const old of pending.value) {
      if (old.key === key) reverts.delete(old.id)
    }
    pending.value = pending.value.filter(x => x.key !== key)
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    pending.value.push({ id, key, page, body: { ...body }, at: Date.now() })
    if (revert) reverts.set(id, revert)
    persist()
    clearRetry()
    void flush()
  }

  async function flush(): Promise<void> {
    if (flushing || disposed) return
    if (!pending.value.length) {
      if (status.value !== 'error') status.value = 'idle'
      return
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      status.value = 'offline'
      scheduleRetry(RETRY_BASE)
      return
    }
    flushing = true
    status.value = 'saving'
    lastError.value = ''
    try {
      while (pending.value.length && !disposed) {
        const item = pending.value[0]
        let rev: number
        try {
          const result = await api.patchPart(opts.sessionId, item.page, item.body)
          rev = result.rev
        } catch (e) {
          const err = e instanceof ApiError ? e : new ApiError(0, String((e as Error)?.message || e))
          const definitive =
            err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429
          if (definitive) {
            remove(item.id)
            const revert = reverts.get(item.id)
            reverts.delete(item.id)
            revert?.()
            lastError.value = err.message
            persist()
            status.value = 'error'
            opts.onError?.(err, item.body)
            break
          }
          status.value =
            typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error'
          lastError.value = err.message || '网络异常'
          attempts += 1
          scheduleRetry(Math.min(RETRY_MAX, RETRY_BASE * attempts))
          persist()
          break
        }
        remove(item.id)
        reverts.delete(item.id)
        persist()
        attempts = 0
        opts.onSaved?.(item.body, rev)
        if (!pending.value.length) {
          status.value = 'saved'
          savedAt.value = new Date().toLocaleTimeString('zh-CN')
        }
      }
    } finally {
      flushing = false
    }
  }

  function init(): PendingItem[] {
    pending.value = restore()
    if (pending.value.length) status.value = 'idle'
    return pending.value
  }

  function dispose() {
    disposed = true
    clearRetry()
  }

  return {
    status,
    savedAt,
    lastError,
    pending,
    pendingCount,
    busy,
    init,
    enqueue,
    flush,
    dispose
  }
}
