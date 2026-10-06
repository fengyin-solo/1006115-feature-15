import assert from 'node:assert'
import * as mc from '@/api/mortar-check.ts'

const manager = '拌制站负责人'
const other = '值班管理员'

function mortarRows() {
  // 通过 enriched 列表触发补登，再用 service 读
  return mc.listMortarRows()
}

// 1) 首次读取自动按拌制日期补登：9 个批次里 8 个已拌制（含废弃），MORT-0008 待拌制不补。
const rows = mortarRows()
const byNo = Object.fromEntries(rows.map((r) => [r.批次编号, r]))
const expected = {
  'MORT-0001': { pass: '核对合格', std: 'v1' },
  'MORT-0002': { pass: '核对不合格', std: 'v1', hit: '水泥用量' },
  'MORT-0003': { pass: '核对合格', std: 'v1' },
  'MORT-0004': { pass: '核对不合格', std: 'v1', hit: '膨润土用量' },
  'MORT-0005': { pass: '核对不合格', std: 'v1', hit: '水灰比' },
  'MORT-0006': { pass: '核对不合格', std: 'v1', hit: '稠度' },
  'MORT-0007': { pass: '核对合格', std: 'v1' },
  'MORT-0009': { pass: '核对合格', std: 'v1' },
}
for (const [no, exp] of Object.entries(expected)) {
  const row = byNo[no]
  assert.ok(row, `缺少批次 ${no}`)
  assert.ok(row.核对结论.startsWith(exp.pass), `${no} 结论应为 ${exp.pass}，实际：${row.核对结论}`)
  assert.equal(row.适用标准版本, exp.std, `${no} 标准版本`)
  if (exp.hit) {
    assert.ok(row.核对结论.includes(exp.hit), `${no} 应写明差在 ${exp.hit}，实际：${row.核对结论}`)
  }
}
assert.ok(byNo['MORT-0008'].核对结论.includes('待核对'), '待拌制批次不应有结论')

// 2) 偏差批次：4 条（废弃的 MORT-0009 合格不计）。
const dev = mc.deviationBatches()
assert.deepEqual(dev.map((d) => d.批次编号).sort(), ['MORT-0002', 'MORT-0004', 'MORT-0005', 'MORT-0006'])

// 3) 超线批次不许提交检验，且消息写明差在哪个料。
const id2 = rows.find((r) => r.批次编号 === 'MORT-0002').id
const block = mc.submitMortarCheck(Number(id2), other)
assert.equal(block.ok, false, '水泥超线批次不许提交')
assert.ok(block.message.includes('水泥用量'), block.message)

// 4) 重复提交沿用最早一条：合格批次再递一遍返回成功但不新增委托、不改动结论时间。
const id1 = rows.find((r) => r.批次编号 === 'MORT-0001').id
const before = mc.listMortarRows().find((r) => r.id === id1).核对时间
const again = mc.submitMortarCheck(Number(id1), other)
assert.equal(again.ok, true)
assert.ok(again.message.includes('重复提交沿用最早结论'), again.message)
const after = mc.listMortarRows().find((r) => r.id === id1).核对时间
assert.equal(before, after, '重复核对不得改动最早结论')

// 5) 权限：非负责人改配方/调标准被拒。
const deniedRecipe = mc.saveRecipe(other, {
  浆液类型: '惰性浆液', 配方水泥: 1, 配方膨润土: 1, 配方水灰比: 1, 配方稠度: 1, 生效日期: '2026-10-01',
})
assert.equal(deniedRecipe.ok, false)
const deniedStd = mc.adjustStandard(other, {
  水泥偏差限: 0.01, 膨润土偏差限: 0.01, 水灰比极差限: 0.01, 稠度极差限: 1, 生效日期: '2026-10-01',
})
assert.equal(deniedStd.ok, false)

// 6) 改配方不影响已冻结结论；未核对批次按新配方预判。
const recipeResult = mc.saveRecipe(manager, {
  浆液类型: '可硬性浆液', 配方水泥: 110, 配方膨润土: 30, 配方水灰比: 0.7, 配方稠度: 100, 生效日期: '2026-10-01',
})
assert.equal(recipeResult.ok, true)
const stillFrozen = mc.listMortarRows().find((r) => r.批次编号 === 'MORT-0002')
assert.ok(stillFrozen.核对结论.includes('水泥用量'), '改配方后历史结论保留')

// 7) 发布 v2（水泥 ±3%，2026-10-01 生效）：九月批次仍按 v1，早先结论沿用；MORT-0007 在 v2 下水泥 744/720=3.3% 会超线，
//    但它九月拌制且已有 v1 结论，保持合格。
const adj = mc.adjustStandard(manager, {
  水泥偏差限: 0.03, 膨润土偏差限: 0.05, 水灰比极差限: 0.05, 稠度极差限: 20, 生效日期: '2026-10-01', 说明: '水泥收严至 ±3%',
})
assert.equal(adj.ok, true, adj.message)
assert.equal(adj.重新核对条数, 0, '已有结论的批次不重核')
const stds = mc.listStandards()
assert.equal(stds.length, 2)
assert.equal(stds[1].版本, 'v2')
const sepRow = mc.listMortarRows().find((r) => r.批次编号 === 'MORT-0007')
assert.equal(sepRow.适用标准版本, 'v1')
assert.ok(sepRow.核对结论.startsWith('核对合格'), '九月批次按当时 v1 保留合格')

// 8) 新生效日期不允许早于现行版本。
const badDate = mc.adjustStandard(manager, {
  水泥偏差限: 0.02, 膨润土偏差限: 0.02, 水灰比极差限: 0.02, 稠度极差限: 2, 生效日期: '2026-09-01',
})
assert.equal(badDate.ok, false)

// 9) 两处入口读到的偏差批次同一份、同条数。
const testing = mc.attachCheckConclusion('testing')
const grouting = mc.attachCheckConclusion('grouting')
const testingDev = testing.filter((r) => String(r.配料核对结论).startsWith('核对不合格')).map((r) => r.关联批次编号)
const groutingDev = grouting.filter((r) => String(r.配料核对结论).startsWith('核对不合格')).map((r) => r.浆液批次编号)
assert.deepEqual(testingDev.sort(), ['MORT-0002'])
assert.deepEqual(groutingDev.sort(), ['MORT-0002'])
assert.equal(testingDev.length, groutingDev.length)
assert.equal(mc.deviationBatches().length, 4)
// 投影文本一致
const t2 = testing.find((r) => r.关联批次编号 === 'MORT-0002').配料核对结论
const g2 = grouting.find((r) => r.浆液批次编号 === 'MORT-0002').配料核对结论
assert.equal(t2, g2)
assert.ok(t2.includes('水泥用量'))

// 10) 待用批次清单：只有检验合格+核对合格；已废弃批次即便早先合格也不待用。
const ready = mc.readyMortarBatches().map((r) => r.批次编号)
assert.deepEqual(ready.sort(), ['MORT-0001', 'MORT-0003'])

// 11) 注浆闸门：偏差批次不能开始注浆；合格批次放行。
const gateBad = mc.gateGrouting(grouting.find((r) => r.浆液批次编号 === 'MORT-0002'))
assert.ok(gateBad && gateBad.includes('水泥用量'), gateBad ?? '')
const gateGood = mc.gateGrouting(grouting.find((r) => r.浆液批次编号 === 'MORT-0001'))
assert.equal(gateGood, null)

// 12) 补登幂等：再补一遍不新增。
const second = mc.backfillMortarChecks(manager)
assert.equal(second.补登条数, 0)

// 13) 待拌制批次提交检验：数据不齐，不落半条。
const id8 = rows.find((r) => r.批次编号 === 'MORT-0008').id
const incomplete = mc.submitMortarCheck(Number(id8), other)
assert.equal(incomplete.ok, false)
assert.ok(incomplete.message.includes('未落任何记录'))
assert.equal(mc.listMortarRows().find((r) => r.id === id8).核对时间, '—')

// 14) 合格的拌制中批次首次提交检验：转检验合格并自动生成一条委托；再递不重复生成。
const id7 = rows.find((r) => r.批次编号 === 'MORT-0007').id
const testingBefore = mc.attachCheckConclusion('testing').length
const submit7 = mc.submitMortarCheck(Number(id7), other)
assert.equal(submit7.ok, true, submit7.message)
const testingAfter1 = mc.attachCheckConclusion('testing')
assert.equal(testingAfter1.length, testingBefore + 1)
assert.ok(testingAfter1.some((r) => r.关联批次编号 === 'MORT-0007'))
mc.submitMortarCheck(Number(id7), other)
const testingAfter2 = mc.attachCheckConclusion('testing')
assert.equal(testingAfter2.length, testingAfter1.length, '重复提交不得重复生成委托')
assert.equal(mc.listMortarRows().find((r) => r.id === id7).status, '检验合格')

console.log('全部 14 组断言通过 ✓')
