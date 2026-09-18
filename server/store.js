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

export const DEFAULT_CONFIG = {
  persons: [],
  dimensions: [
    { key: 'arrange', name: '编曲', enabled: true },
    { key: 'vocal', name: 'vocal', enabled: true },
    { key: 'visual', name: '画面', enabled: true }
  ],
  tags: ['神曲', '洗脑', '神割切', '意难平', '燃', '温柔', '电波', '毒性'],
  scoreMin: 1,
  scoreMax: 10
}

export function loadConfig() {
  const cfg = readJson(CONFIG_PATH, null)
  if (!cfg) {
    writeJson(CONFIG_PATH, DEFAULT_CONFIG)
    return structuredClone(DEFAULT_CONFIG)
  }
  return cfg
}

export function saveConfig(cfg) {
  writeJson(CONFIG_PATH, cfg)
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
