/**
 * 网易云音乐开放平台集成：包装官方 CLI @music163/ncm-cli。
 * 凭证（appId/privateKey）由 ncm-cli 自己管理（config set），本模块绝不落盘、不回传密钥。
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { createRequire } from 'node:module'
import fs from 'node:fs'

const require_ = createRequire(import.meta.url)

let binPathCache = ''
function binPath() {
  if (!binPathCache) {
    const pkg = require_('@music163/ncm-cli/package.json')
    const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin['ncm-cli']
    binPathCache = path.join(path.dirname(require_.resolve('@music163/ncm-cli/package.json')), rel)
  }
  return binPathCache
}

/**
 * 执行 ncm-cli 子命令。CLI 退出时可能带 libuv assertion 噪音，
 * 因此以 stdout 是否有有效内容为主要成功判据。
 */
function runNcm(args, timeoutMs = 25000) {
  return new Promise(resolve => {
    let child
    let stdout = ''
    let stderr = ''
    let done = false
    try {
      child = spawn(process.execPath, [binPath(), ...args], {
        windowsHide: true,
        env: { ...process.env }
      })
    } catch (e) {
      resolve({ ok: false, error: `无法启动 ncm-cli：${e.message}` })
      return
    }
    const timer = setTimeout(() => {
      if (!done) {
        done = true
        child.kill()
        resolve({ ok: false, error: 'ncm-cli 执行超时' })
      }
    }, timeoutMs)
    child.stdout.on('data', d => (stdout += d.toString('utf-8')))
    child.stderr.on('data', d => (stderr += d.toString('utf-8')))
    child.on('error', e => {
      if (!done) {
        done = true
        clearTimeout(timer)
        resolve({ ok: false, error: e.message })
      }
    })
    child.on('close', () => {
      if (!done) {
        done = true
        clearTimeout(timer)
        const clean = s => s.replace(/Assertion failed:.*$/s, '').trim()
        resolve({ ok: true, stdout: clean(stdout), stderr: clean(stderr) })
      }
    })
  })
}

function firstLine(text) {
  return String(text || '').split('\n')[0].trim()
}

/** 探测 CLI 是否可用、凭证是否齐备（只回布尔，不回密钥） */
export async function ncmStatus() {
  const status = {
    installed: fs.existsSync(binPath()),
    appId: false,
    privateKey: false,
    player: '',
    mpv: false
  }
  if (!status.installed) return status
  const r = await runNcm(['config', 'list'], 15000)
  if (r.ok) {
    const out = r.stdout + '\n' + r.stderr
    status.appId = /appId:\s*\S+/i.test(out) && !/appId:\s*\(未配置\)/i.test(out)
    status.privateKey = !/privateKey:\s*(\(未配置\)|$)/im.test(out)
    const m = out.match(/player:\s*(\S+)/i)
    if (m && m[1] !== '(未配置)') status.player = m[1]
  }
  try {
    const w = spawn('where', ['mpv'], { windowsHide: true })
    let whereOut = ''
    w.stdout.on('data', d => (whereOut += d))
    await new Promise(res => {
      w.on('close', code => {
        status.mpv = code === 0 && whereOut.trim().length > 0
        res()
      })
      w.on('error', () => res())
    })
  } catch {
    /* where 不可用按未安装处理 */
  }
  return status
}

/** 从解析后的曲名里取最适合做搜索的关键词：优先「／」后的原文，剥离 CV 标注 */
export function searchKeyword(parsed) {
  const song = String(parsed?.song || '').trim()
  let name = song
  if (song.includes('／')) {
    const orig = song.split('／').slice(1).join('／').trim()
    if (orig) name = orig
  }
  let artist = String(parsed?.artist || '')
    .replace(/（?\(?\s*CV\s*[.：:）)]\s*[^)）]*\)）?/gi, '')
    .replace(/\s*&\s*$/, '')
    .trim()
  return { keyword: `${name} ${artist}`.trim(), name, artist }
}

/**
 * 从 search song 输出中解析第一条结果。
 * CLI 输出格式未完全公开：先试 JSON（数组或含 results/data 字段），失败退回文本行。
 */
export function parseSearchOutput(out) {
  if (!out) return null
  // 1) 整体 JSON
  try {
    const j = JSON.parse(out)
    const arr = Array.isArray(j) ? j : j.results || j.data || j.songs || []
    const first = Array.isArray(arr) ? arr[0] : null
    if (first && (first.id || first.songId || first.encryptedId)) return normalizeSong(first)
  } catch {
    /* 不是整体 JSON，继续 */
  }
  // 2) 文本中夹 JSON
  const jsonMatch = out.match(/[[{][\s\S]*[\]}]/)
  if (jsonMatch) {
    try {
      const j = JSON.parse(jsonMatch[0])
      const arr = Array.isArray(j) ? j : j.results || j.data || j.songs || []
      const first = Array.isArray(arr) ? arr[0] : null
      if (first && (first.id || first.songId || first.encryptedId)) return normalizeSong(first)
    } catch {
      /* 继续 */
    }
  }
  // 3) 纯文本行：期望含 song?id=<数字> 或 「序号. 曲名 - 歌手 <id:数字>」类格式
  const lines = out.split('\n').filter(l => l.trim())
  for (const line of lines) {
    const idm = line.match(/song\?id=(\d+)/) || line.match(/#\/song\?id=(\d+)/) || line.match(/\bid[:=]\s*"?(\d{6,})"?/)
    if (idm) {
      return {
        id: idm[1],
        name: line.replace(/song\?id=\d+/, '').replace(/[|｜]/, ' - ').trim().slice(0, 120),
        artist: ''
      }
    }
  }
  for (const line of lines) {
    // 形如 "1. 曲名 - 歌手" 的普通列表行（含中日英字符即认）
    const m = line.match(/^\s*\d{1,3}[.、)）]\s*(.{2,80}?)\s+[-–—]\s+(.+)$/)
    if (m) return { id: '', name: m[1].trim(), artist: m[2].trim() }
  }
  return null
}

function normalizeSong(s) {
  return {
    id: String(s.id || s.songId || ''),
    encryptedId: s.encryptedId || s.encrypted_id || '',
    name: s.name || s.title || s.songName || '',
    artist: Array.isArray(s.artists)
      ? s.artists.map(a => a.name || a).join('/')
      : s.artist || s.singer || '',
    album: s.album?.name || s.album || '',
    raw: undefined
  }
}

/** 搜歌：返回 {ok, song?, error?, raw?} */
export async function searchSong(keyword) {
  const r = await runNcm(['search', 'song', '--keyword', keyword])
  if (!r.ok) return { ok: false, error: r.error }
  const errText = [r.stdout, r.stderr].join('\n')
  if (/PRIVATE_KEY|未设置|API key/i.test(errText) && !parseSearchOutput(r.stdout)) {
    return { ok: false, error: firstLine(errText) || '凭证未配置' }
  }
  const song = parseSearchOutput(r.stdout)
  if (!song) {
    return { ok: false, error: '搜索结果解析失败', raw: errText.slice(0, 500) }
  }
  return { ok: true, song }
}

/** 本机播放（需要 privateKey + player=mpv + 安装 mpv） */
export async function playSong(song) {
  const args = ['play', '--song']
  if (song.encryptedId) args.push('--encrypted-id', song.encryptedId)
  if (song.id) args.push('--original-id', song.id)
  const r = await runNcm(args, 20000)
  if (!r.ok) return { ok: false, error: r.error }
  const text = r.stdout + r.stderr
  if (/PRIVATE_KEY|未设置|mpv|player/i.test(text) && text.length < 600) {
    return { ok: false, error: firstLine(text) || '播放失败' }
  }
  return { ok: true }
}
