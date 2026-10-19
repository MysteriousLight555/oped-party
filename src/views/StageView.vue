<template>
  <div class="stage" v-if="cfg">
    <div class="top">
      <span class="session-name">{{ session?.name || '…' }}</span>
      <span class="progress">
        已评齐 {{ completeCount }} / {{ totalActive }}
        <span class="sub">· 当前曲已交 {{ currentSubmitted }} / {{ memberCount }}</span>
      </span>
      <button
        v-if="blind && !revealed"
        class="reveal"
        @click="reveal"
        title="揭晓后大屏显示所有人的分数"
      >
        揭晓分数
      </button>
      <button class="fsbtn" @click="toggleFs" title="全屏（F）">{{ fs ? '⤢' : '⛶' }}</button>
    </div>
    <div class="bar"><i :style="{ width: pct + '%' }"></i></div>

    <template v-if="current">
      <div class="nowline">
        <span class="nowtag">🔊 正在听</span>
        <span class="pageno">P{{ current.page }} / {{ parts.length }}</span>
        <span v-if="!hostPicked" class="auto">待评曲自动跟随</span>
      </div>
      <div class="kind" v-if="current.parsed?.kind">{{ current.parsed.kind }}</div>
      <h1 class="song">「{{ current.parsed?.song || current.title }}」</h1>
      <div class="meta">
        {{ current.parsed?.artist || '—' }} · 《{{ current.parsed?.anime || '？' }}》
        <span v-if="current.favorites?.length" class="fav">★ {{ current.favorites.length }}</span>
      </div>
      <div class="submitline">
        <span class="submitted">已提交 {{ currentSubmitted }} / {{ memberCount }}</span>
        <span v-if="missing.length" class="waiting">还差 {{ missing.length }} 人：{{ missing.join('、') }}</span>
        <span v-else class="allin">✓ 本曲评齐</span>
        <span v-if="!hideScores && currentAvg != null" class="avg">均分 {{ currentAvg }}</span>
        <span v-if="blind && !revealed" class="blindtag">🔒 独立评分中 · 分数暂不显示</span>
      </div>
      <div class="persons">
        <div
          v-for="pn in members"
          :key="pn"
          class="pcard"
          :class="{ done: hasPersonScore(current, pn), fav: current.favorites?.includes(pn) }"
        >
          <div class="pname">{{ pn }}</div>
          <div class="pscore">
            <template v-if="hasPersonScore(current, pn)">
              <template v-if="hideScores">✓</template>
              <template v-else>{{ current.scores[pn] }}</template>
            </template>
            <template v-else>…</template>
          </div>
        </div>
      </div>
      <div class="foot-hint" v-if="blind && !revealed">独立评分模式：大家交完再揭晓，避免互相影响。</div>
    </template>

    <div v-else-if="session?.done" class="alldone">
      <h1 class="song">🎉 本期结束</h1>
      <div class="meta">共 {{ totalActive }} 首 · 去生成报告发群里吧</div>
    </div>
    <div v-else-if="session" class="alldone">
      <h1 class="song">🎉 本期评完！</h1>
      <div class="meta">共 {{ totalActive }} 首 · 快去生成报告发群里吧</div>
    </div>

    <div class="foot">主持人用「📣 投影这首」切歌 · 手机自动定位当前曲</div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
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
    if (Number(s.rev || 0) < Number(session.value?.rev || 0)) return
    if (s.parts.length === session.value?.parts.length || !session.value) session.value = s
  } catch {
    /* 断网保持旧画面 */
  }
}

function hasPersonScore(p: Part, pn: string) {
  return typeof p.scores?.[pn] === 'number'
}

const parts = computed(() => (session.value?.parts || []).filter(p => !p.skipped))
const members = computed(() => session.value?.members || cfg.value?.persons || [])
const memberCount = computed(() => members.value.length)
const blind = computed(() => Boolean(session.value?.stage?.blind))
const revealed = computed(() => Boolean(session.value?.stage?.revealed))
const hideScores = computed(() => blind.value && !revealed.value)

const completeCount = computed(() => {
  if (!memberCount.value) return 0
  return parts.value.filter(p => members.value.every(m => hasPersonScore(p, m))).length
})
const totalActive = computed(() => parts.value.length)

/** 当前曲：主持人明确指定；没有指定时回退到"下一首还没评齐的" */
const hostPicked = computed(() => {
  const page = session.value?.stage?.currentPage
  return typeof page === 'number' && parts.value.some(p => p.page === page)
})
const current = computed<Part | null>(() => {
  if (!session.value) return null
  if (hostPicked.value) {
    return parts.value.find(p => p.page === session.value!.stage!.currentPage) || null
  }
  return parts.value.find(p => members.value.some(m => !hasPersonScore(p, m))) || null
})

const currentSubmitted = computed(() => {
  const p = current.value
  if (!p) return 0
  return members.value.filter(m => hasPersonScore(p, m)).length
})
const missing = computed(() => {
  const p = current.value
  if (!p) return []
  return members.value.filter(m => !hasPersonScore(p, m))
})
const currentAvg = computed(() => {
  const p = current.value
  if (!p) return null
  const vals = members.value
    .map(m => p.scores?.[m])
    .filter((v): v is number => typeof v === 'number')
  if (!vals.length) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
})
const pct = computed(() =>
  totalActive.value ? Math.round((completeCount.value / totalActive.value) * 100) : 0
)

async function reveal() {
  try {
    const r = await api.setStage(sessionId, { revealed: true })
    if (session.value) session.value.stage = r.stage
    ElMessage.success('已揭晓')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

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
  flex-wrap: wrap;
}
.session-name {
  max-width: 45vw;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.progress { font-variant-numeric: tabular-nums; color: #f4f5f7; font-weight: 600; }
.progress .sub { color: #8b93a3; font-weight: 400; font-size: 0.8em; margin-left: 6px; }
.reveal {
  margin-left: auto;
  background: #ffa940;
  border: none;
  color: #1b1d24;
  border-radius: 8px;
  font-size: 16px;
  font-weight: 700;
  padding: 6px 14px;
  cursor: pointer;
}
.fsbtn {
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

.nowline { margin-top: 4vh; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.nowtag { color: #23ade5; font-weight: 700; font-size: clamp(16px, 2vw, 24px); }
.pageno { color: #9aa3b2; font-size: clamp(14px, 1.6vw, 20px); font-variant-numeric: tabular-nums; }
.auto { color: #6b7386; font-size: 13px; }

.kind {
  margin-top: 2vh;
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
  margin: 1vh 0 0;
  font-size: clamp(34px, 7vw, 88px);
  line-height: 1.25;
  word-break: break-all;
}
.meta { margin-top: 1.5vh; font-size: clamp(18px, 2.6vw, 34px); color: #c3cad8; }
.fav { color: #ffa940; font-weight: 700; margin-left: 14px; }

.submitline {
  margin-top: 2.2vh;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: clamp(15px, 1.9vw, 24px);
}
.submitted { color: #f4f5f7; font-weight: 600; }
.waiting { color: #ffa940; }
.allin { color: #67c23a; }
.avg { color: #fb7299; font-weight: 700; }
.blindtag { color: #9aa3b2; font-size: 0.75em; }

.persons {
  margin-top: 3.5vh;
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
.foot-hint { margin-top: 3vh; color: #8b93a3; font-size: 15px; }

.alldone { margin-top: 12vh; }
.foot {
  margin-top: auto;
  padding-top: 5vh;
  color: #4c556c;
  font-size: 14px;
}
</style>
