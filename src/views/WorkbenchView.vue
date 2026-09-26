<template>
  <div class="page" v-if="session && cfg">
    <div class="wb-head">
      <el-button text @click="leave">← 返回</el-button>
      <div class="wb-title">
        <b>{{ session.name }}</b>
        <span class="wb-sub">
          已评 {{ votedCount }}/{{ totalActive }} ·
          <span :class="['sav', saveStatus]">{{ saveText }}</span>
          <span v-if="session.followGlobal" class="cfgtag">跟随全局</span>
          <span v-else-if="session.settings" class="cfgtag" title="参与人/维度/标签为本期独立快照，与全局解耦">本期独立配置</span>
        </span>
      </div>
      <el-button @click="openPip" title="置顶小窗，全屏看视频时也能打分">📺 悬浮面板</el-button>
      <el-button @click="openStage" title="大字只读屏，共享到腾讯会议让大家实时看到进度">🖥 大屏</el-button>
      <el-button
        @click="ncmBatch"
        :loading="ncmBatching"
        :title="`把未关联网易云的分P批量匹配（剩余 ${ncmUnmatchedCount} 首）`"
      >
        🎵 匹配网易云<template v-if="ncmUnmatchedCount">（{{ ncmUnmatchedCount }}）</template>
      </el-button>
      <el-button
        @click="ncmHeartFav"
        :loading="ncmHearting"
        title="把全场★收藏且已匹配网易云的歌加红心（网易云「喜欢的音乐」）"
      >
        ❤ 同步红心
      </el-button>
      <el-button
        @click="ncmSyncFav"
        :loading="ncmSyncing"
        title="把全场★收藏且已匹配网易云的歌批量加入目标歌单（设置页配置歌单 ID）"
      >
        ★ 同步到歌单
      </el-button>
      <el-button
        @click="ncmUndo"
        :loading="ncmUndoing"
        title="取消本期已同步的红心，并把本期★收藏移出目标歌单"
      >
        ↩ 撤销同步
      </el-button>
      <el-button @click="jumpNextPending">下一个待评 →</el-button>
      <el-button
        @click="router.push(`/session/${sessionId}/settings`)"
        title="本期的参与人 / 维度权重 / 标签 / 分值范围（快照，与全局解耦）"
      >
        ⚙ 本期设置
      </el-button>
      <el-tooltip
        content="分P标题解析不理想时，把标题列表发给大模型批量补全（只补空字段，不覆盖已解析和人工修正的内容；需在设置页配 Key）"
        placement="bottom"
      >
        <el-button :loading="aiParseLoading" @click="aiParse">🤖 AI 识别标题</el-button>
      </el-tooltip>
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
            <el-dropdown-item divided @click="prefetchLyrics" :disabled="lyricPrefetching">
              📄 预取歌词（报告附歌词本）
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
      <div class="ap-alert">
        <span>
          还没有参与人：输入名字回车即加，或去<RouterLink to="/settings">设置页</RouterLink>统一配置——
        </span>
        <input
          v-model="personInline"
          class="apin"
          placeholder="名字，回车添加"
          @keydown.enter="onPersonEnter"
        />
        <el-button size="small" type="primary" plain @click="addPersonInline">添加</el-button>
      </div>
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
              <span v-if="libOf(item.part.page)?.hearted" class="lb heart" title="已红心">❤</span>
              <span v-if="libOf(item.part.page)?.inPlaylist" class="lb pl" title="已在目标歌单">♪</span>
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
              <el-tag v-if="libOf(part.page)?.hearted" size="small" type="danger" effect="plain" class="libtag">已红心</el-tag>
              <el-tag v-if="libOf(part.page)?.inPlaylist" size="small" type="success" effect="plain" class="libtag">已在歌单</el-tag>
            </div>
          </div>
          <div class="sh-actions">
            <el-button size="small" @click="openEdit">修正信息</el-button>
            <el-button size="small" :disabled="!session.bvid" @click="openBili">B站 ↗</el-button>
            <el-button
              size="small"
              :loading="ncmMatching"
              @click="ncmMatch"
              :title="part.ncm ? `已匹配：${part.ncm.name}` : '搜索网易云曲库并关联'"
            >
              {{ part.ncm ? '🎵 已关联' : '🎵 关联网易云' }}
            </el-button>
            <el-button
              v-if="part.ncm?.id"
              size="small"
              type="success"
              plain
              @click="ncmOpenPage"
              title="在网易云音乐网页版打开"
              >试听 ↗</el-button
            >
            <el-button
              v-if="part.ncm?.id && ncmStatus?.mpv"
              size="small"
              type="success"
              plain
              :loading="ncmPlaying"
              @click="ncmPlay"
              title="用本机播放器（mpv，需 ncm-cli 登录）播放这首歌"
              >▶ 本机</el-button
            >
            <el-button v-if="part.ncm" size="small" @click="openVer" title="自动匹配可能选错版本，从候选里换一个">🔀 换版本</el-button>
            <el-button v-if="part.ncm" size="small" @click="openLyric" title="网易云歌词（含翻译），看过即缓存，报告可附歌词本">📄 歌词</el-button>
            <el-button size="small" @click="toggleSkip">
              {{ part.skipped ? '取消跳过' : '跳过' }}
            </el-button>
          </div>
        </div>

        <el-alert v-if="part.skipped" type="info" :closable="false" class="mb12">
          已标记为跳过，不会出现在榜单里（比如菜单、说明类分 P）。
        </el-alert>

        <div class="quickrow" v-if="cfg.persons.length">
          <span class="qlabel">⚡ 连报</span>
          <input
            ref="quickRef"
            v-model="quickText"
            class="qin"
            :placeholder="quickPlaceholder"
            @keydown.enter.prevent="applyQuick"
            @keydown.tab.prevent="focusFirst"
          />
          <span class="qhint">空格分隔按人员顺序：<b>9</b> 分数 · <b>9*</b> 顺带收藏 · <b>--</b> 留空 · 少填=后面的人没分；回车提交到下一首，Tab 回表格</span>
        </div>

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
              <tr class="aprow">
                <td :colspan="2 + dims.length + 1">
                  <input
                    v-model="personInline"
                    class="apin"
                    placeholder="＋ 临时来了新朋友？输入名字，回车即加一行"
                    @keydown.enter="onPersonEnter"
                  />
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

    <el-dialog v-model="editDlg" title="修正歌曲信息" width="480px">      <el-form label-width="70px">
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

    <el-dialog v-model="verDlg" title="🔀 换个版本" width="600px">
      <div class="ver-search">
        <el-input
          v-model="verKeyword"
          placeholder="搜索关键词（曲名 歌手）"
          clearable
          @keydown.enter="verSearch"
        />
        <el-button :loading="verSearching" @click="verSearch">搜索</el-button>
      </div>
      <el-alert v-if="verError" :title="verError" type="error" :closable="false" class="mb12" />
      <div class="ver-list" v-loading="verSearching">
        <div
          v-for="s in verSongs"
          :key="s.encryptedId || s.id"
          class="ver-item"
          :class="{ cur: part?.ncm?.id === s.id }"
        >
          <img v-if="s.cover" :src="s.cover" class="ver-cover" loading="lazy" />
          <div class="ver-info">
            <div class="ver-name">
              {{ s.name }}
              <span v-if="s.vipFlag" class="ver-vip">VIP</span>
              <span v-if="s.payPlayFlag" class="ver-vip pay">付费</span>
            </div>
            <div class="ver-sub">{{ s.artist }}<template v-if="s.album"> · {{ s.album }}</template></div>
          </div>
          <el-button size="small" type="primary" plain :disabled="part?.ncm?.id === s.id" @click="verPick(s)">
            {{ part?.ncm?.id === s.id ? '当前' : '选它' }}
          </el-button>
        </div>
        <div v-if="!verSongs.length && !verSearching" class="ver-empty">还没有结果，换个关键词试试</div>
      </div>
    </el-dialog>

    <el-drawer v-model="lyricDlg" size="400px">
      <template #header>
        <b>📄 歌词</b>
        <span class="lyric-head-sub">网易云歌词 · 报告可选附歌词本</span>
      </template>
      <div v-if="lyricLoading" class="lyric-loading">歌词加载中…</div>
      <template v-else>
        <div class="lyric-song">「{{ part?.parsed.song || part?.title }}」 {{ part?.parsed.artist }}</div>
        <div v-if="lyricNoLyric" class="lyric-empty">网易云标注这首歌没有歌词（纯音乐）。</div>
        <div v-else-if="!lyricLines.length" class="lyric-empty">没有拿到歌词。</div>
        <div v-else class="lyric-body">
          <div v-for="(l, i) in lyricLines" :key="i" class="lyric-line">
            <span>{{ l }}</span>
            <span v-if="lyricTransLines[i]" class="lyric-tr">{{ lyricTransLines[i] }}</span>
          </div>
        </div>
      </template>
    </el-drawer>

    <!-- 悬浮面板内容：平时隐藏，开 PiP 时整个节点搬进置顶窗（只用原生控件，避免组件库弹层跨文档问题） -->
    <div ref="pipHostRef" class="pip-host">
      <div v-if="part && cfg" class="ph-wrap">
        <div class="ph-song">
          <span v-if="part.parsed.kind" class="ph-kind">{{ part.parsed.kind }}</span>
          <span class="ph-title">「{{ part.parsed.song || part.title }}」</span>
          <span class="ph-meta">{{ part.parsed.artist }} · 《{{ part.parsed.anime || '？' }}》</span>
        </div>
        <div class="ph-rows">
          <div v-if="dims.length" class="ph-row ph-head">
            <span class="ph-name"></span>
            <span class="ph-col strong">总分</span>
            <span v-for="d in dims" :key="d.key" class="ph-col" :title="d.desc || d.name">
              {{ d.name }}
            </span>
            <span class="ph-favslot">★</span>
          </div>
          <div v-for="pn in cfg.persons" :key="pn" class="ph-row">
            <span class="ph-name">{{ pn }}</span>
            <input
              class="ph-in"
              :value="part.scores[pn] ?? ''"
              placeholder="—"
              inputmode="numeric"
              @input="onPipInput($event, pn)"
              @blur="pipClamp(pn)"
              @keydown.enter.prevent="pipEnter($event)"
            />
            <template v-if="dims.length">
              <input
                v-for="d in dims"
                :key="d.key"
                class="ph-in dim"
                :value="part.dimScores?.[d.key]?.[pn] ?? ''"
                placeholder="—"
                inputmode="numeric"
                @input="onPipDimInput($event, pn, d.key)"
                @blur="pipClampDim(pn, d.key)"
                @keydown.enter.prevent="pipEnter($event)"
              />
            </template>
            <button
              class="ph-fav"
              :class="{ on: part.favorites.includes(pn) }"
              title="收藏"
              @click="toggleFav(pn)"
            >
              ★
            </button>
          </div>
        </div>
        <div class="ph-foot">
          <button class="ph-btn" @click="pipSkipNext">跳过 ↓</button>
          <button class="ph-btn primary" @click="next">下一首 →</button>
          <span class="ph-pos">{{ votedCount }}/{{ totalActive }}</span>
        </div>
        <p class="ph-hint">
          回车跳下一格（总分→维度→下一人）· 维度是参考坐标，可留空 · 打分即时同步
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouterLink } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sessionConfig } from '../sessionConfig'
import { api, download } from '../api'
import type { Config, NcmSong, Part, Session } from '../types'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const session = ref<Session | null>(null)
const globalCfg = ref<Config | null>(null)
// 工作台全程使用"本期生效配置"（快照或跟随全局），不再直读全局
const cfg = computed<Config | null>(() =>
  globalCfg.value ? sessionConfig(session.value, globalCfg.value) : null
)
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
  normalize(s, sessionConfig(s, c))
  session.value = s
  globalCfg.value = c
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

// ---------- 内联添加参与人（临时场景不用跑去设置页） ----------
const personInline = ref('')

function onPersonEnter(e: KeyboardEvent) {
  if (e.isComposing) return // 中文输入法选词回车不触发
  e.preventDefault()
  addPersonInline()
}

async function addPersonInline() {
  const name = personInline.value.trim()
  if (!name || !session.value || !globalCfg.value) return
  personInline.value = ''
  // 跟随全局（或存量无快照）→ 加进全局模板；有快照 → 加进本期名单（随本期自动保存）
  if (session.value.followGlobal === true || !session.value.settings) {
    if (globalCfg.value.persons.includes(name)) {
      ElMessage.warning('已经有这个人了')
      return
    }
    globalCfg.value.persons.push(name)
    try {
      globalCfg.value = await api.saveConfig(globalCfg.value)
    } catch (e) {
      ElMessage.error(`保存失败：${(e as Error).message}`)
      return
    }
  } else {
    if (session.value.settings.persons.includes(name)) {
      ElMessage.warning('已经有这个人了')
      return
    }
    session.value.settings.persons.push(name)
  }
  ElMessage.success(`已加入 ${name}`)
  await nextTick()
  const inputs = matrixRef.value?.querySelectorAll<HTMLInputElement>('tbody .sin.total')
  const last = inputs?.[inputs.length - 1]
  last?.focus()
  last?.select()
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
  // PiP 还开着就把节点搬回来，避免组件卸载时节点留在别的文档里
  if (pipWin && !pipWin.closed && pipHostRef.value) {
    document.body.append(pipHostRef.value)
    pipHostRef.value.classList.remove('in-pip')
  }
  document.removeEventListener('keydown', globalKey)
  window.removeEventListener('focus', refreshSilently)
  window.clearInterval(pollTimer)
  window.clearInterval(lyricPollTimer)
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

// ---------- 报分连录：一行填完整曲所有分 ----------
const quickRef = ref<HTMLInputElement | null>(null)
const quickText = ref('')
const quickPlaceholder = computed(() =>
  cfg.value?.persons.map((_, i) => (i === 0 ? '如 9' : '8.5')).join(' ') || ''
)

function applyQuick() {
  if (!session.value || !part.value || !cfg.value) return
  const raw = quickText.value.trim()
  if (!raw) {
    ElMessage.info('输入为空：直接回车只跳下一首，分数没动')
    next()
    focusQuick()
    return
  }
  const tokens = raw.split(/\s+/)
  const persons = cfg.value.persons
  if (tokens.length > persons.length) {
    ElMessage.error(`多打了：最多 ${persons.length} 个值（${persons.join(' ')}）`)
    return
  }
  const min = cfg.value.scoreMin
  const max = cfg.value.scoreMax
  const plan: { person: string; score?: number; fav?: boolean }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === '--') {
      plan.push({ person: persons[i] })
      continue
    }
    const fav = t.endsWith('*')
    const num = Number(fav ? t.slice(0, -1) : t)
    if (Number.isNaN(num) || num < min || num > max) {
      ElMessage.error(`第 ${i + 1} 个值「${t}」不是 ${min}~${max} 的分数，整行没提交`)
      return
    }
    plan.push({ person: persons[i], score: Math.round(num), fav })
  }
  for (const p of plan) {
    if (p.score === undefined) delete part.value.scores[p.person]
    else part.value.scores[p.person] = p.score
    if (p.fav && !part.value.favorites.includes(p.person)) part.value.favorites.push(p.person)
  }
  quickText.value = ''
  // 跳到下一个待评曲并保持光标在连报框（现场报分节奏不断）
  const parts = session.value.parts
  for (let step = 1; step <= parts.length; step++) {
    const i = (currentIndex.value + step) % parts.length
    if (!parts[i].skipped && !hasScore(parts[i])) {
      currentIndex.value = i
      focusQuick()
      return
    }
  }
  ElMessage.success('全部评完了！可以去生成报告了 🎉')
}

function focusQuick() {
  nextTick(() => {
    quickRef.value?.focus()
    quickRef.value?.select()
  })
}

// ---------- 现场大屏 ----------
function openStage() {
  window.open(`${location.origin}${location.pathname}#/session/${sessionId}/stage`, 'oped-stage')
}

// ---------- 悬浮面板（Document Picture-in-Picture：把打分 DOM 搬进置顶窗） ----------
// 注意：PiP 窗口导航离开初始文档会被浏览器立即关闭，所以只能"搬节点+拷样式"，不能给它塞 URL
const pipHostRef = ref<HTMLElement | null>(null)
let pipWin: Window | null = null

function onPipInput(e: Event, pn: string) {
  if (!part.value) return
  onCellInput(e, part.value.scores, pn)
}

function onPipDimInput(e: Event, pn: string, dimKey: string) {
  if (!part.value) return
  const ds = (part.value.dimScores = part.value.dimScores || {})
  const map = (ds[dimKey] = ds[dimKey] || {})
  const raw = (e.target as HTMLInputElement).value.trim()
  if (raw === '') {
    delete map[pn]
    return
  }
  const n = Number(raw)
  if (!Number.isNaN(n)) map[pn] = n
}

function pipClampDim(pn: string, dimKey: string) {
  if (!part.value) return
  const map = part.value.dimScores[dimKey] || {}
  const v = map[pn]
  if (typeof v !== 'number' || Number.isNaN(v)) {
    delete map[pn]
    return
  }
  const min = cfg.value?.scoreMin ?? 1
  const max = cfg.value?.scoreMax ?? 10
  map[pn] = Math.min(max, Math.max(min, Math.round(v)))
}

function pipClamp(pn: string) {
  if (part.value) clampCell(part.value.scores, pn)
}

function pipEnter(e: KeyboardEvent) {
  const ins = Array.from(pipHostRef.value?.querySelectorAll<HTMLInputElement>('.ph-in') ?? [])
  const i = ins.indexOf(e.target as HTMLInputElement)
  if (i >= 0 && i < ins.length - 1) {
    ins[i + 1].focus()
  } else {
    next()
    // 下一首后把焦点拉回置顶窗的第一个输入框（next 默认聚焦主页面表格）
    nextTick(() => {
      const el = pipHostRef.value?.querySelector<HTMLInputElement>('.ph-in')
      el?.focus()
      el?.select()
    })
  }
}

function pipSkipNext() {
  toggleSkip()
  next()
}

function copyStylesTo(pip: Window) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const text = Array.from(sheet.cssRules)
        .map(r => r.cssText)
        .join('')
      if (!text) continue
      const style = pip.document.createElement('style')
      style.textContent = text
      pip.document.head.appendChild(style)
    } catch {
      if (sheet.href) {
        const link = pip.document.createElement('link')
        link.rel = 'stylesheet'
        link.href = sheet.href
        pip.document.head.appendChild(link)
      }
    }
  }
  pip.document.title = '悬浮打分'
}

async function openPip() {
  const dpip = (
    window as unknown as {
      documentPictureInPicture?: { requestWindow: (o: object) => Promise<Window> }
    }
  ).documentPictureInPicture
  const popupUrl = `${location.origin}${location.pathname}#/pip/${sessionId}`
  if (!dpip?.requestWindow) {
    // 浏览器不支持 Document PiP：退化为普通小窗（不置顶但能用）
    window.open(popupUrl, 'oped-pip', 'width=380,height=430')
    return
  }
  if (pipWin && !pipWin.closed) {
    pipWin.focus()
    return
  }
  try {
    const w = await dpip.requestWindow({ width: 440, height: 420 })
    copyStylesTo(w)
    const host = pipHostRef.value
    if (host) {
      w.document.body.append(host)
      host.classList.add('in-pip')
    }
    w.document.body.style.cssText = 'margin:0;background:#16181d;color:#f2f3f5'
    // 用户关掉 PiP 窗：把节点搬回主页面，方便下次再开
    w.addEventListener('pagehide', () => {
      const host = pipHostRef.value
      if (host) {
        document.body.append(host)
        host.classList.remove('in-pip')
      }
      pipWin = null
    })
    pipWin = w
    await nextTick()
    w.document.querySelector<HTMLInputElement>('.ph-in')?.focus()
  } catch {
    window.open(popupUrl, 'oped-pip', 'width=380,height=430')
  }
}

// ---------- 远程写入同步（悬浮面板/在线打分页改了数据，这里跟上） ----------
async function refreshSilently() {
  if (!session.value || !cfg.value) return
  if (saveStatus.value === 'saving') return
  const ae = document.activeElement
  if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return
  // 悬浮窗里正在输入时也别刷（焦点在 PiP 文档里，主文档 activeElement 看不到）
  const pipDoc = pipWin && !pipWin.closed ? pipWin.document : null
  const pae = pipDoc?.activeElement
  if (pae && (pae.tagName === 'INPUT' || pae.tagName === 'TEXTAREA')) return
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

// ---------- AI 标题识别（正则解析的兜底，只补空/弱字段） ----------
const aiParseLoading = ref(false)

async function aiParse() {
  if (!session.value) return
  aiParseLoading.value = true
  try {
    const r = await api.aiParseTitles(sessionId)
    r.parts.forEach((parsed, i) => {
      const p = session.value?.parts[i]
      if (p) p.parsed = parsed
    })
    ElMessage.success(
      r.applied > 0 ? `AI 已补全 ${r.applied} 个字段，可逐首「修正信息」复核` : '标题信息已经齐全，无需补全'
    )
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    aiParseLoading.value = false
  }
}

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

// ---------- 网易云音乐 ----------
const ncmStatus = ref<{ configured: boolean; loggedIn: boolean; tokenRemainingHours: number; mpv: boolean } | null>(
  null
)
const ncmMatching = ref(false)
const ncmPlaying = ref(false)
const ncmBatching = ref(false)
const ncmUnmatchedCount = computed(
  () => (session.value?.parts || []).filter(p => !p.skipped && !p.ncm).length
)

onMounted(async () => {
  try {
    ncmStatus.value = await api.ncmStatus()
  } catch {
    /* CLI 未装等情况，按钮点击时再提示 */
  }
})

async function ncmGuardReady(): Promise<boolean> {
  if (!ncmStatus.value?.loggedIn || !ncmStatus.value?.configured) {
    try {
      ncmStatus.value = await api.ncmStatus()
    } catch {
      /* ignore */
    }
  }
  if (!ncmStatus.value?.configured) {
    ElMessage.warning('网易云未配置凭证（data/ncm-auth.json 缺 appId/privateKey）')
    return false
  }
  if (!ncmStatus.value?.loggedIn) {
    ElMessage.warning('网易云登录已过期：去设置页重新扫码（二维码链接发手机打开即可）')
    return false
  }
  return true
}

async function ncmMatch() {
  if (!(await ncmGuardReady()) || !part.value) return
  ncmMatching.value = true
  try {
    const r = await api.ncmMatch(sessionId, part.value.page)
    if (part.value) part.value.ncm = r as Part['ncm']
    ElMessage.success(`已关联网易云：「${r.name}」${r.artist ? ` - ${r.artist}` : ''}`)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    ncmMatching.value = false
  }
}

function ncmOpenPage() {
  if (part.value?.ncm?.id) {
    window.open(`https://music.163.com/#/song?id=${part.value.ncm.id}`, '_blank')
  }
}

async function ncmPlay() {
  if (!part.value?.ncm) return
  ncmPlaying.value = true
  try {
    await api.ncmPlay(sessionId, part.value.page)
    ElMessage.info(`本机播放中：「${part.value.ncm.name}」`)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    ncmPlaying.value = false
  }
}

async function ncmBatch() {
  if (!(await ncmGuardReady()) || !session.value) return
  const targets = session.value.parts.filter(p => !p.skipped && !p.ncm)
  if (!targets.length) {
    ElMessage.info('全部分 P 都已关联过网易云')
    return
  }
  ncmBatching.value = true
  let okCount = 0
  let failCount = 0
  try {
    for (const p of targets) {
      try {
        const r = await api.ncmMatch(sessionId, p.page)
        p.ncm = r as Part['ncm']
        okCount++
      } catch {
        failCount++
      }
    }
  } finally {
    ncmBatching.value = false
  }
  const msg = `批量匹配完成：成功 ${okCount}，失败 ${failCount}`
  if (failCount) ElMessage.warning(msg)
  else ElMessage.success(msg)
}

// ---------- 远端资料库状态（已红心/已入歌单标记 + 同步前预览） ----------
const libStatus = ref<Record<number, { hearted: boolean | null; inPlaylist: boolean | null }>>({})

function libOf(page: number) {
  return libStatus.value[page]
}

async function refreshLib() {
  if (!session.value) return
  try {
    const r = await api.ncmLibrary(sessionId)
    libStatus.value = r.parts || {}
  } catch {
    /* 未登录/网络问题时静默：只是没有小标记 */
  }
}

onMounted(() => refreshLib())

/** 收藏歌确认弹窗：网易云查询接口个人权限未开放，无法远端预判，去重靠写入响应 */
async function syncPreview(kind: 'heart' | 'playlist') {
  const favs = (session.value?.parts || []).filter(
    p => !p.skipped && p.favorites?.length && p.ncm?.encryptedId
  )
  if (!favs.length) {
    ElMessage.warning('没有既★收藏、又已🎵匹配网易云的歌')
    return null
  }
  const label = kind === 'heart' ? '「喜欢的音乐」（红心）' : '目标歌单'
  const dupNote = kind === 'playlist' ? '网易云会自动去重，重复的不会重复入库' : '已红心过的会原样跳过'
  try {
    await ElMessageBox.confirm(`本期共 ${favs.length} 首收藏歌将同步到${label}，${dupNote}。开始同步？`, kind === 'heart' ? '❤ 同步红心' : '★ 同步到歌单', {
      confirmButtonText: '同步',
      cancelButtonText: '先不了',
      type: 'info'
    })
    return { favs: favs.length, already: 0 }
  } catch {
    return null
  }
}

const ncmSyncing = ref(false)
async function ncmSyncFav() {
  if (!(await ncmGuardReady()) || !session.value) return
  const preview = await syncPreview('playlist')
  if (!preview) return
  ncmSyncing.value = true
  try {
    const r = await api.ncmSyncFavorites(sessionId)
    ElMessage.success(
      `同步完成：${r.songs} 首收藏歌（来自 ${r.parts} 个分 P）加入歌单，新增 ${r.added}、重复 ${r.duplicate}`
    )
    refreshLib()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    ncmSyncing.value = false
  }
}

const ncmHearting = ref(false)
async function ncmHeartFav() {
  if (!(await ncmGuardReady()) || !session.value) return
  const preview = await syncPreview('heart')
  if (!preview) return
  ncmHearting.value = true
  try {
    const r = await api.ncmHeartFavorites(sessionId)
    let msg = `红心同步完成：成功 ${r.hearted}/${r.songs}`
    if (r.paidSkipped) msg += `，付费歌曲跳过 ${r.paidSkipped}`
    if (r.failed.length) {
      ElMessage.warning(msg + `，失败 ${r.failed.length}`)
      console.warn('红心失败详情', r.failed)
    } else {
      ElMessage.success(msg + '，去网易云「喜欢的音乐」看看吧')
    }
    refreshLib()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    ncmHearting.value = false
  }
}

// ---------- 撤销本期同步 ----------
const ncmUndoing = ref(false)
async function ncmUndo() {
  if (!(await ncmGuardReady()) || !session.value) return
  try {
    await ElMessageBox.confirm(
      '取消本期已同步的红心，并把本期★收藏的歌移出目标歌单。只动本期收藏的歌，账号里其他收藏不受影响。',
      '↩ 撤销本期同步',
      { confirmButtonText: '撤销', cancelButtonText: '取消', type: 'warning' }
    )
  } catch {
    return
  }
  ncmUndoing.value = true
  try {
    const r = await api.ncmUndoSync(sessionId, true, true)
    let msg = `已撤销：取消红心 ${r.unhearted}/${r.songs}，移出歌单 ${r.removed}`
    if (r.heartFailed.length) msg += `（红心失败 ${r.heartFailed.length}，多为付费/版权限制）`
    ElMessage.success(msg)
    refreshLib()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    ncmUndoing.value = false
  }
}

// ---------- 换版本：搜索候选手动选定 ----------
const verDlg = ref(false)
const verKeyword = ref('')
const verSearching = ref(false)
const verSongs = ref<NcmSong[]>([])
const verError = ref('')

function fallbackKeyword(p: Part): string {
  const song = String(p.parsed?.song || '').trim()
  let name = song
  if (song.includes('／')) {
    const orig = song.split('／').slice(1).join('／').trim()
    if (orig) name = orig
  }
  return `${name} ${String(p.parsed?.artist || '')}`.trim()
}

async function openVer() {
  if (!part.value) return
  verKeyword.value = part.value.ncm?.keyword || fallbackKeyword(part.value)
  verSongs.value = []
  verError.value = ''
  verDlg.value = true
  verSearch()
}

async function verSearch() {
  const kw = verKeyword.value.trim()
  if (!kw) return
  verSearching.value = true
  verError.value = ''
  try {
    const r = await api.ncmSearch(kw)
    verSongs.value = r.songs
    if (!r.songs.length) verError.value = '没有搜到结果，换个关键词'
  } catch (e) {
    verError.value = (e as Error).message
  } finally {
    verSearching.value = false
  }
}

async function verPick(s: NcmSong) {
  if (!part.value) return
  try {
    const saved = await api.ncmSetSong(sessionId, part.value.page, s as unknown as Record<string, unknown>)
    part.value.ncm = saved
    verDlg.value = false
    ElMessage.success(`已换成「${saved.name}」${saved.artist ? ` - ${saved.artist}` : ''}`)
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}

// ---------- 歌词（查看即缓存） ----------
const lyricDlg = ref(false)
const lyricLoading = ref(false)
const lyricText = ref('')
const lyricTrans = ref('')
const lyricNoLyric = ref(false)

function splitLrc(lrc: string): string[] {
  return String(lrc || '')
    .split('\n')
    .map(l => l.replace(/^\[[^\]]*\]\s*/, '').trimEnd())
    .filter(l => l.trim().length > 0)
}

const lyricLines = computed(() => splitLrc(lyricText.value))
const lyricTransLines = computed(() => splitLrc(lyricTrans.value))

async function openLyric() {
  if (!part.value?.ncm) {
    ElMessage.warning('先关联网易云，才有歌词可看')
    return
  }
  lyricDlg.value = true
  if (part.value.ncm.lyric) {
    lyricText.value = part.value.ncm.lyric.text || ''
    lyricTrans.value = part.value.ncm.lyric.trans || ''
    lyricNoLyric.value = Boolean(part.value.ncm.lyric.noLyric)
    return
  }
  lyricLoading.value = true
  lyricText.value = ''
  lyricTrans.value = ''
  lyricNoLyric.value = false
  try {
    const r = await api.ncmLyric(sessionId, part.value.page)
    lyricText.value = r.text || ''
    lyricTrans.value = r.trans || ''
    lyricNoLyric.value = Boolean(r.noLyric)
    if (part.value?.ncm) {
      part.value.ncm.lyric = { text: r.text || '', trans: r.trans || '', noLyric: r.noLyric }
    }
  } catch (e) {
    lyricDlg.value = false
    ElMessage.error((e as Error).message)
  } finally {
    lyricLoading.value = false
  }
}

// ---------- 歌词预取（报告附歌词本） ----------
const lyricPrefetching = ref(false)
let lyricPollTimer: number | undefined

async function prefetchLyrics() {
  if (!(await ncmGuardReady()) || !session.value) return
  try {
    const r = await api.ncmLyricPrefetchStart(sessionId)
    if (!r.total) {
      ElMessage.info('本期匹配的歌都已经有歌词缓存了，直接出报告即可')
      return
    }
    lyricPrefetching.value = true
    ElMessage.info(`开始预取歌词：共 ${r.total} 首，完成后报告自动附歌词本`)
    window.clearInterval(lyricPollTimer)
    lyricPollTimer = window.setInterval(async () => {
      try {
        const st = await api.ncmLyricPrefetchStatus(sessionId)
        if (!st.running) {
          window.clearInterval(lyricPollTimer)
          lyricPrefetching.value = false
          ElMessage.success(`歌词预取完成（${st.done}/${st.total}）`)
          refreshSilently()
        }
      } catch {
        window.clearInterval(lyricPollTimer)
        lyricPrefetching.value = false
      }
    }, 2000)
  } catch (e) {
    ElMessage.error((e as Error).message)
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
.cfgtag {
  color: #9499a0;
  border: 1px solid #e6e8ec;
  border-radius: 4px;
  padding: 0 5px;
  font-size: 11px;
  margin-left: 8px;
}
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
.aprow td { padding: 6px 8px 2px; }
.apin {
  width: 100%;
  height: 30px;
  border: 1px dashed #dcdfe6;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 13px;
  color: #61666d;
  outline: none;
  background: #fafbfc;
}
.apin:focus {
  border-color: #fb7299;
  border-style: solid;
  background: #fff;
}
.ap-alert {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.ap-alert .apin {
  width: 180px;
  background: #fff;
}
.hint { color: #9499a0; font-size: 12.5px; margin: 10px 0 0; }

.quickrow {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 8px 10px;
  background: #fffaf3;
  border: 1px solid #ffe9c8;
  border-radius: 10px;
  flex-wrap: wrap;
}
.qlabel { font-weight: 700; color: #e6a23c; white-space: nowrap; font-size: 13.5px; }
.qin {
  flex: 1;
  min-width: 200px;
  height: 34px;
  border: 1px solid #e6d9bd;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 16px;
  font-variant-numeric: tabular-nums;
  outline: none;
  background: #fff;
}
.qin:focus { border-color: #e6a23c; box-shadow: 0 0 0 2px #fdf3e3; }
.qhint { color: #b0a489; font-size: 12px; }

.libtag { margin-left: 6px; vertical-align: 1px; }
.lb { margin-left: 3px; font-size: 11px; }
.lb.heart { color: #f56c6c; }
.lb.pl { color: #67c23a; }

.ver-search { display: flex; gap: 8px; margin-bottom: 12px; }
.ver-list { min-height: 120px; display: flex; flex-direction: column; gap: 6px; }
.ver-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid #ebeef5;
  border-radius: 10px;
}
.ver-item.cur { border-color: #fb7299; background: #fff0f4; }
.ver-cover { width: 42px; height: 42px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
.ver-info { flex: 1; min-width: 0; }
.ver-name { font-weight: 600; font-size: 14px; }
.ver-sub { color: #9499a0; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ver-vip {
  font-size: 10.5px;
  color: #e6a23c;
  border: 1px solid #ecd9b0;
  background: #fdf6ec;
  border-radius: 4px;
  padding: 0 4px;
  margin-left: 4px;
  vertical-align: 1px;
}
.ver-vip.pay { color: #f56c6c; border-color: #f3d1d1; background: #fef0f0; }
.ver-empty { color: #9499a0; text-align: center; padding: 24px 0; font-size: 13px; }

.lyric-head-sub { color: #9499a0; font-size: 12px; margin-left: 10px; font-weight: 400; }
.lyric-loading { color: #9499a0; padding: 20px 0; }
.lyric-song { color: #61666d; font-size: 13.5px; margin-bottom: 12px; }
.lyric-empty { color: #9499a0; padding: 20px 0; }
.lyric-body { line-height: 1.7; }
.lyric-line { margin-bottom: 10px; }
.lyric-line span { display: block; }
.lyric-tr { color: #9499a0; font-size: 12.5px; margin-top: 2px; }

/* ---------- 悬浮面板搬运节点（PiP） ---------- */
.pip-host { display: none; }
.pip-host.in-pip { display: block; }
.ph-wrap { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; }
.ph-song { line-height: 1.5; }
.ph-kind {
  font-size: 11px;
  color: #fb7299;
  border: 1px solid #fb7299;
  border-radius: 4px;
  padding: 0 4px;
  margin-right: 5px;
  vertical-align: 1px;
}
.ph-title { font-size: 16px; font-weight: 700; word-break: break-all; }
.ph-meta { display: block; color: #8a919e; font-size: 12px; margin-top: 2px; }
.ph-rows { display: flex; flex-direction: column; gap: 6px; }
.ph-row { display: flex; align-items: center; gap: 5px; }
.ph-row.ph-head { margin-bottom: -2px; }
.ph-name {
  width: 72px;
  flex-shrink: 0;
  font-size: 13.5px;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ph-col {
  width: 50px;
  flex-shrink: 0;
  text-align: center;
  color: #8a919e;
  font-size: 10.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ph-col.strong { color: #fb7299; font-weight: 600; }
.ph-favslot { width: 26px; text-align: center; color: #4a5264; font-size: 12px; flex-shrink: 0; }
.ph-in {
  width: 50px;
  flex-shrink: 0;
  height: 33px;
  border: 1px solid #3a4152;
  border-radius: 8px;
  background: #1d212b;
  color: #f2f3f5;
  font-size: 15px;
  text-align: center;
  outline: none;
  -moz-appearance: textfield;
  appearance: textfield;
}
.ph-in::-webkit-outer-spin-button,
.ph-in::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.ph-in:focus { border-color: #fb7299; }
.ph-in.dim { color: #b9c1cf; border-color: #2e3442; }
.ph-in.dim:focus { border-color: #5a81b4; }
.ph-fav { border: none; background: none; font-size: 20px; color: #4a5264; cursor: pointer; padding: 0 3px; flex-shrink: 0; }
.ph-fav.on { color: #ffa940; }
.ph-foot { display: flex; align-items: center; gap: 9px; margin-top: 2px; }
.ph-btn {
  height: 32px;
  padding: 0 13px;
  border-radius: 8px;
  border: 1px solid #3a4152;
  background: #1d212b;
  color: #cfd4de;
  font-size: 13px;
  cursor: pointer;
}
.ph-btn.primary { background: #fb7299; border-color: #fb7299; color: #fff; font-weight: 600; }
.ph-pos { margin-left: auto; color: #8a919e; font-size: 13px; font-variant-numeric: tabular-nums; }
.ph-hint { margin: 0; color: #5a6275; font-size: 11px; line-height: 1.5; }

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
