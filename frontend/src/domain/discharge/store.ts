import { SEED_ROWS } from '@/data/seed'
import type { EntryRow } from '@/data/types'

import {
  LEGACY_COMPATIBLE_REASONS,
  type CompilationTask,
  type DischargeRecord,
  type DischargeStatus,
  type MethodVersion,
} from './types'

/**
 * 流量领域独立存储。旧版数据挂在通用 entries 存储的 discharge 键下，
 * 首次访问时做一次性存量迁移：
 *  - 补齐「测量方法版本」：存量记录一律视为旧版规范 v1.0；
 *  - 以规范状态枚举重算状态，清掉与状态不一致的 pending/abnormal 残留标记；
 *  - 已通过的历史记录只修标记、不改结论（保持原结果）；
 *  - 异常记录补齐异常原因，旧版规范下的已知原因可被兼容接收。
 */
const STORE_KEY = 'hydrology-monitor-station:discharge-v2'

export type DischargeStore = {
  records: DischargeRecord[]
  tasks: CompilationTask[]
  migrated: boolean
}

const STATUS_FROM_LEGACY: Record<string, DischargeStatus> = {
  已采集: 'collected',
  待审核: 'pendingConfirm',
  已通过: 'confirmed',
  异常值: 'abnormal',
}

const CANONICAL_STATUSES: readonly string[] = ['collected', 'pendingConfirm', 'confirmed', 'abnormal']

function resolveStatus(raw: string): DischargeStatus {
  // 迁移幂等：已是规范枚举的原样保留，旧版中文标签才做映射
  if (CANONICAL_STATUSES.includes(raw)) {
    return raw as DischargeStatus
  }
  return STATUS_FROM_LEGACY[raw] ?? 'collected'
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

/** 迁移单条存量记录：幂等，已具备新结构的记录原样保留（含历史已通过结论） */
export function migrateRow(raw: EntryRow): DischargeRecord {
  const legacyStatus = text(raw.status)
  const status = resolveStatus(legacyStatus)
  const version = (text(raw.测量方法版本) || 'v1.0') as MethodVersion
  // 异常原因只在异常态保留：存量异常缺原因时按旧版规范补一个可兼容原因；
  // 非异常态一律清空，防止异常处理后旧原因残留。
  let reason = text(raw.异常原因)
  if (status === 'abnormal') {
    if (!reason) {
      reason = LEGACY_COMPATIBLE_REASONS[0]
    }
  } else {
    reason = ''
  }
  const assignedTaskId =
    typeof raw.assignedTaskId === 'number' ? raw.assignedTaskId : null
  return {
    id: Number(raw.id),
    记录编号: text(raw.记录编号),
    站点编号: text(raw.站点编号),
    测量方法: text(raw.测量方法),
    测量方法版本: version,
    断面流量: text(raw.断面流量),
    最大流速: text(raw.最大流速),
    过水面积: text(raw.过水面积),
    测量时间: text(raw.测量时间),
    异常原因: reason,
    status,
    assignedTaskId,
  }
}

function seedRecords(): DischargeRecord[] {
  // seed 已按新结构补充了版本/原因字段；仍统一过一遍迁移，保证口径一致
  return (SEED_ROWS.discharge ?? []).map((row) => migrateRow(row))
}

function emptyStore(): DischargeStore {
  return { records: seedRecords(), tasks: [], migrated: true }
}

function readLegacyEntries(): EntryRow[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return SEED_ROWS.discharge ?? []
  }
  const raw = window.localStorage.getItem('hydrology-monitor-station:entries')
  if (!raw) {
    return SEED_ROWS.discharge ?? []
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return parsed.discharge ?? SEED_ROWS.discharge ?? []
  } catch {
    return SEED_ROWS.discharge ?? []
  }
}

function migrateFromLegacy(): DischargeStore {
  const legacy = readLegacyEntries().map((row) => migrateRow(row))
  const store: DischargeStore = {
    records: legacy.length ? legacy : seedRecords(),
    tasks: [],
    migrated: true,
  }
  persist(store)
  return store
}

function persist(store: DischargeStore): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORE_KEY, JSON.stringify(store))
  }
}

let cache: DischargeStore | null = null

export function dischargeStore(): DischargeStore {
  if (cache) {
    return cache
  }
  if (typeof window === 'undefined' || !window.localStorage) {
    cache = emptyStore()
    return cache
  }
  const raw = window.localStorage.getItem(STORE_KEY)
  if (!raw) {
    cache = migrateFromLegacy()
    return cache
  }
  try {
    const parsed = JSON.parse(raw) as DischargeStore
    // 再次归一化，保证旧版本写出的数据也能被新判定正确读取（幂等迁移）
    parsed.records = parsed.records.map((row) => migrateRow(row as unknown as EntryRow))
    parsed.tasks ??= []
    cache = parsed
  } catch {
    cache = migrateFromLegacy()
  }
  return cache
}

export function saveDischargeStore(store: DischargeStore): void {
  cache = store
  persist(store)
}

export function resetDischargeStore(): DischargeStore {
  const store = emptyStore()
  saveDischargeStore(store)
  return store
}
