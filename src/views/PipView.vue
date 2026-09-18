<template>
  <div class="pip" v-if="session && cfg">
    <div class="pip-head">
      <span class="pip-tag" v-if="part?.parsed.kind">{{ part.parsed.kind }}</span>
      <div class="pip-song">
        <div class="pip-title">「{{ part?.parsed.song || part?.title }}」</div>
        <div class="pip-meta">
          {{ part?.parsed.artist || '—' }} · {{ part?.parsed.anime || '？' }}
          <template v-if="liveAvg != null"> · 均 <b>{{ liveAvg }}</b></template>
        </div>
      </div>
      <span class="pip-pos">P{{ part?.page }}/{{ session.parts.length }}</span>
    </div>

    <div class="pip-matrix" ref="matrixRef">
      <div class="pip-row" v-for="pn in cfg.persons" :key="pn">
        <span class="pip-name">{{ pn }}</span>
        <input
          class="pip-in"
          :value="part?.scores[pn] ?? ''"
          :placeholder="`${cfg.scoreMin}-${cfg.scoreMax}`"
          inputmode="numeric"
          @input="onInput($event, pn)"
          @blur="clamp($event, pn)"
          @keydown.enter.prevent="onEnter($event)"
        />
        <button
          class="pip-fav"
          :class="{ on: part?.favorites.includes(pn) }"
          @click="toggleFav(pn)"
        >
          ★
        </button>
      </div>
      <div v-if="!cfg.persons.length" class="pip-empty">先去主界面设置参与人</div>
    </div>

    <div class="pip-foot">
      <button class="pip-btn" @click="prev" :disabled="currentIndex === 0">←</button>
      <span class="pip-sav" :class="saveStatus">{{ saveText }}</span>
      <button class="pip-btn next" @click="next">→</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api'
import type { Config, Part, Session } from '../types'

const route = useRoute()
const sessionId = route.params.id as string

const session = ref<Session | null>(null)
const cfg = ref<Config | null>(null)
const currentIndex = ref(0)
const matrixRef = ref<HTMLElement | null>(null)
const saveStatus = ref<'saved' | 'saving' | 'error' | 'idle'>('idle')
const savedAt = ref('')

const saveText = computed(() =>
  saveStatus.value === 'saving'
    ? '保存中…'
    : saveStatus.value === 'error'
      ? '保存失败'
      : saveStatus.value === 'saved'
        ? `已存 ${savedAt.value}`
        : '回车下一首'
)

const part = computed(() => session.value?.parts[currentIndex.value] ?? null)
const liveAvg = computed(() => {
  const vals = Object.values(part.value?.scores || {}).filter(
    v => typeof v === 'number'
  ) as number[]
  if (!vals.length) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
})

onMounted(async () => {
  const [s, c] = await Promise.all([api.getSession(sessionId), api.getConfig()])
  session.value = s
  cfg.value = c
  const saved = localStorage.getItem(`pip-index-${sessionId}`)
  let i = saved ? Number(saved) : NaN
  if (!(i >= 0) || i >= s.parts.length) {
    i = s.parts.findIndex((p: Part) => !p.skipped && !hasScore(p))
    if (i < 0) i = 0
  }
  currentIndex.value = i
  document.body.classList.add('pip-body')
  await nextTick()
  matrixRef.value?.querySelector<HTMLInputElement>('.pip-in')?.focus()
})

function hasScore(p: Part) {
  return Object.values(p.scores || {}).some(v => typeof v === 'number')
}

async function persist(person: string, score?: number | null, fav?: boolean) {
  saveStatus.value = 'saving'
  try {
    await api.patchPart(sessionId, part.value!.page, { person, score, fav })
    saveStatus.value = 'saved'
    savedAt.value = new Date().toLocaleTimeString('zh-CN')
  } catch {
    saveStatus.value = 'error'
  }
}

function onInput(e: Event, pn: string) {
  const raw = (e.target as HTMLInputElement).value.trim()
  const map = part.value!.scores
  if (raw === '') {
    if (map[pn] !== undefined) {
      delete map[pn]
      persist(pn, null)
    }
    return
  }
  const n = Number(raw)
  if (!Number.isNaN(n)) {
    map[pn] = n
    persist(pn, n)
  }
}

function clamp(e: Event, pn: string) {
  const input = e.target as HTMLInputElement
  const raw = input.value.trim()
  const scores = part.value!.scores
  if (raw === '' || Number.isNaN(Number(raw))) {
    // 脏输入（如 "--"）：清掉 UI 与状态，保持一致
    if (scores[pn] !== undefined) {
      delete scores[pn]
      persist(pn, null)
    }
    input.value = ''
    return
  }
  const min = cfg.value?.scoreMin ?? 1
  const max = cfg.value?.scoreMax ?? 10
  const c = Math.min(max, Math.max(min, Math.round(Number(raw))))
  scores[pn] = c
  input.value = String(c)
  persist(pn, c)
}

function toggleFav(pn: string) {
  const p = part.value!
  const on = p.favorites.includes(pn)
  if (on) p.favorites.splice(p.favorites.indexOf(pn), 1)
  else p.favorites.push(pn)
  persist(pn, undefined, !on)
}

function onEnter(e: KeyboardEvent) {
  const ins = Array.from(matrixRef.value?.querySelectorAll<HTMLInputElement>('.pip-in') ?? [])
  const idx = ins.indexOf(e.target as HTMLInputElement)
  if (idx >= 0 && idx < ins.length - 1) ins[idx + 1].focus()
  else next()
}

async function prev() {
  if (currentIndex.value > 0) {
    currentIndex.value--
    stash()
    await focusFirst()
  }
}
async function next() {
  if (session.value && currentIndex.value < session.value.parts.length - 1) {
    currentIndex.value++
    stash()
    await focusFirst()
  }
}
function stash() {
  localStorage.setItem(`pip-index-${sessionId}`, String(currentIndex.value))
  document.title = `P${part.value?.page} ${part.value?.parsed.song || part.value?.title || ''}`
}
async function focusFirst() {
  await nextTick()
  const first = matrixRef.value?.querySelector<HTMLInputElement>('.pip-in')
  first?.focus()
  first?.select()
}
</script>

<style scoped>
.pip {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  background: rgba(24, 25, 28, 0.94);
  color: #e8e9ea;
  padding: 10px 12px;
  font-family: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
}
.pip-head {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 8px;
}
.pip-tag {
  background: #fb7299;
  color: #fff;
  border-radius: 6px;
  font-size: 11px;
  padding: 2px 7px;
  flex-shrink: 0;
  margin-top: 2px;
  white-space: nowrap;
}
.pip-song {
  flex: 1;
  min-width: 0;
}
.pip-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  word-break: break-all;
}
.pip-meta {
  color: #9499a0;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pip-meta b {
  color: #fb7299;
}
.pip-pos {
  color: #61666d;
  font-size: 11.5px;
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.pip-matrix {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow-y: auto;
  min-height: 0;
}
.pip-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.pip-name {
  width: 64px;
  flex-shrink: 0;
  font-size: 13.5px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pip-in {
  flex: 1;
  min-width: 0;
  height: 34px;
  border-radius: 8px;
  border: 1px solid #3e4045;
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
  padding: 0 10px;
  font-size: 16px;
  font-weight: 700;
  text-align: center;
  outline: none;
}
.pip-in:focus {
  border-color: #fb7299;
  background: rgba(251, 114, 153, 0.1);
}
.pip-in::placeholder {
  color: #5c5f66;
  font-weight: 400;
}
.pip-fav {
  border: none;
  background: none;
  font-size: 20px;
  color: #5c5f66;
  cursor: pointer;
  padding: 0 4px;
}
.pip-fav.on {
  color: #f7a35c;
}
.pip-empty {
  color: #9499a0;
  font-size: 13px;
  text-align: center;
  padding: 20px 0;
}
.pip-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}
.pip-btn {
  border: 1px solid #3e4045;
  background: rgba(255, 255, 255, 0.06);
  color: #e8e9ea;
  border-radius: 8px;
  width: 56px;
  height: 34px;
  font-size: 16px;
  cursor: pointer;
}
.pip-btn.next {
  background: #fb7299;
  border-color: #fb7299;
  color: #fff;
  font-weight: 700;
}
.pip-btn:disabled {
  opacity: 0.35;
}
.pip-sav {
  color: #9499a0;
  font-size: 11.5px;
}
.pip-sav.saved {
  color: #67c23a;
}
.pip-sav.error {
  color: #f56c6c;
}
</style>

<style>
/* PiP 小窗全局底色（无 scoped，作用于 body） */
body.pip-body {
  margin: 0;
  background: rgba(24, 25, 28, 0.94);
}
</style>
