import type { EntryRow } from '@/data/types'

/**
 * 流量记录统一判定域。
 *
 * 页面动作、整编分单入口、下载导出三处一律以这里的结论为准，
 * 不允许再各自根据动作名或状态顺序猜测 pending / abnormal。
 */

export const FLOW_STATUS = {
  collected: '已采集',
  reviewing: '待审核',
  approved: '已通过',
  abnormal: '异常值',
} as const

/** 存量记录登记时没有记录方法版本，统一按现行《河流流量测验规范》兜底补齐。 */
export const FLOW_METHOD_VERSION_LEGACY = 'GB50179-2015'
/** 存量记录的异常按旧规则残留，迁移时打上兼容标识，新规则校验时对其放行。 */
export const FLOW_COMPAT_LEGACY = '存量兼容'
export const FLOW_COMPAT_CURRENT = '现行规则'

export const FLOW_VERSION_FIELD = '测量方法版本'
export const FLOW_COMPAT_FIELD = '异常兼容'

/** 分单整编不是流量状态流转，由整编域处理，这里仅保留统一动作名。 */
export const FLOW_DISPATCH_ACTION = '分单整编'

const PENDING_STATUSES: ReadonlySet<string> = new Set([FLOW_STATUS.collected, FLOW_STATUS.reviewing])

type Transition = {
  action: string
  from: readonly string[]
  to: string
}

/** 唯一合法的流量状态机；两个入口提交都只能走这张表。 */
const TRANSITIONS: readonly Transition[] = [
  { action: '提交审核', from: [FLOW_STATUS.collected], to: FLOW_STATUS.reviewing },
  { action: '确认通过', from: [FLOW_STATUS.reviewing], to: FLOW_STATUS.approved },
  { action: '标记异常', from: [FLOW_STATUS.collected, FLOW_STATUS.reviewing], to: FLOW_STATUS.abnormal },
  { action: '复核重报', from: [FLOW_STATUS.abnormal], to: FLOW_STATUS.collected },
]

const ACTIONS_BY_STATUS: Record<string, string[]> = {
  [FLOW_STATUS.collected]: ['提交审核', '标记异常'],
  [FLOW_STATUS.reviewing]: ['确认通过', '标记异常'],
  [FLOW_STATUS.approved]: [FLOW_DISPATCH_ACTION],
  [FLOW_STATUS.abnormal]: ['复核重报'],
}

export type FlowDecision = {
  status: string
  /** 仍需人工跟进：已采集、待审核。已通过是终态，不再算待确认。 */
  pending: boolean
  abnormal: boolean
  /** 已通过：历史成果终态，任何入口都不得再改动其状态。 */
  approved: boolean
  /** 只有已通过且非异常的测量才允许进入整编任务。 */
  canCompile: boolean
  actions: string[]
}

function deriveFlags(status: string): Pick<EntryRow, 'pending' | 'abnormal'> {
  return {
    pending: PENDING_STATUSES.has(status),
    abnormal: status === FLOW_STATUS.abnormal,
  }
}

/** 统一判定：一条流量记录当前是什么态、能做什么，全部由 status 单一来源派生。 */
export function classifyFlow(row: Pick<EntryRow, 'status'>): FlowDecision {
  const status = String(row.status)
  const flags = deriveFlags(status)
  const approved = status === FLOW_STATUS.approved
  return {
    status,
    ...flags,
    approved,
    canCompile: approved && !flags.abnormal,
    actions: ACTIONS_BY_STATUS[status] ?? [],
  }
}

/**
 * 同一测量的唯一键：站点 + 方法 + 方法版本 + 测量时间。
 * 版本不同视为不同测量（按新旧规范复测不算同一次）。
 */
export function measurementKey(row: EntryRow): string {
  const version = String(row[FLOW_VERSION_FIELD] ?? FLOW_METHOD_VERSION_LEGACY)
  return ['站点编号', '测量方法', '测量时间']
    .map((field) => String(row[field] ?? ''))
    .join('|')
    .concat(`|${version}`)
}

export type FlowActionResult = {
  ok: boolean
  message: string
  row?: EntryRow
}

/** 按统一状态机推进一条流量记录，返回写好 status/pending/abnormal 的新行。 */
export function applyFlowAction(row: EntryRow, action: string): FlowActionResult {
  const decision = classifyFlow(row)
  const version = String(row[FLOW_VERSION_FIELD] ?? '').trim()
  if (!version) {
    return { ok: false, message: '该记录缺少测量方法版本，请先完成存量兼容补齐再操作' }
  }
  const transition = TRANSITIONS.find((item) => item.action === action)
  if (!transition) {
    return { ok: false, message: `流量记录没有登记「${action}」这个动作` }
  }
  if (!transition.from.includes(decision.status)) {
    return { ok: false, message: `「${decision.status}」状态不能执行「${action}」` }
  }
  const next: EntryRow = { ...row, status: transition.to, ...deriveFlags(transition.to) }
  return { ok: true, message: `流量记录已${action}，当前状态「${transition.to}」`, row: next }
}

/**
 * 存量流量记录迁移（幂等）：
 * 1. 补齐测量方法版本（旧数据缺省 → 现行规范版本）；
 * 2. 补齐异常兼容标识（旧规则残留数据 → 存量兼容，新规则校验放行）；
 * 3. pending/abnormal 一律按统一判定重算，清掉残留旧标记；
 * 4. 绝不改动 status：历史已通过记录保持原结果。
 */
export function migrateFlowRow(row: EntryRow): EntryRow {
  const rawVersion = row[FLOW_VERSION_FIELD]
  const hasVersion = typeof rawVersion === 'string' && rawVersion.trim() !== ''
  const rawCompat = row[FLOW_COMPAT_FIELD]
  const hasCompat = typeof rawCompat === 'string' && rawCompat.trim() !== ''

  const next: EntryRow = { ...row }
  if (!hasVersion) {
    next[FLOW_VERSION_FIELD] = FLOW_METHOD_VERSION_LEGACY
  }
  if (!hasCompat) {
    next[FLOW_COMPAT_FIELD] = hasVersion ? FLOW_COMPAT_CURRENT : FLOW_COMPAT_LEGACY
  }
  return { ...next, ...deriveFlags(String(next.status)) }
}
