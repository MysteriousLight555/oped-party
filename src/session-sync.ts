/** 工作台自动保存：对比"上次已保存的快照"和"当前界面"，只提交改过的字段
 *
 * 这是"朋友的分数被覆盖"的根因修复：
 * 以前工作台每 700ms 把整期 JSON PUT 回去，朋友刚写的新分数会被旧快照覆盖。
 * 现在只发送自己真正改过的格子，服务端按字段合并，别人的分数不受影响。
 */
import type { Part, Session, SessionOp } from './types'

type Dict = Record<string, unknown>

export function cloneData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function valueOf(v: unknown): unknown {
  return v === undefined ? null : v
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(valueOf(a)) === JSON.stringify(valueOf(b))
}

function sameList(a: string[] | undefined, b: string[] | undefined): boolean {
  const aa = [...(a || [])].sort()
  const bb = [...(b || [])].sort()
  return JSON.stringify(aa) === JSON.stringify(bb)
}

function unionKeys(...maps: Array<Dict | undefined>): string[] {
  const set = new Set<string>()
  for (const map of maps) {
    if (!map) continue
    for (const key of Object.keys(map)) set.add(key)
  }
  return [...set]
}

/** 只比较打分相关字段；ncm / aiReviews 等由服务端专用接口维护，不参与自动保存 */
export function diffSession(base: Session, current: Session): SessionOp[] {
  const ops: SessionOp[] = []
  const baseParts = new Map((base.parts || []).map(p => [p.page, p]))

  for (const part of current.parts || []) {
    const b = baseParts.get(part.page)
    if (!b) continue

    for (const person of unionKeys(b.scores as Dict, part.scores as Dict)) {
      const before = b.scores?.[person]
      const after = part.scores?.[person]
      if (!same(before, after)) {
        ops.push({
          t: 'score',
          page: part.page,
          person,
          value: typeof after === 'number' ? after : null,
          old: typeof before === 'number' ? before : null
        })
      }
    }

    for (const dim of unionKeys(b.dimScores as Dict, part.dimScores as Dict)) {
      const bm = b.dimScores?.[dim]
      const cm = part.dimScores?.[dim]
      for (const person of unionKeys(bm as Dict, cm as Dict)) {
        const before = bm?.[person]
        const after = cm?.[person]
        if (!same(before, after)) {
          ops.push({
            t: 'dim',
            page: part.page,
            dim,
            person,
            value: typeof after === 'number' ? after : null,
            old: typeof before === 'number' ? before : null
          })
        }
      }
    }

    for (const person of unionKeys(b.personTags as Dict, part.personTags as Dict)) {
      const before = b.personTags?.[person] || []
      const after = part.personTags?.[person] || []
      if (!sameList(before, after)) {
        ops.push({
          t: 'tags',
          page: part.page,
          person,
          value: [...after],
          old: [...before]
        })
      }
    }

    for (const person of unionKeys(b.personComments as Dict, part.personComments as Dict)) {
      const before = b.personComments?.[person] || ''
      const after = part.personComments?.[person] || ''
      if (before !== after) {
        ops.push({
          t: 'personComment',
          page: part.page,
          person,
          value: after,
          old: before
        })
      }
    }

    for (const person of unionKeys(
      Object.fromEntries((b.favorites || []).map(p => [p, true])),
      Object.fromEntries((part.favorites || []).map(p => [p, true]))
    )) {
      const before = (b.favorites || []).includes(person)
      const after = (part.favorites || []).includes(person)
      if (before !== after) {
        ops.push({ t: 'fav', page: part.page, person, value: after, old: before })
      }
    }

    if (!same(b.parsed, part.parsed)) {
      ops.push({ t: 'part', page: part.page, field: 'parsed', value: cloneData(part.parsed), old: cloneData(b.parsed) })
    }
    if ((b.comment || '') !== (part.comment || '')) {
      ops.push({ t: 'part', page: part.page, field: 'comment', value: part.comment || '', old: b.comment || '' })
    }
    if (!sameList(b.tags, part.tags)) {
      ops.push({ t: 'part', page: part.page, field: 'tags', value: [...(part.tags || [])], old: [...(b.tags || [])] })
    }
    if (Boolean(b.skipped) !== Boolean(part.skipped)) {
      ops.push({ t: 'part', page: part.page, field: 'skipped', value: Boolean(part.skipped), old: Boolean(b.skipped) })
    }
  }

  return ops
}

export function sessionSnapshotsEqual(a: Session, b: Session): boolean {
  return diffSession(a, b).length === 0
}

/** 把本地待同步的修改叠加到刚拉下来的服务器快照上（刷新时不丢正在编辑的内容） */
export function applySessionOps(session: Session, ops: SessionOp[]): void {
  for (const op of ops) {
    const part = (session.parts || []).find(p => p.page === op.page)
    if (!part) continue
    if (op.t === 'score') {
      part.scores = part.scores || {}
      if (op.value === null) delete part.scores[op.person]
      else part.scores[op.person] = op.value
    } else if (op.t === 'dim') {
      part.dimScores = part.dimScores || {}
      part.dimScores[op.dim] = part.dimScores[op.dim] || {}
      if (op.value === null) delete part.dimScores[op.dim][op.person]
      else part.dimScores[op.dim][op.person] = op.value
    } else if (op.t === 'tags') {
      part.personTags = part.personTags || {}
      if (op.value.length) part.personTags[op.person] = [...op.value]
      else delete part.personTags[op.person]
    } else if (op.t === 'personComment') {
      part.personComments = part.personComments || {}
      if (op.value) part.personComments[op.person] = op.value
      else delete part.personComments[op.person]
    } else if (op.t === 'fav') {
      part.favorites = part.favorites || []
      const i = part.favorites.indexOf(op.person)
      if (op.value && i < 0) part.favorites.push(op.person)
      if (!op.value && i >= 0) part.favorites.splice(i, 1)
    } else if (op.t === 'part') {
      if (op.field === 'parsed') part.parsed = cloneData(op.value as Part['parsed'])
      else if (op.field === 'comment') part.comment = String(op.value ?? '')
      else if (op.field === 'tags') part.tags = [...((op.value as string[]) || [])]
      else if (op.field === 'skipped') part.skipped = Boolean(op.value)
    }
  }
}
