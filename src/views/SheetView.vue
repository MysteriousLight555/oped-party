<template>
  <div class="sheet" v-if="session && cfg">
    <header class="s-head">
      <h1>{{ session.name }}</h1>
      <p>
        个人打分 · <b>{{ me || '先选名字' }}</b> · 听完一首点一首
        <span v-if="meLocked"> · 身份已绑定</span>
      </p>
    </header>

    <div class="page-inner">
      <div class="savebar" :class="queue.status.value">
        <span class="dot"></span>
        <span class="txt">{{ saveText }}</span>
        <button
          v-if="queue.status.value === 'error' || queue.status.value === 'offline'"
          class="retry"
          @click="queue.flush()"
        >
          重试
        </button>
        <span v-if="queue.pendingCount.value" class="pending"
          >待提交 {{ queue.pendingCount.value }} 条</span
        >
      </div>

      <div v-if="current" class="nowbar">
        <span class="now">🔊 正在听</span>
        <b class="now-song">P{{ current.page }}「{{ current.parsed.song || current.title }}」</b>
        <span class="now-prog">
          已提交 {{ currentProg.submitted }}/{{ currentProg.memberCount }}
        </span>
        <span v-if="!currentProg.complete" class="now-miss">
          还差 {{ currentProg.missing.length }} 人<template v-if="currentProg.missing.length"
            >：{{ currentProg.missing.join('、') }}</template
          >
        </span>
        <span v-else class="now-ok">本曲已齐</span>
        <button class="locate" @click="scrollTo(current.page)">定位</button>
      </div>

      <div class="s-bar">
        <div class="s-row">
          <template v-if="meLocked">
            <span class="me-pill">你是 <b>{{ me }}</b></span>
            <el-button text size="small" @click="switchIdentity">换人</el-button>
          </template>
          <template v-else>
            <el-select
              v-model="personSel"
              placeholder="选择你是谁…"
              style="width: 190px"
              size="large"
            >
              <el-option v-for="p in members" :key="p" :label="p" :value="p" />
              <el-option label="✎ 其他人…" value="__custom__" />
            </el-select>
            <el-input
              v-if="personSel === '__custom__'"
              v-model="personCustom"
              placeholder="输入你的名字"
              style="width: 170px"
              size="large"
            />
          </template>
          <span class="s-progress">已评 {{ doneCount }}/{{ parts.length }}</span>
        </div>
        <div class="s-row">
          <el-input v-model="filterText" placeholder="搜索曲名 / 歌手 / 番剧" clearable />
        </div>
        <p class="s-tip">
          点分数即保存，再点一下取消；★ 收藏；维度分是参考坐标，可留空。
          <span v-if="session.stage?.blind">本场<b>独立评分</b>：提交前互相看不到分数，主持人揭晓后在大屏统一展示。</span>
        </p>
      </div>

      <el-alert
        v-if="session.done"
        type="info"
        show-icon
        :closable="false"
        class="mb8"
        title="本场已结束，评分已锁定；已提交的分数仍可查看。"
      />

      <div class="s-list">
        <div
          v-for="p in filteredParts"
          :key="p.page"
          :ref="el => setItemRef(p.page, el)"
          class="s-item"
          :class="{ current: p.page === currentPage, locked: session.done }"
        >
          <div class="s-title">
            <span class="s-num">P{{ p.page }}</span>
            <span class="s-song">「{{ p.parsed.song || p.title }}」</span>
            <span v-if="p.page === currentPage" class="s-onair">正在听</span>
            <span class="s-meta">
              {{ [p.parsed.artist, p.parsed.anime ? `《${p.parsed.anime}》` : '', p.parsed.kind]
                .filter(Boolean)
                .join(' · ') }}
            </span>
            <span class="s-submitted">{{ progressOf(p).submitted }}/{{ progressOf(p).memberCount }}</span>
          </div>
          <div class="s-scores">
            <template v-if="useButtons">
              <button
                v-for="v in scoreRange"
                :key="v"
                class="s-btn"
                :class="{ on: p.scores[me] === v }"
                :disabled="session.done"
                @click="tapScore(p, v)"
              >
                {{ v }}
              </button>
            </template>
            <el-input-number
              v-else
              :model-value="(p.scores[me] as number) ?? undefined"
              :min="cfg.scoreMin"
              :max="cfg.scoreMax"
              :step="0.5"
              :disabled="session.done"
              size="small"
              @change="(v: number | undefined) => setScore(p, v ?? null)"
            />
            <button
              class="s-fav"
              :class="{ on: p.favorites.includes(me) }"
              :disabled="session.done"
              title="收藏"
              @click="tapFav(p)"
            >
              ★
            </button>
          </div>
          <button
            v-if="dims.length"
            class="s-dimtoggle"
            :class="{ open: dimOpen[p.page] }"
            @click="dimOpen[p.page] = !dimOpen[p.page]"
          >
            <span>维度 <b>{{ dimFilled(p) }}</b>/{{ dims.length }}</span>
            <span
              v-if="dvgOf(p) != null"
              class="s-dvg"
              :class="(dvgOf(p) as number) >= 0 ? 'pos' : 'neg'"
            >Δ{{ fmtDvg(dvgOf(p) as number) }}</span>
            <span class="chev">▾</span>
          </button>
          <div v-if="dims.length && dimOpen[p.page]" class="s-dimpanel">
            <div v-for="d in dims" :key="d.key" class="s-dimrow">
              <span class="s-dimname" :title="d.desc">{{ d.name }}</span>
              <template v-if="useButtons">
                <button
                  v-for="v in scoreRange"
                  :key="v"
                  class="s-btn mini"
                  :class="{ on: p.dimScores?.[d.key]?.[me] === v }"
                  :disabled="session.done"
                  @click="tapDim(p, d.key, v)"
                >
                  {{ v }}
                </button>
              </template>
              <el-input-number
                v-else
                :model-value="(p.dimScores?.[d.key]?.[me] as number) ?? undefined"
                :min="cfg.scoreMin"
                :max="cfg.scoreMax"
                :step="0.5"
                :disabled="session.done"
                size="small"
                @change="(v: number | undefined) => setDim(p, d.key, v ?? null)"
              />
            </div>
            <p class="s-dimhint">维度分是参考坐标（算 Δ 反差用），不给也完全不影响你的总分。</p>
          </div>
          <div v-if="me" class="s-tags">
            <button
              v-for="t in tagOptions(p)"
              :key="t"
              class="s-tag"
              :class="{ on: p.personTags?.[me]?.includes(t) }"
              :disabled="session.done"
              @click="toggleTag(p, t)"
            >
              {{ t }}
            </button>
          </div>
        </div>
        <el-empty v-if="!filteredParts.length" description="没有匹配的分 P" />
      </div>
    </div>
  </div>
  <div v-else class="sheet-loading">加载中…</div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api, ApiError } from '../api'
import {
  auth,
  clearParticipant,
  ensureAccess,
  getParticipantPerson,
  getParticipantToken
} from '../auth'
import { applyPatchBody, createSheetSaveQueue, type PatchBody } from '../sheet-sync'
import type { Config, Part, Session } from '../types'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const session = ref<Session | null>(null)
const cfg = ref<Config | null>(null)
const personSel = ref('')
const personCustom = ref('')
const filterText = ref('')
const tokenPerson = ref('')
const itemRefs = new Map<number, HTMLElement>()
const dimOpen = ref<Record<number, boolean>>({})

const queue = createSheetSaveQueue({
  sessionId,
  onError: (err, body) => {
    ElMessage.error(`保存失败：${err.message}`)
    if (err.code === 'SESSION_CLOSED' && session.value) session.value.done = true
    if (err.status === 401 || err.code === 'NEED_JOIN') {
      clearParticipant(sessionId)
      tokenPerson.value = ''
      router.replace(`/join/${sessionId}`)
    }
    void body
    scheduleRefresh(0)
  },
  onSaved: (_body, rev) => {
    if (session.value) session.value.rev = Math.max(Number(session.value.rev) || 0, rev)
    scheduleRefresh(250)
  }
})

const me = computed(() =>
  tokenPerson.value
    ? tokenPerson.value
    : personSel.value === '__custom__'
      ? personCustom.value.trim()
      : personSel.value
)
const meLocked = computed(() => Boolean(tokenPerson.value))
const members = computed(() => session.value?.members || cfg.value?.persons || [])
const dims = computed(() => (cfg.value?.dimensions || []).filter(d => d.enabled))
const parts = computed(() => (session.value?.parts || []).filter(p => !p.skipped))

const saveText = computed(() => {
  const status = queue.status.value
  if (status === 'saving') return '保存中…'
  if (status === 'saved') return `已保存 ${queue.savedAt.value}`
  if (status === 'error') return `保存失败：${queue.lastError.value}`
  if (status === 'offline') return '网络断开，修改已暂存，联网后自动重试'
  return queue.pendingCount.value ? '待保存…' : '点分即存'
})

const doneCount = computed(
  () => parts.value.filter(p => typeof p.scores?.[me.value] === 'number').length
)
const useButtons = computed(() => {
  const c = cfg.value
  return c ? c.scoreMax - c.scoreMin + 1 <= 10 : true
})
const scoreRange = computed(() => {
  const c = cfg.value
  if (!c) return []
  const arr: number[] = []
  for (let v = c.scoreMin; v <= c.scoreMax; v++) arr.push(v)
  return arr
})
const filteredParts = computed(() => {
  const kw = filterText.value.trim().toLowerCase()
  if (!kw) return parts.value
  return parts.value.filter(p =>
    [p.title, p.parsed?.song, p.parsed?.artist, p.parsed?.anime]
      .join(' ')
      .toLowerCase()
      .includes(kw)
  )
})

/** 主持人明确指定的当前曲 */
const stagePage = computed(() => {
  const page = session.value?.stage?.currentPage
  return typeof page === 'number' ? page : null
})
/** 没有指定时回退到"下一首还没评齐的"（只用于显示，不自动滚动） */
const currentPage = computed(() => {
  if (stagePage.value != null) return stagePage.value
  const first = parts.value.find(p => !progressOf(p).complete)
  return first?.page ?? null
})
const current = computed(() => parts.value.find(p => p.page === currentPage.value) ?? null)
const currentProg = computed(() =>
  current.value
    ? progressOf(current.value)
    : { submitted: 0, memberCount: members.value.length, missing: [], complete: false }
)

function normalize(s: Session, c: Config) {
  if (!Array.isArray(s.members)) s.members = [...(c.persons || [])]
  s.stage = {
    currentPage: typeof s.stage?.currentPage === 'number' ? s.stage.currentPage : null,
    blind: Boolean(s.stage?.blind),
    revealed: Boolean(s.stage?.revealed),
    updatedAt: s.stage?.updatedAt ?? null
  }
  for (const p of s.parts) {
    p.scores = p.scores || {}
    p.dimScores = p.dimScores || {}
    for (const d of c.dimensions) p.dimScores[d.key] = p.dimScores[d.key] || {}
    p.personTags = p.personTags || {}
    p.personComments = p.personComments || {}
    p.favorites = p.favorites || []
    p.tags = p.tags || []
    p.comment = p.comment ?? ''
    p.parsed = p.parsed || { kind: '', anime: '', song: '', artist: '' }
  }
}

/** 单曲进度：参与者本地拿不到别人的分数，用服务端 progress + 本地待提交修正 */
function progressOf(p: Part) {
  const server = session.value?.progress?.[p.page]
  if (!server || !tokenPerson.value) {
    const list = members.value
    const missing = list.filter(m => typeof p.scores?.[m] !== 'number')
    return {
      submitted: list.length - missing.length,
      memberCount: list.length,
      missing,
      complete: list.length > 0 && missing.length === 0
    }
  }
  const mine = typeof p.scores?.[me.value] === 'number'
  const serverHasMine = !server.missing.includes(me.value)
  const submitted = server.submitted + (mine && !serverHasMine ? 1 : 0) - (!mine && serverHasMine ? 1 : 0)
  const missing = server.missing.filter(m => m !== me.value)
  if (!mine) missing.push(me.value)
  return {
    submitted: Math.max(0, submitted),
    memberCount: server.memberCount,
    missing,
    complete: server.memberCount > 0 && missing.length === 0
  }
}

function setItemRef(page: number, el: unknown) {
  if (el instanceof HTMLElement) itemRefs.set(page, el)
  else itemRefs.delete(page)
}

function scrollTo(page: number, smooth = true) {
  const el = itemRefs.get(page)
  el?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' })
}

function isEditing(): boolean {
  const ae = document.activeElement
  return Boolean(ae && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName))
}

// 主持人切歌：手机自动定位（正在输入时不打断）
watch(stagePage, async page => {
  if (page == null || isEditing()) return
  await nextTick()
  scrollTo(page)
})

// ---------- 加载 ----------
onMounted(async () => {
  await ensureAccess(true)
  tokenPerson.value =
    getParticipantToken(sessionId) && getParticipantPerson(sessionId)
      ? getParticipantPerson(sessionId)
      : ''
  if (!auth.host && !tokenPerson.value) {
    router.replace(`/join/${sessionId}`)
    return
  }
  try {
    const [s, c] = await Promise.all([api.getSession(sessionId), api.getConfig()])
    normalize(s, c)
    // 上次没提交成功的修改先叠回界面，随后队列会自动重试
    const pending = queue.init()
    for (const item of pending) {
      const part = s.parts.find(p => p.page === item.page)
      if (part) applyPatchBody(part, item.body)
    }
    session.value = s
    cfg.value = c
    if (tokenPerson.value) {
      personSel.value = tokenPerson.value
    } else {
      const saved =
        localStorage.getItem(`sheet-person-${sessionId}`) ||
        localStorage.getItem('sheet-person-global') ||
        ''
      if (saved) {
        if (c.persons.includes(saved) || (s.members || []).includes(saved)) personSel.value = saved
        else {
          personCustom.value = saved
          personSel.value = '__custom__'
        }
      }
    }
    for (const p of s.parts) {
      dimOpen.value[p.page] = dims.value.some(
        d => typeof p.dimScores?.[d.key]?.[me.value] === 'number'
      )
    }
    // 首次进入：如果主持人在放某一首，直接定位过去
    await nextTick()
    const startPage = s.stage?.currentPage
    if (typeof startPage === 'number') {
      window.setTimeout(() => scrollTo(startPage, false), 350)
    }
    if (pending.length) void queue.flush()
  } catch (e) {
    const err = e as ApiError
    if (err.status === 403 || err.code === 'NEED_JOIN') {
      clearParticipant(sessionId)
      router.replace(`/join/${sessionId}`)
      return
    }
    ElMessage.error((e as Error).message)
  }
})

// ---------- 轮询别人的进度 / 主持人的当前曲 ----------
let pollTimer: number | undefined
let refreshTimer: number | undefined
let refreshing = false

function scheduleRefresh(delay = 800) {
  window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => {
    void refreshRemote()
  }, delay)
}

async function refreshRemote() {
  if (refreshing || document.hidden || !session.value) return
  if (queue.status.value === 'saving') return
  refreshing = true
  try {
    const s = await api.getSession(sessionId)
    if (Number(s.rev || 0) < Number(session.value.rev || 0)) return
    normalize(s, cfg.value!)
    const pending = queue.pending.value
    for (const item of pending) {
      const part = s.parts.find(p => p.page === item.page)
      if (part) applyPatchBody(part, item.body)
    }
    session.value = s
  } catch (e) {
    const err = e as ApiError
    if (err.status === 403 || err.status === 401) {
      clearParticipant(sessionId)
      router.replace(`/join/${sessionId}`)
    }
  } finally {
    refreshing = false
  }
}

function onOnline() {
  void queue.flush()
  scheduleRefresh(300)
}

function onFocus() {
  scheduleRefresh(150)
}

onMounted(() => {
  pollTimer = window.setInterval(() => {
    if (!document.hidden) void refreshRemote()
  }, 6000)
  window.addEventListener('online', onOnline)
  window.addEventListener('focus', onFocus)
})

onBeforeUnmount(() => {
  queue.dispose()
  window.clearInterval(pollTimer)
  window.clearTimeout(refreshTimer)
  window.removeEventListener('online', onOnline)
  window.removeEventListener('focus', onFocus)
})

// ---------- 身份 ----------
async function guard(): Promise<boolean> {
  if (!me.value) {
    ElMessage.warning('先选择你是谁')
    return false
  }
  if (!meLocked.value && !members.value.includes(me.value) && session.value) {
    session.value.members = [...members.value, me.value]
  }
  localStorage.setItem(`sheet-person-${sessionId}`, me.value)
  localStorage.setItem('sheet-person-global', me.value)
  return true
}

function switchIdentity() {
  if (queue.pendingCount.value) {
    ElMessage.warning('还有评分待提交，请保存成功后再换人')
    return
  }
  clearParticipant(sessionId)
  router.replace(`/join/${sessionId}`)
}

function patch(page: Part, body: Omit<PatchBody, 'person'>, revert?: () => void) {
  queue.enqueue(page.page, { ...body, person: me.value }, revert)
}

// ---------- 打分：先改界面，再由队列可靠提交 ----------
async function setScore(p: Part, v: number | null) {
  if (session.value?.done) return
  if (!(await guard())) return
  const prev = p.scores[me.value]
  const before = prev === undefined ? () => delete p.scores[me.value] : () => (p.scores[me.value] = prev)
  if (v === null) delete p.scores[me.value]
  else p.scores[me.value] = v
  patch(p, { score: v }, before)
}

function tapScore(p: Part, v: number) {
  if (p.scores[me.value] === v) void setScore(p, null)
  else void setScore(p, v)
}

async function setDim(p: Part, key: string, v: number | null) {
  if (session.value?.done) return
  if (!(await guard())) return
  p.dimScores = p.dimScores || {}
  p.dimScores[key] = p.dimScores[key] || {}
  const prev = p.dimScores[key][me.value]
  const before =
    prev === undefined
      ? () => delete p.dimScores![key][me.value]
      : () => (p.dimScores![key][me.value] = prev)
  if (v === null) delete p.dimScores[key][me.value]
  else p.dimScores[key][me.value] = v
  patch(p, { dim: key, score: v }, before)
}

function tapDim(p: Part, key: string, v: number) {
  if (p.dimScores?.[key]?.[me.value] === v) void setDim(p, key, null)
  else void setDim(p, key, v)
}

async function tapFav(p: Part) {
  if (session.value?.done) return
  if (!(await guard())) return
  const on = !p.favorites.includes(me.value)
  if (on) p.favorites.push(me.value)
  else p.favorites.splice(p.favorites.indexOf(me.value), 1)
  patch(
    p,
    { fav: on },
    () => {
      const i = p.favorites.indexOf(me.value)
      if (on && i >= 0) p.favorites.splice(i, 1)
      if (!on && i < 0) p.favorites.push(me.value)
    }
  )
}

function tagOptions(p: Part): string[] {
  const set = new Set([...(cfg.value?.tags || []), ...(p.personTags?.[me.value] ?? [])])
  return [...set]
}

async function toggleTag(p: Part, t: string) {
  if (session.value?.done) return
  if (!(await guard())) return
  const cur = new Set(p.personTags?.[me.value] ?? [])
  const on = !cur.has(t)
  if (on) cur.add(t)
  else cur.delete(t)
  const arr = [...cur]
  const before = [...(p.personTags?.[me.value] ?? [])]
  p.personTags = p.personTags || {}
  p.personTags[me.value] = arr
  patch(
    p,
    { personTags: arr },
    () => {
      if (p.personTags) p.personTags[me.value] = before
    }
  )
}

// ---------- 反差小徽标 ----------
function dimFilled(p: Part): number {
  return dims.value.filter(d => typeof p.dimScores?.[d.key]?.[me.value] === 'number').length
}

function refOf(p: Part): number | null {
  const vals: { v: number; w: number }[] = []
  for (const d of dims.value) {
    const v = p.dimScores?.[d.key]?.[me.value]
    if (typeof v === 'number') vals.push({ v, w: d.weight && d.weight > 0 ? d.weight : 0 })
  }
  if (!vals.length) return null
  let wsum = vals.reduce((a, x) => a + x.w, 0)
  if (wsum <= 0) wsum = vals.length
  return Math.round(vals.reduce((a, x) => a + x.v * (x.w / wsum), 0) * 100) / 100
}

function dvgOf(p: Part): number | null {
  const s = p.scores[me.value]
  const ref = refOf(p)
  if (typeof s !== 'number' || ref == null) return null
  return Math.round((s - ref) * 100) / 100
}

function fmtDvg(x: number): string {
  const v = Math.round(x * 10) / 10
  return (v > 0 ? '+' : '') + v.toFixed(1)
}
</script>

<style scoped>
.s-head {
  background: linear-gradient(120deg, #fb7299, #f25d8e 45%, #23ade5 130%);
  color: #fff;
  padding: 22px 16px 28px;
  text-align: center;
}
.s-head h1 {
  margin: 0 0 6px;
  font-size: 22px;
}
.s-head p {
  margin: 0;
  opacity: 0.92;
  font-size: 13px;
}
.page-inner {
  max-width: 720px;
  margin: -14px auto 0;
  padding: 0 12px 60px;
}
.savebar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.96);
  backdrop-filter: blur(6px);
  border-radius: 10px;
  padding: 8px 12px;
  margin-bottom: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06);
  font-size: 12.5px;
  color: #61666d;
}
.savebar .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #c0c4cc;
  flex-shrink: 0;
}
.savebar.saving .dot { background: #e6a23c; }
.savebar.saved .dot { background: #67c23a; }
.savebar.error .dot { background: #f56c6c; }
.savebar.error .txt { color: #c24545; }
.savebar.offline .dot { background: #909399; }
.savebar .retry {
  border: 1px solid #f3d1d1;
  color: #c24545;
  background: #fef0f0;
  border-radius: 12px;
  font-size: 12px;
  padding: 1px 10px;
  cursor: pointer;
}
.savebar .pending { margin-left: auto; color: #b88230; }

.nowbar {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #fff7f0;
  border: 1px solid #ffe2c8;
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #7a5a32;
}
.nowbar .now { font-weight: 700; color: #e6a23c; }
.nowbar .now-song {
  font-size: 15px;
  color: #30333a;
  min-width: 0;
  word-break: break-all;
}
.nowbar .now-prog { color: #61666d; }
.nowbar .now-miss { color: #b88230; }
.nowbar .now-ok { color: #4e9a51; }
.nowbar .locate {
  margin-left: auto;
  border: none;
  background: #fff;
  color: #e6a23c;
  border-radius: 12px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
  box-shadow: 0 0 0 1px #ffe2c8;
}

.s-bar {
  background: #fff;
  border-radius: 12px;
  padding: 14px 16px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
  margin-bottom: 12px;
}
.s-row {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}
.s-row + .s-row {
  margin-top: 8px;
}
.s-progress {
  color: #9499a0;
  font-size: 13px;
  margin-left: auto;
}
.me-pill {
  background: #fff0f4;
  color: #fb7299;
  border-radius: 16px;
  padding: 4px 12px;
  font-size: 13px;
}
.s-tip {
  color: #9499a0;
  font-size: 12.5px;
  margin: 8px 2px 0;
  line-height: 1.6;
}
.mb8 {
  margin-bottom: 8px;
}
.s-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.s-item {
  background: #fff;
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.04);
  border: 1.5px solid transparent;
  transition: border-color 0.2s, box-shadow 0.2s;
}
.s-item.current {
  border-color: #ffc78a;
  box-shadow: 0 2px 14px rgba(230, 162, 60, 0.18);
}
.s-item.locked {
  opacity: 0.92;
}
.s-title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}
.s-num {
  color: #9499a0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.s-song {
  font-weight: 600;
  font-size: 15px;
}
.s-onair {
  font-size: 11px;
  color: #e6a23c;
  background: #fff7f0;
  border: 1px solid #ffe2c8;
  border-radius: 10px;
  padding: 0 8px;
}
.s-meta {
  color: #9499a0;
  font-size: 12.5px;
}
.s-submitted {
  margin-left: auto;
  color: #b0b4bb;
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
}
.s-scores {
  display: flex;
  gap: 5px;
  flex-wrap: wrap;
  align-items: center;
}
.s-btn {
  min-width: 34px;
  height: 32px;
  border-radius: 16px;
  border: 1px solid #dcdfe6;
  background: #fff;
  font-size: 14px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  color: #18191c;
}
.s-btn:hover {
  border-color: #fb7299;
  color: #fb7299;
}
.s-btn.on {
  background: #fb7299;
  border-color: #fb7299;
  color: #fff;
  font-weight: 700;
}
.s-btn:disabled,
.s-fav:disabled,
.s-tag:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.s-fav {
  border: none;
  background: none;
  font-size: 20px;
  color: #d5d8db;
  cursor: pointer;
  padding: 0 2px;
}
.s-fav.on {
  color: #f7a35c;
}
.s-tags {
  margin-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}
.s-dimtoggle {
  margin-top: 8px;
  border: none;
  background: none;
  color: #9499a0;
  font-size: 12px;
  cursor: pointer;
  padding: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.s-dimtoggle b {
  color: #fb7299;
}
.s-dimtoggle .chev {
  display: inline-block;
  transition: transform 0.18s;
  font-size: 10px;
}
.s-dimtoggle.open .chev {
  transform: rotate(180deg);
}
.s-dvg {
  font-size: 10.5px;
  font-weight: 600;
  border-radius: 4px;
  padding: 0 4px;
}
.s-dvg.pos {
  color: #c24545;
  background: #fdeeee;
}
.s-dvg.neg {
  color: #2a6fb8;
  background: #eaf3fc;
}
.s-dimpanel {
  margin-top: 8px;
  border-top: 1px dashed #eceef1;
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  animation: dim-in 0.18s ease;
}
@keyframes dim-in {
  from {
    opacity: 0;
    transform: translateY(-3px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}
.s-dimrow {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}
.s-dimname {
  color: #61666d;
  font-size: 12.5px;
  width: 64px;
  flex-shrink: 0;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.s-btn.mini {
  min-width: 28px;
  height: 26px;
  font-size: 12.5px;
  border-radius: 13px;
}
.s-dimhint {
  margin: 2px 0 0;
  color: #b8bec6;
  font-size: 11.5px;
}
.s-tag {
  border: 1px solid #e3e5e9;
  background: #fff;
  color: #61666d;
  border-radius: 20px;
  padding: 2px 10px;
  font-size: 12px;
  cursor: pointer;
}
.s-tag:hover {
  border-color: #fb7299;
  color: #fb7299;
}
.s-tag.on {
  background: #fff0f4;
  border-color: #ffd6e2;
  color: #fb7299;
  font-weight: 600;
}
.sheet-loading {
  text-align: center;
  color: #9499a0;
  padding: 80px 0;
}
</style>
