<template>
  <section class="page" data-module="mortar">
    <header class="page-head">
      <div>
        <h2>浆液拌制管理</h2>
        <p class="page-desc">按批次编号把配方用量与实际投料摆在一起核对：水泥、膨润土、水灰比、稠度各有判定线，超线批次不许提交检验。实际投料以领料单为准，水灰比与稠度以现场记录本实测为准。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" :disabled="!store.isMortarOwner" @click="openRecipe">维护配方</button>
        <button class="btn" type="button" :disabled="!store.isMortarOwner" @click="openStandard">调整判定标准</button>
        <button class="btn" type="button" @click="exportRows">导出浆液拌制清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">已核对批次</span>
        <strong class="stat-value">{{ summary.checked }}/{{ summary.total }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">核对合格</span>
        <strong class="stat-value ok-text">{{ summary.passed }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">偏差批次（两处清单同一份）</span>
        <strong class="stat-value bad-text">{{ summary.deviation }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">按拌制日期补登</span>
        <strong class="stat-value">{{ summary.backfilled }}</strong>
      </article>
    </div>

    <div class="rule-panel">
      <h3>判定线（按拌制日期适用当时版本）</h3>
      <p v-for="std in rules.standards" :key="std.version" class="rule-line">
        {{ std.version }}（{{ std.effectiveFrom }} 起施行{{ std.remark ? `，${std.remark}` : '' }}）：
        水泥偏差 ±{{ std.cementTolPct }}% · 膨润土偏差 ±{{ std.bentoniteTolPct }}% ·
        水灰比偏差 ±{{ std.wcrTol }} · 稠度偏差 ±{{ std.consistencyTolMm }}mm
        <span v-if="std.version === latestStandardVersion" class="ok-text">［当前］</span>
      </p>
      <p class="rule-line">取数口径：配方用量取配方库当时版本；实际水泥/膨润土用量以领料单为准；水灰比、稠度以现场记录本实测为准。现场记录与领料单打架时，数量按领料单、拌制指标按现场记录。</p>
      <p v-if="!store.isMortarOwner" class="rule-line">当前角色为「{{ store.role }}」，配方与判定标准只读；切到「拌制站负责人」才能调整。</p>
    </div>

    <div class="rule-panel">
      <h3>配方库（版本化）</h3>
      <p v-for="recipe in rules.recipes" :key="`${recipe.slurryType}-${recipe.version}`" class="rule-line">
        {{ recipe.slurryType }} {{ recipe.version }}（{{ recipe.effectiveFrom }} 起生效）：
        水泥 {{ recipe.cementKg }}kg/盘 · 膨润土 {{ recipe.bentoniteKg }}kg/盘 · 水灰比 {{ recipe.wcr }} · 稠度 {{ recipe.consistencyMm }}mm
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
            <template v-if="column === '核对结论'">
              <span v-if="!row[column]" class="muted-text">未核对</span>
              <span v-else :class="String(row[column]).startsWith('合格') ? 'ok-text' : 'bad-text'">{{ row[column] }}</span>
            </template>
            <template v-else>{{ row[column] ?? '—' }}</template>
          </td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in availableActions(row)"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无浆液拌制数据</td>
        </tr>
      </tbody>
    </table>

    <div class="sub-table-wrap">
      <h3>配料偏差核对记录（试验检测委托清单、同步注浆待用批次清单均读这一份）</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>批次编号</th>
            <th>领料单号</th>
            <th>水泥 配方/实际/偏差</th>
            <th>膨润土 配方/实际/偏差</th>
            <th>水灰比 设计/实测/偏差</th>
            <th>稠度 设计/实测/偏差</th>
            <th>判定</th>
            <th>首次核对</th>
            <th>最近重核</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="check in checks" :key="check.batchNo">
            <td>{{ check.batchNo }}</td>
            <td>{{ check.requisitionNo || '—' }}</td>
            <td>{{ check.formulaCement }}/{{ check.actualCement }}<strong>/{{ signed(check.cementDevPct) }}%</strong></td>
            <td>{{ check.formulaBentonite }}/{{ check.actualBentonite }}<strong>/{{ signed(check.bentoniteDevPct) }}%</strong></td>
            <td>{{ check.designWcr }}/{{ check.measuredWcr }}<strong>/{{ signed(check.wcrDelta) }}</strong></td>
            <td>{{ check.designConsistency }}/{{ check.measuredConsistency }}<strong>/{{ signed(check.consistencyDelta) }}mm</strong></td>
            <td :class="check.passed ? 'ok-text' : 'bad-text'">{{ check.passed ? '合格' : `不合格：${check.failedItems.join('；')}` }}</td>
            <td>{{ check.firstCheckedAt }}</td>
            <td>{{ check.recheckedAt || '—' }}</td>
            <td>
              <span v-if="check.backfilled" class="muted-text">按拌制日期补登</span>
              <span v-else>本人提交</span>
              <span v-if="check.history.length > 1" class="muted-text">；已按新标准重核，早先判定留档{{ check.history.length }}版</span>
            </td>
          </tr>
          <tr v-if="!checks.length">
            <td colspan="10" class="empty-state">尚无核对记录</td>
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="page-foot">
      <span>共 {{ total }} 条浆液批次；同批次重复提交核对只留最早一条；数据不齐整单不落</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 维护配方：仅拌制站负责人 -->
    <div v-if="recipeModal" class="modal-mask" @click.self="recipeModal = false">
      <div class="modal">
        <h3>维护配方（新版本 {{ nextRecipeVersion }}，保存后已拌制批次重核，早先批次按当时配方判定）</h3>
        <div class="form-grid">
          <label>
            <span>浆液类型</span>
            <input v-model="recipeForm.slurryType" placeholder="如：同步注浆浆液" />
          </label>
          <label>
            <span>生效日期</span>
            <input v-model="recipeForm.effectiveFrom" type="date" />
          </label>
          <label>
            <span>水泥用量（kg/盘）</span>
            <input v-model="recipeForm.cementKg" type="number" step="0.1" />
          </label>
          <label>
            <span>膨润土用量（kg/盘）</span>
            <input v-model="recipeForm.bentoniteKg" type="number" step="0.1" />
          </label>
          <label>
            <span>设计水灰比</span>
            <input v-model="recipeForm.wcr" type="number" step="0.01" />
          </label>
          <label>
            <span>设计稠度（mm）</span>
            <input v-model="recipeForm.consistencyMm" type="number" step="1" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="recipeModal = false">取消</button>
          <button class="btn primary" type="button" @click="saveRecipe">保存配方并重核</button>
        </div>
      </div>
    </div>

    <!-- 调整判定标准：仅拌制站负责人 -->
    <div v-if="standardModal" class="modal-mask" @click.self="standardModal = false">
      <div class="modal">
        <h3>调整判定标准（新版本 {{ nextStandardVersion }}，早于生效日拌制的批次仍按当时判定）</h3>
        <div class="form-grid">
          <label>
            <span>生效日期</span>
            <input v-model="standardForm.effectiveFrom" type="date" />
          </label>
          <label>
            <span>水泥允许偏差（%）</span>
            <input v-model="standardForm.cementTolPct" type="number" step="0.5" />
          </label>
          <label>
            <span>膨润土允许偏差（%）</span>
            <input v-model="standardForm.bentoniteTolPct" type="number" step="0.5" />
          </label>
          <label>
            <span>水灰比允许偏差</span>
            <input v-model="standardForm.wcrTol" type="number" step="0.01" />
          </label>
          <label>
            <span>稠度允许偏差（mm）</span>
            <input v-model="standardForm.consistencyTolMm" type="number" step="1" />
          </label>
          <label>
            <span>说明</span>
            <input v-model="standardForm.remark" placeholder="如：雨季放宽稠度线" />
          </label>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="standardModal = false">取消</button>
          <button class="btn primary" type="button" @click="saveStandard">保存标准并重核</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  mortarReconcileSummary,
  mortarRulesView,
  runAction as applyAction,
} from '@/api/local-service'
import { listChecks, saveRecipe as persistRecipe, saveStandard as persistStandard } from '@/data/mortar-domain'
import { useSessionStore } from '@/stores/session'
import type { EntryRow, MortarCheck, MortarStandard, RecipeVersion } from '@/data/types'

const store = useSessionStore()
const meta = moduleMeta('mortar')
const columns = [
  '批次编号',
  '浆液类型',
  '领料单号',
  '拌制日期',
  '配方水泥用量',
  '水泥用量',
  '水泥偏差',
  '配方膨润土用量',
  '膨润土用量',
  '膨润土偏差',
  '设计水灰比',
  '水灰比',
  '水灰比偏差',
  '设计稠度',
  '稠度',
  '稠度偏差',
  '核对状态',
  '核对结论',
  '批次状态',
]
const statuses = ['待拌制', '拌制中', '检验合格', '已废弃']

const rows = ref<EntryRow[]>([])
const checks = ref<MortarCheck[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = ['批次编号', '浆液类型', '领料单号']
const rules = ref(mortarRulesView())
const summary = ref(mortarReconcileSummary())

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const latestStandardVersion = computed(
  () => rules.value.standards[rules.value.standards.length - 1]?.version ?? '',
)
const nextRecipeVersion = computed(() => {
  const sameType = rules.value.recipes.filter((item) => item.slurryType === recipeForm.slurryType)
  const max = sameType.reduce((acc, item) => Math.max(acc, Number(item.version.slice(1)) || 0), 0)
  return `V${max + 1}`
})
const nextStandardVersion = computed(() => {
  const max = rules.value.standards.reduce(
    (acc, item) => Math.max(acc, Number(item.version.slice(1)) || 0),
    0,
  )
  return `V${max + 1}`
})

const recipeModal = ref(false)
const standardModal = ref(false)
const recipeForm = reactive({
  slurryType: '同步注浆浆液',
  effectiveFrom: new Date().toISOString().slice(0, 10),
  cementKg: 150,
  bentoniteKg: 40,
  wcr: 0.8,
  consistencyMm: 110,
})
const standardForm = reactive<Omit<MortarStandard, 'version' | 'updatedBy'>>({
  effectiveFrom: new Date().toISOString().slice(0, 10),
  cementTolPct: 5,
  bentoniteTolPct: 5,
  wcrTol: 0.05,
  consistencyTolMm: 20,
  remark: '',
})

function signed(num: number): string {
  return num > 0 ? `+${num}` : `${num}`
}

function availableActions(row: EntryRow): string[] {
  const status = String(row.status)
  if (status === '待拌制') return ['开始拌制']
  if (status === '已废弃') return []
  // 拌制中：先核对再检验
  return ['提交核对', '提交检验', '废弃批次']
}

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openRecipe() {
  if (!store.isMortarOwner) {
    errorMessage.value = '只有拌制站负责人能改配方'
    return
  }
  const latest = [...rules.value.recipes]
    .reverse()
    .find((item: RecipeVersion) => item.slurryType === recipeForm.slurryType)
  if (latest) {
    recipeForm.cementKg = latest.cementKg
    recipeForm.bentoniteKg = latest.bentoniteKg
    recipeForm.wcr = latest.wcr
    recipeForm.consistencyMm = latest.consistencyMm
  }
  recipeModal.value = true
}

function openStandard() {
  if (!store.isMortarOwner) {
    errorMessage.value = '只有拌制站负责人能调整判定标准'
    return
  }
  const latest = rules.value.standards[rules.value.standards.length - 1]
  standardForm.cementTolPct = latest.cementTolPct
  standardForm.bentoniteTolPct = latest.bentoniteTolPct
  standardForm.wcrTol = latest.wcrTol
  standardForm.consistencyTolMm = latest.consistencyTolMm
  standardModal.value = true
}

function saveRecipe() {
  errorMessage.value = ''
  const result = persistRecipe(
    {
      slurryType: recipeForm.slurryType.trim(),
      effectiveFrom: recipeForm.effectiveFrom,
      cementKg: Number(recipeForm.cementKg),
      bentoniteKg: Number(recipeForm.bentoniteKg),
      wcr: Number(recipeForm.wcr),
      consistencyMm: Number(recipeForm.consistencyMm),
    },
    { role: store.role },
  )
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  recipeModal.value = false
  reload()
}

function saveStandard() {
  errorMessage.value = ''
  const result = persistStandard({ ...standardForm }, { role: store.role })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  standardModal.value = false
  reload()
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action, { role: store.role })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  errorMessage.value = result.message
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    checks.value = listChecks()
    rules.value = mortarRulesView()
    summary.value = mortarReconcileSummary()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '浆液拌制列表读取失败'
  }
}

onMounted(reload)
</script>
