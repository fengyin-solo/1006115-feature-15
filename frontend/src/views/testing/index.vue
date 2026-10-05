<template>
  <section class="page" data-module="testing">
    <header class="page-head">
      <div>
        <h2>试验检测管理</h2>
        <p class="page-desc">维护试验委托。浆液批次委托的配料核对结论与拌制站同源：未核对或水泥/膨润土偏差超线的批次不许送样。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记试验委托</button>
        <button class="btn" type="button" @click="exportRows">导出试验检测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待送样委托</span>
        <strong class="stat-value">{{ pendingSample }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">检测中委托</span>
        <strong class="stat-value">{{ testingCount }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">配料偏差批次（与同步注浆待用清单同一份）</span>
        <strong class="stat-value bad-text">{{ deviationBatches.length }}</strong>
      </article>
    </div>

    <div class="rule-panel">
      <h3>配料偏差批次（只读，数据源＝浆液拌制核对记录）</h3>
      <p v-if="!deviationBatches.length" class="rule-line ok-text">当前没有偏差批次。</p>
      <p v-for="check in deviationBatches" :key="check.batchNo" class="rule-line">
        <strong>{{ check.batchNo }}</strong>（{{ check.mixedAt }}，领料单 {{ check.requisitionNo || '—' }}）：
        <span class="bad-text">{{ check.failedItems.join('；') }}</span>
      </p>
    </div>

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
            <template v-if="column === '批次核对结论'">
              <span v-if="!row[column]" class="muted-text">—</span>
              <span v-else :class="String(row[column]).startsWith('合格') ? 'ok-text' : 'bad-text'">{{ row[column] }}</span>
            </template>
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

    <footer class="page-foot">
      <span>共 {{ total }} 条试验委托；偏差批次条数以拌制站核对记录为准</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listDeviationBatches,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, MortarCheck } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('testing')
const columns = ["委托编号", "试样类型", "浆液批次编号", "检测项目", "送样日期", "检测机构", "批次核对结论", "委托状态"]
const actions = ["送样委托", "出具报告", "登记不合格"]
const statuses = ["待送样", "检测中", "已出报告", "不合格"]

const rows = ref<EntryRow[]>([])
const deviationBatches = ref<MortarCheck[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["委托编号", "试样类型", "浆液批次编号"]
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const pendingSample = computed(() => rows.value.filter((row) => String(row.status) === '待送样').length)
const testingCount = computed(() => rows.value.filter((row) => String(row.status) === '检测中').length)

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
  const result = applyAction(meta.key, Number(row.id), action, { role: store.role })
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
    deviationBatches.value = listDeviationBatches()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '试验检测列表读取失败'
  }
}

onMounted(reload)
</script>
