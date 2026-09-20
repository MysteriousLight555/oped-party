<template>
  <div class="page" v-if="cfg">
    <div class="head-row">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">参与人、打分维度、标签库都在这里；改完记得保存。隐藏的维度不丢数据，随时可以再打开。</p>
      </div>
      <el-button type="primary" size="large" :loading="saving" @click="save">保存</el-button>
    </div>

    <el-card shadow="never" class="mb16 philosophy">
      <template #header><b>🧭 评分体系：总分独立，维度只是参考坐标</b></template>
      <ul class="phil-list">
        <li>
          <b>总分 = 主观总评</b>：每人独立给出，工具<b>不会</b>用维度分加权算总分——
          "我知道它套路，但我就是爱"和"它写得再合格我也齁得慌"，这一票的权利在你们。
        </li>
        <li>
          <b>维度分 = 参考坐标系</b>：按权重换算出"维度参考分"，用来算
          <b>反差 Δ = 主观总评 − 参考</b>（正=情怀溢价，负=套路压分）。允许且鼓励脱节。
        </li>
        <li>
          <b>争议指数</b> = 一首歌大家总分的标准差，报告里直接标出吵得最凶的曲子，并逐人摊开评价构成（个人标签 + 个人注解）。
        </li>
        <li>
          标签库请备好 <code>工业糖精</code>、<code>拼好曲式-生硬</code>、<code>本格anisong</code>、<code>神级应景</code> 这类情绪标签——它们是解释反差的证据。
        </li>
      </ul>
    </el-card>

    <el-card shadow="never" class="mb16">
      <template #header><b>参与人</b>（打分表的列，鉴赏会固定成员）</template>
      <div class="chips">
        <el-tag
          v-for="p in cfg.persons"
          :key="p"
          closable
          size="large"
          @close="removePerson(p)"
        >
          {{ p }}
        </el-tag>
        <span v-if="!cfg.persons.length" class="dim">还没有人，加一个吧</span>
      </div>
      <div class="addrow">
        <el-input
          v-model="personInput"
          placeholder="输入名字，回车添加"
          style="width: 220px"
          @keydown.enter="addPerson"
        />
        <el-button @click="addPerson">添加</el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="mb16">
      <template #header>
        <b>打分维度</b>（参考坐标系：权重只用于换算"维度参考分"和反差值，与总分无关；不需要的关掉开关即可）
      </template>
      <table class="dimtable">
        <thead>
          <tr><th>维度名</th><th>参考权重</th><th>一句话说明（显示在表头提示）</th><th>显示</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="d in cfg.dimensions" :key="d.key">
            <td><el-input v-model="d.name" placeholder="维度名" style="width: 140px" /></td>
            <td>
              <el-input-number
                v-model="d.weight"
                :min="0"
                :max="100"
                size="small"
                controls-position="right"
                style="width: 100px"
              />
              <span class="pct">%</span>
            </td>
            <td><el-input v-model="d.desc" placeholder="如：抽掉画面还站不站得住" style="width: 320px" /></td>
            <td><el-switch v-model="d.enabled" /></td>
            <td>
              <el-button text type="danger" @click="removeDim(d.key)">删除</el-button>
            </td>
          </tr>
        </tbody>
      </table>
      <el-button @click="addDim">＋ 添加维度</el-button>
      <p class="hint">
        权重合计 <b :class="{ warn: weightSum !== 100 }">{{ weightSum }}%</b>
        ——不必凑成 100，计算时会按已有维度自动归一化。默认 音乐本体 50 / 音画定制 30 / 本格共鸣 20：
        拆出"音乐本体中心性"与"音画定制服务"，再用"本格共鸣"记录真诚度。
      </p>
    </el-card>

    <el-card shadow="never" class="mb16">
      <template #header><b>标签库</b>（打分时可多选，也可以现场输入新标签）</template>
      <div class="chips">
        <el-tag v-for="t in cfg.tags" :key="t" closable size="large" @close="removeTag(t)" type="info">
          {{ t }}
        </el-tag>
        <span v-if="!cfg.tags.length" class="dim">空空如也</span>
      </div>
      <div class="addrow">
        <el-input
          v-model="tagInput"
          placeholder="输入标签，回车添加"
          style="width: 220px"
          @keydown.enter="addTag"
        />
        <el-button @click="addTag">添加</el-button>
        <el-button text type="primary" @click="restoreSalonTags">
          补齐沙龙推荐标签（工业糖精 / 本格anisong…）
        </el-button>
      </div>
    </el-card>

    <el-card shadow="never" class="mb16">
      <template #header><b>✨ AI 分析（DeepSeek）</b><span class="ai-head-hint">按需触发 · Key 只存本机</span></template>
      <div class="ai-row">
        <span class="ai-label">Base URL</span>
        <el-input v-model="ai.baseUrl" placeholder="https://api.deepseek.com" style="width: 320px" />
      </div>
      <div class="ai-row">
        <span class="ai-label">模型名</span>
        <el-input v-model="ai.model" placeholder="deepseek-flash" style="width: 320px" />
        <span class="ai-hint-inline">报"模型不存在"就改成 deepseek-chat / deepseek-reasoner 等官方名</span>
      </div>
      <div class="ai-row">
        <span class="ai-label">API Key</span>
        <el-input
          v-model="aiKeyInput"
          type="password"
          show-password
          :placeholder="ai.hasKey ? `已保存 ${ai.keyMasked}，留空则保持不变` : 'sk-…'"
          style="width: 320px"
        />
        <el-button v-if="ai.hasKey" text type="danger" @click="clearAiKey">清除 Key</el-button>
      </div>
      <div class="ai-row">
        <el-switch v-model="ai.anonymize" />
        <span class="ai-hint-inline">匿名化参与人：发给模型时用「成员A/B/C」代替真名</span>
      </div>
      <div class="ai-row">
        <el-button type="primary" :loading="aiSaving" @click="saveAi">保存 AI 设置</el-button>
        <el-button :loading="aiTesting" @click="testAiConn">测试连接</el-button>
        <span v-if="aiTestResult" :class="['ai-test', { ok: aiTestOk, bad: !aiTestOk }]">{{
          aiTestResult
        }}</span>
      </div>
      <p class="hint">
        在工作台点「✨ AI 锐评」时，才会把本场的聚合统计（榜单、争议指数、反差值、标签、短评）发送到上面配置的服务商生成点评；
        参与人名字默认随数据外发，介意请开匿名化。锐评结果保存在期次里，可重复生成（保留最近 5 份）。
      </p>
    </el-card>

    <el-card shadow="never" class="mb16">
      <template #header><b>网易云音乐</b>（搜索匹配歌曲、试听直链；凭证只存本机）</template>
      <div class="ncm-row">
        <span>凭证：</span>
        <el-tag v-if="ncm?.configured" type="success" effect="plain">已配置</el-tag>
        <el-tag v-else type="danger" effect="plain">缺 appId/privateKey（data/ncm-auth.json）</el-tag>
        <el-tag v-if="ncm?.loggedIn" type="success" effect="plain" class="ncm-tag">
          已登录 · 剩余约 {{ ncm.tokenRemainingHours }} 小时
        </el-tag>
        <el-tag v-else type="warning" effect="plain" class="ncm-tag">未登录 / 已过期</el-tag>
      </div>
      <div v-if="ncmLogin.qrUrl" class="ncm-row">
        <span>
          用网易云 App 扫码或手机打开：
          <a :href="ncmLogin.qrUrl" target="_blank">{{ ncmLogin.qrUrl }}</a>
          <span v-if="ncmLogin.status === 802">（已扫码，等待确认…）</span>
          <span v-else-if="ncmLogin.status === 801">（等待扫码…）</span>
        </span>
      </div>
      <div class="ncm-row">
        <el-button size="small" :loading="ncmLogin.polling" @click="ncmStartLogin">
          {{ ncm?.loggedIn ? '重新扫码登录' : '扫码登录' }}
        </el-button>
        <span class="hint" style="margin: 0 0 0 10px">
          token 有效期 24 小时；过期后工作台匹配会提示回来重扫。本机播放（▶）还需安装 mpv 并
          npx @music163/ncm-cli login。
        </span>
      </div>
      <div class="ncm-row">
        <span>同步目标歌单：</span>
        <el-input
          v-model="ncmPlaylistId"
          placeholder="歌单的明文数字 ID（网易云 App 里分享歌单，链接里 playlist?id= 后面的数字）"
          style="width: 340px"
          size="small"
        />
        <el-button size="small" :loading="ncmPlSaving" @click="ncmSavePlaylist">保存</el-button>
        <span class="hint" style="margin: 0">「★ 同步到歌单」会把全场收藏的歌批量加进去</span>
      </div>
    </el-card>

    <el-card shadow="never">
      <template #header><b>分数范围</b></template>
      <div class="rangerow">
        最低 <el-input-number v-model="cfg.scoreMin" :min="0" :max="cfg.scoreMax - 1" />
        最高 <el-input-number v-model="cfg.scoreMax" :min="cfg.scoreMin + 1" :max="100" />
      </div>
      <p class="hint">默认 1~10 整数分。改范围不影响已有分数。</p>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import type { Config, Dim } from '../types'

// 与后端 SALON_TAGS 保持一致：一键补齐老饕情绪标签
const SALON_TAGS = [
  '本格anisong',
  '神级应景',
  '工业糖精',
  '拼好曲式-生硬',
  '拼好曲式-浑然天成',
  'VOCALOID味',
  '情怀暴击',
  '反套路',
  '制作糙但真情'
]

const cfg = ref<Config | null>(null)
const personInput = ref('')
const tagInput = ref('')
const saving = ref(false)

const weightSum = computed(() =>
  (cfg.value?.dimensions || []).reduce((a, d) => a + (d.weight || 0), 0)
)

onMounted(async () => {
  cfg.value = await api.getConfig()
})

function addPerson() {
  const name = personInput.value.trim()
  if (!name || !cfg.value) return
  if (cfg.value.persons.includes(name)) {
    ElMessage.warning('已经有这个人了')
    return
  }
  cfg.value.persons.push(name)
  personInput.value = ''
}
function removePerson(p: string) {
  cfg.value?.persons.splice(cfg.value.persons.indexOf(p), 1)
}

function addDim() {
  cfg.value?.dimensions.push({
    key: 'd' + Date.now().toString(36),
    name: '',
    desc: '',
    weight: 0,
    enabled: true
  })
}
function removeDim(key: string) {
  if (!cfg.value) return
  cfg.value.dimensions = cfg.value.dimensions.filter((d: Dim) => d.key !== key)
}

function addTag() {
  const t = tagInput.value.trim()
  if (!t || !cfg.value) return
  if (!cfg.value.tags.includes(t)) cfg.value.tags.push(t)
  tagInput.value = ''
}
function removeTag(t: string) {
  cfg.value?.tags.splice(cfg.value.tags.indexOf(t), 1)
}

function restoreSalonTags() {
  if (!cfg.value) return
  const added = SALON_TAGS.filter(t => !cfg.value!.tags.includes(t))
  if (!added.length) {
    ElMessage.info('沙龙推荐标签已经齐了')
    return
  }
  cfg.value.tags.push(...added)
  ElMessage.success(`已补齐 ${added.length} 个：${added.join('、')}（记得保存）`)
}

// ---------- AI 分析（DeepSeek） ----------
const ai = ref({ baseUrl: '', model: '', anonymize: false, hasKey: false, keyMasked: '' })
const aiKeyInput = ref('')
const aiSaving = ref(false)
const aiTesting = ref(false)
const aiTestResult = ref('')
const aiTestOk = ref(false)

onMounted(async () => {
  ai.value = await api.getAiConfig()
})

// ---------- 网易云音乐 ----------
const ncm = ref<Awaited<ReturnType<typeof api.ncmStatus>> | null>(null)
const ncmLogin = ref<{ qrUrl: string; uniKey: string; status: number; polling: boolean }>({
  qrUrl: '',
  uniKey: '',
  status: 0,
  polling: false
})
const ncmPlaylistId = ref('')
const ncmPlSaving = ref(false)

onMounted(async () => {
  try {
    ncm.value = await api.ncmStatus()
  } catch {
    /* ignore */
  }
  try {
    ncmPlaylistId.value = (await api.ncmGetPlaylist()).playlistId
  } catch {
    /* ignore */
  }
})

async function ncmSavePlaylist() {
  if (!ncmPlaylistId.value.trim()) {
    ElMessage.warning('先粘贴歌单 ID')
    return
  }
  ncmPlSaving.value = true
  try {
    await api.ncmSetPlaylist(ncmPlaylistId.value.trim())
    ElMessage.success('目标歌单已保存')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    ncmPlSaving.value = false
  }
}

async function ncmStartLogin() {
  try {
    const qr = await api.ncmLoginQr()
    ncmLogin.value = { qrUrl: qr.qrUrl, uniKey: qr.uniKey, status: 801, polling: true }
    for (let i = 0; i < 100; i++) {
      await new Promise(r => setTimeout(r, 3000))
      const st = await api.ncmLoginPoll(qr.uniKey)
      ncmLogin.value.status = st.status
      if (st.status === 803) {
        ncm.value = await api.ncmStatus()
        ElMessage.success('网易云登录成功')
        ncmLogin.value.polling = false
        ncmLogin.value.qrUrl = ''
        return
      }
      if (st.status === 800) {
        ElMessage.warning('二维码已过期，请重新生成')
        ncmLogin.value.polling = false
        return
      }
    }
    ncmLogin.value.polling = false
    ElMessage.warning('轮询超时，请重试')
  } catch (e) {
    ncmLogin.value.polling = false
    ElMessage.error((e as Error).message)
  }
}

async function saveAi() {
  aiSaving.value = true
  try {
    ai.value = await api.saveAiConfig({
      baseUrl: ai.value.baseUrl,
      model: ai.value.model,
      anonymize: ai.value.anonymize,
      apiKey: aiKeyInput.value.trim() || undefined
    })
    aiKeyInput.value = ''
    ElMessage.success('AI 设置已保存')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    aiSaving.value = false
  }
}

async function clearAiKey() {
  ai.value = await api.saveAiConfig({ clearKey: true })
  aiKeyInput.value = ''
  ElMessage.success('已清除 API Key')
}

async function testAiConn() {
  aiTesting.value = true
  aiTestResult.value = ''
  try {
    await saveAi()
    const r = await api.testAi()
    aiTestOk.value = true
    aiTestResult.value = `✓ ${r.reply}（模型 ${ai.value.model}）`
  } catch (e) {
    aiTestOk.value = false
    aiTestResult.value = (e as Error).message
  } finally {
    aiTesting.value = false
  }
}

async function save() {
  if (!cfg.value) return
  if (cfg.value.dimensions.some(d => !d.name.trim())) {
    ElMessage.warning('有维度还没填名字')
    return
  }
  saving.value = true
  try {
    cfg.value = await api.saveConfig(cfg.value)
    ElMessage.success('已保存')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 18px;
}
.page-title { margin: 0 0 4px; font-size: 24px; }
.page-sub { margin: 0; color: #9499a0; font-size: 13.5px; }
.mb16 { margin-bottom: 16px; }
.chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.dim { color: #9499a0; font-size: 13px; }
.addrow { display: flex; gap: 8px; }
.dimtable { border-collapse: collapse; margin-bottom: 10px; }
.dimtable th {
  text-align: left;
  color: #9499a0;
  font-weight: 500;
  font-size: 13px;
  padding: 4px 14px 8px 0;
}
.dimtable td { padding: 5px 14px 5px 0; vertical-align: middle; }
.hint { color: #9499a0; font-size: 12.5px; margin: 10px 0 0; }
.hint .warn { color: #e6a23c; }
.rangerow { display: flex; align-items: center; gap: 10px; }
.pct { color: #9499a0; font-size: 12.5px; margin-left: 4px; }
.philosophy :deep(.el-card__body) { padding-top: 8px; }
.phil-list { margin: 0; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; font-size: 13.5px; color: #48505a; }
.phil-list code {
  background: #fff0f4;
  color: #fb7299;
  border-radius: 4px;
  padding: 0 5px;
  font-size: 12.5px;
}
.ai-head-hint {
  color: #9499a0;
  font-size: 12.5px;
  font-weight: 400;
  margin-left: 10px;
}
.ai-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.ai-label {
  width: 70px;
  flex-shrink: 0;
  color: #61666d;
  font-size: 13.5px;
  text-align: right;
}
.ai-hint-inline {
  color: #9499a0;
  font-size: 12.5px;
}
.ai-test {
  font-size: 12.5px;
  word-break: break-all;
}
.ai-test.ok { color: #67c23a; }
.ai-test.bad { color: #f56c6c; }
.ncm-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.ncm-tag {
  margin-left: 4px;
}
</style>
