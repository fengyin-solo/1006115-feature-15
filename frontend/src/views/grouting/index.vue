<template>
  <section class="page" data-module="grouting">
    <header class="page-head">
      <div>
        <h2>同步注浆管理</h2>
        <p class="page-desc">维护注浆记录。待用浆液批次清单按拌制站核对结论读取，偏差批次与试验检测委托清单读到的是同一份。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记注浆记录</button>
        <button class="btn" type="button" @click="exportRows">导出同步注浆清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待用/在用浆液批次</span>
        <strong class="stat-value">{{ readyBatches.length }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">其中核对合格</span>
        <strong class="stat-value ok-text">{{ readyPassed }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">配料偏差批次（与试验检测同一份）</span>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无同步注浆数据，可先登记注浆记录</td>
        </tr>
      </tbody>
    </table>

    <div class="sub-table-wrap">
      <h3>待用浆液批次清单（核对结论、合格与否均从拌制站同一份核对记录读）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次编号</th>
            <th>浆液类型</th>
            <th>领料单号</th>
            <th>拌制日期</th>
            <th>水泥 配方/实际/偏差</th>
            <th>膨润土 配方/实际/偏差</th>
            <th>水灰比 设计/实测/偏差</th>
            <th>稠度 设计/实测/偏差</th>
            <th>核对结论</th>
            <th>批次状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="batch in readyBatches" :key="String(batch['批次编号'])">
            <td>{{ batch['批次编号'] }}</td>
            <td>{{ batch['浆液类型'] }}</td>
            <td>{{ batch['领料单号'] || '—' }}</td>
            <td>{{ batch['拌制日期'] }}</td>
            <td>{{ batch['配方水泥用量'] || '—' }}/{{ batch['水泥用量'] || '—' }}/{{ batch['水泥偏差'] || '—' }}</td>
            <td>{{ batch['配方膨润土用量'] || '—' }}/{{ batch['膨润土用量'] || '—' }}/{{ batch['膨润土偏差'] || '—' }}</td>
            <td>{{ batch['设计水灰比'] || '—' }}/{{ batch['水灰比'] || '—' }}/{{ batch['水灰比偏差'] || '—' }}</td>
            <td>{{ batch['设计稠度'] || '—' }}/{{ batch['稠度'] || '—' }}/{{ batch['稠度偏差'] || '—' }}</td>
            <td>
              <span v-if="!batch['核对结论']" class="muted-text">未核对，不许提交检验/送样</span>
              <span v-else :class="String(batch['核对结论']).startsWith('合格') ? 'ok-text' : 'bad-text'">{{ batch['核对结论'] }}</span>
            </td>
            <td>{{ batch.status }}</td>
          </tr>
          <tr v-if="!readyBatches.length">
            <td colspan="10" class="empty-state">暂无待用浆液批次</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条同步注浆记录；两处入口读到的偏差批次数一致：{{ deviationBatches.length }}</span>
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
  listReadyBatches,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, MortarCheck } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('grouting')
const columns = ["注浆编号", "对应环号", "浆液批次编号", "浆液配比", "注浆量", "注浆压力", "初凝时间", "注浆班组", "批次核对结论", "注浆状态"]
const actions = ["开始注浆", "确认完成", "安排补浆"]
const statuses = ["待注浆", "注浆中", "已完成", "已补浆"]

const rows = ref<EntryRow[]>([])
const readyBatches = ref<EntryRow[]>([])
const deviationBatches = ref<MortarCheck[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ["注浆编号", "对应环号", "浆液批次编号"]
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const readyPassed = computed(
  () => readyBatches.value.filter((row) => String(row['核对结论'] ?? '').startsWith('合格')).length,
)

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
    readyBatches.value = listReadyBatches()
    deviationBatches.value = listDeviationBatches()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '同步注浆列表读取失败'
  }
}

onMounted(reload)
</script>
