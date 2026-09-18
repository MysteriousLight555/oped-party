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
 * 拉取视频元信息 + 分P列表，结果按 bvid 缓存在 data/cache/。
 * view 接口拿标题/封面，失败时退回 pagelist（仅分P，无标题）。
 */
export async function fetchVideo(bvid, { refresh = false } = {}) {
  const cachePath = path.join(CACHE.dir, `${bvid}.json`)
  if (!refresh && fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'))
    if (cached.parts?.length) return cached
  }

  let meta = { title: '', cover: '', owner: '' }
  let pages = null

  const view = await getJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`
  ).catch(() => null)
  if (view && view.code === 0 && view.data) {
    meta = {
      title: view.data.title || '',
      cover: view.data.pic || '',
      owner: view.data.owner?.name || ''
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
