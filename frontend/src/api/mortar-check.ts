import {
  listAux,
  listRows,
  MORTAR_CHECK_KEY,
  MORTAR_RECIPE_KEY,
  MORTAR_STANDARD_KEY,
  saveCollections,
} from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'
import type {
  CheckLine,
  MixCheckRecord,
  MixStandard,
  SlurryRecipe,
  StationRole,
} from '@/data/mortar-types'

/**
 * 浆液拌制配料偏差核对。
 *
 * 三处取数收成同一份：配方（mortar-recipes）、现场签认实际投料（mortar 批次行）、
 * 领料单（批次行上的领料量）都围绕同一批次；核对结论只产一份（mortar-checks），
 * 试验检测委托清单与同步注浆待用批次清单都从这份结论投影，不各写一套。
 *
 * 取数以哪份为准：水泥/膨润土实际用量与水灰比、稠度实测值，一律以拌制现场当班
 * 签认记录（批次行）为准；领料单只做月度总量备核，两边打架时不改判、不拦提交。
 */

export const SOURCE_RULE =
  '取数规则：实际投料、水灰比与稠度以拌制现场当班签认记录为准；领料单仅作月度总量备核，分歧时不改判。'
export const MANAGER_ROLE: StationRole = '拌制站负责人'

const MORTAR_KEY = 'mortar'
const TESTING_KEY = 'testing'
const GROUTING_KEY = 'grouting'

const MIXED_STATUSES = ['拌制中', '检验合格', '已废弃']
const LINE_PROJECTION: { item: string; 判定字段: string }[] = [
  { item: '水泥用量', 判定字段: '水泥偏差判定' },
  { item: '膨润土用量', 判定字段: '膨润土偏差判定' },
  { item: '水灰比', 判定字段: '水灰比判定' },
  { item: '稠度', 判定字段: '稠度判定' },
]

function recipes(): SlurryRecipe[] {
  return listAux<SlurryRecipe>(MORTAR_RECIPE_KEY)
}

function standards(): MixStandard[] {
  return listAux<MixStandard>(MORTAR_STANDARD_KEY).slice().sort((a, b) =>
    a.生效日期.localeCompare(b.生效日期),
  )
}

function checks(): MixCheckRecord[] {
  return listAux<MixCheckRecord>(MORTAR_CHECK_KEY)
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null
  }
  const parsed = Number(String(value).replace(/[^\d.\-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

function pct(value: number): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`
}

function signed(value: number, unit = '', digits = 2): string {
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}${unit}`
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 按拌制日期选适用标准：标准调整只追加新版本，老批次永远按当时的版本判。 */
function standardAt(date: string): MixStandard {
  const list = standards()
  const hit = list.filter((item) => item.生效日期 <= date)
  return hit[hit.length - 1] ?? list[0]
}

function recipeOf(row: EntryRow): SlurryRecipe | undefined {
  return recipes().find((item) => item.浆液类型 === String(row.浆液类型 ?? ''))
}

/** 实际投料以批次行上现场签认的数字为准；领料量只展示、不参与判定。 */
function actual(row: EntryRow, key: string): number | null {
  return num(row[key])
}

type Evaluation = {
  standard: MixStandard
  recipe: SlurryRecipe
  lines: CheckLine[]
  pass: boolean
  summary: string
}

/**
 * 按批次做四条判定线：水泥用量偏差、膨润土用量偏差、水灰比极差、稠度极差。
 * 配方用量按拌制方量折算成总量，与现场签认实际投料摆在一起比。
 * 数据不齐（含找不到该浆液类型的配方）时不算结论，返回 null，调用方不得落半条记录。
 */
function evaluate(row: EntryRow): Evaluation | null {
  const recipe = recipeOf(row)
  const standard = standardAt(String(row.拌制日期 ?? ''))
  const volume = num(row.拌制方量)
  const cement = actual(row, '水泥用量')
  const bentonite = actual(row, '膨润土用量')
  const wc = actual(row, '水灰比')
  const consistency = actual(row, '稠度')
  if (!recipe || !standard || !volume || volume <= 0) {
    return null
  }
  if ([cement, bentonite, wc, consistency].some((v) => v === null)) {
    return null
  }

  const lines: CheckLine[] = []
  const ratioLine = (
    item: '水泥用量' | '膨润土用量',
    plannedTotal: number,
    measured: number,
    limit: number,
  ): CheckLine => {
    const deviation = ((measured - plannedTotal) / plannedTotal) * 100
    const pass = Math.abs(deviation) <= limit * 100
    return {
      项目: item,
      配方值: plannedTotal,
      实测值: measured,
      偏差: deviation,
      偏差文本: pct(deviation),
      允许范围: `±${(limit * 100).toFixed(1)}%`,
      是否合格: pass,
      不合格说明: pass ? '' : `${item}偏差 ${pct(deviation)}（允许 ±${(limit * 100).toFixed(1)}%）`,
    }
  }
  const gapLine = (
    item: '水灰比' | '稠度',
    design: number,
    measured: number,
    limit: number,
    unit: string,
    digits: number,
  ): CheckLine => {
    const gap = measured - design
    const pass = Math.abs(gap) <= limit
    return {
      项目: item,
      配方值: design,
      实测值: measured,
      偏差: gap,
      偏差文本: signed(gap, unit, digits),
      允许范围: `±${limit}${unit}`,
      是否合格: pass,
      不合格说明: pass ? '' : `${item}极差 ${signed(gap, unit, digits)}（允许 ±${limit}${unit}）`,
    }
  }

  lines.push(
    ratioLine('水泥用量', recipe.配方水泥 * volume, cement as number, standard.水泥偏差限),
  )
  lines.push(
    ratioLine('膨润土用量', recipe.配方膨润土 * volume, bentonite as number, standard.膨润土偏差限),
  )
  lines.push(gapLine('水灰比', recipe.配方水灰比, wc as number, standard.水灰比极差限, '', 2))
  lines.push(gapLine('稠度', recipe.配方稠度, consistency as number, standard.稠度极差限, 'mm', 0))

  const summary = lines
    .filter((line) => !line.是否合格)
    .map((line) => line.不合格说明)
    .join('；')
  return { standard, recipe, lines, pass: lines.every((line) => line.是否合格), summary }
}

function buildRecord(
  row: EntryRow,
  result: Evaluation,
  operator: string,
  at: string,
  backfilled: boolean,
): MixCheckRecord {
  return {
    批次编号: String(row.批次编号),
    浆液批次id: Number(row.id),
    浆液类型: String(row.浆液类型),
    拌制日期: String(row.拌制日期),
    适用标准版本: result.standard.版本,
    配方快照: { ...result.recipe },
    核对时间: at,
    核对人: operator,
    是否合格: result.pass,
    核对项: result.lines.map((line) => ({ ...line })),
    结论说明: result.summary,
    来源规则: SOURCE_RULE,
    补登: backfilled,
  }
}

function checkOf(id: number): MixCheckRecord | undefined {
  return checks().find((item) => item.浆液批次id === id)
}

/**
 * 老批次按拌制日期补登：已拌制且投料数据齐全的批次，缺核对结论的补一条。
 * 已有结论（含早先按旧标准判的）一律不动。幂等：重复执行只保留最早那条。
 */
export function backfillMortarChecks(
  operator = '系统（按拌制日期补登）',
): { 补登条数: number; 沿用条数: number } {
  const rows = listRows(MORTAR_KEY)
  const existing = checks()
  const nextChecks = [...existing]
  const patchRows: EntryRow[] = []
  let added = 0

  for (const row of rows) {
    if (!MIXED_STATUSES.includes(String(row.status))) {
      continue
    }
    if (checkOf(Number(row.id))) {
      continue
    }
    const result = evaluate(row)
    if (!result) {
      // 投料数据不齐或没有配方：不补、不写半条，等现场补齐后再核。
      continue
    }
    nextChecks.push(
      buildRecord(row, result, operator, `${String(row.拌制日期)}（按拌制日期补登）`, true),
    )
    added += 1
    if (String(row.status) !== '已废弃' && row.abnormal !== (!result.pass)) {
      patchRows.push({ ...row, abnormal: !result.pass })
    }
  }

  if (added > 0) {
    const patch: Record<string, unknown[]> = { [MORTAR_CHECK_KEY]: nextChecks }
    if (patchRows.length) {
      patch[MORTAR_KEY] = rows.map((row) =>
        patchRows.find((item) => item.id === row.id) ?? row,
      )
    }
    saveCollections(patch)
  }
  return { 补登条数: added, 沿用条数: existing.length }
}

/** 同一批次重复提交核对：只留最早一条，再递一遍仍按最早那次。 */
export function submitMortarCheck(id: number, operator: string): ActionResult {
  const rows = listRows(MORTAR_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的浆液批次` }
  }
  const row = rows[index]
  const status = String(row.status)
  if (status === '已废弃') {
    return { ok: false, message: '该批次已废弃，不能提交检验' }
  }

  const frozen = checkOf(Number(row.id))
  if (frozen && !frozen.是否合格) {
    return {
      ok: false,
      message: `该批次已于 ${frozen.核对时间} 按【${frozen.适用标准版本}】核对，重复提交沿用最早结论：不合格（${frozen.结论说明}），不许提交检验。`,
    }
  }

  // 没有冻结结论时现场核一遍；数据不齐就不写半条。
  const result = frozen ? null : evaluate(row)
  if (!frozen && !result) {
    return { ok: false, message: '投料数据不完整或缺少该浆液类型的配方，本次核对未通过，未落任何记录' }
  }
  const record = frozen ?? buildRecord(row, result as Evaluation, operator, nowText(), false)

  if (status === '检验合格') {
    return {
      ok: true,
      message: `该批次已于 ${record.核对时间} 按【${record.适用标准版本}】核对合格，重复提交沿用最早结论，无需重复操作。`,
    }
  }

  // 合格：批次转「检验合格」，并往试验检测委托清单写一条委托；三处改动一次原子落库。
  const nextRows = rows.map((item, i) =>
    i === index ? { ...item, status: '检验合格', pending: false, abnormal: false } : item,
  )
  const testingRows = listRows(TESTING_KEY)
  const batchNo = String(row.批次编号)
  const patch: Record<string, unknown[]> = { [MORTAR_KEY]: nextRows }
  if (!frozen) {
    patch[MORTAR_CHECK_KEY] = [...checks(), record]
  }
  if (!testingRows.some((item) => String(item.关联批次编号 ?? '') === batchNo)) {
    const nextId = testingRows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
    patch[TESTING_KEY] = [
      ...testingRows,
      {
        id: nextId,
        status: '待送样',
        pending: true,
        abnormal: false,
        委托编号: `TEST-${String(nextId).padStart(4, '0')}`,
        试样类型: '同步注浆浆液',
        检测项目: '稠度、凝结时间、抗压强度',
        关联批次编号: batchNo,
        送样日期: nowText().slice(0, 10),
        检测结果: '待检测',
        报告编号: '',
        检测机构: '中心试验室',
        委托状态: '待送样',
      },
    ]
  }
  saveCollections(patch)
  return {
    ok: true,
    message: frozen
      ? `批次 ${batchNo} 沿用 ${record.核对时间} 的合格结论，已提交检验并生成试验委托。`
      : `批次 ${batchNo} 配料核对合格，已提交检验并生成试验委托。`,
  }
}

function projectCheck(row: EntryRow): EntryRow {
  const projected: EntryRow = { ...row }
  const record = checkOf(Number(row.id))
  let lines = record?.核对项
  let conclusion: string
  let version: string
  let checkedAt: string

  if (record) {
    conclusion = record.是否合格
      ? `核对合格（${record.补登 ? '按拌制日期补登' : '现场核对'}）`
      : `核对不合格：${record.结论说明}`
    version = record.适用标准版本
    checkedAt = record.核对时间
  } else {
    const preview = evaluate(row)
    if (!preview) {
      conclusion = '待核对（投料数据未齐）'
      version = '—'
      checkedAt = '—'
      lines = []
    } else {
      lines = preview.lines
      conclusion = preview.pass
        ? '待核对（按适用标准预判合格）'
        : `待核对（按适用标准预判不合格：${preview.summary}）`
      version = preview.standard.版本
      checkedAt = '—'
    }
  }

  const recipe = record?.配方快照 ?? recipeOf(row)
  if (recipe) {
    projected.配方水泥用量 = recipe.配方水泥
    projected.配方膨润土用量 = recipe.配方膨润土
    projected.配方水灰比 = recipe.配方水灰比
    projected.配方稠度 = recipe.配方稠度
  }
  for (const mapping of LINE_PROJECTION) {
    const line = lines?.find((item) => item.项目 === mapping.item)
    projected[mapping.判定字段] = line
      ? `${line.是否合格 ? '合格' : '不合格'} ${line.偏差文本}（允许 ${line.允许范围}）`
      : '—'
  }
  projected.核对结论 = conclusion
  projected.适用标准版本 = version
  projected.核对时间 = checkedAt
  return projected
}

/** 浆液拌制清单：读出前先补登老批次，再把唯一一份核对结论投影到每行。 */
export function listMortarRows(): EntryRow[] {
  backfillMortarChecks()
  return listRows(MORTAR_KEY).map(projectCheck)
}

/** 拌制页指标，直接从唯一一份核对记录统计。 */
export function mortarStats(): { label: string; value: number }[] {
  backfillMortarChecks()
  const rows = listRows(MORTAR_KEY)
  const active = (id: number) =>
    String(rows.find((row) => Number(row.id) === id)?.status ?? '') !== '已废弃'
  const records = checks()
  return [
    {
      label: '待核对批次',
      value: rows.filter((row) => String(row.status) === '拌制中' && !checkOf(Number(row.id))).length,
    },
    {
      label: '核对合格批次',
      value: records.filter((item) => item.是否合格 && active(item.浆液批次id)).length,
    },
    {
      label: '配料偏差批次',
      value: records.filter((item) => !item.是否合格 && active(item.浆液批次id)).length,
    },
    { label: '待拌制批次', value: rows.filter((row) => String(row.status) === '待拌制').length },
    { label: '废弃批次', value: rows.filter((row) => String(row.status) === '已废弃').length },
  ]
}

/**
 * 试验检测 / 同步注浆清单共用的投影：两处读到的核对结论、偏差批次编号同出一份。
 */
export function attachCheckConclusion(key: string): EntryRow[] {
  backfillMortarChecks()
  const rowsByBatch = new Map(
    listRows(MORTAR_KEY).map((row) => [String(row.批次编号 ?? ''), row]),
  )
  const linkField = key === GROUTING_KEY ? '浆液批次编号' : '关联批次编号'
  return listRows(key).map((row) => {
    const batchNo = String(row[linkField] ?? '')
    const record = batchNo ? checks().find((item) => item.批次编号 === batchNo) : undefined
    if (!batchNo || !rowsByBatch.has(batchNo)) {
      return { ...row, 配料核对结论: '—', 配料偏差批次: '' }
    }
    if (!record) {
      return { ...row, 配料核对结论: '未核对', 配料偏差批次: '' }
    }
    return {
      ...row,
      配料核对结论: record.是否合格
        ? `核对合格（${record.适用标准版本}）`
        : `核对不合格：${record.结论说明}`,
      配料偏差批次: record.是否合格 ? '' : batchNo,
    }
  })
}

/** 同步注浆的待用批次清单：只可能是核对合格、检验合格的批次。 */
export function readyMortarBatches(): EntryRow[] {
  backfillMortarChecks()
  return listRows(MORTAR_KEY)
    .filter((row) => {
      const record = checkOf(Number(row.id))
      return String(row.status) === '检验合格' && record?.是否合格
    })
    .map((row) => {
      const record = checkOf(Number(row.id)) as MixCheckRecord
      return {
        id: row.id,
        status: row.status,
        pending: row.pending,
        abnormal: row.abnormal,
        批次编号: row.批次编号,
        浆液类型: row.浆液类型,
        拌制日期: row.拌制日期,
        核对结论: `核对合格（${record.适用标准版本}，${record.核对时间}）`,
      }
    })
}

/** 偏差批次清单（唯一一份）：试验检测与同步注浆两处入口读到的条数必须一致。 */
export function deviationBatches(): { 批次编号: string; 结论说明: string }[] {
  const rows = listRows(MORTAR_KEY)
  return checks()
    .filter((item) => {
      if (item.是否合格) {
        return false
      }
      const row = rows.find((r) => Number(r.id) === item.浆液批次id)
      return row && String(row.status) !== '已废弃'
    })
    .map((item) => ({ 批次编号: item.批次编号, 结论说明: item.结论说明 }))
}

/** 开始注浆前的闸门：批次未核对或核对不合格，不许待用。 */
export function gateGrouting(row: EntryRow): string | null {
  const batchNo = String(row.浆液批次编号 ?? '')
  if (!batchNo) {
    return null
  }
  const batch = listRows(MORTAR_KEY).find((item) => String(item.批次编号) === batchNo)
  if (!batch) {
    return null
  }
  const record = checkOf(Number(batch.id))
  if (String(batch.status) === '已废弃') {
    return `待用批次 ${batchNo} 已废弃，不能用于注浆`
  }
  if (!record) {
    return `待用批次 ${batchNo} 尚未完成配料核对，不能开始注浆`
  }
  if (!record.是否合格) {
    return `待用批次 ${batchNo} 配料偏差超标（${record.结论说明}），不能开始注浆`
  }
  return null
}

// ── 配方与判定标准：只有拌制站负责人能改 ──────────────────────────────────

function requireManager(role: string): ActionResult | null {
  return role === MANAGER_ROLE
    ? null
    : { ok: false, message: '只有拌制站负责人能改配方和判定标准' }
}

export function listRecipes(): SlurryRecipe[] {
  return recipes()
}

export function listStandards(): MixStandard[] {
  return standards()
}

export function saveRecipe(role: string, input: Omit<SlurryRecipe, '更新人' | '更新时间'>): ActionResult {
  const denied = requireManager(role)
  if (denied) {
    return denied
  }
  for (const field of ['配方水泥', '配方膨润土', '配方水灰比', '配方稠度'] as const) {
    if (!(Number.isFinite(input[field]) && input[field] > 0)) {
      return { ok: false, message: '配方用量必须是正数，本次修改未落任何记录' }
    }
  }
  const next: SlurryRecipe = { ...input, 更新人: role, 更新时间: nowText() }
  const rest = recipes().filter((item) => item.浆液类型 !== input.浆液类型)
  saveCollections({ [MORTAR_RECIPE_KEY]: [...rest, next] })
  // 已核对批次带着配方快照，结论不动；未核对批次下次按新配方核。
  return { ok: true, message: `浆液类型「${input.浆液类型}」配方已更新，历史核对结论保留不变。` }
}

export function adjustStandard(
  role: string,
  input: Omit<MixStandard, '版本' | '调整人' | '调整时间' | '说明'> & { 说明?: string },
): ActionResult & { 重新核对条数?: number; 沿用原结论条数?: number } {
  const denied = requireManager(role)
  if (denied) {
    return denied
  }
  const limits = ['水泥偏差限', '膨润土偏差限', '水灰比极差限', '稠度极差限'] as const
  if (limits.some((field) => !(Number.isFinite(input[field]) && input[field] > 0))) {
    return { ok: false, message: '判定线必须是正数，本次调整未落任何记录' }
  }
  const list = standards()
  const latest = list[list.length - 1]
  if (latest && input.生效日期 <= latest.生效日期) {
    return {
      ok: false,
      message: `新标准生效日期必须晚于现行版本【${latest.版本}】的 ${latest.生效日期}，本次调整未落任何记录`,
    }
  }
  const versionNo = list.reduce((max, item) => {
    const n = Number(item.版本.replace(/^v/i, ''))
    return Number.isFinite(n) ? Math.max(max, n) : max
  }, 0) + 1
  const next: MixStandard = {
    ...input,
    版本: `v${versionNo}`,
    说明: input.说明 ?? `标准调整：水泥 ±${(input.水泥偏差限 * 100).toFixed(1)}%、膨润土 ±${(input.膨润土偏差限 * 100).toFixed(1)}%、水灰比极差 ±${input.水灰比极差限}、稠度极差 ±${input.稠度极差限}mm。`,
    调整人: role,
    调整时间: nowText(),
  }
  saveCollections({ [MORTAR_STANDARD_KEY]: [...list, next] })
  // 已拌制批次重新核一遍：老批次按拌制日期仍命中原版本，只补真正缺结论的批次。
  const replay = backfillMortarChecks()
  return {
    ok: true,
    message: `判定标准【${next.版本}】已发布，${next.生效日期} 起拌制的批次按此判定；早先批次沿用当时结论。`,
    重新核对条数: replay.补登条数,
    沿用原结论条数: replay.沿用条数,
  }
}
