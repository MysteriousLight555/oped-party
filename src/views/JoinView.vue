<template>
  <div class="join-page">
    <!-- 场次列表：朋友从根网址 / #/join 进来，不暴露主持人工作台 -->
    <template v-if="!joinId">
      <div class="join-head">
        <h1>加入鉴赏会</h1>
        <p>选一场，输口令，用手机就能打分。主持人会在大屏上同步进度。</p>
      </div>

      <el-empty
        v-if="loaded && !sessions.length"
        description="还没有鉴赏会，等主持人建好这一期再来"
      />

      <div class="join-list">
        <el-card v-for="s in sessions" :key="s.id" shadow="hover" class="join-item">
          <div class="join-main">
            <div class="join-title">
              <b>{{ s.name }}</b>
              <el-tag v-if="s.done" size="small" type="info" effect="plain">已结束</el-tag>
              <el-tag v-else size="small" type="success" effect="plain">进行中</el-tag>
            </div>
            <div class="join-meta">
              {{ s.createdAt.slice(0, 10) }} · {{ s.memberCount }} 人 · 已评齐
              {{ s.complete }}/{{ s.total }}
            </div>
          </div>
          <el-button type="primary" @click="router.push(`/join/${s.id}`)">加入</el-button>
        </el-card>
      </div>

      <div class="host-entry">
        <el-button text @click="openHost">我是主持人 · 登录管理页</el-button>
      </div>
    </template>

    <!-- 单场加入 -->
    <template v-else>
      <div v-if="info" class="join-card">
        <h1>{{ info.name }}</h1>
        <p class="join-sub">
          {{ info.createdAt.slice(0, 10) }} · {{ info.memberCount }} 人 · {{ info.total }} 首
        </p>

        <el-alert
          v-if="info.done"
          type="info"
          show-icon
          :closable="false"
          title="本场已经结束：可以查看自己交过的分数，但不能再修改。"
          class="mb12"
        />

        <div v-if="existingPerson" class="joined">
          <p>你已作为 <b>{{ existingPerson }}</b> 加入本场</p>
          <div class="joined-btns">
            <el-button type="primary" size="large" @click="goSheet">继续打分</el-button>
            <el-button text @click="switchIdentity">换个人</el-button>
          </div>
        </div>

        <template v-else>
          <div class="join-form">
            <div class="pick">
              <span class="lbl">你是谁</span>
              <el-select
                v-model="personSel"
                filterable
                allow-create
                default-first-option
                placeholder="选名字，或直接输入新名字"
                style="width: 230px"
                size="large"
              >
                <el-option v-for="m in info.members" :key="m" :label="m" :value="m" />
              </el-select>
            </div>
            <div v-if="info.pinRequired" class="pick">
              <span class="lbl">房间口令</span>
              <el-input
                v-model="pin"
                maxlength="8"
                size="large"
                placeholder="问主持人要 4 位口令"
                style="width: 200px"
                @keyup.enter="join"
              />
            </div>
            <p v-else class="no-pin">本场不需要口令</p>
            <el-button type="primary" size="large" :loading="joining" @click="join">
              进入打分
            </el-button>
          </div>
          <p class="join-tip">
            独立评分：你只看到自己交了多少，分数会在主持人揭晓后统一展示。
          </p>
        </template>
      </div>
      <div v-else-if="error" class="join-card">
        <el-alert :title="error" type="error" :closable="false" show-icon />
        <el-button class="mt12" @click="router.push('/join')">返回场次列表</el-button>
      </div>
      <p v-else class="loading">加载中…</p>
    </template>

    <!-- 主持人登录（通过公网/其他设备打开时） -->
    <el-dialog v-model="showHost" title="主持人登录" width="440px">
      <p class="host-hint">
        本机打开会自动识别为主持人。通过公网或另一台设备打开时，输入启动窗口打印的
        <b>房间管理密钥</b>（也可在本机设置页查看）。
      </p>
      <el-input
        v-model="hostKeyInput"
        placeholder="房间管理密钥"
        show-password
        @keyup.enter="claimHost"
      />
      <template #footer>
        <el-button @click="showHost = false">取消</el-button>
        <el-button type="primary" :loading="claiming" @click="claimHost">登录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import {
  auth,
  clearParticipant,
  ensureAccess,
  getParticipantPerson,
  getParticipantToken,
  setHostKey,
  setParticipantToken
} from '../auth'
import type { JoinInfo, JoinSummary } from '../types'

const route = useRoute()
const router = useRouter()

const joinId = computed(() => String(route.params.id || ''))
const sessions = ref<JoinSummary[]>([])
const info = ref<JoinInfo | null>(null)
const loaded = ref(false)
const error = ref('')
const personSel = ref('')
const pin = ref('')
const joining = ref(false)
const existingPerson = ref('')
const showHost = ref(false)
const hostKeyInput = ref('')
const claiming = ref(false)

async function loadList() {
  try {
    sessions.value = await api.joinSessions()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loaded.value = true
  }
}

async function loadInfo() {
  if (!joinId.value) {
    info.value = null
    await loadList()
    return
  }
  loaded.value = false
  error.value = ''
  info.value = null
  existingPerson.value =
    getParticipantToken(joinId.value) && getParticipantPerson(joinId.value)
      ? getParticipantPerson(joinId.value)
      : ''
  try {
    info.value = await api.joinInfo(joinId.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loaded.value = true
  }
}

onMounted(loadInfo)
watch(joinId, loadInfo)

async function join() {
  if (!info.value) return
  const person = personSel.value.trim()
  if (!person) {
    ElMessage.warning('先选一个名字，或输入你的名字')
    return
  }
  joining.value = true
  try {
    const r = await api.joinSession(info.value.id, person, pin.value.trim())
    setParticipantToken(info.value.id, r.token, r.person)
    auth.participant = { sessionId: info.value.id, person: r.person }
    info.value.members = r.session.members || info.value.members
    ElMessage.success(`已作为「${r.person}」加入`)
    goSheet()
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    joining.value = false
  }
}

function goSheet() {
  if (!joinId.value) return
  router.replace(`/session/${joinId.value}/sheet`)
}

function switchIdentity() {
  clearParticipant(joinId.value)
  existingPerson.value = ''
  personSel.value = ''
  pin.value = ''
}

function openHost() {
  hostKeyInput.value = ''
  showHost.value = true
}

async function claimHost() {
  const key = hostKeyInput.value.trim()
  if (!key) return
  claiming.value = true
  try {
    await api.claimHost(key)
    setHostKey(key)
    await ensureAccess(true)
    showHost.value = false
    ElMessage.success('主持人权限已登录')
    router.push('/')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    claiming.value = false
  }
}
</script>

<style scoped>
.join-page {
  max-width: 720px;
  margin: 0 auto;
  padding: 30px 16px 60px;
}
.join-head {
  text-align: center;
  margin-bottom: 22px;
}
.join-head h1 {
  margin: 0 0 8px;
  font-size: 26px;
}
.join-head p {
  margin: 0;
  color: #9499a0;
  font-size: 14px;
}
.join-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.join-item :deep(.el-card__body) {
  display: flex;
  align-items: center;
  gap: 16px;
}
.join-main {
  flex: 1;
  min-width: 0;
}
.join-title {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.join-title b {
  font-size: 17px;
}
.join-meta {
  color: #9499a0;
  font-size: 13px;
  margin-top: 4px;
}
.host-entry {
  text-align: center;
  margin-top: 26px;
}
.join-card {
  background: #fff;
  border-radius: 16px;
  padding: 26px 24px 30px;
  box-shadow: 0 6px 30px rgba(0, 0, 0, 0.06);
}
.join-card h1 {
  margin: 0 0 6px;
  font-size: 24px;
}
.join-sub {
  margin: 0 0 20px;
  color: #9499a0;
  font-size: 13.5px;
}
.join-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: flex-start;
}
.pick {
  display: flex;
  align-items: center;
  gap: 12px;
}
.pick .lbl {
  width: 64px;
  color: #61666d;
  font-size: 14px;
}
.no-pin {
  color: #9499a0;
  font-size: 13px;
  margin: 0;
}
.join-tip {
  margin: 20px 0 0;
  color: #9499a0;
  font-size: 12.5px;
}
.joined p {
  font-size: 16px;
  margin: 10px 0 18px;
}
.joined-btns {
  display: flex;
  align-items: center;
  gap: 8px;
}
.host-hint {
  color: #61666d;
  font-size: 13px;
  line-height: 1.7;
  margin: 0 0 12px;
}
.loading {
  text-align: center;
  color: #9499a0;
  padding: 40px 0;
}
.mb12 {
  margin-bottom: 12px;
}
.mt12 {
  margin-top: 12px;
}
</style>
