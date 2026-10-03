import {
  CURRENT_METHOD_VERSION,
  DISCHARGE_STATUS_LABEL,
  LEGACY_COMPATIBLE_REASONS,
  type DischargeAction,
  type DischargeRecord,
  type DischargeStatus,
  type DischargeVerdict,
} from './types'

/**
 * 唯一的状态判定入口。
 * 页面动作能不能点、分单收不收、下载标什么、整编任务认不认，全部来自这里，
 * 避免同一测量在多处判断不一致（已通过被当成待确认、异常残留旧标记等问题）。
 */
export function judgeRecord(record: DischargeRecord): DischargeVerdict {
  const status = record.status
  const abnormal = status === 'abnormal'
  const abnormalityCompatible =
    abnormal &&
    record.测量方法版本 === 'v1.0' &&
    (LEGACY_COMPATIBLE_REASONS as readonly string[]).includes(record.异常原因)
  const assigned = record.assignedTaskId !== null
  return {
    status,
    statusLabel: DISCHARGE_STATUS_LABEL[status],
    pending: status !== 'confirmed',
    abnormal,
    awaitingConfirm: status === 'pendingConfirm',
    abnormalityCompatible,
    compilationEligible: status === 'confirmed' || abnormalityCompatible,
    assigned,
  }
}

export function canSubmit(record: DischargeRecord): boolean {
  return record.status === 'collected'
}

export function canConfirm(record: DischargeRecord): boolean {
  return record.status === 'pendingConfirm'
}

export function canMarkAbnormal(record: DischargeRecord): boolean {
  // 已通过是历史结果，保持原结论，不允许再翻成异常
  return record.status === 'collected' || record.status === 'pendingConfirm'
}

const NEXT_STATUS: Record<DischargeAction, DischargeStatus | null> = {
  submit: 'pendingConfirm',
  confirm: 'confirmed',
  markAbnormal: 'abnormal',
}

const ACTION_LABEL: Record<DischargeAction, string> = {
  submit: '提交审核',
  confirm: '确认通过',
  markAbnormal: '标记异常',
}

export type FlowResult = {
  ok: boolean
  message: string
  status?: DischargeStatus
}

/**
 * 两个入口（页面动作、分单入口）共同走的统一提交流程：
 * 先过同一份状态判定，再决定能否流转以及流转到哪。已通过的历史记录直接拦下，
 * 从根上保证同一测量不会在重复提交时再次进入待确认、进而重复生成整编任务。
 */
export function transitionStatus(
  record: DischargeRecord,
  action: DischargeAction,
  abnormalReason = '',
): FlowResult {
  const allowed =
    action === 'submit'
      ? canSubmit(record)
      : action === 'confirm'
        ? canConfirm(record)
        : canMarkAbnormal(record)
  if (!allowed) {
    return {
      ok: false,
      message: `当前状态「${DISCHARGE_STATUS_LABEL[record.status]}」不允许执行「${ACTION_LABEL[action]}」`,
    }
  }
  if (action === 'markAbnormal' && !abnormalReason) {
    return { ok: false, message: '标记异常必须填写异常原因，便于按测量方法版本判定兼容性' }
  }
  const status = NEXT_STATUS[action]
  if (!status) {
    return { ok: false, message: '未知的流程动作' }
  }
  return {
    ok: true,
    message: `已${ACTION_LABEL[action]}，最终状态「${DISCHARGE_STATUS_LABEL[status]}」`,
    status,
  }
}

/** 新登记记录默认落在现行测量方法版本与已采集状态 */
export function newRecordDefaults(): Pick<DischargeRecord, '测量方法版本' | 'status' | 'assignedTaskId' | '异常原因'> {
  return { 测量方法版本: CURRENT_METHOD_VERSION, status: 'collected', assignedTaskId: null, 异常原因: '' }
}
