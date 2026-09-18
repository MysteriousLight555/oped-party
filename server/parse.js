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
  // 【小剧场ED】正后方的神威 —— 有【】类型但标题里没有「曲名」
  {
    re: /^【([^】]{1,12})】\s*(.+)$/,
    pick: m => ({
      kind: m[1].trim(),
      anime: '',
      song: m[2].trim(),
      artist: ''
    })
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
