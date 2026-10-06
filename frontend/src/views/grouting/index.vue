<template>
  <section class="page" data-module="grouting">
    <header class="page-head">
      <div>
        <h2>同步注浆管理</h2>
        <p class="page-desc">维护注浆记录，围绕注浆编号、对应环号、浆液批次、浆液配比、注浆量做登记、筛选与状态流转；待用批次必须是配料核对合格的批次。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记注浆记录</button>
        <button class="btn" type="button" @click="exportRows">导出同步注浆清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="rule-banner">待用批次只认浆液拌制出具的同一份核对结论：当前配料偏差批次 {{ deviationList.length }} 条（{{ deviationText || '无' }}），未核对或偏差超标的批次不能开始注浆。</p>

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
            <td :colspan="columns.length + 2" class="empty-state">暂无同步注浆数据，可先登记注浆记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="sub-table-wrap">
      <h3>待用批次清单（浆液拌制核对合格、检验合格的批次，共 {{ readyBatches.length }} 条）</h3>
      <div class="table-scroll">
        <table class="data-table">
          <thead>
            <tr><th>批次编号</th><th>浆液类型</th><th>拌制日期</th><th>核对结论</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in readyBatches" :key="String(item.id)">
              <td>{{ item.批次编号 }}</td>
              <td>{{ item.浆液类型 }}</td>
              <td>{{ item.拌制日期 }}</td>
              <td><span class="tag pass">{{ item.核对结论 }}</span></td>
            </tr>
            <tr v-if="!readyBatches.length">
              <td colspan="4" class="empty-state">暂无核对合格的待用批次</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条注浆记录；偏差批次与试验检测委托清单同源同条数（{{ deviationList.length }} 条）。</span>
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
import { deviationBatches, readyMortarBatches } from '@/api/mortar-check'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('grouting')
const columns = ["注浆编号", "对应环号", "浆液批次编号", "浆液配比", "注浆量", "注浆压力", "初凝时间", "注浆班组", "配料核对结论", "注浆状态"]
const actions = ["开始注浆", "确认完成", "安排补浆"]
const statuses = ["待注浆", "注浆中", "已完成", "已补浆"]

const rows = ref<EntryRow[]>([])
const readyBatches = ref<EntryRow[]>([])
const deviationList = ref<{ 批次编号: string; 结论说明: string }[]>([])
const deviationText = computed(() => deviationList.value.map((item) => item.批次编号).join('、'))
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["注浆编号", "对应环号", "浆液批次编号"]
const stats = computed(() => [
  { label: '待用合格批次', value: readyBatches.value.length },
  { label: '配料偏差批次', value: deviationList.value.length },
  { label: '注浆中记录', value: rows.value.filter((row) => String(row.status) === '注浆中').length },
  { label: '待补浆记录', value: rows.value.filter((row) => String(row.status) === '已完成' || String(row.status) === '已补浆').length },
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
  errorMessage.value = '注浆记录登记入口尚未接入审批流'
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
    readyBatches.value = readyMortarBatches()
    deviationList.value = deviationBatches()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '同步注浆列表读取失败'
  }
}

onMounted(reload)
</script>
