<template>
  <div class="page">
    <div class="head-row">
      <div>
        <h1 class="page-title">期次</h1>
        <p class="page-sub">每季鉴赏会建一期，贴 BV 号自动拉取分 P，边听边打分。</p>
      </div>
      <el-button type="primary" size="large" @click="showCreate = true">＋ 新建一期</el-button>
    </div>

    <el-alert
      v-if="config && config.persons.length === 0"
      type="warning"
      show-icon
      :closable="false"
      class="mb16"
    >
      还没有配置参与人，先去<RouterLink to="/settings">设置页</RouterLink>把同学加进来，打分表才有列。
    </el-alert>

    <el-card v-if="sessions.length" class="mb16 aggregate" shadow="never">
      <div class="agg-row">
        <div>
          <b>🏆 全期总榜</b>
          <span class="agg-sub">跨期去重 · 歌手榜 · 番剧榜 · 各期回顾</span>
        </div>
        <div class="agg-btns">
          <el-button size="small" @click="preview(api.allReport('html', true))">预览</el-button>
          <el-button size="small" @click="download(api.allReport('html'))">HTML</el-button>
          <el-button size="small" @click="download(api.allReport('md'))">Markdown</el-button>
          <el-button size="small" @click="download(api.allReport('xlsx'))">Excel</el-button>
          <el-button size="small" @click="download(api.allReport('json'))">JSON</el-button>
        </div>
      </div>
    </el-card>

    <el-empty v-if="loaded && sessions.length === 0" description="还没有期次，点右上角「新建一期」开始" />

    <div class="session-list">
      <el-card v-for="s in sessions" :key="s.id" class="session-card" shadow="hover">
        <div class="sc-main">
          <div class="sc-title" @click="go(s.id)">
            <span class="sc-name">{{ s.name }}</span>
            <el-tag v-if="s.done" size="small" type="success" effect="plain">已完成</el-tag>
          </div>
          <div class="sc-meta">
            <a v-if="s.bvid" :href="`https://www.bilibili.com/video/${s.bvid}`" target="_blank">{{
              s.videoTitle || s.bvid
            }}</a>
            <span v-else>{{ s.videoTitle }}</span>
            · {{ s.createdAt.slice(0, 10) }} · 已评 {{ s.voted }}/{{ s.total
            }}<span v-if="s.skipped"> · 跳过 {{ s.skipped }}</span>
          </div>
          <el-progress
            :percentage="s.total ? Math.round((s.voted / s.total) * 100) : 0"
            :stroke-width="8"
            :show-text="false"
          />
        </div>
        <div class="sc-actions" @click.stop>
          <el-button type="primary" @click="go(s.id)">继续打分</el-button>
          <el-dropdown trigger="click">
            <el-button>报告 ↓</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="preview(api.sessionReport(s.id, 'html', true))"
                  >预览排行榜</el-dropdown-item
                >
                <el-dropdown-item divided @click="download(api.sessionReport(s.id, 'html'))"
                  >下载 HTML</el-dropdown-item
                >
                <el-dropdown-item @click="download(api.sessionReport(s.id, 'md'))"
                  >下载 Markdown</el-dropdown-item
                >
                <el-dropdown-item @click="download(api.sessionReport(s.id, 'xlsx'))"
                  >下载 Excel</el-dropdown-item
                >
                <el-dropdown-item @click="download(api.sessionReport(s.id, 'json'))"
                  >导出 JSON</el-dropdown-item
                >
              </el-dropdown-menu>
            </template>
          </el-dropdown>
          <el-dropdown trigger="click">
            <el-button>⋯</el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="download(api.sheetUrl(s.id))">
                  下载打分单（发同学）
                </el-dropdown-item>
                <el-dropdown-item @click="copySheetLink(s)">复制在线打分链接</el-dropdown-item>
                <el-dropdown-item @click="pickImport(s)">导入打分单…</el-dropdown-item>
                <el-dropdown-item divided @click="rename(s)">重命名</el-dropdown-item>
                <el-dropdown-item @click="toggleDone(s)">{{
                  s.done ? '标记为进行中' : '标记为已完成'
                }}</el-dropdown-item>
                <el-dropdown-item divided @click="remove(s)">
                  <span style="color: #f56c6c">删除这一期</span>
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-card>
    </div>

    <el-dialog v-model="showCreate" title="新建一期" width="560px">
      <el-tabs v-model="createTab">
        <el-tab-pane label="B 站视频导入" name="bvid">
          <el-form label-position="top">
            <el-form-item label="视频链接或 BV 号">
              <el-input
                v-model="createForm.bvidInput"
                placeholder="直接粘贴分享链接即可，自动提取 BV 号"
                :disabled="creating"
              />
            </el-form-item>
            <el-form-item label="期名（可选，默认取视频标题）">
              <el-input v-model="createForm.name" placeholder="如：2026年7月新番鉴赏会" />
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="手动粘贴列表" name="manual">
          <el-form label-position="top">
            <el-form-item label="期名">
              <el-input v-model="createForm.manualTitle" placeholder="如：2026年7月新番鉴赏会" />
            </el-form-item>
            <el-form-item label="曲目列表（每行一首）">
              <el-input
                v-model="createForm.lines"
                type="textarea"
                :rows="10"
                placeholder="每行一个分 P 标题，格式不限，能解析就解析，解析不了的按原样打分"
              />
            </el-form-item>
          </el-form>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <el-button @click="showCreate = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="create">创建并开始打分</el-button>
      </template>
    </el-dialog>

    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      multiple
      style="display: none"
      @change="onImportFiles"
    />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { RouterLink } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api, download } from '../api'
import type { Config, SessionMeta } from '../types'

const router = useRouter()
const sessions = ref<SessionMeta[]>([])
const config = ref<Config | null>(null)
const loaded = ref(false)
const showCreate = ref(false)
const creating = ref(false)
const createTab = ref('bvid')
const createForm = ref({ bvidInput: '', name: '', manualTitle: '', lines: '' })
const fileInput = ref<HTMLInputElement | null>(null)
let importTarget = ''

async function refresh() {
  sessions.value = await api.listSessions()
  loaded.value = true
}

onMounted(async () => {
  config.value = await api.getConfig()
  await refresh()
})

function go(id: string) {
  router.push(`/session/${id}/work`)
}

function preview(url: string) {
  window.open(url, '_blank')
}

function extractBv(input: string): string {
  const m = input.trim().match(/(BV[a-zA-Z0-9]{8,12})/)
  return m ? m[1] : input.trim()
}

async function create() {
  creating.value = true
  try {
    let session
    if (createTab.value === 'bvid') {
      session = await api.createSession({
        mode: 'bvid',
        bvid: extractBv(createForm.value.bvidInput),
        name: createForm.value.name
      })
    } else {
      session = await api.createSession({
        mode: 'manual',
        manualTitle: createForm.value.manualTitle,
        name: createForm.value.manualTitle,
        lines: createForm.value.lines.split('\n')
      })
    }
    showCreate.value = false
    ElMessage.success(`已导入 ${session.parts.length} 个分 P`)
    go(session.id)
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    creating.value = false
  }
}

async function rename(s: SessionMeta) {
  try {
    const { value } = await ElMessageBox.prompt('新的期名', '重命名', {
      inputValue: s.name,
      inputValidator: v => !!v?.trim() || '不能为空'
    })
    const full = await api.getSession(s.id)
    full.name = value.trim()
    await api.saveSession(full)
    ElMessage.success('已重命名')
    refresh()
  } catch {
    /* 取消 */
  }
}

async function toggleDone(s: SessionMeta) {
  const full = await api.getSession(s.id)
  full.done = !s.done
  await api.saveSession(full)
  refresh()
}

async function remove(s: SessionMeta) {
  try {
    await ElMessageBox.confirm(
      `删除「${s.name}」及全部打分记录？此操作不可恢复。`,
      '删除期次',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
  } catch {
    return
  }
  await api.deleteSession(s.id)
  ElMessage.success('已删除')
  refresh()
}

// ---------- 个人打分单（线上会议场景） ----------
function pickImport(s: SessionMeta) {
  importTarget = s.id
  fileInput.value?.click()
}

async function onImportFiles(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files
  if (!files?.length) return
  const sheets: unknown[] = []
  try {
    for (const f of Array.from(files)) {
      sheets.push(JSON.parse(await f.text()))
    }
  } catch {
    ElMessage.error('有文件不是合法的 JSON 打分单')
    input.value = ''
    return
  }
  try {
    const r = await api.importSheets(importTarget, sheets)
    ElMessage.success(
      `导入成功：${r.scores} 个分数、${r.favorites} 个收藏` +
        (r.tags ? `、${r.tags} 个标签` : '') +
        (r.addedPersons.length ? `；新成员 ${r.addedPersons.join('、')} 已自动加入配置` : '')
    )
    config.value = await api.getConfig()
    refresh()
  } catch (err) {
    ElMessage.error((err as Error).message)
  }
  input.value = ''
}

function copySheetLink(s: SessionMeta) {
  const url = `${location.origin}${location.pathname}#/sheet/${s.id}`
  navigator.clipboard
    .writeText(url)
    .then(() =>
      ElMessage.success(
        '已复制（按当前页面地址生成）。同学若在公网访问：先运行「开远程打分.bat」，再在通道网址打开的页面里复制这个链接'
      )
    )
    .catch(() => ElMessage.info(`复制失败，手动复制：${url}`))
}
</script>

<style scoped>
.head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}
.page-title {
  margin: 0 0 4px;
  font-size: 24px;
}
.page-sub {
  margin: 0;
  color: #9499a0;
  font-size: 13.5px;
}
.mb16 {
  margin-bottom: 16px;
}
.aggregate :deep(.el-card__body) {
  padding: 14px 18px;
}
.agg-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.agg-sub {
  margin-left: 12px;
  color: #9499a0;
  font-size: 13px;
  font-weight: 400;
}
.session-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.session-card :deep(.el-card__body) {
  display: flex;
  gap: 18px;
  align-items: center;
}
.sc-main {
  flex: 1;
  min-width: 0;
}
.sc-title {
  cursor: pointer;
}
.sc-name {
  font-size: 17px;
  font-weight: 600;
  margin-right: 8px;
}
.sc-title:hover .sc-name {
  color: #fb7299;
}
.sc-meta {
  color: #9499a0;
  font-size: 13px;
  margin: 4px 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sc-actions {
  display: flex;
  gap: 0;
  flex-shrink: 0;
}
</style>
