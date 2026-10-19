import fs from 'node:fs'
import path from 'node:path'
import { CACHE } from './store.js'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

const BILI_HEADERS = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  Origin: 'https://www.bilibili.com',
  Referer: 'https://www.bilibili.com/'
}

async function getJson(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    const res = await fetch(url, { headers: BILI_HEADERS, signal: controller.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 从任意输入提取 BV 号：直接含 BV 的原样提取；
 * b23.tv 短链跟随 302 跳转，从最终地址（或页面源码）里提取。
 * 返回空串表示提取失败。
 */
export async function resolveBvid(raw) {
  const direct = String(raw || '').match(/(BV[a-zA-Z0-9]{8,12})/)
  if (direct) return direct[1]
  const m = String(raw || '').match(/(?:https?:\/\/)?b23\.tv\/[A-Za-z0-9]+/i)
  if (!m) return ''
  const url = m[0].startsWith('http') ? m[0] : `https://${m[0]}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA },
      signal: controller.signal
    })
    const bv = (res.url || '').match(/(BV[a-zA-Z0-9]{8,12})/)
    if (bv) return bv[1]
    const body = await res.text().catch(() => '')
    return (body.match(/BV[a-zA-Z0-9]{8,12}/) || [])[0] || ''
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 拉取视频元信息 + 分P列表，结果按 bvid 缓存在 data/cache/。
 * view 接口拿标题/封面/简介，失败时退回 pagelist（仅分P，无标题）。
 */
export async function fetchVideo(bvid, { refresh = false } = {}) {
  const cachePath = path.join(CACHE.dir, `${bvid}.json`)
  if (!refresh && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    // 老缓存没有 desc 字段：重取一次，之后简介辅助解析才有原料
    if (cached.parts?.length && typeof cached.desc === 'string') return cached
  }

  let meta = { title: '', cover: '', owner: '', desc: '' }
  let pages = null

  const view = await getJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
  ).catch(() => null)
  if (view && view.code === 0 && view.data) {
    meta = {
      title: view.data.title || '',
      cover: view.data.pic || '',
      owner: view.data.owner?.name || '',
      desc: view.data.desc || ''
    }
    pages = view.data.pages || null
  }

  if (!pages) {
    const pl = await getJson(
      `https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(bvid)}`
    )
    if (pl.code !== 0 || !Array.isArray(pl.data)) {
      throw new Error(pl.message || 'pagelist 接口返回异常')
    }
    pages = pl.data
  }

  const video = {
    bvid,
    title: meta.title,
    cover: meta.cover,
    owner: meta.owner,
    desc: meta.desc,
    parts: pages.map(p => ({
      page: p.page,
      cid: p.cid,
      part: p.part,
      duration: p.duration
    })),
    fetchedAt: new Date().toISOString()
  }
  fs.writeFileSync(cachePath, JSON.stringify(video, null, 2), 'utf-8')
  return video
}
