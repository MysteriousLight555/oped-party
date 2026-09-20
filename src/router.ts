import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue') },
    {
      path: '/session/:id/work',
      name: 'work',
      component: () => import('./views/WorkbenchView.vue')
    },
    {
      path: '/session/:id/pip',
      name: 'pip',
      component: () => import('./views/PipView.vue')
    },
    {
      path: '/session/:id/stage',
      name: 'stage',
      component: () => import('./views/StageView.vue')
    },
    {
      path: '/session/:id/sheet',
      name: 'sheet',
      component: () => import('./views/SheetView.vue')
    },
    {
      // 手机扫码入口：自动跳最新一期的打分页（配对过的人免选名字）
      path: '/join',
      name: 'join',
      component: () => import('./views/JoinView.vue')
    },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue') }
  ]
})

export default router
