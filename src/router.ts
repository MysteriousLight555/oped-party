import { createRouter, createWebHashHistory } from 'vue-router'
import { ensureAccess } from './auth'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('./views/HomeView.vue'),
      meta: { host: true }
    },
    {
      path: '/session/:id/work',
      name: 'work',
      component: () => import('./views/WorkbenchView.vue'),
      meta: { host: true }
    },
    {
      path: '/session/:id/settings',
      name: 'session-settings',
      component: () => import('./views/SessionSettingsView.vue'),
      meta: { host: true }
    },
    {
      path: '/session/:id/pip',
      name: 'pip',
      component: () => import('./views/PipView.vue'),
      meta: { host: true }
    },
    {
      path: '/session/:id/stage',
      name: 'stage',
      component: () => import('./views/StageView.vue'),
      meta: { host: true }
    },
    {
      // 手机个人打分页：参与者凭证 / 主持人本机都可进
      path: '/session/:id/sheet',
      name: 'sheet',
      component: () => import('./views/SheetView.vue')
    },
    {
      // 兼容旧版错误的分享链接 #/sheet/<id>
      path: '/sheet/:id',
      redirect: to => `/session/${to.params.id}/sheet`
    },
    {
      // 朋友入口：不带期次时列出可以加入的场次
      path: '/join',
      name: 'join',
      component: () => import('./views/JoinView.vue')
    },
    {
      path: '/join/:id',
      name: 'joinSession',
      component: () => import('./views/JoinView.vue')
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('./views/SettingsView.vue'),
      meta: { host: true }
    }
  ]
})

router.beforeEach(async to => {
  if (to.meta.host !== true) return true
  const access = await ensureAccess()
  if (access.host) return true
  // 远端打开主持人页面：先去朋友入口（那里有"我是主持人"登录）
  return { name: 'join' }
})

export default router
