/**
 * 浆液拌制配料偏差核对领域类型。
 *
 * 三处取数收成同一份：配方用量、现场签认实际投料、领料单数量都挂在同一条浆液批次上，
 * 核对结论也只产一份（配料核对记录），试验检测委托清单与同步注浆待用批次清单都读这一份。
 */

/** 拌制站现场角色：只有「拌制站负责人」能改配方与判定标准。 */
export type StationRole = '拌制站负责人' | '值班管理员'

/** 配方：按浆液类型维护，每条配方含拌制一方浆液所需的各料用量及设计水灰比、稠度。 */
export type SlurryRecipe = {
  浆液类型: string
  /** 单方水泥用量（kg/m³）。 */
  配方水泥: number
  /** 单方膨润土用量（kg/m³）。 */
  配方膨润土: number
  /** 设计水灰比（无量纲）。 */
  配方水灰比: number
  /** 设计稠度（mm 坍落度）。 */
  配方稠度: number
  生效日期: string
  更新人: string
  更新时间: string
}

/** 判定标准版本：按拌制日期适用，标准调整只追加新版本，不改老版本。 */
export type MixStandard = {
  版本: string
  生效日期: string
  /** 水泥用量允许相对偏差，±比值，如 0.05 表示 ±5%。 */
  水泥偏差限: number
  /** 膨润土用量允许相对偏差，±比值。 */
  膨润土偏差限: number
  /** 水灰比允许极差，±绝对值。 */
  水灰比极差限: number
  /** 稠度允许极差，±mm。 */
  稠度极差限: number
  调整人: string
  调整时间: string
  说明: string
}

/** 单个核对项的结论。 */
export type CheckLine = {
  /** 判定线名称：水泥用量 / 膨润土用量 / 水灰比 / 稠度。 */
  项目: string
  配方值: number
  实测值: number
  /** 用量类为相对偏差（%），水灰比/稠度为极差。 */
  偏差: number
  偏差文本: string
  允许范围: string
  是否合格: boolean
  不合格说明: string
}

/** 配料核对记录：同一批次只允许一条，重复提交沿用最早那次。 */
export type MixCheckRecord = {
  批次编号: string
  浆液批次id: number
  浆液类型: string
  拌制日期: string
  适用标准版本: string
  /** 核对时冻结的配方快照，配方后来改了也不影响历史结论。 */
  配方快照: SlurryRecipe
  核对时间: string
  核对人: string
  是否合格: boolean
  核对项: CheckLine[]
  /** 不合格时写明差在哪个料/哪一项；合格为空串。 */
  结论说明: string
  来源规则: string
  补登: boolean
}
