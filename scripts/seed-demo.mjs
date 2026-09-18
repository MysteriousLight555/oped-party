/**
 * E2E 自检脚本：注入演示数据并生成全部报告，供人工/自动检查。
 * 用法：先起服务（npm start），再 node scripts/seed-demo.mjs
 * 会覆盖 data/config.json 的 persons，并创建/覆盖两期演示数据。
 * 演示数据刻意构造了四种"反差打分"场景（总分独立于维度参考）：
 *   ① 编曲差点意思但情投意合 → Δ 正（本格溢价）
 *   ② 不像 anisong 但神级应景 → Δ 正
 *   ③ 写得非常 anisong 但该突出的没突出 → Δ 负
 *   ④ 合格甚至优秀但工业糖精齁人 → Δ 负 + 争议指数 🔥
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

// 1. 配置：沙龙三维度（权重只是参考坐标）+ 老饕标签库
const config = await req('PUT', '/api/config', {
  persons: ['阿伟', '小林', '老张'],
  dimensions: [
    { key: 'body', name: '音乐本体', desc: '抽掉画面它还站不站得住——旋律、编曲、演唱的听感冲击', weight: 50, enabled: true },
    { key: 'fit', name: '音画定制', desc: '是不是为这部番"长"出来的——应景、割切、与画面互文', weight: 30, enabled: true },
    { key: 'resonance', name: '本格共鸣', desc: '真诚度探测：是表达还是套路糖精', weight: 20, enabled: true }
  ],
  tags: [
    '本格anisong', '神级应景', '工业糖精', '拼好曲式-生硬', '拼好曲式-浑然天成',
    'VOCALOID味', '情怀暴击', '反套路', '制作糙但真情', '神曲', '洗脑', '神割切', '意难平', '燃'
  ],
  scoreMin: 1,
  scoreMax: 10
})
console.log('config OK, persons:', config.persons.join('、'))
console.log('config dims:', config.dimensions.map(d => `${d.name}${d.weight}%`).join(' / '))

// 2. 建期：优先 BV 拉分P，失败（离线）则退化为手动列表
const FALLBACK_LINES = [
  '先行OP 迷家「晕不了的恋情」三森铃子',
  '正式OP 葬送的芙莉莲「勇者」YOASOBI',
  '正式ED 孤独摇滚！「回转する恋」	end褶皱',
  '【主题曲】澈底对你成瘾「成瘾／ADDICTED」久慈明仁 (CV.阿座上洋平)',
  '正式OP 咒术回战第三季「甲贺忍法帖」htt',
  '正式ED 药屋少女的呢喃「小小灯影／ひとともし」ハルカトミユキ',
  '正式OP 无职转生III「spiral」LONGMAN',
  '正式ED 我推的孩子第二季「 collapsing world 」',
  '菜单 制作名单',
  '正式OP 帷子「绫」]'
]
let s1
try {
  s1 = await req('POST', '/api/sessions', {
    mode: 'bvid',
    bvid: 'BV1bFTB6GEjW',
    name: '2026年7月新番OP&ED鉴赏会'
  })
  console.log(`期1「${s1.name}」 parts=${s1.parts.length} videoTitle=${s1.videoTitle}`)
} catch (e) {
  console.log('BV 拉取失败（可能离线），改用手动列表：', e.message)
  s1 = await req('POST', '/api/sessions', {
    mode: 'manual',
    name: '2026年7月新番OP&ED鉴赏会（演示）',
    manualTitle: '手动导入演示合集',
    lines: FALLBACK_LINES
  })
  console.log(`期1（手动）parts=${s1.parts.length}`)
}

// 3. 四种反差场景 + 常规曲
const persons = config.persons
const D = config.dimensions.map(d => d.key)

// setter：person -> { t: 总分, d: [维度分按配置顺序], tags: [], c: 短评 }
function scorePart(p, spec) {
  for (const pn of persons) {
    const it = spec[pn]
    if (!it) continue
    p.scores[pn] = it.t
    D.forEach((dk, i) => {
      if (it.d && it.d[i] != null) {
        p.dimScores[dk] = p.dimScores[dk] || {}
        p.dimScores[dk][pn] = it.d[i]
      }
    })
    if (it.tags?.length) p.personTags[pn] = it.tags
    if (it.c) p.personComments[pn] = it.c
  }
  const collective = Object.values(spec).find(x => x.all)
  if (collective) {
    p.tags = collective.allTags || p.tags
    p.comment = collective.all || p.comment
  }
}

const [s1a, s1b, s1c, s1d, ...rest] = s1.parts

// ① 编曲差点意思，但情投意合 → Δ 正
scorePart(s1a, {
  阿伟: { t: 9, d: [5, 5, 6], tags: ['情怀暴击', '制作糙但真情'], c: '编曲是糙了点，但这份少年感我买单' },
  小林: { t: 8, d: [6, 5, 7], tags: ['情怀暴击'] },
  老张: { t: 9, d: [5, 6, 7], c: '十年了还是会被这种笨拙的真诚打中' },
  all: '情怀局，技术放一边',
  allTags: ['情怀暴击']
})

// ② 不像 anisong，但应景到骨子里 → Δ 正
scorePart(s1b, {
  阿伟: { t: 9, d: [5, 9, 8], tags: ['神级应景', '反套路'], c: '这歌根本不像OP，可它就是这部番本身' },
  小林: { t: 8, d: [6, 9, 7], tags: ['神级应景'] },
  老张: { t: 9, d: [5, 10, 8], c: '割切那一刻起鸡皮疙瘩，定制服务的天花板' },
  allTags: ['神级应景']
})

// ③ 写得非常 anisong，但该突出的没突出 → Δ 负
scorePart(s1c, {
  阿伟: { t: 5, d: [8, 6, 6], tags: ['拼好曲式-生硬'], c: '段落全是正确答案，拼起来谁也不让谁' },
  小林: { t: 6, d: [8, 7, 5], tags: ['拼好曲式-生硬'] },
  老张: { t: 5, d: [7, 5, 6], c: '副歌该炸的地方被画面盖没了，可惜' },
  all: '标准 anisong 工艺，但没记住任何一段',
  allTags: ['拼好曲式-生硬']
})

// ④ 合格甚至优秀，但工业糖精齁得慌 → Δ 负 + 争议（老张就吃这套）
scorePart(s1d, {
  阿伟: { t: 4, d: [8, 7, 5], tags: ['工业糖精', 'VOCALOID味'], c: '每一秒都对，加起来就是不对，甜到发苦' },
  小林: { t: 5, d: [7, 8, 5], tags: ['工业糖精'] },
  老张: { t: 9, d: [8, 8, 8], c: '我不管，这旋律就是好听，糖精也是糖' },
  allTags: ['工业糖精']
})

// 其余曲子：只评 8 首、低方差随机（避免稀释四个场景的争议排名）
function r(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
rest.slice(0, 8).forEach(p => {
  if (p.title.includes('菜单') || p.title.includes('名单')) {
    p.skipped = true
    return
  }
  for (const pn of persons) {
    const base = r(6, 9)
    p.scores[pn] = Math.min(10, base + r(-1, 1))
    D.forEach(dk => {
      p.dimScores[dk] = p.dimScores[dk] || {}
      p.dimScores[dk][pn] = Math.min(10, base + r(-1, 1))
    })
  }
  p.favorites = persons.filter(() => Math.random() < 0.4)
  p.tags = [config.tags[r(0, config.tags.length - 1)]]
  if (Math.random() < 0.5) p.personTags[persons[0]] = [config.tags[r(0, config.tags.length - 1)]]
})

await req('PUT', `/api/sessions/${s1.id}`, s1)
console.log('期1 已注入四场景 + 常规评分')

// 4. 第二期（手动导入，歌手与期1重叠，验证跨期去重）
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
    const base = r(5, 9)
    p.scores[pn] = Math.min(10, base + r(-1, 1))
    D.forEach(dk => {
      p.dimScores[dk] = p.dimScores[dk] || {}
      p.dimScores[dk][pn] = Math.min(10, base + r(-1, 1))
    })
  }
  if (i === 1) {
    p.favorites = ['阿伟', '老张']
    p.personTags['阿伟'] = ['本格anisong']
  }
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
await grab(`/api/sessions/${s1.id}/sheet`, '期1-打分单.html')
await grab('/api/reports/all/html', '全期总榜.html')
await grab('/api/reports/all/md', '全期总榜.md')
await grab('/api/reports/all/xlsx', '全期总榜.xlsx')

// 7. 反差/争议体系断言
const md = fs.readFileSync(path.join(OUT, '期1-排行榜.md'), 'utf-8')
const checks = {
  '总榜含「争议」列': md.includes('争议'),
  '总榜含「反差」列': md.includes('反差'),
  '含争议焦点版块': md.includes('争议焦点'),
  '含反差榜版块': md.includes('反差榜'),
  '含标签情绪统计': md.includes('标签情绪统计'),
  '含个人标签（工业糖精）': md.includes('工业糖精'),
  '含个人注解': md.includes('甜到发苦')
}
let pass = true
for (const [k, v] of Object.entries(checks)) {
  console.log(`${v ? '✓' : '✗'} ${k}`)
  if (!v) pass = false
}

// 8. 维度隐藏联动检查：关掉「音画定制」后报告不应出现该维度
await req('PUT', '/api/config', {
  ...config,
  dimensions: config.dimensions.map(d => (d.key === 'fit' ? { ...d, enabled: false } : d))
})
await grab(`/api/sessions/${s1.id}/report/md`, '期1-无音画定制维度.md')
const mdNoFit = fs.readFileSync(path.join(OUT, '期1-无音画定制维度.md'), 'utf-8')
const fitHidden = !mdNoFit.includes('音画定制均分')
console.log(`${fitHidden ? '✓' : '✗'} 隐藏「音画定制」后报告不再出现该维度`)
if (!fitHidden) pass = false
// 还原
await req('PUT', '/api/config', config)

if (!pass) {
  console.error('\n有断言未通过！')
  process.exit(1)
}
console.log('\n全部检查通过。报告样例在 data/tmp-check/ 供人工查看。')
