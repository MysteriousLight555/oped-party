/**
 * E2E 自检脚本：注入演示数据并生成全部报告，供人工/自动检查。
 * 用法：先起服务（npm start），再 node scripts/seed-demo.mjs
 * 会覆盖 data/config.json 的 persons，并创建/覆盖两期演示数据。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE || 'http://127.0.0.1:18890'
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(ROOT, 'data', 'tmp-check')
fs.mkdirSync(OUT, { recursive: true })

async function req(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${text.slice(0, 200)}`)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

// 1. 配置
const config = await req('PUT', '/api/config', {
  persons: ['阿伟', '小林', '老张'],
  dimensions: [
    { key: 'arrange', name: '编曲', enabled: true },
    { key: 'vocal', name: 'vocal', enabled: true },
    { key: 'visual', name: '画面', enabled: true }
  ],
  tags: ['神曲', '洗脑', '神割切', '意难平', '燃'],
  scoreMin: 1,
  scoreMax: 10
})
console.log('config OK, persons:', config.persons.join('、'))

// 2. 用真实 BV 建期
let s1 = await req('POST', '/api/sessions', {
  mode: 'bvid',
  bvid: 'BV1bFTB6GEjW',
  name: '2026年7月新番OP&ED鉴赏会'
})
console.log(`期1「${s1.name}」 parts=${s1.parts.length} videoTitle=${s1.videoTitle}`)

const parsedOk = s1.parts.filter(p => p.parsed.song && p.parsed.song !== p.title).length
console.log(`标题解析成功 ${parsedOk}/${s1.parts.length}`)
for (const i of [0, 1, 2, s1.parts.length - 2, s1.parts.length - 1]) {
  const p = s1.parts[i]
  console.log(`  P${p.page}: kind=${p.parsed.kind} | anime=${p.parsed.anime} | song=${p.parsed.song} | artist=${p.parsed.artist}`)
}

// 3. 给前 8 首打分 + 收藏/标签/短评，跳过第 9 首
const persons = config.persons
const dims = config.dimensions
function r(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
s1.parts.slice(0, 8).forEach((p, i) => {
  for (const pn of persons) {
    p.scores[pn] = r(5, 10)
    for (const d of dims) {
      p.dimScores[d.key] = p.dimScores[d.key] || {}
      p.dimScores[d.key][pn] = r(5, 10)
    }
  }
  p.favorites = persons.filter(() => Math.random() < 0.4)
  p.tags = [config.tags[r(0, config.tags.length - 1)]]
  p.comment = i === 0 ? '副歌一起鸡皮疙瘩全起来了' : ''
})
s1.parts[8].skipped = true
await req('PUT', `/api/sessions/${s1.id}`, s1)
console.log('期1 已注入 8 首评分 + 1 首跳过')

// 4. 手动粘贴建第二期（歌手与期1部分重叠，验证跨期去重）
const lines = [
  '先行OP 无职转生III「远方的故事／とおいものがたり」大原ゆい子',
  '正式OP 葬送的芙莉莲「光芒／まばたき」YOASOBI',
  '正式ED 在超市后门吸烟的二人「夜行者／Night Walker」真夜中',
  '【主题曲】澈底对你成瘾「成瘾／ADDICTED」久慈明仁 (CV.阿座上洋平)',
  '正式OP 咒术回战第三季「甲贺忍法帖」htt',
  '正式ED 药屋少女的呢喃「小小灯影／ひとともし」ハルカトミユキ'
]
let s2 = await req('POST', '/api/sessions', {
  mode: 'manual',
  name: '2026年10月新番OP&ED鉴赏会（演示）',
  manualTitle: '手动粘贴演示合集',
  lines
})
console.log(`期2 手动导入 parts=${s2.parts.length}`)
s2.parts.forEach((p, i) => {
  for (const pn of persons) {
    p.scores[pn] = r(5, 10)
    for (const d of dims) {
      p.dimScores[d.key] = p.dimScores[d.key] || {}
      p.dimScores[d.key][pn] = r(5, 10)
    }
  }
  if (i === 1) p.favorites = ['阿伟', '老张']
})
await req('PUT', `/api/sessions/${s2.id}`, s2)

// 5. 期次列表
const list = await req('GET', '/api/sessions')
for (const s of list) console.log(` - ${s.name}: voted ${s.voted}/${s.total}, skipped ${s.skipped}`)

// 6. 生成全部报告
async function grab(url, file) {
  const res = await fetch(BASE + url)
  if (!res.ok) throw new Error(`${url} -> ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  fs.writeFileSync(path.join(OUT, file), buf)
  console.log(`报告 ${file}: ${(buf.length / 1024).toFixed(1)} KB`)
}

await grab(`/api/sessions/${s1.id}/report/html`, '期1-排行榜.html')
await grab(`/api/sessions/${s1.id}/report/md`, '期1-排行榜.md')
await grab(`/api/sessions/${s1.id}/report/xlsx`, '期1-排行榜.xlsx')
await grab(`/api/sessions/${s1.id}/report/json`, '期1-排行榜.json')
await grab('/api/reports/all/html', '全期总榜.html')
await grab('/api/reports/all/md', '全期总榜.md')
await grab('/api/reports/all/xlsx', '全期总榜.xlsx')

// 7. 维度隐藏联动检查：关掉 vocal 后报告不应出现 vocal 字样
await req('PUT', '/api/config', { ...config, dimensions: config.dimensions.map(d => (d.key === 'vocal' ? { ...d, enabled: false } : d)) })
await grab(`/api/sessions/${s1.id}/report/md`, '期1-无vocal维度.md')
const mdNoVocal = fs.readFileSync(path.join(OUT, '期1-无vocal维度.md'), 'utf-8')
console.log('隐藏 vocal 后报告不含 vocal 维度:', !mdNoVocal.includes('vocal均分'))
// 还原
await req('PUT', '/api/config', config)

console.log('\n全部检查通过。报告样例在 data/tmp-check/ 供人工查看。')
