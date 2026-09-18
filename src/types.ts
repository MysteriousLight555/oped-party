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
  scores: Record<string, number | undefined>
  dimScores: Record<string, Record<string, number | undefined>>
  favorites: string[]
  comment: string
  tags: string[]
  skipped: boolean
}

export interface Session {
  id: string
  name: string
  bvid: string
  videoTitle: string
  cover: string
  createdAt: string
  done: boolean
  parts: Part[]
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
}

export interface Dim {
  key: string
  name: string
  enabled: boolean
}

export interface Config {
  persons: string[]
  dimensions: Dim[]
  tags: string[]
  scoreMin: number
  scoreMax: number
}
