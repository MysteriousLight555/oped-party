<template>
  <div class="stage" v-if="cfg">
    <div class="top">
      <span class="session-name">{{ session?.name || '…' }}</span>
      <span class="progress">{{ votedCount }} / {{ totalActive }}</span>
      <button class="fsbtn" @click="toggleFs" title="全屏（F）">{{ fs ? '⤢' : '⛶' }}</button>
    </div>
    <div class="bar"><i :style="{ width: pct + '%' }"></i></div>

    <template v-if="current">
      <div class="kind" v-if="current.parsed?.kind">{{ current.parsed.kind }}</div>
      <h1 class="song">「{{ current.parsed?.song || current.title }}」</h1>
      <div class="meta">
        {{ current.parsed?.artist || '—' }} · 《{{ current.parsed?.anime || '？' }}》
        <span v-if="current.favorites?.length" class="fav">★ {{ current.favorites.length }}</span>
      </div>
      <div class="persons">
        <div
          v-for="pn in cfg.persons"
          :key="pn"
          class="pcard"
          :class="{ done: hasPersonScore(current, pn), fav: current.favorites?.includes(pn) }"
        >
          <div class="pname">{{ pn }}</div>
          <div class="pscore">
            <template v-if="hasPersonScore(current, pn)">{{ current.scores[pn] }}</template>
            <template v-else>…</template>
          </div>
        </div>
      </div>
      <div class="wait" v-if="waitCount > 0">还差 {{ waitCount }} 人</div>
    </template>

    <div v-else-if="session" class="alldone">
      <h1 class="song">🎉 本期评完！</h1>
      <div class="meta">共 {{ totalActive }} 首 · 快去生成报告发群里吧</div>
    </div>

    <div class="foot">自动刷新 · 每隔几秒同步现场进度</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../api'
import type { Config, Part, Session } from '../types'

const route = useRoute()
const sessionId = route.params.id as string

const session = ref<Session | null>(null)
const cfg = ref<Config | null>(null)
const fs = ref(false)

let timer: number | undefined

onMounted(async () => {
  try {
    const [s, c] = await Promise.all([api.getSession(sessionId), api.getConfig()])
    session.value = s
    cfg.value = c
  } catch {
    /* 期次可能已删除 */
  }
  timer = window.setInterval(refresh, 3000)
})

onBeforeUnmount(() => window.clearInterval(timer))

async function refresh() {
  if (document.hidden) return
  try {
    const s = await api.getSession(sessionId)
    if (s.parts.length === session.value?.parts.length || !session.value) session.value = s
  } catch {
    /* 断网保持旧画面 */
  }
}

function hasPersonScore(p: Part, pn: string) {
  return typeof p.scores?.[pn] === 'number'
}

/** 当前曲 = 第一首未跳过且还有人没打分的；全评完则 null */
const current = computed<Part | null>(() => {
  const parts = session.value?.parts || []
  for (const p of parts) {
    if (p.skipped) continue
    if (!cfg.value) return p
    if (!cfg.value.persons.every(pn => hasPersonScore(p, pn))) return p
  }
  return null
})

const votedCount = computed(
  () => (session.value?.parts || []).filter(p => !p.skipped && Object.keys(p.scores || {}).length > 0).length
)
const totalActive = computed(() => (session.value?.parts || []).filter(p => !p.skipped).length)
const waitCount = computed(() => {
  const p = current.value
  if (!p || !cfg.value) return 0
  return cfg.value.persons.filter(pn => !hasPersonScore(p, pn)).length
})
const pct = computed(() =>
  totalActive.value ? Math.round((votedCount.value / totalActive.value) * 100) : 0
)

function toggleFs() {
  if (document.fullscreenElement) {
    document.exitFullscreen()
    fs.value = false
  } else {
    document.documentElement.requestFullscreen().then(
      () => (fs.value = true),
      () => {}
    )
  }
}

function globalKey(e: KeyboardEvent) {
  if (e.key === 'f' || e.key === 'F') toggleFs()
}
onMounted(() => document.addEventListener('keydown', globalKey))
onBeforeUnmount(() => document.removeEventListener('keydown', globalKey))
</script>

<style scoped>
.stage {
  min-height: 100vh;
  background: radial-gradient(1200px 600px at 20% -10%, #232838 0%, #12141a 55%);
  color: #f4f5f7;
  padding: 24px 5vw 60px;
  display: flex;
  flex-direction: column;
}
.top {
  display: flex;
  align-items: center;
  gap: 18px;
  font-size: 20px;
  color: #9aa3b2;
}
.session-name {
  max-width: 55vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.progress { font-variant-numeric: tabular-nums; color: #f4f5f7; font-weight: 600; }
.fsbtn {
  margin-left: auto;
  background: none;
  border: 1px solid #39415a;
  color: #9aa3b2;
  border-radius: 8px;
  font-size: 18px;
  padding: 4px 12px;
  cursor: pointer;
}
.fsbtn:hover { color: #fff; border-color: #5a6482; }
.bar {
  height: 6px;
  border-radius: 3px;
  background: #2a3046;
  margin: 12px 0 0;
  overflow: hidden;
}
.bar i { display: block; height: 100%; background: linear-gradient(90deg, #fb7299, #ffa940); transition: width 0.6s; }

.kind {
  margin-top: 5vh;
  display: inline-block;
  align-self: flex-start;
  color: #fb7299;
  border: 2px solid #fb7299;
  border-radius: 10px;
  padding: 2px 16px;
  font-size: 26px;
  font-weight: 700;
}
.song {
  margin: 2vh 0 0;
  font-size: clamp(34px, 7vw, 88px);
  line-height: 1.25;
  word-break: break-all;
}
.meta { margin-top: 1.5vh; font-size: clamp(18px, 2.6vw, 34px); color: #c3cad8; }
.fav { color: #ffa940; font-weight: 700; margin-left: 14px; }

.persons {
  margin-top: 5vh;
  display: flex;
  flex-wrap: wrap;
  gap: 2.4vw;
}
.pcard {
  min-width: 12vw;
  border: 2px solid #2a3046;
  border-radius: 18px;
  padding: 18px 26px;
  background: #181c28;
}
.pcard.done { border-color: #fb7299; }
.pcard.fav { box-shadow: 0 0 0 3px #ffa94033; }
.pname { font-size: clamp(16px, 2.2vw, 30px); color: #c3cad8; }
.pcard.done .pname { color: #fff; }
.pscore {
  font-size: clamp(40px, 6vw, 84px);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: #6b7386;
}
.pcard.done .pscore { color: #fb7299; }
.wait { margin-top: 3vh; font-size: clamp(15px, 2vw, 26px); color: #ffa940; }

.alldone { margin-top: 12vh; }
.foot {
  margin-top: auto;
  padding-top: 5vh;
  color: #4c556c;
  font-size: 14px;
}
</style>
