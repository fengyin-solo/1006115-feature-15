import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'shield-tunnel-construction:entries'

// 浆液拌制配料核对用到的存量集合：配方、判定标准、核对记录。
// 与各业务模块的清单共用同一份 localStorage，读写仍走这一层，页面不另开一套。
export const MORTAR_RECIPE_KEY = 'mortar-recipes'
export const MORTAR_STANDARD_KEY = 'mortar-standards'
export const MORTAR_CHECK_KEY = 'mortar-checks'
const AUX_KEYS = [MORTAR_RECIPE_KEY, MORTAR_STANDARD_KEY, MORTAR_CHECK_KEY]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function seedSnapshot(): Record<string, unknown[]> {
  return clone(SEED_ROWS as Record<string, unknown[]>)
}

function readStorage(): Record<string, unknown[]> {
  const fallback = seedSnapshot()
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown[]>
    // 存量读取方式兼容：浏览器里已有的清单原样保留，新增集合缺了就用示例补上。
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, unknown[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache as Record<string, EntryRow[]>
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

/** 读配料核对相关的存量集合（配方 / 判定标准 / 核对记录）。 */
export function listAux<T>(key: string): T[] {
  if (cache === null) {
    cache = readStorage()
  }
  return (cache[key] ?? []) as T[]
}

/** 只替换一个集合，沿用既有读法落库。 */
export function saveRows(key: string, rows: EntryRow[]): void {
  saveCollections({ [key]: rows })
}

/**
 * 一次替换多个集合并一次性写入：配料核对要同时改批次、核对记录（必要时还有委托清单），
 * 要么整份落库，要么不落，不允许只写半条。
 */
export function saveCollections(patch: Record<string, unknown[]>): void {
  const next = { ...allRows(), ...patch }
  cache = next as Record<string, unknown[]>
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? []) as EntryRow[]
  saveRows(key, rows)
  return rows
}

/** 重置浆液拌制相关的全部存量：批次、配方、标准、核对记录一起回到示例。 */
export function resetMortarData(): void {
  const fallback = seedSnapshot()
  saveCollections({
    mortar: clone(fallback.mortar),
    [MORTAR_RECIPE_KEY]: clone(fallback[MORTAR_RECIPE_KEY] ?? []),
    [MORTAR_STANDARD_KEY]: clone(fallback[MORTAR_STANDARD_KEY] ?? []),
    [MORTAR_CHECK_KEY]: [],
  })
}

export function storageKey(): string {
  return STORAGE_KEY
}

export { AUX_KEYS }
