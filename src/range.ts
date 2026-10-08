/**
 * dsh-pdf-render · 纯逻辑层（零 IO，可离线单测）
 *
 * 唯一职责：把「页范围」这句人话翻成**页号数组**，并把翻不动的部分**响亮报错**——
 * 不静默丢弃、不夹取到合法范围（`0` 与 `total+1` 都要报错，而不是当成第 1 页/最后一页）。
 *
 * 支持：`all` · `1` · `1-3` · `2,5` · `1-2,5,7-9`
 * 归一：输出**去重 + 升序**
 */

export interface RangeParse {
  /** 归一后的页号（1 起，升序、去重） */
  pages: number[]
  /** 解析失败的原因，逐条列出；非空即视为整体失败 */
  errors: string[]
}

export function parsePageRange(spec: string, total: number): RangeParse {
  const errors: string[] = []
  const raw = (spec ?? '').trim()
  if (raw === '') {
    return { pages: [], errors: ['pages 为空——请给 all / 1 / 1-3 / 2,5'] }
  }
  if (!Number.isInteger(total) || total < 1) {
    return { pages: [], errors: [`文档页数非法：${total}`] }
  }
  if (raw.toLowerCase() === 'all') {
    return { pages: Array.from({ length: total }, (_, i) => i + 1), errors: [] }
  }
  const out = new Set<number>()
  for (const partRaw of raw.split(',')) {
    const part = partRaw.trim()
    if (part === '') {
      errors.push('范围里有空片段（多余的逗号？）')
      continue
    }
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(part)
    if (!m) {
      errors.push(`无法解析的片段：${part}`)
      continue
    }
    const a = Number(m[1])
    const b = m[2] === undefined ? a : Number(m[2])
    if (a < 1 || a > total) {
      errors.push(`页号越界：${a}（文档共 ${total} 页）`)
      continue
    }
    if (b < 1 || b > total) {
      errors.push(`页号越界：${b}（文档共 ${total} 页）`)
      continue
    }
    if (b < a) {
      errors.push(`区间反序：${part}（起点大于终点）`)
      continue
    }
    for (let p = a; p <= b; p++) out.add(p)
  }
  return { pages: [...out].sort((x, y) => x - y), errors }
}

/** 递归剔掉 `undefined` 键——宿主对工具输出做**无损 JSON** 校验，`JSON.stringify` 会丢它们 ⇒ 往返不等。 */
export function dropUndefined<T>(v: T): T {
  // ⚠ 数组里也要剔 `undefined`：`JSON.stringify([1, undefined, 3])` ⇒ `[1,null,3]`（**null 化**），
  //   那不是无损往返 ⇒ 宿主的 lossless 校验会挂。代价是数组长度可能变——但工具输出里的数组
  //   本就只有「有值的元素」这一种语义，不存在「占位空槽」的约定（2026-10-08 由单测 D1 抓出）。
  if (Array.isArray(v)) return v.filter((x) => x !== undefined).map(dropUndefined) as unknown as T
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (val === undefined) continue
      o[k] = dropUndefined(val)
    }
    return o as T
  }
  return v
}
