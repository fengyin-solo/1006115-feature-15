/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 登录角色：只有拌制站负责人能改配方、调判定标准。 */
export type ActorRole = '拌制站负责人' | '值班管理员'

export type Actor = {
  role: ActorRole
}

/** 配方版本：按浆液类型维护，批次核对时取拌制日期当天生效的那一版。 */
export type RecipeVersion = {
  slurryType: string
  version: string
  effectiveFrom: string
  cementKg: number
  bentoniteKg: number
  wcr: number
  consistencyMm: number
  updatedBy: string
}

/** 配料偏差判定标准：版本化；早于新生效日拌制的批次仍按当时版本判定。 */
export type MortarStandard = {
  version: string
  effectiveFrom: string
  cementTolPct: number
  bentoniteTolPct: number
  wcrTol: number
  consistencyTolMm: number
  remark: string
  updatedBy: string
}

/** 单条核对结论：同一批次只允许一条，是试验检测与同步注浆两处清单的共同事实源。 */
export type MortarCheck = {
  batchNo: string
  slurryType: string
  mixedAt: string
  recipeVersion: string
  standardVersion: string
  formulaCement: number
  formulaBentonite: number
  designWcr: number
  designConsistency: number
  actualCement: number
  actualBentonite: number
  measuredWcr: number
  measuredConsistency: number
  requisitionNo: string
  cementDevPct: number
  bentoniteDevPct: number
  wcrDelta: number
  consistencyDelta: number
  passed: boolean
  failedItems: string[]
  conclusion: string
  /** 最早一次提交核对的时间，重复提交与重核都不改它。 */
  firstCheckedAt: string
  /** 最近一次按新标准重核的时间；结论没变就不写。 */
  recheckedAt?: string
  checkedBy: string
  backfilled: boolean
  history: { standardVersion: string; passed: boolean; failedItems: string[]; at: string }[]
}
