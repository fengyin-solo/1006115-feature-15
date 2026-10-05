import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import {
  backfillChecks,
  checkByBatch,
  conclusionText,
  evaluateSnapshot,
  isMaterialBlocked,
  listChecks,
  listDeviationChecks,
  listRecipes,
  listStandards,
  readBatchSnapshot,
  recipeAt,
  resetMortarDomain,
  submitCheck,
} from '@/data/mortar-domain'
import type {
  ActionResult,
  Actor,
  EntryRow,
  ModuleMeta,
  MortarCheck,
  OverviewResult,
  PageResult,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const DEFAULT_ACTOR: Actor = { role: '值班管理员' }

let seeded = false

/** 存量批次按拌制日期补登一遍，只做一次；重置拌制站后也会按新种子重补。 */
function ensureBackfilled(): void {
  if (seeded) {
    return
  }
  seeded = true
  backfillChecks(listRows('mortar'))
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

function checkSummaryText(check: MortarCheck | undefined): string {
  if (!check) {
    return ''
  }
  const tag = check.backfilled ? '（按拌制日期补登）' : ''
  return `${conclusionText(check)}${tag}`
}

/**
 * 拌制批次的统一读法：配方用量与实际投料并排，核对结论从唯一事实源带出。
 * 未核对的批次按当前配方库现算配方列展示，明细不落第二份。
 */
export function decorateMortarRow(row: EntryRow): EntryRow {
  const check = checkByBatch(String(row['批次编号'] ?? ''))
  const snapshotLike = readBatchSnapshot(row)
  let recipeSlurry = ''
  let formulaCement = ''
  let formulaBentonite = ''
  let designWcr = ''
  let designConsistency = ''
  let cementDev = ''
  let bentoniteDev = ''
  let wcrDelta = ''
  let consistencyDelta = ''
  if (!('missing' in snapshotLike)) {
    if (check) {
      recipeSlurry = check.recipeVersion
      formulaCement = String(check.formulaCement)
      formulaBentonite = String(check.formulaBentonite)
      designWcr = String(check.designWcr)
      designConsistency = String(check.designConsistency)
      cementDev = `${check.cementDevPct > 0 ? '+' : ''}${check.cementDevPct}%`
      bentoniteDev = `${check.bentoniteDevPct > 0 ? '+' : ''}${check.bentoniteDevPct}%`
      wcrDelta = `${check.wcrDelta > 0 ? '+' : ''}${check.wcrDelta}`
      consistencyDelta = `${check.consistencyDelta > 0 ? '+' : ''}${check.consistencyDelta}mm`
    } else {
      const recipe = recipeAt(snapshotLike.slurryType, snapshotLike.mixedAt)
      if (recipe) {
        recipeSlurry = recipe.version
        formulaCement = String(recipe.cementKg)
        formulaBentonite = String(recipe.bentoniteKg)
        designWcr = String(recipe.wcr)
        designConsistency = String(recipe.consistencyMm)
        const evaluation = evaluateSnapshot(snapshotLike)
        if (!('missing' in evaluation)) {
          cementDev = `${evaluation.cementDevPct > 0 ? '+' : ''}${evaluation.cementDevPct}%`
          bentoniteDev = `${evaluation.bentoniteDevPct > 0 ? '+' : ''}${evaluation.bentoniteDevPct}%`
          wcrDelta = `${evaluation.wcrDelta > 0 ? '+' : ''}${evaluation.wcrDelta}`
          consistencyDelta = `${evaluation.consistencyDelta > 0 ? '+' : ''}${evaluation.consistencyDelta}mm`
        }
      }
    }
  }
  return {
    ...row,
    配方版本: recipeSlurry,
    配方水泥用量: formulaCement,
    配方膨润土用量: formulaBentonite,
    设计水灰比: designWcr,
    设计稠度: designConsistency,
    水泥偏差: cementDev,
    膨润土偏差: bentoniteDev,
    水灰比偏差: wcrDelta,
    稠度偏差: consistencyDelta,
    核对结论: checkSummaryText(check),
    核对状态: check ? '已核对' : '未核对',
    首次核对时间: check?.firstCheckedAt ?? '',
  }
}

function decorateTestingRow(row: EntryRow): EntryRow {
  const batchNo = String(row['浆液批次编号'] ?? '').trim()
  if (!batchNo) {
    return { ...row, 批次核对结论: '' }
  }
  const check = checkByBatch(batchNo)
  return { ...row, 批次核对结论: checkSummaryText(check) }
}

function decorateGroutingRow(row: EntryRow): EntryRow {
  const batchNo = String(row['浆液批次编号'] ?? '').trim()
  if (!batchNo) {
    return { ...row, 批次核对结论: '' }
  }
  const check = checkByBatch(batchNo)
  return { ...row, 批次核对结论: checkSummaryText(check) }
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  ensureBackfilled()
  const rawRows = listRows(key)
  let rows = rawRows
  if (key === 'mortar') {
    rows = rawRows.map(decorateMortarRow)
  } else if (key === 'testing') {
    rows = rawRows.map(decorateTestingRow)
  } else if (key === 'grouting') {
    rows = rawRows.map(decorateGroutingRow)
  }
  const matched = filterRows(rows, filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 待用浆液批次清单：同步注浆页从核对结论这同一份数据读。已废弃、待拌制、检验合格已投用的口径由页面按需筛。 */
export function listReadyBatches(): EntryRow[] {
  ensureBackfilled()
  // 待用＝已经拌出来（不是待拌制、没废弃），核对结论决定能不能给同步注浆用。
  return listRows('mortar')
    .filter((row) => !['已废弃', '待拌制'].includes(String(row.status)))
    .map(decorateMortarRow)
}

/** 偏差批次：试验检测与同步注浆两处入口都走这里，条数必然对得上。 */
export function listDeviationBatches(): MortarCheck[] {
  ensureBackfilled()
  return listDeviationChecks()
}

export function mortarReconcileSummary(): {
  total: number
  checked: number
  passed: number
  deviation: number
  backfilled: number
} {
  ensureBackfilled()
  const checks = listChecks()
  return {
    total: listRows('mortar').length,
    checked: checks.length,
    passed: checks.filter((item) => item.passed).length,
    deviation: checks.filter((item) => !item.passed).length,
    backfilled: checks.filter((item) => item.backfilled).length,
  }
}

export function mortarRulesView(): {
  standards: ReturnType<typeof listStandards>
  recipes: ReturnType<typeof listRecipes>
} {
  return { standards: listStandards(), recipes: listRecipes() }
}

function fail(message: string): ActionResult {
  return { ok: false, message }
}

export function runAction(
  key: string,
  id: number,
  action: string,
  actor: Actor = DEFAULT_ACTOR,
): ActionResult {
  ensureBackfilled()
  const meta = moduleMeta(key)

  // 浆液拌制的核对动作单独走配料偏差规则。
  if (key === 'mortar') {
    return runMortarAction(meta, id, action, actor)
  }

  // 试验委托送样：配料偏差超线（尤其水泥/膨润土）的批次不许送样。
  if (key === 'testing' && action === '送样委托') {
    const rows = listRows(key)
    const row = rows.find((item) => Number(item.id) === id)
    if (row) {
      const batchNo = String(row['浆液批次编号'] ?? '').trim()
      if (batchNo) {
        const check = checkByBatch(batchNo)
        if (!check) {
          return fail(`批次 ${batchNo} 尚未完成配料偏差核对，先在浆液拌制站提交核对`)
        }
        if (!check.passed) {
          return fail(
            `批次 ${batchNo} 配料偏差${
              isMaterialBlocked(check) ? '（水泥/膨润土超线）' : ''
            }，不许送样：${check.failedItems.join('；')}`,
          )
        }
      }
    }
  }

  return applyGenericAction(meta, key, id, action)
}

function applyGenericAction(
  meta: ModuleMeta,
  key: string,
  id: number,
  action: string,
): ActionResult {
  const target = meta.actionTargets[action]
  if (!target) {
    return fail(`${meta.entity}没有登记「${action}」这个动作`)
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的${meta.entity}`)
  }
  const current = String(rows[index].status)
  if (current === target) {
    return fail(`${meta.entity}已经是「${target}」，不用重复操作`)
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

function runMortarAction(
  meta: ModuleMeta,
  id: number,
  action: string,
  actor: Actor,
): ActionResult {
  const rows = listRows('mortar')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return fail(`没有找到编号为 ${id} 的浆液批次`)
  }
  const row = rows[index]
  const current = String(row.status)

  if (action === '开始拌制' || action === '废弃批次') {
    return applyGenericAction(meta, 'mortar', id, action)
  }

  if (action === '提交核对') {
    if (current === '已废弃') {
      return fail('已废弃批次不再核对')
    }
    // 同一批次重复提交核对只留一条；submitCheck 内部保证数据不齐不落半条。
    const result = submitCheck(row, actor)
    if (result.ok && result.check) {
      // 结论只存一份（核对记录里）；批次清单上仅同步异常标记，看板与别处明细随之更新。
      const next = [...rows]
      next[index] = {
        ...row,
        abnormal: !result.check.passed,
      }
      saveRows('mortar', next)
    }
    return result
  }

  if (action === '提交检验') {
    const check = checkByBatch(String(row['批次编号'] ?? ''))
    if (!check) {
      return fail('该批次还没有配料偏差核对结论，先提交核对再提交检验')
    }
    if (!check.passed) {
      const blocked = isMaterialBlocked(check)
      return fail(
        blocked
          ? `水泥/膨润土用量偏差超出允许范围，不许提交检验；差在：${check.failedItems
              .filter((item) => item.startsWith('水泥') || item.startsWith('膨润土'))
              .join('；')}`
          : `水灰比或稠度超出判定线，不许提交检验；差在：${check.failedItems.join('；')}`,
      )
    }
    return applyGenericAction(meta, 'mortar', id, action)
  }

  return fail(`浆液批次没有登记「${action}」这个动作`)
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  if (key === 'mortar') {
    // 明细随之更新：重置拌制站时核对结论、配方与标准调整一起回到初始，不留对不上的半套。
    resetMortarDomain()
    backfillChecks(listRows('mortar'))
  }
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listEntries(key).items) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  ensureBackfilled()
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
