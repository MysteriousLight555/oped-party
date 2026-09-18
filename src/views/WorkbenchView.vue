<template>
  <div class="page" v-if="session && cfg">
    <div class="wb-head">
      <el-button text @click="leave">← 返回</el-button>
      <div class="wb-title">
        <b>{{ session.name }}</b>
        <span class="wb-sub">
          已评 {{ votedCount }}/{{ totalActive }} ·
          <span :class="['sav', saveStatus]">{{ saveText }}</span>
        </span>
      </div>
      <el-button @click="openPip" title="置顶小窗，全屏看视频时也能打分">📺 悬浮面板</el-button>
      <el-button @click="jumpNextPending">下一个待评 →</el-button>
      <el-button
        type="warning"
        plain
        :loading="aiLoading"
        title="把本场聚合数据发给大模型，生成锐评与每人口味画像（按需触发）"
        @click="openAi"
      >✨ AI 锐评</el-button>
      <el-dropdown trigger="click">
        <el-button>报告 ↓</el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="preview(api.sessionReport(session.id, 'html', true))">
              预览排行榜
            </el-dropdown-item>
            <el-dropdown-item divided @click="download(api.sessionReport(session.id, 'html'))">
              下载 HTML
            </el-dropdown-item>
            <el-dropdown-item @click="download(api.sessionReport(session.id, 'md'))">
              下载 Markdown
            </el-dropdown-item>
            <el-dropdown-item @click="download(api.sessionReport(session.id, 'xlsx'))">
              下载 Excel
            </el-dropdown-item>
            <el-dropdown-item @click="download(api.sessionReport(session.id, 'json'))">
              导出 JSON
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <el-alert v-if="cfg.persons.length === 0" type="warning" show-icon :closable="false" class="mb12">
      还没有参与人，先去<RouterLink to="/settings">设置页</RouterLink>添加，再回来打分。
    </el-alert>

    <div class="wb-body" :class="{ noperson: cfg.persons.length === 0 }">
      <aside class="plist">
        <el-input v-model="filterText" placeholder="搜索曲名 / 歌手 / 番剧" clearable size="small" />
        <el-scrollbar class="plist-scroll">
          <div
            v-for="item in filteredParts"
            :key="item.part.page"
            class="pitem"
            :class="[statusOf(item.part), { active: item.index === currentIndex }]"
            @click="setIndex(item.index)"
          >
            <span class="pnum">{{ item.part.page }}</span>
            <div class="pinfo">
              <span class="ptitle">{{ item.part.parsed?.song || item.part.title }}</span>
              <span v-if="subOf(item.part)" class="psub">
                <em v-if="item.part.parsed.kind" class="pk">{{ item.part.parsed.kind }}</em>{{ subOf(item.part) }}
              </span>
            </div>
            <span class="pbadges">
              <span v-if="statusOf(item.part) === 'done'" class="ok">✓</span>
              <span v-if="item.part.skipped" class="sk">跳</span>
              <span v-if="item.part.favorites?.length" class="star">★</span>
            </span>
          </div>
          <div v-if="!filteredParts.length" class="pempty">没有匹配的分 P</div>
        </el-scrollbar>
      </aside>

      <section class="main" v-if="part">
        <div class="songhead">
          <div class="sh-left">
            <h2 class="sh-song">
              <el-tag v-if="part.parsed.kind" size="small" effect="dark" class="kindtag">{{
                part.parsed.kind
              }}</el-tag>
              「{{ part.parsed.song || part.title }}」
            </h2>
            <div class="sh-meta">
              {{ part.parsed.artist || '—' }} · 《{{ part.parsed.anime || '？' }}》 ·
              {{ fmtDur(part.duration) }}
              <template v-if="liveAvg != null">
                · 当前均分 <b class="liveavg">{{ liveAvg }}</b>
              </template>
            </div>
          </div>
          <div class="sh-actions">
            <el-button size="small" @click="openEdit">修正信息</el-button>
            <el-button size="small" :disabled="!session.bvid" @click="openBili">B站 ↗</el-button>
            <el-button size="small" @click="toggleSkip">
              {{ part.skipped ? '取消跳过' : '跳过' }}
            </el-button>
          </div>
        </div>

        <el-alert v-if="part.skipped" type="info" :closable="false" class="mb12">
          已标记为跳过，不会出现在榜单里（比如菜单、说明类分 P）。
        </el-alert>

        <div class="matrix" ref="matrixRef">
          <table>
            <thead>
              <tr>
                <th></th>
                <th>
                  总分（主观总评）
                  <span class="range">{{ cfg.scoreMin }}~{{ cfg.scoreMax }}</span>
                </th>
                <th v-for="d in dims" :key="d.key">
                  <span :title="d.desc || d.name">{{ d.name }}</span>
                  <span
                    v-if="d.weight != null"
                    class="wt"
                    title="参考权重：只用来换算「维度参考分」，与总分无关"
                  >{{ d.weight }}%</span>
                </th>
                <th>收藏</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="pn in cfg.persons" :key="pn">
                <td class="pname">{{ pn }}</td>
                <td>
                  <div class="totwrap">
                    <input
                      class="sin total"
                      :value="part.scores[pn] ?? ''"
                      @input="onCellInput($event, part.scores, pn)"
                      @blur="clampCell(part.scores, pn)"
                      @keydown.enter.prevent="onEnter($event)"
                      :placeholder="`${cfg.scoreMin}-${cfg.scoreMax}`"
                      inputmode="numeric"
                    />
                    <span
                      v-if="dvgOf(part, pn) != null"
                      class="dvg"
                      :class="(dvgOf(part, pn) as number) >= 0 ? 'pos' : 'neg'"
                      :title="`维度参考分 ${refOf(part, pn)}（按权重换算）。反差 = 主观总评 − 参考：正=情怀溢价，负=套路压分`"
                    >Δ{{ fmtDvg(dvgOf(part, pn) as number) }}</span>
                  </div>
                </td>
                <td v-for="d in dims" :key="d.key">
                  <input
                    class="sin"
                    :value="part.dimScores[d.key]?.[pn] ?? ''"
                    @input="onCellInput($event, part.dimScores[d.key], pn)"
                    @blur="clampCell(part.dimScores[d.key], pn)"
                    @keydown.enter.prevent="onEnter($event)"
                    inputmode="numeric"
                  />
                </td>
                <td>
                  <button
                    class="favbtn"
                    :class="{ on: part.favorites.includes(pn) }"
                    :title="part.favorites.includes(pn) ? '取消收藏' : '收藏'"
                    @click="toggleFav(pn)"
                  >
                    ★
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <p class="hint">
            输完一个格子按<b>回车</b>跳到下一格，最后一个回车自动进入下一首；Alt + ←/→ 切歌。<br />
            总分是<b>主观总评</b>，不和维度分换算——想给情怀分、想压套路分，尽管和维度反着来，
            <b>Δ 反差</b>（总分 − 维度参考分）会被记进报告。
          </p>
        </div>

        <div class="extra">
          <el-input
            v-model="part.comment"
            placeholder="全场短评（可选，大家的公共印象）"
            maxlength="120"
            show-word-limit
          />
          <el-select
            v-model="part.tags"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="全场标签（可多选，可直接输入新标签）"
          >
            <el-option v-for="t in tagOptions" :key="t" :label="t" :value="t" />
          </el-select>
        </div>

        <el-collapse class="annot">
          <el-collapse-item name="annot">
            <template #title>
              <span class="annot-title">🪞 反差注解</span>
              <span class="annot-sub">谁给的是情怀分/套路分、为什么——逐人记录，报告里摊开看</span>
            </template>
            <div v-for="pn in cfg.persons" :key="pn" class="annot-row">
              <span class="annot-name">
                {{ pn }}
                <b v-if="typeof part.scores[pn] === 'number'" class="annot-score">{{
                  part.scores[pn]
                }}</b>
                <span
                  v-if="dvgOf(part, pn) != null"
                  class="dvg"
                  :class="(dvgOf(part, pn) as number) >= 0 ? 'pos' : 'neg'"
                >Δ{{ fmtDvg(dvgOf(part, pn) as number) }}</span>
              </span>
              <el-select
                :model-value="part.personTags?.[pn] ?? []"
                multiple
                filterable
                allow-create
                default-first-option
                size="small"
                placeholder="个人标签，如 工业糖精 / 情怀暴击"
                class="annot-tags"
                @update:model-value="(v: string[]) => setPersonTags(pn, v)"
              >
                <el-option v-for="t in tagOptions" :key="t" :label="t" :value="t" />
              </el-select>
              <el-input
                :model-value="part.personComments?.[pn] ?? ''"
                size="small"
                placeholder="一句话注解（可选）"
                maxlength="80"
                class="annot-cmt"
                @update:model-value="(v: string) => setPersonComment(pn, v)"
              />
            </div>
          </el-collapse-item>
        </el-collapse>

        <div class="navrow">
          <el-button @click="prev" :disabled="currentIndex === 0">← 上一首</el-button>
          <span class="pos">P{{ part.page }} / {{ session.parts.length }}</span>
          <el-button type="primary" @click="next">下一首 →</el-button>
        </div>
      </section>
    </div>

    <el-dialog v-model="aiDlg" :title="aiLoading ? '✨ AI 锐评 · 生成中…' : '✨ AI 锐评'" width="660px" top="5vh">
      <div v-if="aiLoading" class="ai-loading">
        <span class="ai-spinner"></span>
        <span>正在通读全场数据并撰写锐评（榜单、争议、反差、标签、短评），通常 10~60 秒…</span>
      </div>
      <template v-else>
        <el-alert v-if="aiError" type="error" :title="aiError" show-icon :closable="false" />
        <div v-if="aiText" class="ai-text">{{ aiText }}</div>
        <div v-if="aiText" class="ai-meta">
          {{ aiModel }} · {{ aiAt }} · 已存为本期第 {{ aiCount }} 份锐评
        </div>
      </template>
      <template #footer>
        <el-button v-if="aiText && !aiLoading" @click="copyAi">复制全文</el-button>
        <el-button @click="aiDlg = false">关闭</el-button>
        <el-button type="primary" :loading="aiLoading" @click="genAi">
          {{ aiText ? '重新生成' : aiError ? '重试' : '生成锐评' }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editDlg" title="修正歌曲信息" width="480px">
      <el-form label-width="70px">
        <el-form-item label="类型"><el-input v-model="editForm.kind" placeholder="如 先行OP / 正式ED" /></el-form-item>
        <el-form-item label="曲名"><el-input v-model="editForm.song" /></el-form-item>
        <el-form-item label="歌手"><el-input v-model="editForm.artist" /></el-form-item>
        <el-form-item label="番剧"><el-input v-model="editForm.anime" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editDlg = false">取消</el-button>
        <el-button type="primary" @click="saveEdit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouterLink } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api, download } from '../api'
import type { Config, Part, Session } from '../types'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const session = ref<Session | null>(null)
const cfg = ref<Config | null>(null)
const currentIndex = ref(0)
const filterText = ref('')
const matrixRef = ref<HTMLElement | null>(null)
const editDlg = ref(false)
const editForm = ref({ kind: '', song: '', artist: '', anime: '' })

const saveStatus = ref<'saved' | 'saving' | 'error' | 'idle'>('idle')
const savedAt = ref('')
const saveText = computed(() => {
  if (saveStatus.value === 'saving') return '保存中…'
  if (saveStatus.value === 'error') return '保存失败！'
  if (saveStatus.value === 'saved') return `已自动保存 ${savedAt.value}`
  return '自动保存已开启'
})

let ready = false
let saveTimer: number | undefined

// ---------- 加载 ----------
onMounted(async () => {
  const [s, c] = await Promise.all([api.getSession(sessionId), api.getConfig()])
  normalize(s, c)
  session.value = s
  cfg.value = c
  const firstTodo = s.parts.findIndex(p => !p.skipped && !hasScore(p))
  currentIndex.value = firstTodo >= 0 ? firstTodo : 0
  await nextTick()
  ready = true
})

function normalize(s: Session, c: Config) {
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

// ---------- 派生 ----------
const part = computed(() => session.value?.parts[currentIndex.value] ?? null)
const dims = computed(() => (cfg.value?.dimensions || []).filter(d => d.enabled))
const votedCount = computed(
  () => (session.value?.parts || []).filter(p => !p.skipped && hasScore(p)).length
)
const totalActive = computed(
  () => (session.value?.parts || []).filter(p => !p.skipped).length
)
const liveAvg = computed(() => {
  const vals = Object.values(part.value?.scores || {}).filter(
    v => typeof v === 'number'
  ) as number[]
  if (!vals.length) return null
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100
})
const tagOptions = computed(() => {
  const set = new Set([...(cfg.value?.tags || []), ...(part.value?.tags || [])])
  return [...set]
})
const filteredParts = computed(() => {
  const parts = session.value?.parts || []
  const kw = filterText.value.trim().toLowerCase()
  const list = parts.map((p, index) => ({ part: p, index }))
  if (!kw) return list
  return list.filter(({ part: p }) => {
    const pr = p.parsed || { kind: '', anime: '', song: '', artist: '' }
    return [p.title, pr.song, pr.artist, pr.anime]
      .join(' ')
      .toLowerCase()
      .includes(kw)
  })
})

function hasScore(p: Part) {
  return Object.values(p.scores || {}).some(v => typeof v === 'number')
}

// ---------- 反差：维度参考分（按权重归一化）与 主观总评 − 参考分 ----------
function refOf(p: Part, pn: string): number | null {
  const dimsAll = cfg.value?.dimensions.filter(d => d.enabled) || []
  const vals: { v: number; w: number }[] = []
  for (const d of dimsAll) {
    const v = p.dimScores?.[d.key]?.[pn]
    if (typeof v === 'number') vals.push({ v, w: d.weight && d.weight > 0 ? d.weight : 0 })
  }
  if (!vals.length) return null
  let wsum = vals.reduce((a, x) => a + x.w, 0)
  if (wsum <= 0) wsum = vals.length
  return Math.round((vals.reduce((a, x) => a + x.v * (x.w / wsum), 0)) * 100) / 100
}

function dvgOf(p: Part, pn: string): number | null {
  const s = p.scores[pn]
  const ref = refOf(p, pn)
  if (typeof s !== 'number' || ref == null) return null
  return Math.round((s - ref) * 100) / 100
}

function fmtDvg(x: number): string {
  const v = Math.round(x * 10) / 10
  return (v > 0 ? '+' : '') + v.toFixed(1)
}

function setPersonTags(pn: string, v: string[]) {
  if (!part.value) return
  part.value.personTags = part.value.personTags || {}
  part.value.personTags[pn] = v
}

function setPersonComment(pn: string, v: string) {
  if (!part.value) return
  part.value.personComments = part.value.personComments || {}
  part.value.personComments[pn] = v
}
function statusOf(p: Part) {
  if (p.skipped) return 'skip'
  return hasScore(p) ? 'done' : 'todo'
}

// 列表第二行：歌手 · 《作品》（类型单独做成小徽标）
function subOf(p: Part): string {
  const pr = p.parsed
  if (!pr) return ''
  return [pr.artist, pr.anime ? `《${pr.anime}》` : ''].filter(Boolean).join(' · ')
}

// ---------- 自动保存 ----------
watch(
  session,
  () => {
    if (!ready) return
    scheduleSave()
  },
  { deep: true }
)

function scheduleSave() {
  saveStatus.value = 'saving'
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(doSave, 700)
}

async function doSave() {
  if (!session.value) return
  try {
    await api.saveSession(session.value)
    saveStatus.value = 'saved'
    savedAt.value = new Date().toLocaleTimeString('zh-CN')
  } catch (e) {
    saveStatus.value = 'error'
    ElMessage.error(`保存失败：${(e as Error).message}`)
  }
}

function leave() {
  if (saveStatus.value === 'saving') doSave()
  router.push('/')
}

onBeforeUnmount(() => {
  if (saveStatus.value === 'saving') doSave()
  document.removeEventListener('keydown', globalKey)
  window.removeEventListener('focus', refreshSilently)
  window.clearInterval(pollTimer)
})

// ---------- 打分 ----------
function onCellInput(e: Event, map: Record<string, number | undefined>, who: string) {
  const raw = (e.target as HTMLInputElement).value.trim()
  if (raw === '') {
    delete map[who]
    return
  }
  const n = Number(raw)
  if (!Number.isNaN(n)) map[who] = n
}

function clampCell(map: Record<string, number | undefined>, who: string) {
  const v = map[who]
  if (typeof v !== 'number' || Number.isNaN(v)) {
    delete map[who]
    return
  }
  const min = cfg.value?.scoreMin ?? 1
  const max = cfg.value?.scoreMax ?? 10
  map[who] = Math.min(max, Math.max(min, Math.round(v)))
}

function onEnter(e: KeyboardEvent) {
  const ins = Array.from(matrixRef.value?.querySelectorAll<HTMLInputElement>('.sin') ?? [])
  const idx = ins.indexOf(e.target as HTMLInputElement)
  if (idx >= 0 && idx < ins.length - 1) {
    ins[idx + 1].focus()
  } else {
    next()
  }
}

function toggleFav(pn: string) {
  if (!part.value) return
  const i = part.value.favorites.indexOf(pn)
  if (i >= 0) part.value.favorites.splice(i, 1)
  else part.value.favorites.push(pn)
}

function toggleSkip() {
  if (part.value) part.value.skipped = !part.value.skipped
}

// ---------- 导航 ----------
function setIndex(i: number) {
  currentIndex.value = i
  focusFirst()
}
function prev() {
  if (currentIndex.value > 0) {
    currentIndex.value--
    focusFirst()
  }
}
function next() {
  if (session.value && currentIndex.value < session.value.parts.length - 1) {
    currentIndex.value++
    focusFirst()
  }
}
async function focusFirst() {
  await nextTick()
  const first = matrixRef.value?.querySelector<HTMLInputElement>('.sin')
  first?.focus()
  first?.select()
}
function jumpNextPending() {
  if (!session.value) return
  const parts = session.value.parts
  for (let step = 1; step <= parts.length; step++) {
    const i = (currentIndex.value + step) % parts.length
    if (!parts[i].skipped && !hasScore(parts[i])) return setIndex(i)
  }
  ElMessage.info('全部评完了！可以去生成报告了 🎉')
}

function globalKey(e: KeyboardEvent) {
  if (!e.altKey) return
  if (e.key === 'ArrowRight') next()
  else if (e.key === 'ArrowLeft') prev()
}
onMounted(() => document.addEventListener('keydown', globalKey))

// ---------- 悬浮面板 ----------
function openPip() {
  const url = `${location.origin}${location.pathname}#/pip/${sessionId}`
  const dpip = (
    window as unknown as {
      documentPictureInPicture?: {
        requestWindow: (o: object) => Promise<Window>
        window: Window | null
      }
    }
  ).documentPictureInPicture
  if (dpip?.requestWindow) {
    dpip
      .requestWindow({ width: 380, height: 380 })
      .then(w => {
        w.location.href = url
      })
      .catch(() => window.open(url, 'oped-pip', 'width=380,height=400'))
  } else {
    window.open(url, 'oped-pip', 'width=380,height=400')
  }
}

// ---------- 远程写入同步（悬浮面板/在线打分页改了数据，这里跟上） ----------
async function refreshSilently() {
  if (!session.value || !cfg.value) return
  if (saveStatus.value === 'saving') return
  const ae = document.activeElement
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return
  try {
    const s = await api.getSession(sessionId)
    // await 期间用户可能已开始编辑/保存：二次校验，避免用服务器旧数据覆盖本地新输入
    const statusNow = saveStatus.value as string
    if (statusNow === 'saving' || statusNow === 'error') return
    const ae2 = document.activeElement
    if (ae2 && (ae2.tagName === 'INPUT' || ae2.tagName === 'TEXTAREA')) return
    if (s.parts.length !== session.value.parts.length) return
    ready = false
    normalize(s, cfg.value)
    session.value = s
    currentIndex.value = Math.min(currentIndex.value, s.parts.length - 1)
    await nextTick()
    ready = true
  } catch {
    /* 忽略瞬时错误 */
  }
}
let pollTimer: number | undefined
onMounted(() => {
  window.addEventListener('focus', refreshSilently)
  pollTimer = window.setInterval(() => {
    if (!document.hidden) refreshSilently()
  }, 8000)
})

// ---------- AI 锐评（DeepSeek，按需触发） ----------
const aiDlg = ref(false)
const aiLoading = ref(false)
const aiText = ref('')
const aiModel = ref('')
const aiAt = ref('')
const aiError = ref('')
const aiCount = ref(0)

function openAi() {
  const reviews = session.value?.aiReviews || []
  if (reviews.length) {
    aiText.value = reviews[0].text
    aiModel.value = reviews[0].model
    aiAt.value = new Date(reviews[0].createdAt).toLocaleString('zh-CN')
  } else {
    aiText.value = ''
    aiModel.value = ''
    aiAt.value = ''
  }
  aiCount.value = reviews.length
  aiError.value = ''
  aiDlg.value = true
}

async function genAi() {
  aiLoading.value = true
  aiError.value = ''
  try {
    const r = await api.aiReview(sessionId)
    aiText.value = r.review.text
    aiModel.value = r.review.model
    aiAt.value = new Date(r.review.createdAt).toLocaleString('zh-CN')
    aiCount.value = r.total
    if (session.value) {
      session.value.aiReviews = [r.review, ...(session.value.aiReviews || [])].slice(0, 5)
    }
  } catch (e) {
    aiError.value = (e as Error).message
  } finally {
    aiLoading.value = false
  }
}

async function copyAi() {
  try {
    await navigator.clipboard.writeText(aiText.value)
    ElMessage.success('已复制锐评全文')
  } catch {
    ElMessage.error('复制失败，请手动选择文本')
  }
}

// ---------- 其他 ----------
function openBili() {
  if (session.value?.bvid && part.value) {
    window.open(
      `https://www.bilibili.com/video/${session.value.bvid}/?p=${part.value.page}`,
      '_blank'
    )
  }
}
function openEdit() {
  if (!part.value) return
  editForm.value = {
    kind: part.value.parsed.kind,
    song: part.value.parsed.song,
    artist: part.value.parsed.artist,
    anime: part.value.parsed.anime
  }
  editDlg.value = true
}
function saveEdit() {
  if (part.value) part.value.parsed = { ...editForm.value }
  editDlg.value = false
}
function preview(url: string) {
  window.open(url, '_blank')
}
function fmtDur(sec: number) {
  if (!sec) return '--:--'
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}
</script>

<style scoped>
.mb12 { margin-bottom: 12px; }
.wb-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.wb-title { flex: 1; min-width: 200px; }
.wb-title b { font-size: 18px; margin-right: 10px; }
.wb-sub { color: #9499a0; font-size: 13px; }
.sav.error { color: #f56c6c; }
.sav.saved { color: #67c23a; }

.wb-body {
  display: flex;
  gap: 14px;
  align-items: stretch;
}
.wb-body.noperson .plist { width: 100%; }
.wb-body.noperson .main { display: none; }

.plist {
  width: 320px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 10px;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: calc(100vh - 190px);
  min-height: 420px;
}
.plist-scroll { flex: 1; }
.pitem {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13.5px;
  border: 1px solid transparent;
}
.pitem:hover { background: #f7f8fa; }
.pitem.active {
  background: #fff0f4;
  border-color: #ffd6e2;
}
.pnum {
  color: #9499a0;
  font-variant-numeric: tabular-nums;
  width: 26px;
  text-align: right;
  flex-shrink: 0;
  line-height: 19px;
}
.pinfo {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ptitle {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.psub {
  color: #9499a0;
  font-size: 11.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 15px;
}
.pk {
  font-style: normal;
  color: #fb7299;
  background: #fff0f4;
  border: 1px solid #ffe3ec;
  border-radius: 4px;
  padding: 0 4px;
  margin-right: 5px;
  font-size: 10.5px;
  line-height: 14px;
  display: inline-block;
  vertical-align: 1px;
}
.pitem.done .ptitle { color: #61666d; }
.pitem.skip { opacity: 0.45; }
.pbadges { flex-shrink: 0; font-size: 12px; }
.pbadges .ok { color: #67c23a; margin-right: 3px; }
.pbadges .sk { color: #9499a0; margin-right: 3px; }
.pbadges .star { color: #f7a35c; }
.pempty { color: #9499a0; text-align: center; padding: 20px 0; font-size: 13px; }

.main {
  flex: 1;
  min-width: 0;
  background: #fff;
  border-radius: 10px;
  padding: 18px 20px;
}
.songhead {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.sh-song {
  margin: 0 0 6px;
  font-size: 20px;
  line-height: 1.4;
  word-break: break-all;
}
.kindtag { margin-right: 6px; vertical-align: 2px; }
.sh-meta { color: #61666d; font-size: 14px; }
.liveavg { color: #fb7299; font-size: 15px; }
.sh-actions { display: flex; gap: 0; flex-shrink: 0; }

.matrix table {
  width: 100%;
  border-collapse: collapse;
}
.matrix th {
  text-align: left;
  color: #9499a0;
  font-weight: 500;
  font-size: 13px;
  padding: 6px 8px;
  border-bottom: 2px solid #e6e8ec;
  white-space: nowrap;
}
.matrix td {
  padding: 7px 8px;
  border-bottom: 1px solid #f0f1f3;
}
.pname { font-weight: 600; white-space: nowrap; }
.range { color: #c9ccd0; font-size: 12px; }
.wt { color: #c9ccd0; font-size: 11px; margin-left: 3px; }
.totwrap { display: flex; align-items: center; }
.dvg {
  font-size: 11px;
  font-weight: 600;
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 6px;
  white-space: nowrap;
}
.dvg.pos { color: #c24545; background: #fdeeee; }
.dvg.neg { color: #2a6fb8; background: #eaf3fc; }
.sin {
  width: 76px;
  height: 34px;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  outline: none;
  transition: border-color 0.15s;
}
.sin:focus { border-color: #fb7299; box-shadow: 0 0 0 2px #fff0f4; }
.sin.total { font-weight: 700; width: 92px; }
.favbtn {
  border: none;
  background: none;
  font-size: 21px;
  color: #d5d8db;
  cursor: pointer;
  padding: 0 6px;
  transition: color 0.15s, transform 0.1s;
}
.favbtn:hover { transform: scale(1.15); }
.favbtn.on { color: #f7a35c; }
.hint { color: #9499a0; font-size: 12.5px; margin: 10px 0 0; }

.extra { margin-top: 16px; display: flex; flex-direction: column; gap: 10px; }

.annot { margin-top: 4px; border-top: none; }
.annot :deep(.el-collapse-item__header) { height: 40px; }
.annot-title { font-weight: 600; font-size: 14px; }
.annot-sub { color: #9499a0; font-size: 12px; margin-left: 10px; }
.annot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  padding: 5px 0;
}
.annot-name {
  width: 130px;
  flex-shrink: 0;
  font-weight: 600;
  font-size: 13.5px;
  white-space: nowrap;
}
.annot-score { color: #fb7299; margin-left: 4px; }
.annot-tags { width: 300px; }
.annot-cmt { flex: 1; min-width: 180px; }

.navrow {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 18px;
}
.pos { color: #9499a0; font-size: 13px; font-variant-numeric: tabular-nums; }

.ai-loading {
  display: flex;
  align-items: center;
  gap: 12px;
  color: #9499a0;
  font-size: 13.5px;
  padding: 26px 0;
}
.ai-spinner {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  border-radius: 50%;
  border: 3px solid #ffe3ec;
  border-top-color: #fb7299;
  animation: ai-spin 0.9s linear infinite;
}
@keyframes ai-spin {
  to { transform: rotate(360deg); }
}
.ai-text {
  white-space: pre-wrap;
  line-height: 1.85;
  font-size: 14px;
  color: #30333a;
  max-height: 56vh;
  overflow-y: auto;
}
.ai-meta {
  margin-top: 10px;
  color: #9499a0;
  font-size: 12px;
}
</style>
