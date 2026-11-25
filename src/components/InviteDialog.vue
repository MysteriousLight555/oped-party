<template>
  <el-dialog
    :model-value="modelValue"
    title="📨 邀请朋友"
    width="540px"
    top="6vh"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <template v-if="session">
      <div class="inv-head">
        <b>{{ session.name }}</b>
        <span>{{ session.members?.length || 0 }} 人 · {{ session.done ? '已结束' : '进行中' }}</span>
      </div>

      <p class="inv-tip">
        把这个链接发给朋友，他们打开后选名字、输口令就能打分。主持人页面不要发出去。
      </p>

      <div class="inv-address">
        <el-radio-group v-model="mode" size="small" aria-label="邀请地址类型">
          <el-radio-button value="local">本地</el-radio-button>
          <el-radio-button value="public">公网</el-radio-button>
        </el-radio-group>
        <span v-if="mode === 'public' && activePublic && manualBase === null" class="inv-connected">已识别公网隧道</span>
      </div>

      <div class="inv-link">
        <el-input v-model="link" readonly>
          <template #prepend>参与链接</template>
        </el-input>
        <el-button type="primary" :disabled="!link" @click="copy(link, '参与链接')">复制</el-button>
      </div>

      <div class="inv-qr">
        <img v-if="qrSrc" :src="qrSrc" alt="参与链接二维码" class="qr-img" />
        <div v-else class="qr-placeholder">
          {{ link ? qrError || '二维码生成中…' : '等待有效地址' }}
        </div>
        <div class="qr-side">
          <p v-if="mode === 'local' && baseIsLoopback" class="warn">
            本机地址只能在这台电脑打开。同一 WiFi 可填可访问的局域网地址，异地朋友请切到「公网」。
          </p>
          <p v-else-if="mode === 'public' && !activePublic && !link" class="warn">
            等待公网隧道连接。也可以运行「开远程打分.bat」重试，或手动填写公网地址。
          </p>
          <p v-else>朋友打开参与链接或扫码加入本期。</p>
          <el-input
            v-model="baseInput"
            size="small"
            :placeholder="mode === 'public' ? '等待公网地址或手动填写' : '本机或局域网地址'"
          >
            <template #prepend>根地址</template>
          </el-input>
          <el-button v-if="manualBase !== null" link size="small" type="primary" @click="resetBase">
            恢复自动地址
          </el-button>
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
        <el-button :disabled="!link" @click="copyInviteText">复制邀请文案（含口令）</el-button>
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
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '../api'
import type { Session } from '../types'

const props = defineProps<{ modelValue: boolean; session: Session | null }>()
const emit = defineEmits<{
  'update:modelValue': [boolean]
  changed: [patch: { pin?: string; stage?: Session['stage'] }]
}>()

type AddressMode = 'local' | 'public'
const localRootKey = 'oped-invite-local'
const publicRootKey = 'oped-invite-public'
const manualLocal = ref<string | null>(null)
const manualPublic = ref<string | null>(null)
const mode = ref<AddressMode>('public')
const localBase = ref('')
const activePublic = ref('')
const pinDraft = ref('')
const blind = ref(false)
const savingPin = ref(false)
const qrSrc = ref('')
const qrError = ref('')

function normalizeBase(value: string) {
  try {
    const url = new URL(value.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return ''
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return ''
  }
}

const loopback = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?=[:/]|$)/i
const lan = /^https?:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(?=[:/]|$)/i
const quickTunnel = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com(?=[:/]|$)/i
const browserBase = normalizeBase(location.href)
const browserLocal = loopback.test(browserBase) || lan.test(browserBase)
const browserPublic = browserLocal ? '' : browserBase
const detectedPublic = computed(() => activePublic.value || browserPublic)
const manualBase = computed(() => mode.value === 'public' ? manualPublic.value : manualLocal.value)
const baseInput = computed({
  get: () => manualBase.value ?? (mode.value === 'public' ? detectedPublic.value : localBase.value),
  set: value => {
    const isPublic = mode.value === 'public'
    const draft = isPublic ? manualPublic : manualLocal
    const key = isPublic ? publicRootKey : localRootKey
    draft.value = value
    const clean = normalizeBase(value)
    if (clean && !quickTunnel.test(clean)) localStorage.setItem(key, clean)
    else localStorage.removeItem(key)
  }
})
const cleanBase = computed(() => normalizeBase(baseInput.value))
const baseIsLoopback = computed(() => loopback.test(cleanBase.value))
const link = computed(() => props.session && cleanBase.value ? `${cleanBase.value}/#/join/${props.session.id}` : '')

function resetBase() {
  baseInput.value = ''
  if (mode.value === 'public') manualPublic.value = null
  else manualLocal.value = null
}

watch(() => props.modelValue, (open, _, onCleanup) => {
  if (!open || !props.session) return
  pinDraft.value = props.session.pin || ''
  blind.value = Boolean(props.session.stage?.blind)
  localBase.value = browserLocal ? browserBase : ''
  activePublic.value = ''

  const remembered = normalizeBase(localStorage.getItem('oped-invite-base') || '')
  const rememberedLocal = loopback.test(remembered) || lan.test(remembered)
  if (remembered && remembered !== browserBase && !quickTunnel.test(remembered)) {
    const key = rememberedLocal ? localRootKey : publicRootKey
    if (!localStorage.getItem(key)) localStorage.setItem(key, remembered)
  }
  localStorage.removeItem('oped-invite-base')
  manualLocal.value = localStorage.getItem(localRootKey)
  manualPublic.value = localStorage.getItem(publicRootKey)
  mode.value = 'public'

  let openNow = true
  async function refreshAddresses() {
    try {
      const addresses = await api.inviteAddresses()
      if (!openNow) return
      localBase.value = lan.test(browserBase) ? browserBase : addresses.local
      activePublic.value = addresses.public ?? ''
    } catch {
      if (openNow) activePublic.value = ''
    }
  }
  void refreshAddresses()
  const timer = window.setInterval(refreshAddresses, 4000)
  onCleanup(() => {
    openNow = false
    window.clearInterval(timer)
  })
}, { immediate: true })

watch([link, () => props.modelValue], ([target, open], _, onCleanup) => {
  qrSrc.value = ''
  qrError.value = ''
  if (!target || !open) return
  let valid = true
  const timer = window.setTimeout(async () => {
    try {
      const url = await api.qrObjectUrl(target)
      if (valid) qrSrc.value = url
      else URL.revokeObjectURL(url)
    } catch (e) {
      if (valid) qrError.value = (e as Error).message
    }
  }, 250)
  onCleanup(() => {
    valid = false
    window.clearTimeout(timer)
    if (qrSrc.value) URL.revokeObjectURL(qrSrc.value)
  })
}, { immediate: true })

async function copy(text: string, label: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(`已复制${label}`)
  } catch {
    ElMessage.info(text)
  }
}

function copyInviteText() {
  if (!props.session || !link.value) return
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
.inv-address { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.inv-connected { color: #2d7342; font-size: 12px; }
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
