/** 保存时序回归：直接执行 Vue 页面的脚本逻辑，不启动浏览器或写入 data/。 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import * as vue from 'vue'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const storage = new Map()
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key)
}
globalThis.window = { setTimeout, clearTimeout }
globalThis.document = { hidden: false, activeElement: null }
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })

class ApiError extends Error {
  constructor(status, message, body = {}) {
    super(message)
    this.status = status
    this.code = body.code || ''
    this.body = body
  }
}

function load(relative, api = {}, extra = '') {
  const text = fs.readFileSync(path.join(ROOT, relative), 'utf8')
  const source = relative.endsWith('.vue')
    ? text.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    : text
  const js = ts.transpileModule(source + '\n' + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const module = { exports: {} }
  const require = name => {
    if (name === 'vue') return { ...vue, onMounted() {}, onBeforeUnmount() {}, watch() {} }
    if (name === 'vue-router') return {
      useRoute: () => ({ params: { id: 'test' }, query: {}, path: '/session/test/work' }),
      useRouter: () => ({ replace() {}, push() {} })
    }
    if (name === 'element-plus') return {
      ElMessage: { success() {}, error() {}, warning() {}, info() {} },
      ElMessageBox: { confirm: async () => {} }
    }
    if (name.endsWith('/api')) return { api, ApiError }
    if (name.endsWith('/session-sync')) return load('src/session-sync.ts')
    if (name.endsWith('/sheet-sync')) return load('src/sheet-sync.ts', api)
    if (name.endsWith('/sessionConfig')) return load('src/sessionConfig.ts')
    if (name.endsWith('/auth')) return { auth: { host: false } }
    if (name.endsWith('.vue')) return {}
    throw new Error(`未提供测试依赖：${name}`)
  }
  new Function('require', 'module', 'exports', js)(require, module, module.exports)
  return module.exports
}

const sync = load('src/session-sync.ts')
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve
  const promise = new Promise(r => { resolve = r })
  return { promise, resolve }
}
function fixture() {
  return {
    id: 'test', rev: 1, done: false, members: ['甲', '乙'],
    stage: { currentPage: 1, blind: false, revealed: false },
    parts: [{ page: 1, title: '测试曲', parsed: {}, scores: { 甲: 6 }, dimScores: {},
      favorites: [], tags: [], comment: '', personTags: {}, personComments: {}, skipped: false }]
  }
}
function workbench(api) {
  return load('src/views/WorkbenchView.vue', api, `
    export { session, doSave, finishParty, personInline, addPersonInline };
    export function init(s: Session) {
      session.value = cloneData(s); base = cloneData(s); baseRev = s.rev || 0;
      globalCfg.value = { dimensions: [], persons: ['甲', '乙'], tags: [], scoreMin: 1, scoreMax: 10 };
    }
  `)
}

let passed = 0
async function check(label, run) {
  await run()
  passed++
  console.log(`  ✓ ${label}`)
}

await check('刚改分就结束：先保存最后一格，再锁定本场', async () => {
  const stored = fixture()
  const calls = []
  const view = workbench({
    patchSession: async (_id, ops) => {
      calls.push('save'); sync.applySessionOps(stored, ops)
      return { rev: ++stored.rev, conflicts: [] }
    },
    finishSession: async () => {
      calls.push('finish'); stored.done = true
      return { rev: ++stored.rev, missingCount: 0 }
    }
  })
  view.init(stored)
  view.session.value.parts[0].scores.甲 = 8.5
  await view.finishParty()
  assert.deepEqual(calls, ['save', 'finish'])
  assert.equal(stored.parts[0].scores.甲, 8.5)
})

await check('保存期间继续输入并结束：请求串行，最后一次输入也保存', async () => {
  const stored = fixture()
  const gate = deferred()
  let saves = 0
  let active = 0
  let maxActive = 0
  let finished = false
  const view = workbench({
    patchSession: async (_id, ops) => {
      maxActive = Math.max(maxActive, ++active)
      if (++saves === 1) await gate.promise
      sync.applySessionOps(stored, ops); active--
      return { rev: ++stored.rev, conflicts: [] }
    },
    finishSession: async () => {
      finished = true
      assert.equal(stored.parts[0].scores.甲, 9)
      return { rev: ++stored.rev, missingCount: 0 }
    }
  })
  view.init(stored)
  view.session.value.parts[0].scores.甲 = 7
  const first = view.doSave()
  view.session.value.parts[0].scores.甲 = 9
  const end = view.finishParty()
  assert.equal(finished, false)
  gate.resolve()
  await Promise.all([first, end])
  assert.equal(finished, true)
  assert.equal(maxActive, 1)
})

await check('保存失败时保留现场，不直接结束锁定', async () => {
  let finished = false
  const view = workbench({
    patchSession: async () => { throw new ApiError(0, '断网') },
    finishSession: async () => { finished = true }
  })
  view.init(fixture())
  view.session.value.parts[0].scores.甲 = 9
  await view.finishParty()
  assert.equal(finished, false)
  assert.equal(view.session.value.done, false)
})

await check('工作台内联加人会保存到本场名单，不修改全局模板', async () => {
  let submitted
  const view = workbench({ updateSessionMeta: async (_id, body) => {
    submitted = body
    return { members: body.members, rev: 2, settings: null }
  } })
  view.init(fixture())
  view.personInline.value = '新朋友'
  await view.addPersonInline()
  assert.deepEqual(submitted.members, ['甲', '乙', '新朋友'])
  assert.deepEqual([...view.session.value.members], ['甲', '乙', '新朋友'])
})

await check('同设备给两个人打同一首：离线队列分别保留，联网后都提交', async () => {
  const sent = []
  const { createSheetSaveQueue } = load('src/sheet-sync.ts', {
    patchPart: async (_id, _page, body) => { sent.push(body); return { rev: 2 } }
  })
  const queue = createSheetSaveQueue({ sessionId: 'offline' })
  try {
    navigator.onLine = false
    queue.enqueue(1, { person: '甲', score: 7 })
    queue.enqueue(1, { person: '乙', score: 9 })
    assert.equal(queue.pendingCount.value, 2)
    navigator.onLine = true
    await queue.flush()
    assert.deepEqual(sent.map(x => [x.person, x.score]), [['甲', 7], ['乙', 9]])
    assert.equal(queue.pendingCount.value, 0)
  } finally { navigator.onLine = true; queue.dispose() }
})

await check('网络失败后刷新页面：本地待提交记录恢复并成功补交', async () => {
  const failedQueue = load('src/sheet-sync.ts', {
    patchPart: async () => { throw new ApiError(0, '网络失败') }
  }).createSheetSaveQueue({ sessionId: 'retry' })
  failedQueue.enqueue(1, { person: '甲', score: 8.5 })
  await tick()
  assert.equal(failedQueue.pendingCount.value, 1)
  failedQueue.dispose()
  const sent = []
  const restored = load('src/sheet-sync.ts', {
    patchPart: async (_id, _page, body) => { sent.push(body); return { rev: 3 } }
  }).createSheetSaveQueue({ sessionId: 'retry' })
  try {
    assert.equal(restored.init().length, 1)
    await restored.flush()
    assert.equal(sent[0].score, 8.5)
    assert.equal(restored.pendingCount.value, 0)
    assert.equal(restored.status.value, 'saved')
  } finally { restored.dispose() }
})

await check('服务端明确拒绝时回滚收藏，并清除已拒绝的队列项', async () => {
  let favorite = true
  const queue = load('src/sheet-sync.ts', {
    patchPart: async () => { throw new ApiError(409, '已结束', { code: 'SESSION_CLOSED' }) }
  }).createSheetSaveQueue({ sessionId: 'rejected' })
  try {
    queue.enqueue(1, { person: '甲', fav: true }, () => { favorite = false })
    await tick()
    assert.equal(favorite, false)
    assert.equal(queue.pendingCount.value, 0)
    assert.equal(queue.status.value, 'error')
  } finally { queue.dispose() }
})

await check('手机交分成功后，迟到的旧轮询响应不能盖回旧分数', async () => {
  const oldResponse = deferred()
  const view = load('src/views/SheetView.vue', {
    getSession: () => oldResponse.promise,
    patchPart: async () => ({ rev: 2 })
  }, `
    export { session, queue, refreshRemote, setScore };
    export function init(s: Session) {
      session.value = s; tokenPerson.value = '甲';
      globalCfg.value = { dimensions: [], persons: ['甲', '乙'], tags: [], scoreMin: 1, scoreMax: 10 };
    }
  `)
  const old = fixture()
  view.init(fixture())
  try {
    const refresh = view.refreshRemote()
    await view.setScore(view.session.value.parts[0], 8)
    await tick()
    oldResponse.resolve(old)
    await refresh
    assert.equal(view.session.value.rev, 2)
    assert.equal(view.session.value.parts[0].scores.甲, 8)
  } finally { view.queue.dispose() }
})

await check('歌词返回时保留新评分和锁定状态，换版本后不挂错歌词', async () => {
  const source = ts.createSourceFile('index.js', fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const code = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'fetchPartLyric').getText(source)
  let stored = fixture()
  stored.parts[0].ncm = { encryptedId: 'song-A' }
  const gate = deferred()
  let saved = 0
  const fetchLyric = new Function('getLyric', 'loadAuth', 'getSession', 'saveSession', `return (${code})`)(
    () => gate.promise, () => ({}), () => sync.cloneData(stored),
    value => { stored = value; saved++ }
  )
  const task = fetchLyric(sync.cloneData(stored), sync.cloneData(stored.parts[0]))
  stored.parts[0].scores.甲 = 9
  stored.done = true
  gate.resolve({ ok: true, text: '歌词' })
  await task
  assert.equal(stored.parts[0].scores.甲, 9)
  assert.equal(stored.done, true)
  assert.equal(stored.parts[0].ncm.lyric.text, '歌词')
  const oldPart = sync.cloneData(stored.parts[0])
  stored.parts[0].ncm = { encryptedId: 'song-B' }
  await assert.rejects(fetchLyric(stored, oldPart), /歌曲已变更/)
  assert.equal(saved, 1)
  assert.equal(stored.parts[0].ncm.lyric, undefined)
})

console.log(`\n保存时序：${passed} 项通过`)
