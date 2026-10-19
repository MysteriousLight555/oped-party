/** 房间逻辑：成员、当前曲、漏评统计、字段级合并写入、参与者可见数据裁剪
 *
 * 这一层刻意不碰 express：所有函数只接收普通对象，方便隔离测试。
 */
import crypto from 'node:crypto'

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    this.extra = extra
  }
}

export function cleanMemberName(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 20)
}

export function cleanTag(value) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 24)
}

export function cleanText(value, max = 300) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, (ch) => (ch === '\n' ? '\n' : ''))
    .trim()
    .slice(0, max)
}

export function uniqueTags(list, max = 20) {
  const out = []
  for (const item of Array.isArray(list) ? list : []) {
    const t = cleanTag(item)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= max) break
  }
  return out
}

/** 每期独立成员名单：老数据没有 members 时从设置页 + 已有打分校准一次 */
export function membersOf(session, config = {}) {
  if (Array.isArray(session.members)) {
    const out = []
    for (const item of session.members) {
      const name = cleanMemberName(item)
      if (name && !out.includes(name)) out.push(name)
    }
    if (out.length !== session.members.length) session.members = out
    return session.members
  }
  const set = new Set()
  for (const p of config.persons || []) {
    const n = cleanMemberName(p)
    if (n) set.add(n)
  }
  for (const part of session.parts || []) {
    for (const who of Object.keys(part.scores || {})) {
      const n = cleanMemberName(who)
      if (n) set.add(n)
    }
    for (const who of Object.keys(part.personTags || {})) {
      const n = cleanMemberName(who)
      if (n) set.add(n)
    }
    for (const who of Object.keys(part.personComments || {})) {
      const n = cleanMemberName(who)
      if (n) set.add(n)
    }
  }
  session.members = [...set]
  return session.members
}

export function ensureMembers(session, config) {
  const before = JSON.stringify(session.members ?? null)
  membersOf(session, config)
  return JSON.stringify(session.members) !== before
}

export function addMember(session, person, config) {
  const name = cleanMemberName(person)
  if (!name) throw new HttpError(400, '名字不能为空')
  const members = membersOf(session, config)
  if (!members.includes(name)) {
    if (members.length >= 60) throw new HttpError(400, '本场成员太多（上限 60 人）')
    members.push(name)
  }
  return name
}

export function removeMember(session, person, config) {
  const name = cleanMemberName(person)
  const members = membersOf(session, config)
  const i = members.indexOf(name)
  if (i < 0) return false
  members.splice(i, 1)
  return true
}

/** 分数规则：范围来自配置，最多一位小数（多余位数四舍五入） */
export function normalizeScore(value, config = {}) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (!Number.isFinite(n)) throw new HttpError(400, '分数必须是数字')
  const min = Number(config.scoreMin ?? 1)
  const max = Number(config.scoreMax ?? 10)
  if (n < min || n > max) {
    throw new HttpError(400, `分数必须在 ${min}~${max} 之间`)
  }
  return Math.round(n * 10) / 10
}

export function stageOf(session) {
  const st = session.stage || {}
  const page =
    typeof st.currentPage === 'number' && Number.isFinite(st.currentPage)
      ? st.currentPage
      : null
  return {
    currentPage: page,
    blind: st.blind === true,
    revealed: st.revealed === true,
    updatedAt: st.updatedAt || null
  }
}

export function normalizeSession(session, config = {}) {
  session.parts = Array.isArray(session.parts) ? session.parts : []
  session.members = membersOf(session, config)
  session.stage = stageOf(session)
  session.rev = Number(session.rev) || 0
  if (session.pin === undefined || session.pin === null) session.pin = ''
  for (const part of session.parts) {
    part.scores = part.scores && typeof part.scores === 'object' ? part.scores : {}
    part.dimScores = part.dimScores && typeof part.dimScores === 'object' ? part.dimScores : {}
    part.personTags = part.personTags && typeof part.personTags === 'object' ? part.personTags : {}
    part.personComments =
      part.personComments && typeof part.personComments === 'object' ? part.personComments : {}
    part.favorites = Array.isArray(part.favorites) ? part.favorites : []
    part.tags = Array.isArray(part.tags) ? part.tags : []
    part.comment = part.comment ?? ''
    part.skipped = Boolean(part.skipped)
    part.parsed = part.parsed || { kind: '', anime: '', song: '', artist: '' }
  }
  return session
}

export function newPin() {
  return String(crypto.randomInt(1000, 10000))
}

/** 单曲进度：已提交几人、还差谁、是否全齐（用于手机端、大屏、漏评检查） */
export function progressOf(session, config = {}) {
  const members = membersOf(session, config)
  const progress = {}
  let completeCount = 0
  let votedCount = 0
  let totalActive = 0
  for (const part of session.parts || []) {
    if (part.skipped) continue
    totalActive += 1
    const missing = members.filter((m) => typeof part.scores?.[m] !== 'number')
    const submitted = members.length - missing.length
    if (Object.values(part.scores || {}).some((v) => typeof v === 'number')) votedCount += 1
    const complete = members.length > 0 && missing.length === 0
    if (complete) completeCount += 1
    progress[part.page] = {
      submitted,
      memberCount: members.length,
      missing,
      complete
    }
  }
  return { progress, members, totalActive, votedCount, completeCount }
}

export function missingBeforeFinish(session, config = {}) {
  const members = membersOf(session, config)
  const missing = []
  for (const part of session.parts || []) {
    if (part.skipped) continue
    const who = members.filter((m) => typeof part.scores?.[m] !== 'number')
    if (who.length) {
      missing.push({
        page: part.page,
        song: part.parsed?.song || part.title,
        missing: who
      })
    }
  }
  return missing
}

/** 参与者拿到的数据：只保留自己的分数/收藏/标签，以及"已提交几人、还差谁"的进度 */
export function participantSession(session, config, person) {
  normalizeSession(session, config)
  const live = progressOf(session, config)
  const st = stageOf(session)
  const me = cleanMemberName(person)
  const parts = (session.parts || []).map((p) => {
    const dimScores = {}
    for (const [key, map] of Object.entries(p.dimScores || {})) {
      dimScores[key] = typeof map?.[me] === 'number' ? { [me]: map[me] } : {}
    }
    return {
      page: p.page,
      cid: p.cid || 0,
      title: p.title,
      duration: p.duration || 0,
      parsed: p.parsed,
      scores: typeof p.scores?.[me] === 'number' ? { [me]: p.scores[me] } : {},
      dimScores,
      personTags: p.personTags?.[me] ? { [me]: p.personTags[me] } : {},
      personComments: p.personComments?.[me] ? { [me]: p.personComments[me] } : {},
      favorites: (p.favorites || []).includes(me) ? [me] : [],
      tags: p.tags || [],
      comment: p.comment || '',
      skipped: Boolean(p.skipped)
    }
  })
  return {
    id: session.id,
    name: session.name,
    bvid: session.bvid || '',
    videoTitle: session.videoTitle || '',
    cover: session.cover || '',
    createdAt: session.createdAt,
    done: Boolean(session.done),
    rev: Number(session.rev) || 0,
    updatedAt: session.updatedAt || null,
    members: live.members,
    stage: st,
    parts,
    progress: live.progress,
    totalActive: live.totalActive,
    votedCount: live.votedCount,
    completeCount: live.completeCount,
    myPerson: me
  }
}

function jsonOf(v) {
  return JSON.stringify(v === undefined ? null : v)
}

function sameValue(a, b) {
  return jsonOf(a) === jsonOf(b)
}

function noteConflict(conflicts, part, field, person, serverValue, op) {
  if (op.old === undefined) return
  if (!sameValue(op.old, serverValue) && !sameValue(op.value, serverValue)) {
    conflicts.push({ page: part.page, field, person: person || null, serverValue: serverValue ?? null })
  }
}

function ensureDim(config, key) {
  const dim = (config.dimensions || []).find((d) => d.key === key)
  if (!dim) throw new HttpError(400, `未知的维度：${key}`)
  return dim
}

function applyPartField(part, field, value, config) {
  if (field === 'parsed') {
    const src = value && typeof value === 'object' ? value : {}
    part.parsed = {
      kind: cleanText(src.kind, 60),
      anime: cleanText(src.anime, 120),
      song: cleanText(src.song, 120),
      artist: cleanText(src.artist, 120)
    }
  } else if (field === 'comment') {
    part.comment = cleanText(value, 300)
  } else if (field === 'tags') {
    part.tags = uniqueTags(value, 20)
  } else if (field === 'skipped') {
    part.skipped = Boolean(value)
  } else {
    throw new HttpError(400, `不支持修改字段：${field}`)
  }
}

/** 应用一批字段级操作；返回 { changed, conflicts }
 * actor: { role: 'host' } 或 { role: 'participant', person }
 */
export function applyOps(session, ops, { config = {}, actor = { role: 'host' } } = {}) {
  if (!Array.isArray(ops)) throw new HttpError(400, 'ops 必须是数组')
  if (ops.length > 400) throw new HttpError(400, '一次提交的修改太多，请稍后重试')
  const members = membersOf(session, config)
  const conflicts = []
  let changed = 0

  for (const raw of ops) {
    if (!raw || typeof raw !== 'object') continue
    const op = raw
    const page = Number(op.page)
    const person = cleanMemberName(op.person)

    if (actor.role === 'participant') {
      if (op.t === 'part') throw new HttpError(403, '参与者不能修改歌曲信息')
      if (!person || person !== actor.person) throw new HttpError(403, '只能修改自己的评分')
      if (!members.includes(person)) throw new HttpError(403, '你已被移出本场成员，请联系主持人')
    } else if (person && !members.includes(person)) {
      addMember(session, person, config)
    }

    if (op.t === 'part') {
      const part = (session.parts || []).find((p) => p.page === page)
      if (!part) throw new HttpError(404, `分P ${page} 不存在`)
      const field = String(op.field || '')
      const serverValue =
        field === 'parsed'
          ? { ...(part.parsed || {}) }
          : Array.isArray(part[field])
            ? [...part[field]]
            : part[field]
      const before = jsonOf(part[field])
      applyPartField(part, field, op.value, config)
      noteConflict(conflicts, part, field, null, serverValue, op)
      if (jsonOf(part[field]) !== before) changed += 1
      continue
    }

    const part = (session.parts || []).find((p) => p.page === page)
    if (!part) throw new HttpError(404, `分P ${page} 不存在`)
    if (!person) throw new HttpError(400, '缺少 person')

    if (op.t === 'score') {
      const serverValue = part.scores?.[person]
      const value = normalizeScore(op.value, config)
      noteConflict(conflicts, part, 'score', person, serverValue, op)
      part.scores = part.scores || {}
      if (value === null) delete part.scores[person]
      else part.scores[person] = value
      if (!sameValue(serverValue, value)) changed += 1
    } else if (op.t === 'dim') {
      const dim = ensureDim(config, String(op.dim || ''))
      part.dimScores = part.dimScores || {}
      const map = (part.dimScores[dim.key] = part.dimScores[dim.key] || {})
      const serverValue = map[person]
      const value = normalizeScore(op.value, config)
      noteConflict(conflicts, part, `dim:${dim.key}`, person, serverValue, op)
      if (value === null) delete map[person]
      else map[person] = value
      if (!sameValue(serverValue, value)) changed += 1
    } else if (op.t === 'tags') {
      part.personTags = part.personTags || {}
      const serverValue = part.personTags[person] || []
      const value = uniqueTags(op.value, 12)
      noteConflict(conflicts, part, 'personTags', person, serverValue, op)
      if (value.length) part.personTags[person] = value
      else delete part.personTags[person]
      if (!sameValue(serverValue, value)) changed += 1
    } else if (op.t === 'personComment') {
      part.personComments = part.personComments || {}
      const serverValue = part.personComments[person] || ''
      const value = cleanText(op.value, 120)
      noteConflict(conflicts, part, 'personComment', person, serverValue, op)
      if (value) part.personComments[person] = value
      else delete part.personComments[person]
      if (!sameValue(serverValue, value)) changed += 1
    } else if (op.t === 'fav') {
      part.favorites = Array.isArray(part.favorites) ? part.favorites : []
      const serverValue = part.favorites.includes(person)
      const value = Boolean(op.value)
      noteConflict(conflicts, part, 'favorite', person, serverValue, { ...op, value })
      const i = part.favorites.indexOf(person)
      if (value && i < 0) part.favorites.push(person)
      if (!value && i >= 0) part.favorites.splice(i, 1)
      if (serverValue !== value) changed += 1
    } else {
      throw new HttpError(400, `不支持的操作：${op.t}`)
    }
  }

  return { changed, conflicts }
}
