/** AI 锐评（DeepSeek，OpenAI 兼容接口）
 *  - 配置存 data/ai.json（已 gitignore）：Key 不进 config.json、不随任何 /api/config 下发
 *  - 只在用户点「AI 锐评 / 测试连接」时按需调用，把聚合后的打分统计发给模型
 */

import { DATA_DIR, readJson, writeJson } from './store.js'
import path from 'node:path'
import { songTitle } from './stats.js'

const AI_PATH = path.join(DATA_DIR, 'ai.json')

// 模型名默认按需求 deepseek-flash；官方 API 若无此名会报 404，错误信息里会提示可改的官方模型名
const DEFAULT_AI = {
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
  apiKey: '',
  anonymize: false
}

export function loadAiConfig() {
  return { ...DEFAULT_AI, ...readJson(AI_PATH, {}) }
}

export function saveAiConfig(body = {}) {
  const cur = loadAiConfig()
  const next = { ...cur }
  if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
    next.baseUrl = body.baseUrl.trim().replace(/\/+$/, '')
  }
  if (typeof body.model === 'string' && body.model.trim()) next.model = body.model.trim()
  if (body.anonymize !== undefined) next.anonymize = !!body.anonymize
  if (body.clearKey) next.apiKey = ''
  else if (typeof body.apiKey === 'string' && body.apiKey.trim()) next.apiKey = body.apiKey.trim()
  writeJson(AI_PATH, next)
  return next
}

/** 对外只给掩码，绝不明文回传 Key */
export function aiInfo(ai) {
  const k = ai.apiKey || ''
  return {
    baseUrl: ai.baseUrl,
    model: ai.model,
    anonymize: !!ai.anonymize,
    hasKey: !!k,
    keyMasked: k ? `${k.slice(0, 3)}***${k.slice(-4)}` : ''
  }
}

async function chat(ai, { system, user, timeoutMs = 180000, jsonMode = false }) {
  if (!ai.apiKey) {
    throw new Error('尚未配置 API Key——请到「设置 → AI 分析」填写后再试')
  }
  const base = (ai.baseUrl || DEFAULT_AI.baseUrl).replace(/\/+$/, '')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const body = {
    model: ai.model || DEFAULT_AI.model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    stream: false
  }
  if (jsonMode) body.response_format = { type: 'json_object' }
  let res
  try {
    res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ai.apiKey}`
      },
      body: JSON.stringify(body),
      signal: ctrl.signal
    })
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('请求超时——模型响应太久，稍等再试一次')
    throw new Error(`无法连接 ${base}：${e.message}`)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) {
    let msg = ''
    try {
      const j = await res.json()
      msg = j.error?.message || j.message || JSON.stringify(j).slice(0, 300)
    } catch {
      msg = (await res.text().catch(() => '')).slice(0, 300)
    }
    if (res.status === 401) throw new Error('API Key 无效或已过期（401），请到设置页检查')
    if (res.status === 402) throw new Error('账户余额不足（402），请去服务商控制台充值')
    if (res.status === 404 || /not.?exist|not.?found|invalid model/i.test(msg)) {
      throw new Error(
        `模型「${ai.model}」不被该接口接受：${msg}。可在设置页改模型名（DeepSeek 官方常用 deepseek-chat / deepseek-reasoner，新版接口也可能是 deepseek-v4-flash 等）`
      )
    }
    if (res.status === 429) throw new Error('请求过于频繁（429），稍等片刻再试')
    throw new Error(`AI 接口报错 ${res.status}：${msg}`)
  }
  const data = await res.json()
  const text = data.choices?.[0]?.message?.content
  if (!text || !String(text).trim()) throw new Error('模型返回了空内容，请重试')
  return String(text).trim()
}

const SYSTEM_PROMPT = `你是资深 Anisong（动画音乐）鉴赏沙龙的常驻点评人。这群评分者是关注动画音乐数十年的老饕，不是大众评审：
- 总分是每人独立给出的主观总评，不与维度分换算；维度分（音乐本体/音画定制/本格共鸣）只是参考坐标。
- 反差 Δ = 主观总评 − 维度参考分：正=情怀溢价（"编曲差点意思但我情投意合"），负=套路压分（"写得再合格也齁得慌"）。
- 争议指数 = 大家总分的标准差，越大分歧越狠。
- 他们的骄傲：商业成功不等于好听。"工业糖精"该压就压，"糙但真情"该挺就挺，"神级应景"是定制服务的天花板。
- "工业糖精""拼好曲式-生硬""本格anisong"等标签是他们的情绪证词，点评时必须引用。`

function buildReviewData(session, st, config, anonymize) {
  const nameMap = new Map()
  if (anonymize) {
    ;(config.persons || []).forEach((p, i) => nameMap.set(p, `成员${String.fromCharCode(65 + i)}`))
  }
  const nm = p => nameMap.get(p) || p
  const fmt = x => (x == null ? undefined : Math.round(x * 10) / 10)
  const songs = st.ranked.map(r => {
    const p = r.part
    const per = Object.entries(r.persons || {})
      .filter(([, x]) => typeof x.score === 'number')
      .map(([who, x]) => {
        const bits = [`${nm(who)} ${x.score}`]
        if (x.div != null) bits.push(`Δ${x.div > 0 ? '+' : ''}${Math.round(x.div * 10) / 10}`)
        if (x.ref != null) bits.push(`(参考${x.ref})`)
        if (x.tags?.length) bits.push(`标签[${x.tags.join('/')}]`)
        if (x.comment) bits.push(`"${x.comment}"`)
        return bits.join(' ')
      })
      .join('；')
    return {
      曲: songTitle(p),
      歌手: p.parsed?.artist || undefined,
      作品: p.parsed?.anime || undefined,
      类型: p.parsed?.kind || undefined,
      均分: r.avg,
      反差: fmt(r.div),
      争议: r.voters.length >= 2 ? r.std : undefined,
      吵翻: r.hot || undefined,
      各人: per || undefined,
      全场标签: p.tags?.length ? p.tags.join('/') : undefined,
      全场短评: p.comment || undefined,
      收藏人数: r.favCount || undefined
    }
  })
  return {
    场次: session.name,
    日期: new Date(session.createdAt).toLocaleDateString('zh-CN'),
    维度权重: st.dims.map(d => `${d.name}${d.weight != null ? d.weight + '%' : ''}`).join('/'),
    争议热度线: st.hotLine,
    标签统计: st.tagStats.map(t => `${t.name}×${t.count}`).join('、') || undefined,
    未评首数: st.unscored.length || undefined,
    跳过首数: st.skipped.length || undefined,
    歌曲: songs
  }
}

const USER_TMPL = data => `请根据下面这场鉴赏会的真实打分数据，用中文写一篇锐评，结构如下（用 emoji 小标题分节）：

🏆 本场亮点 —— 结合前三名与反差值，不复述数字，给出"为什么"的解读
🔥 争议焦点 —— 挑争议指数最高的 2~3 首，结合每人的分数构成、标签、短评，解读分歧从何而来
⚖️ 反差解读 —— 点评本格溢价与套路罚分最有代表性的曲子，说透老饕的情绪
🎭 每人口味画像 —— 每人一小段（2~3 句）：出手分习惯、常用标签、是情怀党/糖精探测器/分奴/反套路卫士哪一路、和谁分歧最大
💊 一句话总评

要求：犀利、有梗、老饕口吻，不写客套话；必须引用具体歌名和标签；数据里没有的信息一个字都不要编；总长 500~800 字。

【本场数据 JSON】
${JSON.stringify(data)}`

export async function generateReview(session, st, config, ai) {
  const data = buildReviewData(session, st, config, ai.anonymize)
  if (!data.歌曲?.length) throw new Error('这一期还没有任何评分，先去打分再来生成锐评')
  const text = await chat(ai, { system: SYSTEM_PROMPT, user: USER_TMPL(data) })
  if (ai.anonymize) {
    text += `\n\n（已开启匿名化：成员A/B/C… 对应实际参与人的顺序）`
  }
  return text
}

export async function testConnection(ai) {
  const reply = await chat(ai, {
    system: '你是连通性测试员，只输出被要求的内容。',
    user: '请只回复四个字：连接成功',
    timeoutMs: 30000
  })
  return reply
}

// ---------- AI 标题识别：把分P标题批量结构化（正则解析的兜底） ----------

function extractJson(text) {
  const t = String(text)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim()
  try {
    return JSON.parse(t)
  } catch {
    /* 继续尝试截取 */
  }
  const m = t.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (m) {
    try {
      return JSON.parse(m[0])
    } catch {
      /* 放弃 */
    }
  }
  throw new Error('模型没有返回可解析的 JSON，请重试')
}

const PARSE_SYSTEM = `你是B站动画音乐合集视频的分P标题解析器。对每个标题解析出四个字段：
- kind：类型标记的原文，如 先行OP、正式ED2、OP、ED、插入曲、IN、主题曲、剧场版；标题里没有类型标记就给空字符串
- anime：作品/番剧名；没有或不确定就给空字符串
- song：曲名；解析不出就给整个标题
- artist：歌手/组合；没有或不确定就给空字符串
硬性规则：
1. 不确定的信息一律留空字符串，严禁编造或猜测番剧名、歌手名
2. 不要把视频标题、合集名、UP主名当成番剧名
3. 歌手可能有多个（顿号/斜杠分隔），原样保留
4. 只输出 JSON，格式 {"list":[{"page":1,"kind":"","anime":"","song":"","artist":""}...]}，list 的顺序和数量必须与输入标题一一对应`

export async function aiParseTitles(ai, titles) {
  const input = titles.map((t, i) => ({ page: i + 1, title: t }))
  const content = await chat(ai, {
    system: PARSE_SYSTEM,
    user: `分P标题数组：\n${JSON.stringify(input)}\n\n请输出解析结果 JSON。`,
    jsonMode: true
  })
  const data = extractJson(content)
  const list = Array.isArray(data) ? data : data.list
  if (!Array.isArray(list)) throw new Error('模型返回的 JSON 缺少 list 字段，请重试')
  return list.map((e, i) => ({
    page: i + 1,
    kind: String(e?.kind || '').trim(),
    anime: String(e?.anime || '').trim(),
    song: String(e?.song || '').trim(),
    artist: String(e?.artist || '').trim()
  }))
}
