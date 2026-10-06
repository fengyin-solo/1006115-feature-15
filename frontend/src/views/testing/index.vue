<template>
  <section class="page" data-module="testing">
    <header class="page-head">
      <div>
        <h2>试验检测管理</h2>
        <p class="page-desc">维护试验委托，围绕委托编号、试样类型、检测项目、送样日期做登记、筛选与状态流转；浆液批次委托的配料核对结论直接读浆液拌制那一份。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记试验委托</button>
        <button class="btn" type="button" @click="exportRows">导出试验检测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="rule-banner">浆液批次委托的配料核对结论由浆液拌制模块统一出具，本清单只读取、不另判：当前配料偏差批次 {{ deviationList.length }} 条（{{ deviationText || '无' }}）。</p>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th v-for="column in columns" :key="column">{{ column }}</th>
            <th>当前状态</th>
            <th>可执行动作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in columns" :key="column">
              <span v-if="column === '配料核对结论'" :class="conclusionClass(row.配料核对结论)">{{ row[column] ?? '—' }}</span>
              <template v-else>{{ row[column] ?? '—' }}</template>
            </td>
            <td>{{ row.status }}</td>
            <td class="row-actions">
              <button
                v-for="action in actions"
                :key="action"
                class="link"
                type="button"
                @click="runAction(action, row)"
              >
                {{ action }}
              </button>
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 2" class="empty-state">暂无试验检测数据，可先登记试验委托</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条试验委托记录；配料偏差批次与同步注浆待用批次清单同源同条数。</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { deviationBatches } from '@/api/mortar-check'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('testing')
const columns = ["委托编号", "试样类型", "检测项目", "关联批次编号", "送样日期", "检测结果", "报告编号", "检测机构", "配料核对结论", "委托状态"]
const actions = ["送样委托", "出具报告", "登记不合格"]
const statuses = ["待送样", "检测中", "已出报告", "不合格"]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["委托编号", "试样类型", "关联批次编号"]
const deviationList = ref<{ 批次编号: string; 结论说明: string }[]>([])
const deviationText = computed(() => deviationList.value.map((item) => item.批次编号).join('、'))
const stats = computed(() => [
  { label: '待送样委托', value: rows.value.filter((row) => String(row.status) === '待送样').length },
  { label: '检测中委托', value: rows.value.filter((row) => String(row.status) === '检测中').length },
  { label: '配料偏差批次', value: deviationList.value.length },
  { label: '不合格项', value: rows.value.filter((row) => String(row.status) === '不合格').length },
])
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function conclusionClass(value: unknown): string {
  const text = String(value ?? '')
  if (text.startsWith('核对合格')) {
    return 'tag pass'
  }
  if (text.startsWith('核对不合格')) {
    return 'tag fail'
  }
  return 'tag wait'
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '试验委托登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, store.operator)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    deviationList.value = deviationBatches()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '试验检测列表读取失败'
  }
}

onMounted(reload)
</script>
