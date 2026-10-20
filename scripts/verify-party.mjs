/**
 * 隔离数据验收：多端写分 / 字段合并 / 权限 / 分数校验 / 当前曲 / 结束锁定
 *
 *   node scripts/verify-party.mjs
 *
 * 会在 .tmp-verify-data 里起一个独立服务（端口 18901），不碰 data/ 里的真实数据。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const DATA = path.join(ROOT, '.tmp-verify-data')
const PORT = 18901
const BASE = `http://127.0.0.1:${PORT}/api`

let passed = 0
let failed = 0

function ok(cond, label, extra) {
  if (cond) {
    passed++
    console.log(`  ✓ ${label}`)
  } else {
    failed++
    console.error(`  ✗ ${label}${extra === undefined ? '' : ` → ${JSON.stringify(extra)}`}`)
  }
}

function eq(actual, expected, label) {
  ok(
    JSON.stringify(actual) === JSON.stringify(expected),
    label,
    { actual, expected }
  )
}

class ApiError extends Error {
  constructor(status, body) {
    super(body?.error || `HTTP ${status}`)
    this.status = status
    this.body = body
  }
}

async function api(method, url, { body, headers = {} } = {}) {
  // 本机直连会被识别为主持人；测试"朋友"时用转发头模拟公网来源
  const finalHeaders = { 'Content-Type': 'application/json', ...headers }
  if (finalHeaders['x-participant-token'] && !finalHeaders['x-forwarded-for']) {
    finalHeaders['x-forwarded-for'] = '203.0.113.50'
  }
  const res = await fetch(BASE + url, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  const text = await res.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

async function expectError(fn, status, label) {
  try {
    await fn()
    ok(false, label, '没有报错')
  } catch (e) {
    ok(e instanceof ApiError && e.status === status, label, {
      status: e.status,
      body: e.body
    })
    return e
  }
}

function wait(ms) {
  return new Promise(r => setTimeout(r, ms))
}

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      await api('GET', '/access')
      return
    } catch {
      await wait(150)
    }
  }
  throw new Error('测试服务器没有启动')
}

async function main() {
  if (path.dirname(path.resolve(DATA)) !== ROOT) throw new Error('验收数据目录越界')
  fs.rmSync(DATA, { recursive: true, force: true })
  fs.mkdirSync(DATA, { recursive: true })
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, OPED_DATA_DIR: DATA, PORT: String(PORT), HOST: '127.0.0.1' },
    // 沙箱里不能用 piped stdio（EPERM）；验收只需要服务跑起来
    stdio: 'ignore'
  })
  const logs = ''

  try {
    await waitServer()

    console.log('\n[1] 建期 + 初始成员/口令/当前曲')
    const session = await api('POST', '/sessions', {
      body: {
        mode: 'manual',
        manualTitle: '验收测试',
        name: '验收测试',
        lines: ['正式OP 测试番「A」甲', '正式ED 测试番「B」乙']
      }
    })
    ok(session.id && Array.isArray(session.members), '创建成功并带成员名单')
    eq(session.parts.length, 2, '两个分P')
    ok(/^\d{4}$/.test(session.pin), '自动生成 4 位房间口令', session.pin)
    eq(session.stage.currentPage, 1, '当前曲默认第一首')
    eq(session.done, false, '默认进行中')
    const sessionId = session.id
    const pin = session.pin

    console.log('\n[2] 公网/转发请求默认不是主持人')
    await expectError(
      () => api('GET', '/sessions', { headers: { 'x-forwarded-for': '203.0.113.9' } }),
      403,
      '转发请求不能列期次'
    )
    const hostKey = (await api('GET', '/host/key')).key
    ok(typeof hostKey === 'string' && hostKey.length > 6, '本机可读取房间管理密钥')
    const hostHeaders = { 'x-host-key': hostKey, 'x-forwarded-for': '203.0.113.9' }
    const listAsHost = await api('GET', '/sessions', { headers: hostHeaders })
    eq(listAsHost.length, 1, '带密钥的远端请求可当主持人')

    console.log('\n[3] 参与者加入：口令错误 / 正确')
    await expectError(
      () => api('POST', `/sessions/${sessionId}/join`, { body: { person: '小林', pin: '0000' } }),
      403,
      '错误口令被拒绝'
    )
    const joinA = await api('POST', `/sessions/${sessionId}/join`, {
      body: { person: '小林', pin }
    })
    ok(joinA.token, '正确口令拿到参与者凭证')
    const tokenA = joinA.token
    eq(joinA.session.myPerson, '小林', '凭证绑定到本人')
    ok(
      joinA.session.parts.every(p => Object.keys(p.scores).every(who => who === '小林')),
      '参与者只看到自己的分数'
    )
    const joinB = await api('POST', `/sessions/${sessionId}/join`, {
      body: { person: '阿伟', pin }
    })
    const tokenB = joinB.token
    const people = (await api('GET', `/sessions/${sessionId}`, { headers: hostHeaders })).members
    eq(people, ['小林', '阿伟'], '自助加入会进入本场成员名单')

    console.log('\n[4] 权限：参与者不能改配置/别人分数/歌曲信息')
    await expectError(
      () => api('PUT', '/config', { body: {}, headers: { 'x-participant-token': tokenA } }),
      403,
      '参与者不能改配置'
    )
    await expectError(
      () =>
        api('PUT', `/sessions/${sessionId}/part/1`, {
          headers: { 'x-participant-token': tokenA },
          body: { person: '阿伟', score: 9 }
        }),
      403,
      '参与者不能给别人的分'
    )
    await expectError(
      () =>
        api('PUT', `/sessions/${sessionId}/patch`, {
          headers: { 'x-participant-token': tokenA },
          body: { ops: [{ t: 'part', page: 1, field: 'skipped', value: true }] }
        }),
      403,
      '参与者不能改歌曲信息'
    )
    await expectError(
      () => api('DELETE', `/sessions/${sessionId}`, { headers: { 'x-participant-token': tokenA } }),
      403,
      '参与者不能删期次'
    )

    console.log('\n[5] 分数校验：范围 / 小数')
    await expectError(
      () =>
        api('PUT', `/sessions/${sessionId}/part/1`, {
          headers: { 'x-participant-token': tokenA },
          body: { person: '小林', score: 999 }
        }),
      400,
      '超出 1~10 的分数被拒绝'
    )
    await expectError(
      () =>
        api('PUT', `/sessions/${sessionId}/part/1`, {
          headers: { 'x-participant-token': tokenA },
          body: { person: '小林', score: -1 }
        }),
      400,
      '低于下限的分数被拒绝'
    )
    const half = await api('PUT', `/sessions/${sessionId}/part/1`, {
      headers: { 'x-participant-token': tokenA },
      body: { person: '小林', score: 8.46 }
    })
    eq(half.scores['小林'], 8.5, '允许一位小数，多余位四舍五入')

    console.log('\n[6] 核心回归：主持人改短评不会覆盖朋友刚写的分数')
    const before = await api('GET', `/sessions/${sessionId}`, { headers: hostHeaders })
    await api('PUT', `/sessions/${sessionId}/part/1`, {
      headers: { 'x-participant-token': tokenB },
      body: { person: '阿伟', score: 7 }
    })
    // 主持人仍然拿"改短评前"的旧版本整份自动保存 → 服务端只合并短评字段
    const meta = await api('PUT', `/sessions/${sessionId}`, {
      headers: hostHeaders,
      body: { ...before, comment: '朋友新分数之前的旧画面' }
    })
    ok(meta.saved, '旧工作台整期回写不再覆盖分数')
    const after = await api('GET', `/sessions/${sessionId}`, { headers: hostHeaders })
    eq(after.parts[0].scores['阿伟'], 7, '朋友的新分数仍在')
    eq(after.parts[0].comment, '', '整期回写也不再改全场短评（只认白名单元信息）')

    console.log('\n[7] 字段级 patch + 版本冲突')
    const state = await api('GET', `/sessions/${sessionId}`, { headers: hostHeaders })
    const baseRev = state.rev
    // 朋友先写维度分
    await api('PUT', `/sessions/${sessionId}/part/1`, {
      headers: { 'x-participant-token': tokenB },
      body: { person: '阿伟', dim: 'body', score: 6 }
    })
    // 主持人基于旧版本只提交"短评"这一格
    const patched = await api('PUT', `/sessions/${sessionId}/patch`, {
      headers: hostHeaders,
      body: {
        baseRev,
        ops: [
          { t: 'part', page: 1, field: 'comment', value: '全场短评：好听', old: '' },
          { t: 'score', page: 1, person: '小林', value: 9, old: 8.5 }
        ]
      }
    })
    ok(patched.changed >= 1, 'patch 成功写入')
    ok(patched.conflict === true, '版本号变化会被标记（但仍按字段合并）')
    const merged = await api('GET', `/sessions/${sessionId}`, { headers: hostHeaders })
    eq(merged.parts[0].scores['阿伟'], 7, '朋友的分数不受影响')
    eq(merged.parts[0].dimScores.body['阿伟'], 6, '朋友的维度分不受影响')
    eq(merged.parts[0].comment, '全场短评：好听', '主持人短评已保存')
    eq(merged.parts[0].scores['小林'], 9, '主持人改的分已保存')

    // 同一个格子被两头同时改：后写覆盖，并报告冲突
    const conflictRes = await api('PUT', `/sessions/${sessionId}/patch`, {
      headers: hostHeaders,
      body: {
        baseRev: patched.rev,
        ops: [{ t: 'score', page: 1, person: '阿伟', value: 5, old: 7 }]
      }
    })
    eq(conflictRes.conflicts.length, 0, 'old 与服务器一致时不算冲突')
    await api('PUT', `/sessions/${sessionId}/part/1`, {
      headers: { 'x-participant-token': tokenA },
      body: { person: '小林', score: 8 }
    })
    const sameField = await api('PUT', `/sessions/${sessionId}/patch`, {
      headers: hostHeaders,
      body: {
        baseRev: conflictRes.rev,
        ops: [{ t: 'score', page: 1, person: '小林', value: 10, old: 9 }]
      }
    })
    eq(sameField.conflicts.length, 1, '同一格被抢改会返回冲突详情')
    eq(sameField.conflicts[0].serverValue, 8, '冲突里带服务器当前值')

    console.log('\n[8] 当前曲 / 独立揭晓')
    const stage = await api('PUT', `/sessions/${sessionId}/stage`, {
      headers: hostHeaders,
      body: { currentPage: 2, blind: true }
    })
    eq(stage.stage.currentPage, 2, '主持人指定当前曲为 P2')
    const sheetAsB = await api('GET', `/sessions/${sessionId}`, {
      headers: { 'x-participant-token': tokenB }
    })
    eq(sheetAsB.stage.currentPage, 2, '手机端能拿到当前曲')
    eq(sheetAsB.stage.blind, true, '独立评分模式开启')
    eq(sheetAsB.stage.revealed, false, '未揭晓')
    const revealed = await api('PUT', `/sessions/${sessionId}/stage`, {
      headers: hostHeaders,
      body: { revealed: true }
    })
    eq(revealed.stage.revealed, true, '主持人揭晓')
    const nextStage = await api('PUT', `/sessions/${sessionId}/stage`, {
      headers: hostHeaders,
      body: { currentPage: 1 }
    })
    eq(nextStage.stage.revealed, false, '独立评分切到下一首时重新隐藏分数')
    const privateReply = await api('PUT', `/sessions/${sessionId}/part/1`, {
      headers: { 'x-participant-token': tokenA },
      body: { person: '小林', fav: true }
    })
    eq(Object.keys(privateReply.scores), ['小林'], '写入响应也只返回自己的分数')

    console.log('\n[9] 漏评 / 结束锁定 / 重新开放')
    const finishErr = await expectError(
      () => api('POST', `/sessions/${sessionId}/finish`, { headers: hostHeaders, body: {} }),
      409,
      '有漏评时结束需要确认'
    )
    ok(
      finishErr.body.missing.length >= 1 && finishErr.body.missing[0].missing.length >= 1,
      '返回漏评清单',
      finishErr.body
    )
    const finished = await api('POST', `/sessions/${sessionId}/finish`, {
      headers: hostHeaders,
      body: { force: true }
    })
    ok(finished.done && finished.missingCount >= 1, '强制结束后记录漏评数')
    await expectError(
      () =>
        api('PUT', `/sessions/${sessionId}/part/1`, {
          headers: { 'x-participant-token': tokenA },
          body: { person: '小林', score: 9 }
        }),
      409,
      '结束后参与者不能再改分'
    )
    await expectError(
      () =>
        api('PUT', `/sessions/${sessionId}/patch`, {
          headers: hostHeaders,
          body: { ops: [{ t: 'score', page: 1, person: '小林', value: 9 }] }
        }),
      409,
      '结束后主持人也先锁定'
    )
    await expectError(
      () => api('POST', `/sessions/${sessionId}/import`, {
        headers: hostHeaders,
        body: { app: 'oped-party-sheet', sessionId, person: '小林', scores: { 1: 3 } }
      }),
      409,
      '结束后导入离线打分单也不能绕过锁定'
    )
    const reopened = await api('POST', `/sessions/${sessionId}/reopen`, { headers: hostHeaders })
    eq(reopened.done, false, '主持人可以重新开放')

    console.log('\n[10] 二维码 / 邀请信息')
    const info = await api('GET', `/join/${sessionId}`)
    eq(info.pinRequired, true, '加入页知道需要口令')
    eq(info.memberCount, 2, '加入页显示成员数')
    const svg = await fetch(`${BASE}/qr?text=${encodeURIComponent('https://example.com/#/join/x')}`, {
      headers: hostHeaders
    })
    const svgText = await svg.text()
    ok(svg.ok && svgText.includes('<svg'), '二维码接口返回 SVG')
    await expectError(
      () =>
        fetch(`${BASE}/qr?text=abc`, {
          headers: { 'x-forwarded-for': '203.0.113.9' }
        }).then(async r => {
          if (!r.ok) throw new ApiError(r.status, await r.json())
          return r
        }),
      403,
      '二维码接口仅主持人可用'
    )

    console.log('\n[11] 离线打分单 / 报告：使用本场成员 + Cookie 兜底')
    const htmlRes = await fetch(`${BASE}/sessions/${sessionId}/sheet`, { headers: hostHeaders })
    const html = await htmlRes.text()
    ok(html.includes('小林') && html.includes('阿伟'), '打分单包含本场成员')
    ok(html.includes('"persons":["小林","阿伟"]'), '打分单不再使用全局设置成员')
    const reportByCookie = await fetch(`${BASE}/sessions/${sessionId}/report/json`, {
      headers: { 'x-forwarded-for': '203.0.113.9', cookie: `oped_host=${hostKey}` }
    })
    ok(reportByCookie.ok, '远端主持人用 Cookie 可以打开报告下载链接')
    const reportAnon = await fetch(`${BASE}/sessions/${sessionId}/report/json`, {
      headers: { 'x-forwarded-for': '203.0.113.9' }
    })
    ok(reportAnon.status === 403, '普通转发请求不能下载报告')

    console.log('\n[12] 旧版整期回写不会抹掉分数（兼容保护）')
    const stale = { ...merged, parts: merged.parts.map(p => ({ ...p, scores: {} })) }
    await api('PUT', `/sessions/${sessionId}`, { headers: hostHeaders, body: stale })
    const safe = await api('GET', `/sessions/${sessionId}`, { headers: hostHeaders })
    eq(safe.parts[0].scores['阿伟'], 5, '整期回写里的空分数被忽略')

    console.log('\n[13] AI 后台任务完成时保留新评分和结束状态（本地模拟服务）')
    let respondToAi
    let aiArrived
    let aiContent = '本地验收锐评'
    const received = new Promise(resolve => { aiArrived = resolve })
    const provider = http.createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        respondToAi = () => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ choices: [{ message: { content: aiContent } }] }))
        }
        aiArrived()
      })
    })
    await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve))
    try {
      await api('PUT', '/ai/config', {
        headers: hostHeaders,
        body: { baseUrl: `http://127.0.0.1:${provider.address().port}`, apiKey: 'test-only' }
      })
      const task = api('POST', `/sessions/${sessionId}/ai-review`, { headers: hostHeaders })
      // 先确认 AI 请求已经取走旧快照，再修改评分并结束。
      await received
      await api('PUT', `/sessions/${sessionId}/part/1`, {
        headers: { 'x-participant-token': tokenB },
        body: { person: '阿伟', score: 9.5 }
      })
      await api('POST', `/sessions/${sessionId}/finish`, { headers: hostHeaders, body: { force: true } })
      respondToAi()
      await task
      const latest = await api('GET', `/sessions/${sessionId}`, { headers: hostHeaders })
      eq(latest.parts[0].scores['阿伟'], 9.5, 'AI 返回后保留期间新交的分数')
      eq(latest.done, true, 'AI 返回后保持结束锁定')
      eq(latest.aiReviews[0].text, '本地验收锐评', 'AI 结果正常保存')

      await expectError(
        () => api('POST', `/sessions/${sessionId}/ai-parse`, { headers: { 'x-participant-token': tokenA } }),
        403,
        '朋友不能调用付费 AI 标题识别'
      )
      const parseReceived = new Promise(resolve => { aiArrived = resolve })
      aiContent = JSON.stringify({ list: latest.parts.map((p, i) => ({ page: i + 1, kind: 'OP', anime: '补全番名', song: '补全曲名', artist: '补全歌手' })) })
      const parsing = api('POST', `/sessions/${sessionId}/ai-parse`, { headers: hostHeaders })
      await parseReceived
      await api('POST', `/sessions/${sessionId}/reopen`, { headers: hostHeaders })
      await api('PUT', `/sessions/${sessionId}/part/1`, {
        headers: { 'x-participant-token': tokenA }, body: { person: '小林', score: 6.5 }
      })
      await api('PUT', `/sessions/${sessionId}/patch`, { headers: hostHeaders, body: {
        ops: [{ t: 'part', page: 1, field: 'parsed', value: { kind: 'ED', anime: '手动番名', song: '手动曲名', artist: '手动歌手' } }]
      } })
      await api('POST', `/sessions/${sessionId}/finish`, { headers: hostHeaders, body: { force: true } })
      respondToAi()
      await parsing
      const parsed = await api('GET', `/sessions/${sessionId}`, { headers: hostHeaders })
      eq(parsed.parts[0].scores['小林'], 6.5, 'AI 标题识别不覆盖期间新评分')
      eq(parsed.parts[0].parsed.song, '手动曲名', 'AI 标题识别保留期间人工修正')
      eq(parsed.done, true, 'AI 标题识别不回退结束状态')
    } finally {
      provider.closeAllConnections()
      await new Promise(resolve => provider.close(resolve))
    }

    await api('PUT', '/ncm/playlist', { headers: hostHeaders, body: { playlistId: '123' } })
    ok(fs.existsSync(path.join(DATA, 'ncm-auth.json')), '网易云配置同样写入隔离数据目录')

    console.log('\n[14] 合并回归：本期快照、房间成员、手机配置和写分范围一致')
    const scoped = await api('POST', '/sessions', { headers: hostHeaders, body: {
      mode: 'manual', name: '本期快照回归', lines: ['独立曲目']
    } })
    const settings = {
      persons: ['房主', '朋友'],
      dimensions: [{ key: 'tone', name: '本期音色', weight: 100, enabled: true }],
      tags: ['本期标签'], scoreMin: 0, scoreMax: 20
    }
    const metadata = await api('PUT', `/sessions/${scoped.id}`, { headers: hostHeaders, body: { settings } })
    eq(metadata.members, settings.persons, '本期设置修改参与人会同步房间名单')
    const guest = await api('POST', `/sessions/${scoped.id}/join`, { body: { person: '朋友', pin: scoped.pin } })
    const guestHeaders = { 'x-participant-token': guest.token }
    eq(guest.session.settings.scoreMax, 20, '朋友加入响应携带本期分数范围')
    eq(guest.session.settings.dimensions[0].key, 'tone', '朋友能读取本期自定义维度')
    const global = await api('GET', '/config')
    await api('PUT', '/config', { headers: hostHeaders, body: { ...global, scoreMax: 5 } })
    const own = await api('PUT', `/sessions/${scoped.id}/part/1`, {
      headers: guestHeaders, body: { person: '朋友', score: 18.5 }
    })
    eq(own.scores['朋友'], 18.5, '改全局后仍按本期 0~20 分写入')
    const dimResult = await api('PUT', `/sessions/${scoped.id}/patch`, { headers: guestHeaders, body: {
      ops: [{ t: 'dim', page: 1, person: '朋友', dim: 'tone', value: 17 }]
    } })
    eq(dimResult.changed, 1, '字段级保存接受本期新维度')
    const imported = await api('POST', `/sessions/${scoped.id}/import`, { headers: hostHeaders, body: {
      app: 'oped-party-sheet', sessionId: scoped.id, person: '房主', scores: { 1: 15.5 }
    } })
    eq(imported.invalid, 0, '离线导入同样按本期范围校验')
    const configless = { ...settings, dimensions: [] }
    await api('PUT', `/sessions/${scoped.id}`, { headers: hostHeaders, body: { settings: configless } })
    const report = await api('GET', `/sessions/${scoped.id}/report/json`, { headers: hostHeaders })
    eq(report.config.dimensions, [], '仅打总分时不回退到全局维度')
    const roster = await api('PUT', `/sessions/${scoped.id}`, { headers: hostHeaders, body: { members: ['房主', '朋友', '新朋友'] } })
    eq(roster.settings.persons, roster.members, '房间成员修改也同步设置页名单')
    await api('PUT', `/sessions/${scoped.id}`, { headers: hostHeaders, body: { followGlobal: true } })
    await expectError(() => api('PUT', `/sessions/${scoped.id}/part/1`, {
      headers: guestHeaders, body: { person: '朋友', score: 8 }
    }), 400, '切回跟随全局后使用全局上限')
    const followed = await api('GET', `/sessions/${scoped.id}`, { headers: guestHeaders })
    eq(followed.followGlobal, true, '手机端能同步跟随全局开关')
    eq(followed.members, ['房主', '朋友', '新朋友'], '跟随全局不会改掉本场成员')
    await api('PUT', `/sessions/${scoped.id}`, { headers: hostHeaders, body: { noGlobal: true } })
    const aggregate = await api('GET', '/reports/all/json', { headers: hostHeaders })
    ok(!aggregate.sessions.some(s => s.id === scoped.id), '临时场正确排除出全期总榜')
    await api('PUT', '/config', { headers: hostHeaders, body: global })
  } finally {
    child.kill()
    await wait(200)
    fs.rmSync(DATA, { recursive: true, force: true })
  }

  console.log(`\n结果：${passed} 通过，${failed} 失败`)
  if (failed) {
    console.error('\n--- server log ---\n' + logs)
    process.exitCode = 1
  }
}

main().catch(e => {
  console.error(e)
  process.exitCode = 1
})
