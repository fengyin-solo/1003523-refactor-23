import type { CompilationTask, EntryRow, FlowCandidate } from '@/data/types'
import {
  FLOW_COMPAT_FIELD,
  FLOW_DISPATCH_ACTION,
  FLOW_VERSION_FIELD,
  classifyFlow,
  measurementKey,
  migrateFlowRow,
} from './flow'

const FLOW_KEY_FIELD = '来源测量键'
const FLOW_NO_FIELD = '来源记录编号'

/** 统一判定 + 存量迁移后的流量清单：分单看板、下载、整编页都从这里取，结论只可能有一份。 */
export function prepareFlowRows(rows: EntryRow[]): { rows: EntryRow[]; changed: boolean } {
  let changed = false
  const next = rows.map((row) => {
    const migrated = migrateFlowRow(row)
    if (migrated !== row) {
      changed = true
    }
    return migrated
  })
  return { rows: next, changed }
}

/** 整编任务清单候选：只有统一判定 canCompile 的测量会出现，同一测量唯一键去重。 */
export function listFlowCandidates(rows: EntryRow[], tasks: EntryRow[]): FlowCandidate[] {
  const occupied = new Set(
    tasks.map((task) => String(task[FLOW_KEY_FIELD] ?? '')).filter((key) => key !== ''),
  )
  const seen = new Set<string>()
  const candidates: FlowCandidate[] = []
  for (const row of rows) {
    const decision = classifyFlow(row)
    if (!decision.canCompile) {
      continue
    }
    const key = measurementKey(row)
    if (seen.has(key) || occupied.has(key)) {
      continue
    }
    seen.add(key)
    candidates.push({
      id: Number(row.id),
      key,
      recordNo: String(row['记录编号'] ?? ''),
      stationNo: String(row['站点编号'] ?? ''),
    })
  }
  return candidates
}

function compileYear(row: EntryRow): string {
  const match = String(row['测量时间'] ?? '').match(/(\d{4})/)
  return match ? match[1] : '未标注'
}

/**
 * 统一分单流程（页面动作入口与整编页分单入口都走这一份）：
 * 最终状态由统一判定决定；同一测量只能生成一个整编任务。
 */
export function dispatchFlowToCompilation(
  row: EntryRow,
  tasks: EntryRow[],
): { ok: boolean; message: string; task?: CompilationTask } {
  const decision = classifyFlow(row)
  if (!decision.canCompile) {
    return { ok: false, message: `记录当前为「${decision.status}」，只有已通过测量才能分单整编` }
  }
  const key = measurementKey(row)
  if (tasks.some((task) => String(task[FLOW_KEY_FIELD] ?? '') === key)) {
    return { ok: false, message: '该测量已进入整编任务，同一测量不能重复分单' }
  }
  const task: CompilationTask = {
    id: tasks.reduce((max, task) => Math.max(max, Number(task.id) || 0), 0) + 1,
    status: '待整编',
    pending: true,
    abnormal: false,
    成果编号: `COMP-FLOW-${String(row.id).padStart(4, '0')}`,
    整编年份: compileYear(row),
    站点编号: String(row['站点编号'] ?? ''),
    整编类型: '流量整编',
    原始记录数: 1,
    整编人: '待分配',
    审核人: '',
    整编状态: '待整编',
    [FLOW_KEY_FIELD]: key,
    [FLOW_NO_FIELD]: String(row['记录编号'] ?? ''),
  }
  return { ok: true, message: `已按统一流程分单，整编任务「${task.成果编号}」生成`, task }
}

export const FLOW_DISPATCH_TASK_FIELDS = {
  key: FLOW_KEY_FIELD,
  recordNo: FLOW_NO_FIELD,
  version: FLOW_VERSION_FIELD,
  compat: FLOW_COMPAT_FIELD,
} as const

export { FLOW_DISPATCH_ACTION }
