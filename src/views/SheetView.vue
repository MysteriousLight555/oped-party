<template>
  <div class="sheet" v-if="session && cfg">
    <header class="s-head">
      <h1>{{ session.name }}</h1>
      <p>个人打分 · 选好你的名字，听完一首点一首，即点即存</p>
    </header>

    <div class="page-inner">
      <div class="s-bar">
        <div class="s-row">
          <el-select
            v-model="personSel"
            placeholder="选择你是谁…"
            style="width: 200px"
            size="large"
          >
            <el-option v-for="p in cfg.persons" :key="p" :label="p" :value="p" />
            <el-option label="✎ 其他人…" value="__custom__" />
          </el-select>
          <el-input
            v-if="personSel === '__custom__'"
            v-model="personCustom"
            placeholder="输入你的名字"
            style="width: 200px"
            size="large"
          />
          <span class="s-progress">已评 {{ doneCount }}/{{ parts.length }}</span>
        </div>
        <div class="s-row">
          <el-input v-model="filterText" placeholder="搜索曲名 / 歌手 / 番剧" clearable />
        </div>
        <p class="s-tip">
          点分数即选中，再点一下取消；★ 收藏；下方标签是<b>你自己的</b>情绪判断（工业糖精 / 情怀暴击
          …），用来解释你的反差分。分数实时保存，中途关页面也没关系。
        </p>
      </div>

      <div class="s-list">
        <div v-for="p in filteredParts" :key="p.page" class="s-item">
          <div class="s-title">
            <span class="s-num">P{{ p.page }}</span>
            <span class="s-song">「{{ p.parsed.song || p.title }}」</span>
            <span class="s-meta">
              {{ [p.parsed.artist, p.parsed.anime ? `《${p.parsed.anime}》` : '', p.parsed.kind]
                .filter(Boolean)
                .join(' · ') }}
            </span>
          </div>
          <div class="s-scores">
            <template v-if="useButtons">
              <button
                v-for="v in scoreRange"
                :key="v"
                class="s-btn"
                :class="{ on: p.scores[me] === v }"
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
              size="small"
              @change="(v: number | undefined) => setScore(p, v ?? null)"
            />
            <button
              class="s-fav"
              :class="{ on: p.favorites.includes(me) }"
              title="收藏"
              @click="tapFav(p)"
            >
              ★
            </button>
          </div>
          <div v-if="me" class="s-tags">
            <button
              v-for="t in tagOptions(p)"
              :key="t"
              class="s-tag"
              :class="{ on: p.personTags?.[me]?.includes(t) }"
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
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import type { Config, Part, Session } from '../types'

const route = useRoute()
const sessionId = route.params.id as string

const session = ref<Session | null>(null)
const cfg = ref<Config | null>(null)
const personSel = ref('')
const personCustom = ref('')
const filterText = ref('')

const me = computed(() =>
  personSel.value === '__custom__' ? personCustom.value.trim() : personSel.value
)
const parts = computed(() => (session.value?.parts || []).filter(p => !p.skipped))
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
const doneCount = computed(
  () => parts.value.filter(p => typeof p.scores?.[me.value] === 'number').length
)
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

onMounted(async () => {
  const [s, c] = await Promise.all([api.getSession(sessionId), api.getConfig()])
  for (const p of s.parts) {
    p.personTags = p.personTags || {}
    p.personComments = p.personComments || {}
  }
  session.value = s
  cfg.value = c
  personSel.value = localStorage.getItem(`sheet-person-${sessionId}`) || ''
})

async function guard(): Promise<boolean> {
  if (!me.value) {
    ElMessage.warning('先选择你是谁')
    return false
  }
  localStorage.setItem(`sheet-person-${sessionId}`, personSel.value)
  return true
}

async function setScore(p: Part, v: number | null) {
  if (!(await guard())) return
  try {
    await api.patchPart(sessionId, p.page, { person: me.value, score: v })
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

function tapScore(p: Part, v: number) {
  if (p.scores[me.value] === v) setScore(p, null)
  else setScore(p, v)
}

async function tapFav(p: Part) {
  if (!(await guard())) return
  const on = !p.favorites.includes(me.value)
  if (on) p.favorites.push(me.value)
  else p.favorites.splice(p.favorites.indexOf(me.value), 1)
  try {
    await api.patchPart(sessionId, p.page, { person: me.value, fav: on })
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

// ---------- 个人标签：解释"为什么我给这个分"（工业糖精 / 情怀暴击…） ----------
function tagOptions(p: Part): string[] {
  const set = new Set([...(cfg.value?.tags || []), ...(p.personTags?.[me.value] ?? [])])
  return [...set]
}

async function toggleTag(p: Part, t: string) {
  if (!(await guard())) return
  const cur = new Set(p.personTags?.[me.value] ?? [])
  const on = !cur.has(t)
  if (on) cur.add(t)
  else cur.delete(t)
  const arr = [...cur]
  p.personTags = p.personTags || {}
  p.personTags[me.value] = arr
  try {
    await api.patchPart(sessionId, p.page, { person: me.value, personTags: arr })
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
</script>

<style scoped>
.s-head {
  background: linear-gradient(120deg, #fb7299, #f25d8e 45%, #23ade5 130%);
  color: #fff;
  padding: 24px 16px 30px;
  text-align: center;
}
.s-head h1 {
  margin: 0 0 6px;
  font-size: 22px;
}
.s-head p {
  margin: 0;
  opacity: 0.9;
  font-size: 13px;
}
.page-inner {
  max-width: 720px;
  margin: -16px auto 0;
  padding: 0 12px 60px;
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
.s-tip {
  color: #9499a0;
  font-size: 12.5px;
  margin: 8px 2px 0;
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
.s-meta {
  color: #9499a0;
  font-size: 12.5px;
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
</style>
