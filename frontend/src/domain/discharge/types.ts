/**
 * 流量记录领域模型：状态、测量方法版本与整编任务的唯一事实来源。
 * 页面动作、分单入口、下载、整编任务清单都只通过这里读判定结果，不再各自维护判断。
 */

/** 流量记录的业务终态枚举（页面展示与判定都以它为准） */
export type DischargeStatus = 'collected' | 'pendingConfirm' | 'confirmed' | 'abnormal'

export const DISCHARGE_STATUS_LABEL: Record<DischargeStatus, string> = {
  collected: '已采集',
  pendingConfirm: '待确认',
  confirmed: '已通过',
  abnormal: '异常值',
}

/** 测量方法版本：存量记录补齐为旧版规范，新登记一律走现行规范 */
export type MethodVersion = 'v1.0' | 'v2.0'

export const CURRENT_METHOD_VERSION: MethodVersion = 'v2.0'

export const METHOD_VERSION_LABEL: Record<MethodVersion, string> = {
  'v1.0': '流速仪测流规范 v1.0（旧版）',
  'v2.0': '流速仪测流规范 v2.0（现行）',
}

/** 旧版规范允许兼容接收的异常原因；现行规范不接受任何异常兼容 */
export const LEGACY_COMPATIBLE_REASONS = ['借用过水面积', '浮标系数沿用'] as const
export type LegacyCompatibleReason = (typeof LEGACY_COMPATIBLE_REASONS)[number]

export const ABNORMAL_REASON_LABEL: Record<string, string> = {
  借用过水面积: '借用过水面积',
  浮标系数沿用: '浮标系数沿用',
  其他异常: '其他异常',
}

/** 分单/提交入口：两个入口共用同一提交流程，只在任务去重策略上区分 */
export type SubmitEntry = 'pageAction' | 'dispatch'

/** 统一流程支持的动作 */
export type DischargeAction = 'submit' | 'confirm' | 'markAbnormal'

export type DischargeRecord = {
  id: number
  记录编号: string
  站点编号: string
  测量方法: string
  测量方法版本: MethodVersion
  断面流量: string
  最大流速: string
  过水面积: string
  测量时间: string
  异常原因: string
  /** 归一化后的规范状态；status/pending/abnormal 历史字段不再参与判定 */
  status: DischargeStatus
  /** 该记录是否已被整编任务占用（按测量编号全局唯一） */
  assignedTaskId: number | null
}

/** 统一判定结果：所有消费方（动作、分单、下载、整编清单）都只读这一份 */
export type DischargeVerdict = {
  status: DischargeStatus
  statusLabel: string
  pending: boolean
  abnormal: boolean
  /** 该记录当前是否处于待确认（只有它才允许确认通过） */
  awaitingConfirm: boolean
  /** 异常记录是否能被旧版规范兼容接收 */
  abnormalityCompatible: boolean
  /** 是否可进入整编：已通过，或旧版规范下可兼容的异常 */
  compilationEligible: boolean
  /** 是否已分入整编任务 */
  assigned: boolean
}

export type CompilationTaskStatus = '待整编' | '整编中' | '已刊印'

export type CompilationTask = {
  id: number
  任务编号: string
  整编年份: string
  站点编号: string
  测量方法: string
  测量方法版本: MethodVersion
  记录编号: string[]
  原始记录数: number
  创建时间: string
  状态: CompilationTaskStatus
}
