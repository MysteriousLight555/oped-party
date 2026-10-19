<template>
  <el-dialog
    :model-value="modelValue"
    title="📨 邀请朋友"
    width="540px"
    top="6vh"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
    @open="initFields"
  >
    <template v-if="session">
      <div class="inv-head">
        <b>{{ session.name }}</b>
        <span>{{ session.members?.length || 0 }} 人 · {{ session.done ? '已结束' : '进行中' }}</span>
      </div>

      <p class="inv-tip">
        把这个链接发给朋友，他们打开后选名字、输口令就能打分。主持人页面不要发出去。
      </p>

      <div class="inv-link">
        <el-input v-model="link" readonly>
          <template #prepend>参与链接</template>
        </el-input>
        <el-button type="primary" @click="copy(link, '参与链接')">复制</el-button>
      </div>

      <div class="inv-qr">
        <img v-if="qrSrc" :src="qrSrc" alt="参与链接二维码" class="qr-img" />
        <div v-else class="qr-placeholder">
          {{ qrError || '二维码生成中…' }}
        </div>
        <div class="qr-side">
          <p>手机扫码直接进本场打分页。</p>
          <p v-if="baseIsLoopback" class="warn">
            这是本机地址（{{ baseInput }}），朋友打不开。同一 WiFi 请填本机局域网地址（如
            <code>http://192.168.x.x:18890</code>）；异地朋友请先运行「开远程打分.bat」，
            把打印的 <code>https://xxx.trycloudflare.com</code> 填到下面。
          </p>
          <p v-else-if="baseIsLan" class="warn">
            当前是局域网地址，同一 WiFi 的朋友可以扫码；异地朋友请先运行「开远程打分.bat」，
            把打印的 <code>https://xxx.trycloudflare.com</code> 填到下面。
          </p>
          <el-input
            v-model="baseInput"
            size="small"
            placeholder="参与链接的根地址，如 https://xxx.trycloudflare.com"
          >
            <template #prepend>根地址</template>
          </el-input>
        </div>
      </div>

      <div class="inv-row">
        <span class="lbl">房间口令</span>
        <el-input v-model="pinDraft" size="small" maxlength="8" placeholder="4~8 位数字，留空则不需要" style="width: 150px" />
        <el-button size="small" :loading="savingPin" @click="savePin">保存口令</el-button>
        <span class="hint">朋友加入时需要，防止陌生人乱入</span>
      </div>

      <div class="inv-row">
        <span class="lbl">评分方式</span>
        <el-switch v-model="blind" active-text="独立评分" @change="toggleBlind" />
        <span class="hint">
          {{ blind ? '大屏先只显示谁交了，不显示分数' : '大屏实时显示分数' }}
        </span>
        <el-button v-if="blind && !session.stage?.revealed" size="small" type="warning" plain @click="reveal">
          揭晓分数
        </el-button>
        <el-tag v-else-if="blind" type="success" effect="plain" size="small">已揭晓</el-tag>
      </div>

      <div class="inv-copybar">
        <el-button @click="copyInviteText">复制邀请文案（含口令）</el-button>
      </div>

      <el-alert
        v-if="session.done"
        type="info"
        :closable="false"
        show-icon
        title="本场已结束：链接仍可查看，但不能再改分。需要补分请回首页重新开放。"
      />
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import type { Session } from '../types'

const props = defineProps<{ modelValue: boolean; session: Session | null }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  changed: [patch: { pin?: string; stage?: Session['stage'] }]
}>()

const baseInput = ref('')
const pinDraft = ref('')
const blind = ref(false)
const savingPin = ref(false)
const qrSrc = ref('')
const qrError = ref('')
let qrObjectUrl = ''
let qrTimer: number | undefined

const cleanBase = computed(() =>
  baseInput.value
    .trim()
    .replace(/#.*$/, '')
    .replace(/\/+$/, '')
)
const link = computed(() =>
  props.session ? `${cleanBase.value}/#/join/${props.session.id}` : ''
)
const baseIsLoopback = computed(() =>
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(cleanBase.value)
)
const baseIsLan = computed(() =>
  /^https?:\/\/(192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d+)?$/.test(
    cleanBase.value
  )
)

function initFields() {
  if (!props.session) return
  pinDraft.value = props.session.pin || ''
  blind.value = Boolean(props.session.stage?.blind)
  const remembered = localStorage.getItem('oped-invite-base') || ''
  const current = `${location.origin}${location.pathname}`.replace(/\/+$/, '')
  baseInput.value = remembered || current
  void refreshQr()
}

watch(
  () => props.modelValue,
  open => {
    if (open) initFields()
  }
)

function revokeQr() {
  if (qrObjectUrl) URL.revokeObjectURL(qrObjectUrl)
  qrObjectUrl = ''
  qrSrc.value = ''
}

async function refreshQr() {
  if (!props.modelValue || !props.session || !link.value) return
  qrError.value = ''
  try {
    const url = await api.qrObjectUrl(link.value)
    revokeQr()
    qrObjectUrl = url
    qrSrc.value = url
  } catch (e) {
    qrError.value = (e as Error).message
  }
}

watch([link, () => props.modelValue], () => {
  if (!props.modelValue) {
    revokeQr()
    return
  }
  window.clearTimeout(qrTimer)
  qrTimer = window.setTimeout(() => {
    localStorage.setItem('oped-invite-base', cleanBase.value)
    void refreshQr()
  }, 350)
})

onBeforeUnmount(() => {
  window.clearTimeout(qrTimer)
  revokeQr()
})

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制${label}`)
  } catch {
    ElMessage.info(text)
  }
}

function copyInviteText() {
  if (!props.session) return
  const pin = props.session.pin
  const text = `「${props.session.name}」在线打分：${link.value}${pin ? `（房间口令 ${pin}）` : ''}`
  copy(text, '邀请文案')
}

async function savePin() {
  if (!props.session) return
  const pin = pinDraft.value.trim()
  if (pin && !/^\d{4,8}$/.test(pin)) {
    ElMessage.warning('口令必须是 4~8 位数字，留空表示不需要口令')
    return
  }
  savingPin.value = true
  try {
    const r = await api.updateSessionMeta(props.session.id, { pin })
    emit('changed', { pin: r.pin })
    ElMessage.success(pin ? `房间口令已设为 ${pin}` : '已关闭房间口令')
  } catch (e) {
    ElMessage.error((e as Error).message)
  } finally {
    savingPin.value = false
  }
}

async function toggleBlind(value: string | number | boolean) {
  if (!props.session) return
  try {
    const r = await api.setStage(props.session.id, { blind: Boolean(value) })
    emit('changed', { stage: r.stage })
    ElMessage.success(value ? '已开启独立评分，大屏在揭晓前不显示分数' : '已恢复实时显示分数')
  } catch (e) {
    blind.value = !value
    ElMessage.error((e as Error).message)
  }
}

async function reveal() {
  if (!props.session) return
  try {
    const r = await api.setStage(props.session.id, { revealed: true })
    emit('changed', { stage: r.stage })
    ElMessage.success('已揭晓，大屏现在显示所有人的分数')
  } catch (e) {
    ElMessage.error((e as Error).message)
  }
}
</script>

<style scoped>
.inv-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
}
.inv-head b { font-size: 16px; }
.inv-head span { color: #9499a0; font-size: 12.5px; }
.inv-tip { color: #61666d; font-size: 13px; margin: 0 0 12px; line-height: 1.6; }
.inv-link { display: flex; gap: 8px; }
.inv-qr {
  display: flex;
  gap: 16px;
  margin: 14px 0;
  padding: 12px;
  background: #fafbfc;
  border: 1px solid #eef0f3;
  border-radius: 10px;
}
.qr-img {
  width: 150px;
  height: 150px;
  flex-shrink: 0;
  background: #fff;
  border-radius: 8px;
}
.qr-placeholder {
  width: 150px;
  height: 150px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 10px;
  color: #9499a0;
  font-size: 12px;
  background: #fff;
  border-radius: 8px;
  border: 1px dashed #dcdfe6;
}
.qr-side { flex: 1; min-width: 0; font-size: 12.5px; color: #61666d; }
.qr-side p { margin: 0 0 8px; line-height: 1.6; }
.qr-side .warn { color: #b88230; background: #fdf6ec; border-radius: 6px; padding: 6px 8px; }
.qr-side code { background: #fff; padding: 0 3px; border-radius: 3px; }
.inv-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  flex-wrap: wrap;
}
.inv-row .lbl { color: #61666d; font-size: 13px; width: 60px; flex-shrink: 0; }
.inv-row .hint { color: #9499a0; font-size: 12px; }
.inv-copybar { margin-top: 16px; }
</style>
