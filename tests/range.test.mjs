/**
 * dsh-pdf-render 纯判定层测试
 *
 * 本文件里的 **P1–P6 是尸体样本**——它们不测「功能正常」，而测
 * 「仪器在坏输入上会不会**静默放行**」。判据纪律：恒为空的输出不是证据，
 * 恒不报错的判据同样不是证据。
 *
 * 跑法：先 `npm run build`（本测测编译产物，TS 不能直接跑），再 `npm test`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePageRange, dropUndefined } from '../lib/range.js'

test('N1 单页：1 ⇒ [1]', () => {
  assert.deepEqual(parsePageRange('1', 10), { pages: [1], errors: [] })
})

test('N2 区间：1-3 ⇒ [1,2,3]', () => {
  assert.deepEqual(parsePageRange('1-3', 10), { pages: [1, 2, 3], errors: [] })
})

test('N3 列表：2,5 ⇒ [2,5]', () => {
  assert.deepEqual(parsePageRange('2,5', 10), { pages: [2, 5], errors: [] })
})

test('N4 混合 + 归一：5,1-2,3 ⇒ 升序去重 [1,2,3,5]', () => {
  assert.deepEqual(parsePageRange('5,1-2,3', 10), { pages: [1, 2, 3, 5], errors: [] })
})

test('N5 重复项去重：1,1,2 ⇒ [1,2]', () => {
  assert.deepEqual(parsePageRange('1,1,2', 10), { pages: [1, 2], errors: [] })
})

test('N6 all ⇒ 1..total', () => {
  assert.deepEqual(parsePageRange('all', 3), { pages: [1, 2, 3], errors: [] })
})

test('N7 大小写不敏感：ALL ⇒ 1..total', () => {
  assert.deepEqual(parsePageRange('ALL', 2), { pages: [1, 2], errors: [] })
})

test('P1 尸体：空串必须报错，不得当成「全部」或「第 1 页」', () => {
  const r = parsePageRange('', 10)
  assert.equal(r.pages.length, 0)
  assert.ok(r.errors.length > 0, '空规格必须产生错误')
})

test('P2 尸体：非数字片段必须报错，不得静默丢弃', () => {
  const r = parsePageRange('abc', 10)
  assert.deepEqual(r.pages, [])
  assert.ok(r.errors.some((e) => e.includes('abc')), '错误里应点名那个片段')
})

test('P3 尸体：下界越界 0 必须报错，不得夹取成第 1 页', () => {
  const r = parsePageRange('0', 10)
  assert.deepEqual(r.pages, [], '越界不得产出任何页')
  assert.ok(r.errors.length > 0)
})

test('P4 尸体：上界越界 total+1 必须报错，不得夹取成最后一页', () => {
  const r = parsePageRange('11', 10)
  assert.deepEqual(r.pages, [])
  assert.ok(r.errors.length > 0)
})

test('P5 尸体：区间反序 3-1 必须报错，不得自动交换', () => {
  const r = parsePageRange('3-1', 10)
  assert.deepEqual(r.pages, [])
  assert.ok(r.errors.some((e) => e.includes('反序')))
})

test('P6 尸体：多余逗号 1,,2 必须报错（空片段）', () => {
  const r = parsePageRange('1,,2', 10)
  assert.ok(r.errors.some((e) => e.includes('空片段')), '应点名空片段')
})

test('P7 尸体：区间部分越界时，合法部分也不得被采用（整体失败语义）', () => {
  // 1-20 中 11..20 越界 ⇒ 报错；此时 1..10 不许被当成「部分成功」静默产出
  const r = parsePageRange('11-20', 10)
  assert.deepEqual(r.pages, [], '越界片段不得产出任何页')
  assert.ok(r.errors.length > 0)
})

test('P8 尸体：文档页数非法（0）必须报错', () => {
  const r = parsePageRange('1', 0)
  assert.deepEqual(r.pages, [])
  assert.ok(r.errors.length > 0)
})

test('D1 dropUndefined：递归剔掉 undefined 键（lossless JSON 往返）', () => {
  const out = dropUndefined({ a: 1, b: undefined, c: { d: undefined, e: 2 }, f: [1, undefined, 3] })
  assert.deepEqual(out, { a: 1, c: { e: 2 }, f: [1, 3] })
  assert.equal(JSON.parse(JSON.stringify(out)).c.e, 2, '往返后仍在')
})

test('D2 dropUndefined：不许把 null / false / 0 / 空串 当 undefined 剔掉', () => {
  const out = dropUndefined({ n: null, f: false, z: 0, s: '' })
  assert.deepEqual(out, { n: null, f: false, z: 0, s: '' })
})
