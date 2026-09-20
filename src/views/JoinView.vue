<template>
  <div class="join">
    <template v-if="target">
      <p class="j-tip">正在进入最新一期「{{ target.name }}」…</p>
    </template>
    <p v-else-if="loaded" class="j-tip">还没有任何期次，等房主建好再打开这个页面。</p>
    <p v-else class="j-tip">加载中…</p>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import type { SessionMeta } from '../types'

const router = useRouter()
const target = ref<SessionMeta | null>(null)
const loaded = ref(false)

onMounted(async () => {
  try {
    // listSessions 按创建时间倒序，第一个就是最新一期
    const list = await api.listSessions()
    if (list.length) {
      target.value = list[0]
      router.replace(`/session/${list[0].id}/sheet`)
      return
    }
  } catch {
    /* 服务没起或网络断 */
  }
  loaded.value = true
})
</script>

<style scoped>
.join {
  min-height: 60vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
.j-tip {
  color: #9499a0;
  font-size: 15px;
}
</style>
