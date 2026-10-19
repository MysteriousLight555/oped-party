/**
 * 分P标题解析：尽力从 UP 主的标题规则中拆出 类型/番名/曲名/歌手。
 * 解析不出来就整体作为曲名，不影响打分；界面里可手动修正。
 */

function cleanTitle(raw) {
  let t = String(raw || '').trim()
  // 去掉开头的分P编号：`P1-`、`01.`、`1、`、`12 ：` 等
  t = t.replace(/^\s*(?:P\s?\d{1,3}|\d{1,3})\s*[-_.、:：)\]]*\s+/, '')
  // 去掉结尾的时长标注 `(1:32)` `[92s]`
  t = t.replace(/\s*[\[［(（]\s*\d{1,2}:\d{2}\s*[\]］)）]\s*$/, '')
  return t.trim()
}

const RULES = [
  // 先行OP 番名「曲名」歌手 / 正式ED2 番名「曲名」歌手
  {
    re: /^(先行|正式|剧场版|劇場版|NC|第\d+季)?\s*(OP|ED)\s*(\d{1,2})?\s+(.+?)\s*「(.+?)」\s*(.*)$/,
    pick: m => ({
      kind: `${m[1] || ''}${m[2]}${m[3] || ''}`.trim(),
      anime: m[4].trim(),
      song: m[5].trim(),
      artist: m[6].trim()
    })
  },
  // 【主题曲】番名「曲名」歌手 / 【OP】番名「曲名」歌手
  {
    re: /^【([^】]{1,12})】\s*(.+?)\s*「(.+?)」\s*(.*)$/,
    pick: m => ({
      kind: m[1].trim(),
      anime: m[2].trim(),
      song: m[3].trim(),
      artist: m[4].trim()
    })
  },
  // 插入曲 番名「曲名」歌手 / IN2 番名「曲名」歌手 / 劇中歌 番名「曲名」歌手
  {
    re: /^(插入曲|插入歌|挿入歌|挿入曲|劇中歌|劇中曲|IN)\s*(\d{1,2})?\s+(.+?)\s*「(.+?)」\s*(.*)$/,
    pick: m => ({
      kind: `${m[1]}${m[2] || ''}`.trim(),
      anime: m[3].trim(),
      song: m[4].trim(),
      artist: m[5].trim()
    })
  },
  // 【小剧场ED】正后方的神威 —— 有【】类型但标题里没有「曲名」；
  // 余下部分若仍是完整条目（如【7月 续】桃源暗鬼 OP2【阿弥陀籤】超学生），递归解析后合并
  {
    re: /^【([^】]{1,12})】\s*(.+)$/,
    pick: m => {
      const tag = m[1].trim()
      const rest = m[2].trim()
      const inner = parseTitle(rest)
      if (inner.song && inner.song !== rest) {
        return {
          kind: [inner.kind, tag].filter(Boolean).join('·'),
          anime: inner.anime,
          song: inner.song,
          artist: inner.artist
        }
      }
      return { kind: tag, anime: '', song: rest, artist: '' }
    }
  },
  // 番名「曲名」歌手（无类型前缀）
  {
    re: /^(.+?)\s*「(.+?)」\s*(.*)$/,
    pick: m => ({
      kind: '',
      anime: m[1].trim(),
      song: m[2].trim(),
      artist: m[3].trim()
    })
  },
  // 番名 OP【曲名】歌手 / 番名 ED2【曲名】歌手（B站合集另一常见变体，如"新 猫眼三姐妹 ED【CAT'S EYE】Ado"）
  // 放在「」规则之后：只有标题里完全没有「」时才启用，避免抢已有解析
  {
    re: /^(.{0,40}?)\s*(?:新\s+)?(OP|ED|OP\d{1,2}|ED\d{1,2}|插入曲|插入歌|IN|挿入歌)\s*【(.+?)】\s*(.*)$/,
    pick: m => ({
      kind: `${m[2]}`.trim(),
      anime: m[1].trim(),
      song: m[3].trim(),
      artist: m[4].trim()
    })
  }
]

export function parseTitle(raw) {
  const title = cleanTitle(raw)
  for (const rule of RULES) {
    const m = title.match(rule.re)
    if (m) {
      const parsed = rule.pick(m)
      // 番名非空但过短，说明匹配到了杂项前缀，回退原始标题；番名为空的规则（如小剧场）放行
      if (!parsed.anime || parsed.anime.length >= 2) {
        return { kind: parsed.kind, anime: parsed.anime, song: parsed.song, artist: parsed.artist }
      }
    }
  }
  return { kind: '', anime: '', song: title, artist: '' }
}

/**
 * 简介辅助解析：部分 UP 主把完整曲目单写在视频简介里。
 * 仅当简介条目数与分P数完全一致时做位置对齐，且只补"弱解析"（正则完全没认出来的）分P，
 * 不覆盖任何已有信息。返回补全的分P数。
 */
export function applyDescEnhance(parts, desc) {
  if (!desc || !parts?.length) return 0
  const lines = String(desc)
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
  if (lines.length !== parts.length) return 0
  const entries = lines.map(l => parseTitle(l))
  let applied = 0
  parts.forEach((p, i) => {
    const cur = p.parsed || {}
    const e = entries[i]
    const weak = !cur.kind && !cur.anime && (!cur.song || cur.song === p.title)
    const strong = e.song && e.song !== lines[i] && (e.kind || e.anime || e.artist)
    if (!weak || !strong) return
    p.parsed = {
      kind: cur.kind || e.kind,
      anime: cur.anime || e.anime,
      song: cur.song && cur.song !== p.title ? cur.song : e.song,
      artist: cur.artist || e.artist
    }
    applied++
  })
  return applied
}
