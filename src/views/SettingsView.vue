<template>
  <div class="page" v-if="cfg">
    <div class="head-row">
      <div>
        <h1 class="page-title">设置</h1>
        <p class="page-sub">参与人、打分维度、标签库都在这里；改完记得保存。隐藏的维度不丢数据，随时可以再打开。</p>
      </div>
      <el-button type="primary" size="large" :loading="saving" @click="save">保存</el-button>
    </div>

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
      <template #header><b>打分维度</b>（不需要的关掉开关即可，工作台和报告里都不会出现）</template>
      <table class="dimtable">
        <thead>
          <tr><th>维度名</th><th>显示</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="d in cfg.dimensions" :key="d.key">
            <td><el-input v-model="d.name" placeholder="维度名" style="width: 220px" /></td>
            <td><el-switch v-model="d.enabled" /></td>
            <td>
              <el-button text type="danger" @click="removeDim(d.key)">删除</el-button>
            </td>
          </tr>
        </tbody>
      </table>
      <el-button @click="addDim">＋ 添加维度</el-button>
      <p class="hint">默认自带 编曲 / vocal / 画面，改成你们在意的方向就行，比如 作画、割切、歌词。</p>
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
import { onMounted, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import type { Config, Dim } from '../types'

const cfg = ref<Config | null>(null)
const personInput = ref('')
const tagInput = ref('')
const saving = ref(false)

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
.rangerow { display: flex; align-items: center; gap: 10px; }
</style>
