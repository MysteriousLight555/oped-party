<template>
  <div class="page" v-if="loaded && form">
    <div class="head-row">
      <div>
        <h1 class="page-title">⚙ 本期设置</h1>
        <p class="page-sub">
          「{{ sessionName }}」的独立快照——只影响这一期，改全局不会追溯改写本期的报告。
          新期次的默认模板在<RouterLink to="/settings">设置</RouterLink>页配置。
        </p>
      </div>
      <el-button type="primary" size="large" :loading="saving" @click="save">保存</el-button>
    </div>

    <el-card shadow="never" class="mb16">
      <div class="fg-row">
        <el-switch v-model="followGlobal" />
        <div class="fg-text">
          <b>跟随全局</b>
          <p class="hint">
            开启后本期实时使用全局配置（适合懒得每期单独调的场次）；关闭则使用下方这份独立快照。
          </p>
        </div>
        <el-button :disabled="followGlobal" @click="syncFromGlobal">从全局同步一份</el-button>
      </div>
    </el-card>

    <template v-if="!followGlobal">
      <el-card shadow="never" class="mb16">
        <template #header><b>参与人</b>（本期的打分表行列，可增删；删除不丢历史分）</template>
        <div class="chips">
          <el-tag v-for="p in form.persons" :key="p" closable size="large" @close="removePerson(p)">
            {{ p }}
          </el-tag>
          <span v-if="!form.persons.length" class="dim">还没有人，加一个吧</span>
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
          <b>打分维度</b>（权重只用于换算"维度参考分"和反差值，与总分无关）
        </template>
        <table class="dimtable">
          <thead>
            <tr><th>维度名</th><th>参考权重</th><th>一句话说明</th><th>显示</th><th></th></tr>
          </thead>
          <tbody>
            <tr v-for="d in form.dimensions" :key="d.key">
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
              <td><el-input v-model="d.desc" placeholder="显示在表头提示" style="width: 300px" /></td>
              <td><el-switch v-model="d.enabled" /></td>
              <td><el-button text type="danger" @click="removeDim(d.key)">删除</el-button></td>
            </tr>
          </tbody>
        </table>
        <el-button @click="addDim">＋ 添加维度</el-button>
        <p class="hint">
          权重合计 <b :class="{ warn: weightSum !== 100 }">{{ weightSum }}%</b>
          ——不必凑成 100，计算时按已有维度自动归一化。
        </p>
      </el-card>

      <el-card shadow="never" class="mb16">
        <template #header><b>标签库</b>（本期的打分单/工作台可选，也可现场输入）</template>
        <div class="chips">
          <el-tag v-for="t in form.tags" :key="t" closable size="large" type="info" @close="removeTag(t)">
            {{ t }}
          </el-tag>
          <span v-if="!form.tags.length" class="dim">空空如也</span>
        </div>
        <div class="addrow">
          <el-input v-model="tagInput" placeholder="输入标签，回车添加" style="width: 220px" @keydown.enter="addTag" />
          <el-button @click="addTag">添加</el-button>
        </div>
      </el-card>

      <el-card shadow="never">
        <template #header><b>分数范围</b></template>
        <div class="rangerow">
          最低 <el-input-number v-model="form.scoreMin" :min="0" :max="form.scoreMax - 1" />
          最高 <el-input-number v-model="form.scoreMax" :min="form.scoreMin + 1" :max="100" />
        </div>
        <p class="hint">改动只影响这一期；已有分数不会被改写。</p>
      </el-card>
    </template>
    <el-alert
      v-else
      type="info"
      :title="`当前跟随全局：本期实时使用全局配置。关闭开关后会以全局当前值生成一份快照，然后即可单独编辑。`"
      :closable="false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { RouterLink } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import { sessionConfig, snapshotFrom } from '../sessionConfig'
import type { Config, Dim, SessionSettings } from '../types'

const route = useRoute()
const router = useRouter()
const sessionId = route.params.id as string

const sessionName = ref('')
const loaded = ref(false)
const saving = ref(false)
const followGlobal = ref(false)
const form = ref<SessionSettings | null>(null)
const globalCfg = ref<Config | null>(null)

const personInput = ref('')
const tagInput = ref('')

const weightSum = computed(() =>
  (form.value?.dimensions || []).reduce((a, d) => a + (d.weight || 0), 0)
)

onMounted(async () => {
  const [s, c] = await Promise.all([api.getSession(sessionId), api.getConfig()])
  globalCfg.value = c
  sessionName.value = s.name
  followGlobal.value = !!s.followGlobal
  // 有快照用快照；存量期次从"本期生效配置"（=全局）初始化表单，保存时才落快照
  form.value = s.settings
    ? JSON.parse(JSON.stringify(s.settings))
    : snapshotFrom(sessionConfig(s, c))
  loaded.value = true
})

function syncFromGlobal() {
  if (!globalCfg.value) return
  form.value = snapshotFrom(globalCfg.value)
  ElMessage.success('已用全局当前值覆盖本期快照（还未保存，点右上角保存生效）')
}

function addPerson() {
  const name = personInput.value.trim()
  if (!name || !form.value) return
  if (form.value.persons.includes(name)) {
    ElMessage.warning('已经有这个人了')
    return
  }
  form.value.persons.push(name)
  personInput.value = ''
}
function removePerson(p: string) {
  form.value?.persons.splice(form.value.persons.indexOf(p), 1)
}

function addDim() {
  form.value?.dimensions.push({
    key: 'd' + Date.now().toString(36),
    name: '',
    desc: '',
    weight: 0,
    enabled: true
  })
}
function removeDim(key: string) {
  if (!form.value) return
  form.value.dimensions = form.value.dimensions.filter((d: Dim) => d.key !== key)
}

function addTag() {
  const t = tagInput.value.trim()
  if (!t || !form.value) return
  if (!form.value.tags.includes(t)) form.value.tags.push(t)
  tagInput.value = ''
}
function removeTag(t: string) {
  form.value?.tags.splice(form.value.tags.indexOf(t), 1)
}

async function save() {
  if (!form.value) return
  if (form.value.dimensions.some(d => !d.name.trim())) {
    ElMessage.warning('有维度还没填名字')
    return
  }
  saving.value = true
  try {
    // 取最新一期再写入，尽量减少与打分中自动保存的相互覆盖
    const full = await api.getSession(sessionId)
    full.settings = JSON.parse(JSON.stringify(form.value))
    full.followGlobal = followGlobal.value
    await api.saveSession(full)
    ElMessage.success('本期设置已保存')
    router.push(`/session/${sessionId}/work`)
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
.fg-row { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.fg-text { flex: 1; min-width: 240px; }
.fg-text .hint { margin: 2px 0 0; }
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
</style>
