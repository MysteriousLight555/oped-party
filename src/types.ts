export interface Parsed {
  kind: string
  anime: string
  song: string
  artist: string
}

export interface Part {
  page: number
  cid: number
  title: string
  duration: number
  parsed: Parsed
  /** 主观总评：每人独立给出，不与维度分加权换算 */
  scores: Record<string, number | undefined>
  /** 维度参考坐标系（带权重），只用来算"反差值"，不是总分的依据 */
  dimScores: Record<string, Record<string, number | undefined>>
  /** 个人标签：记录每个人的情绪判断（工业糖精 / 情怀暴击 …） */
  personTags?: Record<string, string[]>
  /** 个人短评：解释"为什么明知套路还是给高分"这类反差 */
  personComments?: Record<string, string>
  favorites: string[]
  /** 全场 collective 标签 */
  tags: string[]
  /** 全场短评 */
  comment: string
  skipped: boolean
  /** 网易云音乐关联（官方 CLI 匹配结果缓存） */
  ncm?: NcmSong
}

export interface NcmSong {
  /** 明文数字 ID（网易云网页链接用） */
  id: string
  /** 32 位加密 ID（CLI 播放用） */
  encryptedId?: string
  name: string
  artist?: string
  album?: string
  cover?: string
  payPlayFlag?: boolean
  vipFlag?: boolean
  keyword?: string
  matchedAt?: string
  /** 歌词缓存（预取/查看后落库，报告歌词本用） */
  lyric?: NcmLyric
}

export interface NcmLyric {
  text: string
  trans?: string
  noLyric?: boolean
  fetchedAt?: string
}

/** 远端资料库状态：这首歌是否已红心/已入目标歌单 */
export interface NcmLibEntry {
  hearted: boolean | null
  inPlaylist: boolean | null
}

export interface NcmLibStatus {
  parts: Record<number, NcmLibEntry>
  heartCount: number | null
  targetCount: number | null
  heartError?: string | null
  targetError?: string | null
}

export interface Session {
  id: string
  name: string
  bvid: string
  videoTitle: string
  cover: string
  createdAt: string
  done: boolean
  /** 版本号：每次真实写入 +1，客户端按字段合并时用于识别"期间有人改过" */
  rev?: number
  updatedAt?: string
  /** 本场独立成员名单（新期次从设置页复制，之后可在工作台增删） */
  members?: string[]
  /** 房间口令：加入本场需要（空字符串 = 不需要口令） */
  pin?: string
  /** 现场状态：当前曲、独立评分/揭晓 */
  stage?: StageState
  /** 单曲进度（服务端计算，参与者/大屏用） */
  progress?: Record<number, PartProgress>
  totalActive?: number
  votedCount?: number
  completeCount?: number
  /** 参与者视角：我是谁 */
  myPerson?: string
  parts: Part[]
  /** AI 锐评（最新在前，最多存 5 条） */
  aiReviews?: AiReview[]
}

export interface StageState {
  /** 主持人指定的当前曲；null = 还没指定（大屏回退到"下一首待评"） */
  currentPage: number | null
  /** 独立评分：揭晓前不显示别人的分数 */
  blind: boolean
  /** 是否已揭晓 */
  revealed: boolean
  updatedAt?: string | null
}

export interface PartProgress {
  submitted: number
  memberCount: number
  missing: string[]
  complete: boolean
}

/** 字段级合并写入的操作（工作台自动保存只提交改过的格子） */
export type SessionOp =
  | { t: 'score'; page: number; person: string; value: number | null; old?: number | null }
  | {
      t: 'dim'
      page: number
      dim: string
      person: string
      value: number | null
      old?: number | null
    }
  | { t: 'tags'; page: number; person: string; value: string[]; old?: string[] }
  | { t: 'personComment'; page: number; person: string; value: string; old?: string }
  | { t: 'fav'; page: number; person: string; value: boolean; old?: boolean }
  | {
      t: 'part'
      page: number
      field: 'parsed' | 'comment' | 'tags' | 'skipped'
      value: unknown
      old?: unknown
    }

export interface OpConflict {
  page: number
  field: string
  person: string | null
  serverValue: unknown
}

export interface PatchResult {
  saved: boolean
  changed: number
  rev: number
  updatedAt?: string | null
  conflicts: OpConflict[]
  conflict?: boolean
}

export interface JoinSummary {
  id: string
  name: string
  createdAt: string
  done: boolean
  memberCount: number
  total: number
  complete: number
}

export interface JoinInfo extends JoinSummary {
  members: string[]
  pinRequired: boolean
  blind: boolean
}

export interface JoinResult {
  token: string
  person: string
  session: Session
}

export interface AiReview {
  text: string
  model: string
  createdAt: string
}

/** AI 配置的对外视图：Key 永远只给掩码 */
export interface AiConfigInfo {
  baseUrl: string
  model: string
  anonymize: boolean
  hasKey: boolean
  keyMasked: string
}

export interface SessionMeta {
  id: string
  name: string
  bvid: string
  videoTitle: string
  createdAt: string
  done: boolean
  total: number
  voted: number
  skipped: number
  /** 本场成员数 / 已评齐曲数（老后端可能没有） */
  members?: number
  complete?: number
}

export interface Dim {
  key: string
  name: string
  desc?: string
  /** 参考坐标权重（0~100，计算时自动归一化），与总分无关 */
  weight?: number
  enabled: boolean
}

export interface Config {
  persons: string[]
  dimensions: Dim[]
  tags: string[]
  tagsRev?: number
  scoreMin: number
  scoreMax: number
}
