<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编任务清单</h2>
        <p class="page-desc">
          整编任务由流量测量分单生成，是否可整编完全复用流量侧的统一判定；
          同一测量只能进入一个整编任务，已刊印成果保持原结果。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="dispatchAll">扫描并生成整编任务</button>
        <button class="btn" type="button" @click="exportTasks">导出整编任务清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in statCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <h3 class="section-title">整编任务</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>任务编号</th>
          <th>整编年份</th>
          <th>站点编号</th>
          <th>测量方法 / 版本</th>
          <th>纳入测量（记录编号）</th>
          <th>原始记录数</th>
          <th>创建时间</th>
          <th>任务状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="task in tasks" :key="task.id">
          <td>{{ task.任务编号 }}</td>
          <td>{{ task.整编年份 }}</td>
          <td>{{ task.站点编号 }}</td>
          <td>{{ task.测量方法 }} <small class="version-tag">{{ task.测量方法版本 }}</small></td>
          <td>{{ task.记录编号.join('、') }}</td>
          <td>{{ task.原始记录数 }}</td>
          <td>{{ task.创建时间 }}</td>
          <td><span :class="['task-badge', `task-${task.状态}`]">{{ task.状态 }}</span></td>
          <td class="row-actions">
            <button v-if="task.状态 === '待整编'" class="link" type="button" @click="taskAction(task.id, '开始整编')">
              开始整编
            </button>
            <button v-if="task.状态 === '整编中'" class="link" type="button" @click="taskAction(task.id, '刊印成果')">
              刊印成果
            </button>
            <span v-if="task.状态 === '已刊印'" class="muted-text">已归档</span>
          </td>
        </tr>
        <tr v-if="!tasks.length">
          <td colspan="9" class="empty-state">暂无整编任务，可在流量监测页分单，或点击上方扫描生成</td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">测量整编资格（与流量页同一份判定）</h3>
    <table class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>站点编号</th>
          <th>测量方法 / 版本</th>
          <th>测量时间</th>
          <th>统一判定状态</th>
          <th>异常兼容</th>
          <th>整编资格</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in measurements" :key="row.id">
          <td>{{ row.记录编号 }}</td>
          <td>{{ row.站点编号 }}</td>
          <td>{{ row.测量方法 }} <small class="version-tag">{{ row.测量方法版本 }}</small></td>
          <td>{{ row.测量时间 }}</td>
          <td>
            <span :class="['status-badge', `status-${row.verdict.status}`]">{{ row.verdict.statusLabel }}</span>
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
            <span v-if="row.verdict.assigned" class="assigned-tag">已入任务 #{{ row.assignedTaskId }}</span>
            <span v-else-if="row.verdict.compilationEligible" class="eligible-tag">可整编，待分单</span>
            <span v-else class="muted-text">不具备资格</span>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ tasks.length }} 个整编任务 · 已纳入测量 {{ stats.assigned }} / {{ stats.total }}</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadBlob } from '@/api/download'
import {
  dischargeStats,
  dispatchToCompilation,
  listDischarge,
  listTasks,
  runTaskAction,
  type CompilationTask,
  type DischargeRowView,
} from '@/domain/discharge'

const tasks = ref<CompilationTask[]>([])
const measurements = ref<DischargeRowView[]>([])
const stats = ref(dischargeStats())
const message = ref('')
const messageOk = ref(true)

const statCards = computed(() => [
  { label: '整编任务总数', value: tasks.value.length },
  { label: '待整编', value: tasks.value.filter((task) => task.状态 === '待整编').length },
  { label: '整编中', value: tasks.value.filter((task) => task.状态 === '整编中').length },
  { label: '已刊印', value: tasks.value.filter((task) => task.状态 === '已刊印').length },
  { label: '可整编未分单', value: stats.value.eligible },
])

function notify(text: string, ok = true) {
  message.value = text
  messageOk.value = ok
}

function reload() {
  tasks.value = listTasks()
  measurements.value = listDischarge()
  stats.value = dischargeStats()
}

function dispatchAll() {
  const summary = dispatchToCompilation()
  notify(
    summary.created.length
      ? summary.message
      : `没有新的可整编测量（${summary.duplicated.length} 条已分单，${summary.skipped.length} 条不具备资格）`,
    summary.created.length > 0,
  )
  reload()
}

function taskAction(taskId: number, action: string) {
  const result = runTaskAction(taskId, action)
  notify(result.message, result.ok)
  reload()
}

function exportTasks() {
  const header = ['任务编号', '整编年份', '站点编号', '测量方法', '测量方法版本', '记录编号', '原始记录数', '创建时间', '任务状态']
  const lines = [header.join(',')]
  for (const task of tasks.value) {
    lines.push(
      [
        task.任务编号,
        task.整编年份,
        task.站点编号,
        task.测量方法,
        task.测量方法版本,
        `"${task.记录编号.join('、')}"`,
        task.原始记录数,
        task.创建时间,
        task.状态,
      ].join(','),
    )
  }
  downloadBlob('流量整编任务清单.csv', `﻿${lines.join('\n')}`)
}

onMounted(reload)
</script>
