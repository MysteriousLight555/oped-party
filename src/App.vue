<template>
  <header class="topbar">
    <div class="bar-inner">
      <RouterLink to="/" class="brand">🎵 OP/ED 鉴赏会</RouterLink>
      <nav class="nav">
        <RouterLink to="/">期次</RouterLink>
        <RouterLink to="/settings">设置</RouterLink>
      </nav>
    </div>
  </header>
  <RouterView />
</template>

<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router'
</script>

<style scoped>
.topbar {
  background: linear-gradient(120deg, #fb7299 0%, #f25d8e 45%, #23ade5 130%);
  color: #fff;
}
.bar-inner {
  max-width: 1180px;
  margin: 0 auto;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.brand {
  color: #fff;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: 1px;
}
.nav a {
  color: rgba(255, 255, 255, 0.88);
  margin-left: 22px;
  font-size: 15px;
}
.nav a.router-link-active {
  color: #fff;
  font-weight: 600;
  border-bottom: 2px solid #fff;
  padding-bottom: 2px;
}
/* 手机（打分同学）不看后台导航：期次/设置是房主工具 */
@media (max-width: 768px) {
  .nav {
    display: none;
  }
  .brand {
    font-size: 16px;
  }
  .bar-inner {
    padding: 10px 14px;
  }
}
</style>
