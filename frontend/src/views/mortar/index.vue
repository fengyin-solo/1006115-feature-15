<template>
  <section class="page" data-module="mortar">
    <header class="page-head">
      <div>
        <h2>浆液拌制管理</h2>
        <p class="page-desc">按批次编号把配方用量、现场签认实际投料、领料单摆在一起核对；水泥、膨润土、水灰比、稠度任一超线即不许提交检验。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记浆液批次</button>
        <button class="btn" type="button" @click="exportRows">导出浆液拌制清单</button>
      </div>
    </header>

    <p class="rule-banner">{{ sourceRule }} 判定标准按拌制日期选版本，已冻结的核对结论不随后续调标改动。</p>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
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

    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th rowspan="2">批次编号</th>
            <th rowspan="2">浆液类型</th>
            <th rowspan="2">拌制日期</th>
            <th rowspan="2">方量(m³)</th>
            <th colspan="3">水泥用量(kg)</th>
            <th colspan="3">膨润土用量(kg)</th>
            <th colspan="2">水灰比</th>
            <th colspan="2">稠度(mm)</th>
            <th rowspan="2">核对结论</th>
            <th rowspan="2">适用标准</th>
            <th rowspan="2">核对时间</th>
            <th rowspan="2">当前状态</th>
            <th rowspan="2">可执行动作</th>
          </tr>
          <tr>
            <th>配方</th><th>现场实投</th><th>领料单</th>
            <th>配方</th><th>现场实投</th><th>领料单</th>
            <th>配方</th><th>判定</th>
            <th>配方</th><th>判定</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td class="nowrap">{{ row.批次编号 }}</td>
            <td>{{ row.浆液类型 }}</td>
            <td class="nowrap">{{ row.拌制日期 }}</td>
            <td>{{ row.拌制方量 ?? '—' }}</td>
            <td>{{ formatAmount(row, '配方水泥用量') }}</td>
            <td>{{ row.水泥用量 ?? '—' }}</td>
            <td>{{ row.水泥领料量 ?? '—' }}</td>
            <td>{{ formatAmount(row, '配方膨润土用量') }}</td>
            <td>{{ row.膨润土用量 ?? '—' }}</td>
            <td>{{ row.膨润土领料量 ?? '—' }}</td>
            <td>{{ row.配方水灰比 ?? '—' }}</td>
            <td><span :class="lineClass(row.水灰比判定)">{{ row.水灰比判定 }}</span></td>
            <td>{{ row.配方稠度 ?? '—' }}</td>
            <td><span :class="lineClass(row.稠度判定)">{{ row.稠度判定 }}</span></td>
            <td><span :class="conclusionClass(row)">{{ row.核对结论 }}</span></td>
            <td>{{ row.适用标准版本 }}</td>
            <td class="nowrap">{{ row.核对时间 }}</td>
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
            <td :colspan="19" class="empty-state">暂无浆液拌制数据，可先登记浆液批次</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条浆液批次记录；两处清单（试验检测、同步注浆）读到的偏差批次同出本表核对记录。</span>
      <span v-if="notice" :class="noticeOk ? 'ok-text' : 'error-text'">{{ notice }}</span>
    </footer>

    <section v-if="isManager" class="panel">
      <h3>拌制站负责人操作</h3>
      <div class="panel-actions">
        <button class="btn" type="button" @click="toggleRecipe">{{ showRecipe ? '收起配方维护' : '维护浆液配方' }}</button>
        <button class="btn" type="button" @click="toggleStandard">{{ showStandard ? '收起标准调整' : '调整判定标准' }}</button>
        <button class="btn ghost" type="button" @click="runBackfill">按拌制日期补登老批次</button>
      </div>
      <p class="muted-text">配方与判定标准仅本角色可改；改配方不动历史结论，调标准只追加新版本，老批次按拌制日期沿用当时判定。</p>

      <div v-if="showRecipe">
        <h3>配方维护（按浆液类型，单方用量 kg/m³）</h3>
        <div class="panel-grid">
          <label>浆液类型
            <input v-model="recipeForm.浆液类型" placeholder="如 惰性浆液" />
          </label>
          <label>单方水泥(kg/m³)
            <input v-model.number="recipeForm.配方水泥" type="number" step="0.1" />
          </label>
          <label>单方膨润土(kg/m³)
            <input v-model.number="recipeForm.配方膨润土" type="number" step="0.1" />
          </label>
          <label>设计水灰比
            <input v-model.number="recipeForm.配方水灰比" type="number" step="0.01" />
          </label>
          <label>设计稠度(mm)
            <input v-model.number="recipeForm.配方稠度" type="number" step="1" />
          </label>
          <label>生效日期
            <input v-model="recipeForm.生效日期" type="date" />
          </label>
        </div>
        <div class="panel-actions">
          <button class="btn primary" type="button" @click="submitRecipe">保存配方</button>
        </div>
        <p class="muted-text" v-for="item in recipes" :key="item.浆液类型">
          现行：{{ item.浆液类型 }} 水泥 {{ item.配方水泥 }} / 膨润土 {{ item.配方膨润土 }} / 水灰比 {{ item.配方水灰比 }} / 稠度 {{ item.配方稠度 }}mm（{{ item.生效日期 }} 起，{{ item.更新时间 }} {{ item.更新人 }}）
        </p>
      </div>

      <div v-if="showStandard">
        <h3>判定标准调整（发布新版本，不覆盖旧版本）</h3>
        <div class="panel-grid">
          <label>水泥用量允许偏差
            <input v-model.number="standardForm.水泥偏差限" type="number" step="0.01" />
          </label>
          <label>膨润土允许偏差
            <input v-model.number="standardForm.膨润土偏差限" type="number" step="0.01" />
          </label>
          <label>水灰比极差限
            <input v-model.number="standardForm.水灰比极差限" type="number" step="0.01" />
          </label>
          <label>稠度极差限(mm)
            <input v-model.number="standardForm.稠度极差限" type="number" step="1" />
          </label>
          <label>生效日期
            <input v-model="standardForm.生效日期" type="date" />
          </label>
          <label>说明
            <input v-model="standardForm.说明" placeholder="选填" />
          </label>
        </div>
        <div class="panel-actions">
          <button class="btn primary" type="button" @click="submitStandard">发布新标准</button>
        </div>
        <p class="muted-text" v-for="item in standards" :key="item.版本">
          【{{ item.版本 }}】{{ item.生效日期 }} 起：水泥 ±{{ (item.水泥偏差限 * 100).toFixed(1) }}%、膨润土 ±{{ (item.膨润土偏差限 * 100).toFixed(1) }}%、水灰比极差 ±{{ item.水灰比极差限 }}、稠度极差 ±{{ item.稠度极差限 }}mm —— {{ item.说明 }}（{{ item.调整时间 }} {{ item.调整人 }}）
        </p>
      </div>
    </section>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  adjustStandard,
  backfillMortarChecks,
  listRecipes,
  listStandards,
  MANAGER_ROLE,
  mortarStats,
  saveRecipe,
  SOURCE_RULE,
} from '@/api/mortar-check'
import { useSessionStore } from '@/stores/session'
import type { EntryRow } from '@/data/types'
import type { MixStandard, SlurryRecipe } from '@/data/mortar-types'

const store = useSessionStore()
const isManager = computed(() => store.isStationManager)
const sourceRule = SOURCE_RULE

const meta = moduleMeta('mortar')
const actions = ['开始拌制', '提交检验', '废弃批次']
const statuses = ['待拌制', '拌制中', '检验合格', '已废弃']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const stats = ref<{ label: string; value: number }[]>([])
const notice = ref('')
const noticeOk = ref(false)
const filters = ref<Record<string, string>>({})
const filterFields = ['批次编号', '浆液类型', '拌制日期']
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const recipes = ref<SlurryRecipe[]>([])
const standards = ref<MixStandard[]>([])
const showRecipe = ref(false)
const showStandard = ref(false)

const today = new Date().toISOString().slice(0, 10)
const recipeForm = reactive({
  浆液类型: '惰性浆液',
  配方水泥: 120,
  配方膨润土: 30,
  配方水灰比: 0.8,
  配方稠度: 100,
  生效日期: today,
})
const standardForm = reactive({
  水泥偏差限: 0.03,
  膨润土偏差限: 0.05,
  水灰比极差限: 0.05,
  稠度极差限: 20,
  生效日期: today,
  说明: '',
})

function formatAmount(row: EntryRow, field: string): string {
  const unit = Number(row[field])
  const volume = Number(row.拌制方量)
  return Number.isFinite(unit) && Number.isFinite(volume) && volume > 0
    ? String(Math.round(unit * volume))
    : '—'
}

function lineClass(text: unknown): string {
  const value = String(text ?? '')
  if (value.startsWith('合格')) {
    return 'tag pass'
  }
  if (value.startsWith('不合格')) {
    return 'tag fail'
  }
  return 'tag wait'
}

function conclusionClass(row: EntryRow): string {
  const value = String(row.核对结论 ?? '')
  if (value.startsWith('核对合格')) {
    return 'tag pass'
  }
  if (value.startsWith('核对不合格')) {
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
  notice.value = '浆液批次登记入口尚未接入审批流'
  noticeOk.value = false
}

function runAction(action: string, row: EntryRow) {
  notice.value = ''
  const result = applyAction(meta.key, Number(row.id), action, store.operator)
  noticeOk.value = result.ok
  notice.value = result.ok && result.message ? result.message : result.ok ? '' : result.message
  reload()
}

function loadConfig() {
  recipes.value = listRecipes()
  standards.value = listStandards()
}

function toggleRecipe() {
  showRecipe.value = !showRecipe.value
  loadConfig()
}

function toggleStandard() {
  showStandard.value = !showStandard.value
  loadConfig()
}

function submitRecipe() {
  const result = saveRecipe(MANAGER_ROLE, { ...recipeForm })
  noticeOk.value = result.ok
  notice.value = result.message
  loadConfig()
  reload()
}

function submitStandard() {
  const result = adjustStandard(MANAGER_ROLE, {
    水泥偏差限: standardForm.水泥偏差限,
    膨润土偏差限: standardForm.膨润土偏差限,
    水灰比极差限: standardForm.水灰比极差限,
    稠度极差限: standardForm.稠度极差限,
    生效日期: standardForm.生效日期,
    说明: standardForm.说明 || undefined,
  })
  noticeOk.value = result.ok
  notice.value = result.ok
    ? `${result.message}（本次补核 ${result.重新核对条数 ?? 0} 条，沿用原结论 ${result.沿用原结论条数 ?? 0} 条）`
    : result.message
  loadConfig()
  reload()
}

function runBackfill() {
  const result = backfillMortarChecks(MANAGER_ROLE)
  noticeOk.value = true
  notice.value = `补登完成：新增核对 ${result.补登条数} 条，沿用既有结论 ${result.沿用条数} 条（同批次只保留最早一条）。`
  reload()
}

function reload() {
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    stats.value = mortarStats()
  } catch (error) {
    noticeOk.value = false
    notice.value = error instanceof Error ? error.message : '浆液拌制列表读取失败'
  }
}

onMounted(() => {
  loadConfig()
  reload()
})
</script>
