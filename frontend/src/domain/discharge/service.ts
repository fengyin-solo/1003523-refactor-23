import {
  CURRENT_METHOD_VERSION,
  METHOD_VERSION_LABEL,
  type DischargeAction,
  type DischargeRecord,
} from './types'
import { judgeRecord, newRecordDefaults, transitionStatus } from './status-flow'
import { dischargeStore, resetDischargeStore, saveDischargeStore } from './store'

export type { DischargeRecord } from './types'

export type DischargeRowView = DischargeRecord & {
  verdict: ReturnType<typeof judgeRecord>
  测量方法版本Label: string
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type DischargeStats = {
  total: number
  pendingConfirm: number
  confirmed: number
  abnormal: number
  compatible: number
  eligible: number
  assigned: number
}

function toView(record: DischargeRecord): DischargeRowView {
  return {
    ...record,
    verdict: judgeRecord(record),
    测量方法版本Label: METHOD_VERSION_LABEL[record.测量方法版本],
  }
}

export function listDischarge(filters: Record<string, string> = {}): DischargeRowView[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  return dischargeStore()
    .records.map(toView)
    .filter((row) =>
      pairs.every(([field, value]) =>
        String(row[field as keyof DischargeRowView] ?? '').includes(value.trim()),
      ),
    )
}

export function dischargeStats(): DischargeStats {
  const records = dischargeStore().records.map(judgeRecord)
  return {
    total: records.length,
    pendingConfirm: records.filter((item) => item.awaitingConfirm).length,
    confirmed: records.filter((item) => item.status === 'confirmed').length,
    abnormal: records.filter((item) => item.abnormal).length,
    compatible: records.filter((item) => item.abnormalityCompatible).length,
    eligible: records.filter((item) => item.compilationEligible && !item.assigned).length,
    assigned: records.filter((item) => item.assigned).length,
  }
}

/**
 * 统一动作入口：页面动作与分单入口提交都走这里。
 * 由 transitionStatus 内的唯一判定决定能否流转与最终状态。
 */
export function submitDischargeAction(
  id: number,
  action: DischargeAction,
  abnormalReason = '',
): ActionResult {
  const store = dischargeStore()
  const index = store.records.findIndex((row) => row.id === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的流量记录` }
  }
  const result = transitionStatus(store.records[index], action, abnormalReason)
  if (!result.ok || !result.status) {
    return { ok: result.ok, message: result.message }
  }
  const next: DischargeRecord = {
    ...store.records[index],
    status: result.status,
    异常原因: action === 'markAbnormal' ? abnormalReason : '',
  }
  store.records[index] = next
  saveDischargeStore(store)
  return { ok: true, message: result.message }
}

export type NewDischargeInput = {
  站点编号: string
  测量方法: string
  断面流量: string
  最大流速: string
  过水面积: string
  测量时间: string
}

export function createDischarge(input: NewDischargeInput): ActionResult {
  if (!input.站点编号.trim() || !input.测量方法.trim() || !input.测量时间.trim()) {
    return { ok: false, message: '站点编号、测量方法、测量时间为必填项' }
  }
  const store = dischargeStore()
  const id = store.records.reduce((max, row) => Math.max(max, row.id), 0) + 1
  const record: DischargeRecord = {
    id,
    记录编号: `DISC-${String(id).padStart(4, '0')}`,
    站点编号: input.站点编号.trim(),
    测量方法: input.测量方法.trim(),
    断面流量: input.断面流量.trim(),
    最大流速: input.最大流速.trim(),
    过水面积: input.过水面积.trim(),
    测量时间: input.测量时间.trim(),
    ...newRecordDefaults(),
  }
  store.records.push(record)
  saveDischargeStore(store)
  return { ok: true, message: `流量记录 ${record.记录编号} 已登记，测量方法版本 ${CURRENT_METHOD_VERSION}` }
}

/** 下载前同样只信统一判定：导出列中的状态来自 verdict，旧的 pending/abnormal 不参与 */
export function exportDischargeCsv(filters: Record<string, string> = {}): {
  filename: string
  content: string
} {
  const rows = listDischarge(filters)
  const header = [
    '记录编号',
    '站点编号',
    '测量方法',
    '测量方法版本',
    '断面流量',
    '最大流速',
    '过水面积',
    '测量时间',
    '统一判定状态',
    '待确认',
    '异常',
    '异常兼容',
    '可整编',
    '已分单',
    '异常原因',
  ]
  const lines = [header.join(',')]
  for (const row of rows) {
    const v = row.verdict
    lines.push(
      [
        row.记录编号,
        row.站点编号,
        row.测量方法,
        row.测量方法版本,
        row.断面流量,
        row.最大流速,
        row.过水面积,
        row.测量时间,
        v.statusLabel,
        v.awaitingConfirm ? '是' : '否',
        v.abnormal ? '是' : '否',
        v.abnormalityCompatible ? '是' : '否',
        v.compilationEligible ? '是' : '否',
        v.assigned ? '是' : '否',
        row.异常原因,
      ].join(','),
    )
  }
  return {
    filename: '流量监测-统一判定清单.csv',
    content: `﻿${lines.join('\n')}`,
  }
}

export function resetDischarge(): void {
  resetDischargeStore()
}

export type { DischargeVerdict } from './types'
