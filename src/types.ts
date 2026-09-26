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
  /** B站视频简介：部分 UP 主会把曲目单写在这里，用于标题辅助解析 */
  desc?: string
  createdAt: string
  done: boolean
  parts: Part[]
  /** 轻量临时场：不计入全期总榜聚合 */
  noGlobal?: boolean
  /** AI 锐评（最新在前，最多存 5 条） */
  aiReviews?: AiReview[]
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
  noGlobal?: boolean
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
