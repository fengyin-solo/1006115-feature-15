import { listRows, loadKv, saveKv } from './local-store'
import type {
  Actor,
  EntryRow,
  MortarCheck,
  MortarStandard,
  RecipeVersion,
} from './types'

// 配料偏差核对：配方库、判定标准、核对结论三份数据都在这里集中读写，
// 浆液拌制、试验检测、同步注浆三处页面都从同一份核对结论取数，不各写一套。

const RECIPE_KEY = 'mortar-recipes'
const STANDARD_KEY = 'mortar-standards'
const CHECK_KEY = 'mortar-checks'

const ROLE_OWNER = '拌制站负责人'

// 判定线（V1，自 2026-01-01 起施行）：水泥 ±5%、膨润土 ±5%、水灰比 ±0.05、稠度 ±20mm。
export const DEFAULT_STANDARD: MortarStandard = {
  version: 'V1',
  effectiveFrom: '2026-01-01',
  cementTolPct: 5,
  bentoniteTolPct: 5,
  wcrTol: 0.05,
  consistencyTolMm: 20,
  remark: '同步注浆浆液初始判定线',
  updatedBy: '系统',
}

// 初始配方（V1）：同步注浆浆液，按每盘方量折算的单方用料。
export const DEFAULT_RECIPES: RecipeVersion[] = [
  {
    slurryType: '同步注浆浆液',
    version: 'V1',
    effectiveFrom: '2026-01-01',
    cementKg: 150,
    bentoniteKg: 40,
    wcr: 0.8,
    consistencyMm: 110,
    updatedBy: '系统',
  },
]

function sorted<T extends { effectiveFrom: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
}

/** 取某一日期当天生效的版本（早于该日期生效的最后一版）；没有时返回 null。 */
function versionAt<T extends { effectiveFrom: string }>(versions: T[], date: string): T | null {
  const applicable = sorted(versions).filter((item) => item.effectiveFrom <= date)
  return applicable.length ? applicable[applicable.length - 1] : null
}

function nextVersion(versions: { version: string }[]): string {
  const max = versions.reduce((acc, item) => {
    const num = Number(item.version.replace(/^V/i, ''))
    return Number.isFinite(num) ? Math.max(acc, num) : acc
  }, 0)
  return `V${max + 1}`
}

// ---------- 配方库：只有拌制站负责人能改 ----------

export function listRecipes(): RecipeVersion[] {
  return sorted(loadKv<RecipeVersion[]>(RECIPE_KEY, DEFAULT_RECIPES))
}

export function recipeAt(slurryType: string, date: string): RecipeVersion | null {
  return versionAt(
    listRecipes().filter((item) => item.slurryType === slurryType),
    date,
  )
}

export function saveRecipe(input: Omit<RecipeVersion, 'version' | 'updatedBy'>, actor: Actor): {
  ok: boolean
  message: string
  version?: string
} {
  if (actor.role !== ROLE_OWNER) {
    return { ok: false, message: '只有拌制站负责人能改配方' }
  }
  const recipes = listRecipes()
  const sameType = recipes.filter((item) => item.slurryType === input.slurryType)
  const version = nextVersion(sameType)
  const record: RecipeVersion = { ...input, version, updatedBy: actor.role }
  saveKv(RECIPE_KEY, [...recipes, record])
  // 配方调整：已拌制批次重新核一遍；早于新生效日的批次仍按当时版本判定。
  recheckAll(actor)
  return { ok: true, message: `配方 ${input.slurryType} ${version} 已保存（${input.effectiveFrom} 起生效），已拌制批次已重核`, version }
}

// ---------- 判定标准：版本化，只有拌制站负责人能调 ----------

export function listStandards(): MortarStandard[] {
  return sorted(loadKv<MortarStandard[]>(STANDARD_KEY, [DEFAULT_STANDARD]))
}

export function standardAt(date: string): MortarStandard | null {
  return versionAt(listStandards(), date)
}

export function currentStandard(): MortarStandard {
  const standards = listStandards()
  return sorted(standards)[standards.length - 1]
}

export function saveStandard(
  input: Omit<MortarStandard, 'version' | 'updatedBy'>,
  actor: Actor,
): { ok: boolean; message: string; version?: string } {
  if (actor.role !== ROLE_OWNER) {
    return { ok: false, message: '只有拌制站负责人能调整判定标准' }
  }
  const standards = listStandards()
  const version = nextVersion(standards)
  const record: MortarStandard = { ...input, version, updatedBy: actor.role }
  saveKv(STANDARD_KEY, [...standards, record])
  // 标准调整后重核：适用版本按拌制日期选取，早先的批次按当时判定留着。
  recheckAll(actor)
  return {
    ok: true,
    message: `判定标准 ${version} 已保存（${input.effectiveFrom} 起施行），已拌制批次已重核，早先批次仍按当时判定留档`,
    version,
  }
}

// ---------- 核对结论：三处页面的共同事实源 ----------

export function listChecks(): MortarCheck[] {
  return loadKv<MortarCheck[]>(CHECK_KEY, [])
}

function persistChecks(checks: MortarCheck[]): void {
  saveKv(CHECK_KEY, checks)
}

export function checkByBatch(batchNo: string): MortarCheck | undefined {
  return listChecks().find((item) => item.batchNo === batchNo)
}

/** 偏差批次：两处清单都通过这一个函数读，读到的必然是同一份。 */
export function listDeviationChecks(): MortarCheck[] {
  return listChecks().filter((item) => !item.passed)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const str = String(value ?? '').trim().replace(/[a-zA-Z％%]/g, '')
  if (str === '') return null
  const num = Number(str)
  return Number.isFinite(num) ? num : null
}

function round(num: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(num * factor) / factor
}

export type BatchSnapshot = {
  batchNo: string
  slurryType: string
  mixedAt: string
  requisitionNo: string
  // 实际投料量：以领料单为准（行内水泥/膨润土用量即按领料单口径登记）
  actualCement: number
  actualBentonite: number
  // 水灰比、稠度：以现场记录本实测为准
  measuredWcr: number
  measuredConsistency: number
}

/** 三处取数收成一份：配方库 + 领料单口径投料 + 现场实测指标，缺任一数据不核对。 */
export function readBatchSnapshot(row: {
  [field: string]: string | number | boolean
}): BatchSnapshot | { missing: string[] } {
  const batchNo = String(row['批次编号'] ?? '').trim()
  const slurryType = String(row['浆液类型'] ?? '').trim()
  const mixedAt = String(row['拌制日期'] ?? '').trim()
  const requisitionNo = String(row['领料单号'] ?? '').trim()
  const actualCement = toNumber(row['水泥用量'])
  const actualBentonite = toNumber(row['膨润土用量'])
  const measuredWcr = toNumber(row['水灰比'])
  const measuredConsistency = toNumber(row['稠度'])
  const missing: string[] = []
  if (!batchNo) missing.push('批次编号')
  if (!slurryType) missing.push('浆液类型')
  if (!mixedAt) missing.push('拌制日期')
  if (actualCement === null) missing.push('水泥用量(领料单)')
  if (actualBentonite === null) missing.push('膨润土用量(领料单)')
  if (measuredWcr === null) missing.push('水灰比(现场记录)')
  if (measuredConsistency === null) missing.push('稠度(现场记录)')
  if (missing.length) return { missing }
  return {
    batchNo,
    slurryType,
    mixedAt,
    requisitionNo,
    actualCement: actualCement as number,
    actualBentonite: actualBentonite as number,
    measuredWcr: measuredWcr as number,
    measuredConsistency: measuredConsistency as number,
  }
}

export type Evaluation = {
  passed: boolean
  // 水泥/膨润土是否超线：决定能否提交检验
  materialBlocked: boolean
  failedItems: string[]
  cementDevPct: number
  bentoniteDevPct: number
  wcrDelta: number
  consistencyDelta: number
  recipe: RecipeVersion
  standard: MortarStandard
}

/** 把配方用量与实际投料摆在一起算偏差；标准与配方都取拌制日期当时适用的版本。 */
export function evaluateSnapshot(snapshot: BatchSnapshot): Evaluation | { missing: string[] } {
  const recipe = recipeAt(snapshot.slurryType, snapshot.mixedAt)
  const standard = standardAt(snapshot.mixedAt)
  if (!recipe || !standard) {
    const missing: string[] = []
    if (!recipe) missing.push(`配方（${snapshot.slurryType} 在 ${snapshot.mixedAt} 无适用配方）`)
    if (!standard) missing.push(`判定标准（${snapshot.mixedAt} 无适用标准）`)
    return { missing }
  }

  const cementDevPct = round(
    ((snapshot.actualCement - recipe.cementKg) / recipe.cementKg) * 100,
    1,
  )
  const bentoniteDevPct = round(
    ((snapshot.actualBentonite - recipe.bentoniteKg) / recipe.bentoniteKg) * 100,
    1,
  )
  const wcrDelta = round(snapshot.measuredWcr - recipe.wcr, 2)
  const consistencyDelta = round(snapshot.measuredConsistency - recipe.consistencyMm, 1)

  const failedItems: string[] = []
  if (Math.abs(cementDevPct) > standard.cementTolPct) {
    failedItems.push(
      `水泥用量偏差 ${cementDevPct > 0 ? '+' : ''}${cementDevPct}%（配方 ${recipe.cementKg}kg/投料 ${snapshot.actualCement}kg，允许 ±${standard.cementTolPct}%）`,
    )
  }
  if (Math.abs(bentoniteDevPct) > standard.bentoniteTolPct) {
    failedItems.push(
      `膨润土用量偏差 ${bentoniteDevPct > 0 ? '+' : ''}${bentoniteDevPct}%（配方 ${recipe.bentoniteKg}kg/投料 ${snapshot.actualBentonite}kg，允许 ±${standard.bentoniteTolPct}%）`,
    )
  }
  if (Math.abs(wcrDelta) > standard.wcrTol) {
    failedItems.push(
      `水灰比偏差 ${wcrDelta > 0 ? '+' : ''}${wcrDelta}（设计 ${recipe.wcr}/实测 ${snapshot.measuredWcr}，允许 ±${standard.wcrTol}）`,
    )
  }
  if (Math.abs(consistencyDelta) > standard.consistencyTolMm) {
    failedItems.push(
      `稠度偏差 ${consistencyDelta > 0 ? '+' : ''}${consistencyDelta}mm（设计 ${recipe.consistencyMm}mm/实测 ${snapshot.measuredConsistency}mm，允许 ±${standard.consistencyTolMm}mm）`,
    )
  }

  return {
    passed: failedItems.length === 0,
    materialBlocked:
      Math.abs(cementDevPct) > standard.cementTolPct ||
      Math.abs(bentoniteDevPct) > standard.bentoniteTolPct,
    failedItems,
    cementDevPct,
    bentoniteDevPct,
    wcrDelta,
    consistencyDelta,
    recipe,
    standard,
  }
}

export function conclusionText(check: MortarCheck): string {
  return check.passed
    ? `合格（${check.standardVersion}）`
    : `不合格（${check.standardVersion}）：${check.failedItems.join('；')}`
}

/** 偏差是否卡在水泥/膨润土（决定试验检测能不能送样）。 */
export function isMaterialBlocked(check: MortarCheck): boolean {
  const standard = listStandards().find((item) => item.version === check.standardVersion)
  if (!standard) {
    // 找不到当时标准时退回结论文本判断，宁可不放行
    return !check.passed && !check.failedItems.every((item) => item.startsWith('水灰比') || item.startsWith('稠度'))
  }
  return (
    Math.abs(check.cementDevPct) > standard.cementTolPct ||
    Math.abs(check.bentoniteDevPct) > standard.bentoniteTolPct
  )
}

function buildCheck(
  snapshot: BatchSnapshot,
  evaluation: Evaluation,
  actor: Actor,
  options: { backfilled: boolean; checkedAt: string },
): MortarCheck {
  const failed = [...evaluation.failedItems]
  const check: MortarCheck = {
    batchNo: snapshot.batchNo,
    slurryType: snapshot.slurryType,
    mixedAt: snapshot.mixedAt,
    recipeVersion: evaluation.recipe.version,
    standardVersion: evaluation.standard.version,
    formulaCement: evaluation.recipe.cementKg,
    formulaBentonite: evaluation.recipe.bentoniteKg,
    designWcr: evaluation.recipe.wcr,
    designConsistency: evaluation.recipe.consistencyMm,
    actualCement: snapshot.actualCement,
    actualBentonite: snapshot.actualBentonite,
    measuredWcr: snapshot.measuredWcr,
    measuredConsistency: snapshot.measuredConsistency,
    requisitionNo: snapshot.requisitionNo,
    cementDevPct: evaluation.cementDevPct,
    bentoniteDevPct: evaluation.bentoniteDevPct,
    wcrDelta: evaluation.wcrDelta,
    consistencyDelta: evaluation.consistencyDelta,
    passed: evaluation.passed,
    failedItems: failed,
    conclusion: evaluation.passed
      ? `合格（${evaluation.standard.version}）`
      : `不合格（${evaluation.standard.version}）：${failed.join('；')}`,
    firstCheckedAt: options.checkedAt,
    checkedBy: actor.role,
    backfilled: options.backfilled,
    history: [
      {
        standardVersion: evaluation.standard.version,
        passed: evaluation.passed,
        failedItems: failed,
        at: options.checkedAt,
      },
    ],
  }
  return check
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * 提交核对：同一批次重复提交只留最早一条（再递一遍仍按最早那次返回）；
 * 数据不齐整单不写，不留半条。
 */
export function submitCheck(
  row: { [field: string]: string | number | boolean },
  actor: Actor,
): { ok: boolean; message: string; check?: MortarCheck } {
  const snapshotLike = readBatchSnapshot(row)
  if ('missing' in snapshotLike) {
    return { ok: false, message: `数据不全（缺 ${snapshotLike.missing.join('、')}），本次核对不落任何记录` }
  }
  const existing = checkByBatch(snapshotLike.batchNo)
  if (existing) {
    return {
      ok: true,
      message: `批次 ${existing.batchNo} 已在 ${existing.firstCheckedAt} 核对过，重复提交只保留最早一条：${existing.conclusion}`,
      check: existing,
    }
  }
  const evaluation = evaluateSnapshot(snapshotLike)
  if ('missing' in evaluation) {
    return { ok: false, message: `${evaluation.missing.join('、')}，本次核对不落任何记录` }
  }
  const check = buildCheck(snapshotLike, evaluation, actor, {
    backfilled: false,
    checkedAt: today(),
  })
  // 先构造完整记录再一次性写入：写不成就别落半条。
  persistChecks([...listChecks(), check])
  return {
    ok: true,
    message: check.passed
      ? `批次 ${check.batchNo} 核对合格（${check.standardVersion}），可以提交检验`
      : `批次 ${check.batchNo} 核对不合格，差在：${check.failedItems.join('；')}`,
    check,
  }
}

/**
 * 全量重核：标准/配方调整后对已拌制批次重新核一遍。
 * 早于新生效日的批次仍选到当时版本，结论不变；只有真正适用了新版本且结论翻转的批次
 * 才追加历史并刷新结论。早先的判定留档在 history 里。
 */
export function recheckAll(
  actor: Actor,
  rows?: EntryRow[],
): { recomputed: number; changed: number; backfilled: number } {
  const checks = listChecks()
  const indexByBatch = new Map(checks.map((item) => [item.batchNo, item]))
  let changed = 0
  let backfilled = 0
  let recomputed = 0

  // 默认就顺着现有读法从拌制站清单取批次，调用方不用再传第二份。
  const batchRows = rows ?? listRows('mortar')
  for (const raw of batchRows) {
    const snapshotLike = readBatchSnapshot(raw)
    if ('missing' in snapshotLike) continue
    const evaluation = evaluateSnapshot(snapshotLike)
    if ('missing' in evaluation) continue
    recomputed += 1
    const existing = indexByBatch.get(snapshotLike.batchNo)
    if (!existing) {
      // 老的批次按拌制日期补登一遍。
      const check = buildCheck(snapshotLike, evaluation, actor, {
        backfilled: true,
        checkedAt: snapshotLike.mixedAt,
      })
      checks.push(check)
      indexByBatch.set(check.batchNo, check)
      backfilled += 1
      continue
    }
    if (
      existing.passed !== evaluation.passed ||
      existing.standardVersion !== evaluation.standard.version ||
      existing.recipeVersion !== evaluation.recipe.version
    ) {
      existing.recipeVersion = evaluation.recipe.version
      existing.standardVersion = evaluation.standard.version
      existing.formulaCement = evaluation.recipe.cementKg
      existing.formulaBentonite = evaluation.recipe.bentoniteKg
      existing.designWcr = evaluation.recipe.wcr
      existing.designConsistency = evaluation.recipe.consistencyMm
      existing.cementDevPct = evaluation.cementDevPct
      existing.bentoniteDevPct = evaluation.bentoniteDevPct
      existing.wcrDelta = evaluation.wcrDelta
      existing.consistencyDelta = evaluation.consistencyDelta
      existing.passed = evaluation.passed
      existing.failedItems = [...evaluation.failedItems]
      existing.conclusion = evaluation.passed
        ? `合格（${evaluation.standard.version}）`
        : `不合格（${evaluation.standard.version}）：${evaluation.failedItems.join('；')}`
      existing.recheckedAt = today()
      existing.history.push({
        standardVersion: evaluation.standard.version,
        passed: evaluation.passed,
        failedItems: [...evaluation.failedItems],
        at: today(),
      })
      changed += 1
    }
  }
  if (recomputed > 0) {
    persistChecks(checks)
  }
  return { recomputed, changed, backfilled }
}

/** 首次加载时把存量批次按拌制日期补登一遍（已存在的批次不动）。 */
export function backfillChecks(rows: EntryRow[]): { backfilled: number } {
  const existing = new Set(listChecks().map((item) => item.batchNo))
  const additions: MortarCheck[] = []
  for (const raw of rows) {
    const snapshotLike = readBatchSnapshot(raw)
    if ('missing' in snapshotLike) continue
    if (existing.has(snapshotLike.batchNo)) continue
    const evaluation = evaluateSnapshot(snapshotLike)
    if ('missing' in evaluation) continue
    additions.push(
      buildCheck(snapshotLike, evaluation, { role: '值班管理员' }, {
        backfilled: true,
        checkedAt: snapshotLike.mixedAt,
      }),
    )
  }
  if (additions.length) {
    persistChecks([...listChecks(), ...additions])
  }
  return { backfilled: additions.length }
}

/** 拌制站模块重置时一并清空核对结论与配方/标准调整，避免留下对不上的半套数据。 */
export function resetMortarDomain(): void {
  saveKv(RECIPE_KEY, DEFAULT_RECIPES)
  saveKv(STANDARD_KEY, [DEFAULT_STANDARD])
  saveKv(CHECK_KEY, [])
}

export const MORTAR_OWNER_ROLE = ROLE_OWNER
