import { migrateFlowRow } from '@/domain/discharge/flow'
import { SEED_ROWS } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'
const DISCHARGE_KEY = 'discharge'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 存量流量记录迁移：补齐测量方法版本与异常兼容、按统一判定重算标记。
 * 幂等，仅在确有变化时返回 changed，调用方负责回写持久化。
 */
function migrateAll(data: Record<string, EntryRow[]>): {
  data: Record<string, EntryRow[]>
  changed: boolean
} {
  const discharge = data[DISCHARGE_KEY]
  if (!discharge) {
    return { data, changed: false }
  }
  let changed = false
  const next = discharge.map((row) => {
    const migrated = migrateFlowRow(row)
    if (migrated !== row) {
      changed = true
    }
    return migrated
  })
  if (!changed) {
    return { data, changed: false }
  }
  return { data: { ...data, [DISCHARGE_KEY]: next }, changed: true }
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return migrateAll(fallback).data
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    const { data, changed } = migrateAll(fallback)
    if (changed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
    return data
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    const merged = { ...fallback, ...parsed }
    const { data, changed } = migrateAll(merged)
    if (changed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
    return data
  } catch {
    const { data, changed } = migrateAll(fallback)
    if (changed) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
    return data
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
