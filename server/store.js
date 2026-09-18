import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const DATA_DIR = path.join(ROOT, 'data')
const CONFIG_PATH = path.join(DATA_DIR, 'config.json')
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions')
const CACHE_DIR = path.join(DATA_DIR, 'cache')

for (const dir of [DATA_DIR, SESSIONS_DIR, CACHE_DIR]) {
  fs.mkdirSync(dir, { recursive: true })
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return fallback
  }
}

export function writeJson(filePath, data) {
  const tmp = filePath + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, filePath)
}

// 沙隆标签库：给"工业套路 vs 本格表达"的情绪留档位（出题人点名的四个必须在内）
export const SALON_TAGS = [
  '本格anisong',
  '神级应景',
  '工业糖精',
  '拼好曲式-生硬',
  '拼好曲式-浑然天成',
  'VOCALOID味',
  '情怀暴击',
  '反套路',
  '制作糙但真情'
]
const CLASSIC_TAGS = ['神曲', '洗脑', '神割切', '意难平', '燃', '温柔', '电波', '毒性']

export const DEFAULT_CONFIG = {
  persons: [],
  // 沙隆三维度：权重只是"参考坐标系"，不参与总分计算——总分是每人的主观总评
  dimensions: [
    {
      key: 'body',
      name: '音乐本体',
      desc: '抽掉画面它还站不站得住——旋律、编曲、演唱本身的听感冲击',
      weight: 50,
      enabled: true
    },
    {
      key: 'fit',
      name: '音画定制',
      desc: '它是不是为这部番"长"出来的——应景、割切时机、与画面互文的定制完成度',
      weight: 30,
      enabled: true
    },
    {
      key: 'resonance',
      name: '本格共鸣',
      desc: '真诚度探测：是表达还是套路糖精——糙但真情可以高分，精致但工业可以低分',
      weight: 20,
      enabled: true
    }
  ],
  tags: [...SALON_TAGS, ...CLASSIC_TAGS],
  tagsRev: 2,
  scoreMin: 1,
  scoreMax: 10
}

// 老配置兼容：补权重/说明；出厂旧三件套（编曲/vocal/画面）整体升级为沙龙三维度；
// 标签库合并进沙隆推荐标签（tagsRev 标记只做一次，之后尊重用户增删）
export function normalizeConfig(cfg) {
  cfg.persons = Array.isArray(cfg.persons) ? cfg.persons : []
  cfg.dimensions = Array.isArray(cfg.dimensions) ? cfg.dimensions : []
  cfg.tags = Array.isArray(cfg.tags) ? cfg.tags : []
  const legacy = new Set(['arrange', 'vocal', 'visual'])
  if (
    cfg.dimensions.length === 3 &&
    cfg.dimensions.every(d => legacy.has(d.key))
  ) {
    cfg.dimensions = structuredClone(DEFAULT_CONFIG.dimensions)
  }
  const n = cfg.dimensions.length
  for (const d of cfg.dimensions) {
    if (typeof d.weight !== 'number' || !(d.weight > 0)) d.weight = n ? Math.round(100 / n) : 0
    if (typeof d.desc !== 'string') d.desc = ''
  }
  if (cfg.tagsRev !== 2) {
    for (const t of SALON_TAGS) if (!cfg.tags.includes(t)) cfg.tags.push(t)
    cfg.tagsRev = 2
  }
  if (typeof cfg.scoreMin !== 'number') cfg.scoreMin = 1
  if (typeof cfg.scoreMax !== 'number') cfg.scoreMax = 10
  return cfg
}

export function loadConfig() {
  const cfg = readJson(CONFIG_PATH, null)
  if (!cfg) {
    writeJson(CONFIG_PATH, DEFAULT_CONFIG)
    return structuredClone(DEFAULT_CONFIG)
  }
  const before = JSON.stringify(cfg)
  normalizeConfig(cfg)
  if (JSON.stringify(cfg) !== before) writeJson(CONFIG_PATH, cfg)
  return cfg
}

export function saveConfig(cfg) {
  writeJson(CONFIG_PATH, normalizeConfig(cfg))
  return cfg
}

export function listSessions() {
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => readJson(path.join(SESSIONS_DIR, f), null))
    .filter(Boolean)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
}

export function getSession(id) {
  return readJson(path.join(SESSIONS_DIR, `${id}.json`), null)
}

export function saveSession(session) {
  writeJson(path.join(SESSIONS_DIR, `${session.id}.json`), session)
  return session
}

export function deleteSession(id) {
  const p = path.join(SESSIONS_DIR, `${id}.json`)
  if (fs.existsSync(p)) fs.unlinkSync(p)
}

export function newSessionId() {
  return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export const CACHE = { dir: CACHE_DIR }
