import { dischargeStore, saveDischargeStore } from './store'
import { judgeRecord } from './status-flow'
import type { CompilationTask, CompilationTaskStatus, DischargeRecord } from './types'

/**
 * 整编任务服务：任务清单与分单入口共用同一套判定（judgeRecord），
 * 去重键是测量编号（记录编号），保证同一测量只能进入一个整编任务。
 */

export type DispatchSummary = {
  created: CompilationTask[]
  /** 因未通过统一判定而跳过的测量 */
  skipped: { record: DischargeRecord; reason: string }[]
  /** 已在其它整编任务中而跳过的测量 */
  duplicated: DischargeRecord[]
  message: string
}

function yearOf(record: DischargeRecord): string {
  return text(record.测量时间).slice(0, 4) || '未标注年份'
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value)
}

function groupKey(record: DischargeRecord): string {
  // 整编按「站点 + 年份 + 测量方法」归组，同一测量只可能落到唯一一组
  return `${record.站点编号}｜${yearOf(record)}｜${record.测量方法}`
}

/**
 * 为候选测量分单。只接收通过统一判定的记录：
 *  - 已通过，或旧版规范下可兼容的异常才可整编；
 *  - 已分入任务的测量直接跳过（同一测量不重复生成任务）。
 * 可选 onlyIds 限定本次分单范围（分单入口勾选提交时使用）。
 */
export function dispatchToCompilation(onlyIds?: number[]): DispatchSummary {
  const store = dischargeStore()
  const wanted = onlyIds ? new Set(onlyIds) : null
  const candidates = store.records.filter((record) => !wanted || wanted.has(record.id))

  const skipped: DispatchSummary['skipped'] = []
  const duplicated: DischargeRecord[] = []
  const buckets = new Map<string, DischargeRecord[]>()

  // 本次分单内部也按测量编号去重，防止同一记录被重复放入
  const seenInRun = new Set<number>()

  for (const record of candidates) {
    const verdict = judgeRecord(record)
    if (verdict.assigned) {
      duplicated.push(record)
      continue
    }
    if (!verdict.compilationEligible) {
      skipped.push({
        record,
        reason: verdict.abnormal
          ? `异常原因（${record.异常原因 || '未填原因'}）不满足 ${record.测量方法版本} 版本的兼容接收条件`
          : `状态为「${verdict.statusLabel}」，尚未通过确认`,
      })
      continue
    }
    if (seenInRun.has(record.id)) {
      duplicated.push(record)
      continue
    }
    seenInRun.add(record.id)
    const key = groupKey(record)
    const bucket = buckets.get(key)
    if (bucket) {
      bucket.push(record)
    } else {
      buckets.set(key, [record])
    }
  }

  const created: CompilationTask[] = []
  let nextTaskId = store.tasks.reduce((max, task) => Math.max(max, task.id), 0)

  for (const [key, members] of buckets) {
    const [first] = members
    const taskId = ++nextTaskId
    const task: CompilationTask = {
      id: taskId,
      任务编号: `TASK-${String(taskId).padStart(4, '0')}`,
      整编年份: yearOf(first),
      站点编号: first.站点编号,
      测量方法: first.测量方法,
      测量方法版本: first.测量方法版本,
      记录编号: members.map((item) => item.记录编号),
      原始记录数: members.length,
      创建时间: new Date().toISOString().slice(0, 10),
      状态: '待整编',
    }
    created.push(task)
    const assigned = new Set(members.map((item) => item.id))
    for (const record of store.records) {
      if (assigned.has(record.id)) {
        record.assignedTaskId = taskId
      }
    }
  }

  if (created.length) {
    store.tasks.push(...created)
    saveDischargeStore(store)
  }

  const message =
    `生成整编任务 ${created.length} 个` +
    (duplicated.length ? `，跳过已分单 ${duplicated.length} 条` : '') +
    (skipped.length ? `，不符合整编条件 ${skipped.length} 条` : '')

  return { created, skipped, duplicated, message }
}

export type TaskActionResult = {
  ok: boolean
  message: string
}

const TASK_FLOW: Record<string, CompilationTaskStatus> = {
  开始整编: '整编中',
  刊印成果: '已刊印',
}

export function runTaskAction(taskId: number, action: string): TaskActionResult {
  const store = dischargeStore()
  const task = store.tasks.find((item) => item.id === taskId)
  if (!task) {
    return { ok: false, message: `没有找到编号为 ${taskId} 的整编任务` }
  }
  const target = TASK_FLOW[action]
  if (!target) {
    return { ok: false, message: `整编任务没有登记「${action}」这个动作` }
  }
  if (task.状态 === target) {
    return { ok: false, message: `任务已经是「${target}」，不用重复操作` }
  }
  if (task.状态 === '已刊印') {
    // 已刊印是历史成果，保持原结果
    return { ok: false, message: '任务已刊印，成果归档后不再调整状态' }
  }
  task.状态 = target
  saveDischargeStore(store)
  return { ok: true, message: `任务已${action}，当前状态「${target}」` }
}

export function listTasks(): CompilationTask[] {
  return dischargeStore().tasks
}
