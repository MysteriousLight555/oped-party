import type { Config, Session } from './types'

/**
 * 解析"本期生效配置"：有快照且未开启跟随全局 → 用快照；
 * 否则（含存量期次无快照）→ 用全局。与 server/stats.js 的同名逻辑保持一致。
 */
export function sessionConfig(session: Session | null | undefined, config: Config): Config {
  const s = session?.settings
  if (session?.followGlobal !== true && s && Array.isArray(s.dimensions) && s.dimensions.length) {
    return {
      persons: Array.isArray(s.persons) ? s.persons : config.persons,
      dimensions: s.dimensions,
      tags: Array.isArray(s.tags) ? s.tags : config.tags,
      scoreMin: typeof s.scoreMin === 'number' ? s.scoreMin : config.scoreMin,
      scoreMax: typeof s.scoreMax === 'number' ? s.scoreMax : config.scoreMax
    }
  }
  return config
}

/** 从全局配置生成一份本期快照（建期/「从全局同步」用） */
export function snapshotFrom(config: Config) {
  return {
    persons: [...config.persons],
    dimensions: config.dimensions.map(d => ({ ...d })),
    tags: [...config.tags],
    scoreMin: config.scoreMin,
    scoreMax: config.scoreMax
  }
}
