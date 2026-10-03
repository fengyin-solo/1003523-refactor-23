import {
  FLOW_DISPATCH_ACTION,
  applyFlowAction,
  classifyFlow,
  measurementKey,
} from '@/domain/discharge/flow'
import {
  FLOW_DISPATCH_TASK_FIELDS,
  dispatchFlowToCompilation,
  listFlowCandidates,
  prepareFlowRows,
} from '@/domain/discharge/compilation-domain'
import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FlowCandidate,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const DISCHARGE_KEY = 'discharge'
const COMPILATION_KEY = 'compilation'

/** 取出流量记录时永远过一遍统一判定，保证页面拿到的标记与判定结论一致。 */
function listDischargeRows(): EntryRow[] {
  const { rows, changed: migrated } = prepareFlowRows(listRows(DISCHARGE_KEY))
  const normalized = rows.map((row) => {
    const decision = classifyFlow(row)
    if (row.pending === decision.pending && row.abnormal === decision.abnormal) {
      return row
    }
    return { ...row, pending: decision.pending, abnormal: decision.abnormal }
  })
  const flagsChanged = normalized.some((row, index) => row !== rows[index])
  if (migrated || flagsChanged) {
    saveRows(DISCHARGE_KEY, normalized)
  }
  return normalized
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const source = key === DISCHARGE_KEY ? listDischargeRows() : listRows(key)
  const matched = filterRows(source, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 流量模块的动作统一交给状态机处理；分单整编由统一流程生成整编任务。 */
function runDischargeAction(id: number, action: string): ActionResult {
  const rows = listDischargeRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的流量记录` }
  }
  const current = rows[index]
  if (action === FLOW_DISPATCH_ACTION) {
    const tasks = listRows(COMPILATION_KEY)
    const result = dispatchFlowToCompilation(current, tasks)
    if (!result.ok || !result.task) {
      return { ok: false, message: result.message }
    }
    saveRows(COMPILATION_KEY, [...tasks, result.task])
    return { ok: true, message: result.message }
  }
  const result = applyFlowAction(current, action)
  if (!result.ok || !result.row) {
    return { ok: false, message: result.message }
  }
  const next = [...rows]
  next[index] = result.row
  saveRows(DISCHARGE_KEY, next)
  return { ok: true, message: result.message }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  if (key === DISCHARGE_KEY) {
    return runDischargeAction(id, action)
  }
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

/** 整编任务清单：复用统一判定，列出可分单且尚未进入任何整编任务的流量测量。 */
export function listDispatchCandidates(): FlowCandidate[] {
  return listFlowCandidates(listDischargeRows(), listRows(COMPILATION_KEY))
}

/** 整编页分单入口：与流量页分单动作走同一个统一流程。 */
export function dispatchDischargeToCompilation(id: number): ActionResult {
  return runDischargeAction(id, FLOW_DISPATCH_ACTION)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const isDischarge = key === DISCHARGE_KEY
  const header = isDischarge
    ? ['编号', ...meta.fields, FLOW_DISPATCH_TASK_FIELDS.version, FLOW_DISPATCH_TASK_FIELDS.compat, '整编判定', '当前状态']
    : ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  const source = isDischarge ? listDischargeRows() : listRows(key)
  const occupied = isDischarge
    ? new Set(
        listRows(COMPILATION_KEY)
          .map((task) => String(task[FLOW_DISPATCH_TASK_FIELDS.key] ?? ''))
          .filter((item) => item !== ''),
      )
    : new Set<string>()
  for (const row of source) {
    if (isDischarge) {
      const decision = classifyFlow(row)
      const judgeLabel = decision.abnormal
        ? '异常不可整编'
        : decision.approved
          ? occupied.has(measurementKey(row))
            ? '已进入整编'
            : '可整编'
          : '待确认'
      lines.push(
        [
          row.id,
          ...meta.fields.map((field) => row[field] ?? ''),
          row[FLOW_DISPATCH_TASK_FIELDS.version] ?? '',
          row[FLOW_DISPATCH_TASK_FIELDS.compat] ?? '',
          judgeLabel,
          row.status,
        ].join(','),
      )
      continue
    }
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = meta.key === DISCHARGE_KEY ? listDischargeRows() : rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) =>
        meta.key === DISCHARGE_KEY ? classifyFlow(row).pending : row.pending,
      ).length,
      abnormal: entries.filter((row) =>
        meta.key === DISCHARGE_KEY ? classifyFlow(row).abnormal : row.abnormal,
      ).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
