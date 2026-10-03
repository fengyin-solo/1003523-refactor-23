<template>
  <section class="page" data-module="discharge">
    <header class="page-head">
      <div>
        <h2>流量监测管理</h2>
        <p class="page-desc">
          围绕记录编号、站点编号、测量方法、断面流量做登记、审核与整编分单。
          页面动作、分单入口、下载与整编任务清单共用同一份状态判定。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记流量记录</button>
        <button class="btn" type="button" @click="exportRows">导出统一判定清单</button>
        <button class="btn ghost" type="button" @click="resetAll">重置示例数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
      <span class="legend-item">可整编未分单：{{ stats.eligible }}</span>
      <span class="legend-item">已分入整编任务：{{ stats.assigned }}</span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label class="filter-item">
        <span>记录编号</span>
        <input v-model="filters.记录编号" placeholder="按记录编号检索" />
      </label>
      <label class="filter-item">
        <span>站点编号</span>
        <input v-model="filters.站点编号" placeholder="按站点编号检索" />
      </label>
      <label class="filter-item">
        <span>测量方法</span>
        <input v-model="filters.测量方法" placeholder="按测量方法检索" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <!-- 分单入口：勾选测量后走统一提交流程，再由统一判定决定能否进入整编任务 -->
    <div class="dispatch-bar">
      <label class="select-all">
        <input type="checkbox" :checked="allSelected" :indeterminate.prop="someSelected" @change="toggleAll" />
        全选当前列表
      </label>
      <button class="btn primary" type="button" :disabled="!selectedIds.size" @click="dispatchSelected">
        提交并分单（选中 {{ selectedIds.size }} 条）
      </button>
      <button class="btn" type="button" @click="dispatchAllEligible">一键分单全部可整编测量</button>
      <span class="dispatch-hint">分单只认统一判定：已通过或旧版规范可兼容异常才可整编，同一测量只进一个任务。</span>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th>选择</th>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>异常兼容</th>
          <th>整编去向</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>
            <input type="checkbox" :checked="selectedIds.has(row.id)" @change="toggleOne(row.id)" />
          </td>
          <td>{{ row.记录编号 }}</td>
          <td>{{ row.站点编号 }}</td>
          <td>{{ row.测量方法 }}</td>
          <td>{{ row.断面流量 }}</td>
          <td>{{ row.最大流速 }}</td>
          <td>{{ row.过水面积 }}</td>
          <td>{{ row.测量时间 }}</td>
          <td>
            <span :class="['status-badge', `status-${row.verdict.status}`]">{{ row.verdict.statusLabel }}</span>
            <small class="version-tag">{{ row.测量方法版本 }}</small>
          </td>
          <td>
            <template v-if="row.verdict.abnormal">
              <span :class="['compat-tag', row.verdict.abnormalityCompatible ? 'compat-ok' : 'compat-no']">
                {{ row.verdict.abnormalityCompatible ? `可兼容（${row.异常原因}）` : '不兼容' }}
              </span>
            </template>
            <span v-else class="muted-text">—</span>
          </td>
          <td>
            <span v-if="row.verdict.assigned" class="assigned-tag">任务 #{{ row.assignedTaskId }}</span>
            <span v-else-if="row.verdict.compilationEligible" class="eligible-tag">可整编</span>
            <span v-else class="muted-text">—</span>
          </td>
          <td class="row-actions">
            <button
              v-if="canSubmit(row)"
              class="link"
              type="button"
              @click="runFlow(row.id, 'submit')"
            >
              提交审核
            </button>
            <button
              v-if="canConfirm(row)"
              class="link"
              type="button"
              @click="runFlow(row.id, 'confirm')"
            >
              确认通过
            </button>
            <button
              v-if="canMarkAbnormal(row)"
              class="link danger"
              type="button"
              @click="openAbnormal(row.id)"
            >
              标记异常
            </button>
            <span v-if="!hasAction(row)" class="muted-text">无（历史结果保持）</span>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 6" class="empty-state">暂无流量监测数据，可先登记流量记录</td>
        </tr>
      </tbody>
    </table>

    <!-- 异常原因弹窗：现行规范没有可兼容项，旧版规范仅接受白名单原因 -->
    <div v-if="abnormalTargetId !== null" class="modal-mask" @click.self="abnormalTargetId = null">
      <div class="modal-card">
        <h3>标记异常原因</h3>
        <p class="page-desc">异常原因将结合测量方法版本判定是否可兼容整编。</p>
        <label class="filter-item">
          <span>异常原因</span>
          <select v-model="abnormalReason">
            <option value="" disabled>请选择异常原因</option>
            <option v-for="reason in abnormalReasonOptions" :key="reason" :value="reason">{{ reason }}</option>
          </select>
        </label>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="abnormalTargetId = null">取消</button>
          <button class="btn primary" type="button" @click="confirmAbnormal">确认标记</button>
        </div>
      </div>
    </div>

    <!-- 登记弹窗：新记录固定落在现行测量方法版本 v2.0 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal-card">
        <h3>登记流量记录</h3>
        <div class="form-grid">
          <label class="filter-item"><span>站点编号 *</span><input v-model="form.站点编号" /></label>
          <label class="filter-item"><span>测量方法 *</span><input v-model="form.测量方法" placeholder="流速仪法 / 浮标法 / ADCP法" /></label>
          <label class="filter-item"><span>测量时间 *</span><input v-model="form.测量时间" type="date" /></label>
          <label class="filter-item"><span>断面流量</span><input v-model="form.断面流量" /></label>
          <label class="filter-item"><span>最大流速</span><input v-model="form.最大流速" /></label>
          <label class="filter-item"><span>过水面积</span><input v-model="form.过水面积" /></label>
          <label class="filter-item">
            <span>测量方法版本</span>
            <input value="v2.0（现行规范，新登记固定）" disabled />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="confirmCreate">保存登记</button>
        </div>
      </div>
    </div>

    <footer class="page-foot">
      <span>共 {{ stats.total }} 条流量监测记录 · 存量记录已补齐测量方法版本并归一化状态</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadBlob } from '@/api/download'
import {
  ABNORMAL_REASON_LABEL,
  canConfirm,
  canMarkAbnormal,
  canSubmit,
  createDischarge,
  dischargeStats,
  dispatchToCompilation,
  exportDischargeCsv,
  judgeRecord,
  listDischarge,
  resetDischarge,
  submitDischargeAction,
  type DischargeAction,
  type DischargeRowView,
} from '@/domain/discharge'

const columns = ['记录编号', '站点编号', '测量方法', '断面流量', '最大流速', '过水面积', '测量时间']

const rows = ref<DischargeRowView[]>([])
const stats = ref(dischargeStats())
const filters = ref({ 记录编号: '', 站点编号: '', 测量方法: '' })
const message = ref('')
const messageOk = ref(true)
const selectedIds = ref<Set<number>>(new Set())

const abnormalReasonOptions = [...Object.values(ABNORMAL_REASON_LABEL)]
const abnormalTargetId = ref<number | null>(null)
const abnormalReason = ref('')

const createOpen = ref(false)
const form = ref({ 站点编号: '', 测量方法: '', 测量时间: '', 断面流量: '', 最大流速: '', 过水面积: '' })

const statusSummary = computed(() =>
  (['已采集', '待确认', '已通过', '异常值'] as const).map((label) => ({
    status: label,
    count: rows.value.filter((row) => row.verdict.statusLabel === label).length,
  })),
)

const statCards = computed(() => [
  { label: '记录总数', value: stats.value.total },
  { label: '待确认', value: stats.value.pendingConfirm },
  { label: '已通过', value: stats.value.confirmed },
  { label: '异常记录', value: stats.value.abnormal },
  { label: '旧版可兼容异常', value: stats.value.compatible },
])

const allSelected = computed(() => rows.value.length > 0 && rows.value.every((row) => selectedIds.value.has(row.id)))
const someSelected = computed(
  () => rows.value.some((row) => selectedIds.value.has(row.id)) && !allSelected.value,
)

function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function hasAction(row: DischargeRowView): boolean {
  return canSubmit(row) || canConfirm(row) || canMarkAbnormal(row)
}

function reload() {
  rows.value = listDischarge(filters.value)
  stats.value = dischargeStats()
  // 清理已经不在筛选结果里的勾选
  const visible = new Set(rows.value.map((row) => row.id))
  selectedIds.value = new Set([...selectedIds.value].filter((id) => visible.has(id)))
}

function resetFilters() {
  filters.value = { 记录编号: '', 站点编号: '', 测量方法: '' }
  reload()
}

function exportRows() {
  const file = exportDischargeCsv(filters.value)
  downloadBlob(file.filename, file.content)
}

function resetAll() {
  resetDischarge()
  selectedIds.value = new Set()
  reload()
  notify('已恢复为迁移后的示例数据')
}

/** 页面动作入口：直接走统一流程 */
function runFlow(id: number, action: DischargeAction, reason = '') {
  const result = submitDischargeAction(id, action, reason)
  notify(result.message, result.ok)
  reload()
}

function openAbnormal(id: number) {
  abnormalTargetId.value = id
  abnormalReason.value = ''
}

function confirmAbnormal() {
  if (abnormalTargetId.value === null) {
    return
  }
  runFlow(abnormalTargetId.value, 'markAbnormal', abnormalReason.value)
  abnormalTargetId.value = null
}

function openCreate() {
  form.value = { 站点编号: '', 测量方法: '', 测量时间: '', 断面流量: '', 最大流速: '', 过水面积: '' }
  createOpen.value = true
}

function confirmCreate() {
  const result = createDischarge(form.value)
  notify(result.message, result.ok)
  if (result.ok) {
    createOpen.value = false
    reload()
  }
}

function toggleOne(id: number) {
  const next = new Set(selectedIds.value)
  if (next.has(id)) {
    next.delete(id)
  } else {
    next.add(id)
  }
  selectedIds.value = next
}

function toggleAll() {
  if (allSelected.value) {
    selectedIds.value = new Set()
  } else {
    selectedIds.value = new Set(rows.value.map((row) => row.id))
  }
}

/**
 * 分单入口：仍处于已采集的选中记录先经统一提交流程（与页面动作同一条路），
 * 最终状态由 transitionStatus 决定；随后统一判定决定哪些测量能进入整编任务。
 */
function dispatchSelected() {
  const ids = [...selectedIds.value]
  const submitted: string[] = []
  for (const row of rows.value.filter((item) => selectedIds.value.has(item.id))) {
    if (canSubmit(row)) {
      const result = submitDischargeAction(row.id, 'submit')
      if (result.ok) {
        submitted.push(row.记录编号)
      }
    }
  }
  const summary = dispatchToCompilation(ids)
  const parts = []
  if (submitted.length) {
    parts.push(`提交审核 ${submitted.length} 条（${submitted.join('、')}），需确认后才可整编`)
  }
  parts.push(summary.message)
  if (summary.skipped.length) {
    parts.push(`未收：${summary.skipped.map((item) => `${item.record.记录编号}（${item.reason}）`).join('；')}`)
  }
  notify(parts.join('。'), summary.created.length > 0 || submitted.length > 0)
  selectedIds.value = new Set()
  reload()
}

/** 一键分单：对全部通过统一判定、尚未分单的测量生成任务，天然去重 */
function dispatchAllEligible() {
  const eligibleIds = listDischarge(filters.value)
    .filter((row) => judgeRecord(row).compilationEligible && !judgeRecord(row).assigned)
    .map((row) => row.id)
  if (!eligibleIds.length) {
    notify('当前没有符合整编条件且未分单的测量')
    return
  }
  const summary = dispatchToCompilation(eligibleIds)
  notify(summary.message, true)
  reload()
}

onMounted(reload)
</script>
