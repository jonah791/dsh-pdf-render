/**
 * dsh-pdf-render：PDF → 图片渲染
 *
 * 它解决什么：本机**没有** poppler（`pdftoppm`/`pdftocairo`）、没有 ghostscript、没有
 * `pypdfium2` 之外的渲染器 ⇒ 模型无法「亲眼看」PDF 的版式（表格是否挤成一团、图有没有
 * 越界、首页署名对不对）。而**视觉问题只能靠眼睛判**——判据落在文本层会漏掉一整类缺陷
 * （2026-10-08 实测：宽表被 `adjustbox` 缩到读不清，`\begin{tabular}` 文本层一切正常）。
 *
 * 依赖：`pypdfium2`（纯 wheel，自带二进制；本机 Python 3.14 已装）+ Pillow。
 * 为什么用 Python 而不是纯 JS：node 侧要 `pdfjs-dist` + `node-canvas`（原生模块，构建脆），
 * 而 pypdfium2 已就位且零构建。**代价**：插件依赖外部 python3（README 已如实标注）。
 *
 * 输出纪律：**不返回像素**（那是上下文炸弹），只返回文件路径与尺寸；看图交给 read_image。
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { dropUndefined, parsePageRange } from './range.js'

export const name = 'agent-pdf-render'
export const inject = ['tools'] as const

export interface Config {
  enabled: boolean
  /** python3 可执行名（缺省 python3；某些环境是 python） */
  python: string
  /** 输出根目录（缺省 <DSH_HOME>/_tmp_review/pdf-render） */
  outRoot: string
}
export const Config = z.object({
  enabled: z.boolean().default(true),
  python: z.string().default('python3'),
  outRoot: z.string().default(''),
})

/**
 * 渲染脚本（内联，随 lib/ 一起发布——**不另放 .py**，否则 package.json 的 `files` 不含它，
 * 安装后静默缺失）。它只做一件事：按**已解析好**的页号渲染，并回 JSON。
 * 页范围的解析在 TS 纯层里做（可离线单测），这里不重复实现——**逻辑只有一处**。
 */
const RENDER_PY = `
import json, os, sys
def main():
    req = json.loads(sys.stdin.read())
    try:
        import pypdfium2 as pdfium
    except Exception as e:
        return {'ok': False, 'error': 'pypdfium2 未安装或无渲染后端：%s' % e}
    pdf_path, pages, scale, outdir = req['path'], req['pages'], req['scale'], req['outDir']
    if not os.path.isfile(pdf_path):
        return {'ok': False, 'error': 'PDF 不存在：%s' % pdf_path}
    try:
        os.makedirs(outdir, exist_ok=True)
        pdf = pdfium.PdfDocument(pdf_path)
        total = len(pdf)
        if req.get('probeOnly'):
            return {'ok': True, 'pageCount': total, 'images': []}
        base = os.path.splitext(os.path.basename(pdf_path))[0]
        imgs = []
        for p in pages:
            img = pdf[p - 1].render(scale=scale).to_pil()
            f = os.path.join(outdir, '%s-p%03d.png' % (base, p))
            img.save(f)
            imgs.append({'page': p, 'file': f, 'width': img.size[0], 'height': img.size[1],
                         'bytes': os.path.getsize(f)})
        return {'ok': True, 'pageCount': total, 'images': imgs}
    except Exception as e:
        return {'ok': False, 'error': '渲染失败（%s）：%s' % (type(e).__name__, e)}
sys.stdout.write(json.dumps(main()))
`

export function apply(ctx: Context, config: Config): void {
  // enabled 必须在 apply() 里被消费：显式 false 时挂载但不贡献任何工具/副作用。
  // 只认 === false（未配置/undefined 视为启用），避免把「没写」误判成「关掉」。
  if (config.enabled === false) return
  const logger = ctx.logger('agent-pdf-render')

  ctx.tools.register(defineTool({
    name: 'pdf_render',
    description:
      '把 PDF 的指定页渲染成 PNG，返回**文件路径**（不返回像素——看图请用 read_image / vision_ask）。'
      + 'pages 支持 1 / 1-3 / 2,5 / all。本机走 pypdfium2（无 poppler/gs）。',
    parameters: {
      path: { type: 'string', required: true, description: 'PDF 文件的绝对路径' },
      pages: { type: 'string', description: '页范围：1 / 1-3 / 2,5 / all（缺省 1）' },
      scale: { type: 'number', description: '渲染倍率（缺省 1.5；2.0 更清晰但更大）' },
      outDir: { type: 'string', description: '输出目录（缺省 <DSH_HOME>/_tmp_review/pdf-render）' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          pdf: { type: 'string' },
          pageCount: { type: 'number' },
          scale: { type: 'number' },
          outDir: { type: 'string' },
          images: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                page: { type: 'number', required: true },
                file: { type: 'string', required: true },
                width: { type: 'number', required: true },
                height: { type: 'number', required: true },
                bytes: { type: 'number', required: true },
              },
            },
          },
          error: { type: 'string' },
        },
      },
      render: (_a: unknown, v: any) => {
        const o = v as Record<string, any>
        if (!o?.ok) return [{ type: 'text', text: `pdf_render 失败：${o?.error ?? '未知原因'}` }]
        const lines = (o.images ?? []).map(
          (i: any) => `  第 ${i.page} 页 → ${i.file}（${i.width}×${i.height}, ${i.bytes} B）`)
        return [{
          type: 'text',
          text: `${o.pdf}：共 ${o.pageCount} 页，渲染 ${lines.length} 页（scale ${o.scale}）\n${lines.join('\n')}`,
        }]
      },
    },
    async execute(args: { path: string; pages?: string; scale?: number; outDir?: string }) {
      const pdfPath = String(args.path ?? '')
      const scale = Number(args.scale ?? 1.5)
      const pagesSpec = String(args.pages ?? '1')

      if (!existsSync(pdfPath)) {
        return dropUndefined({ ok: false, error: `PDF 不存在：${pdfPath}` })
      }
      if (!Number.isFinite(scale) || scale <= 0 || scale > 8) {
        return dropUndefined({ ok: false, error: `scale 非法：${args.scale}（应在 0 < scale ≤ 8）` })
      }
      const outDir = args.outDir
        ? String(args.outDir)
        : join(config.outRoot || join(process.env.DSH_HOME || '.', '_tmp_review'), 'pdf-render')
      try {
        mkdirSync(outDir, { recursive: true })
      } catch (e) {
        return dropUndefined({ ok: false, error: `输出目录不可建：${outDir}（${String(e)}）` })
      }

      // 先取页数（打开 PDF 失败要在解析范围之前响亮报错——否则会把「打不开」误报成「页号越界」）
      const probe = runPy(config.python, { path: pdfPath, pages: [1], scale: 0.2, outDir, probeOnly: true })
      if (!probe.ok) return dropUndefined({ ok: false, error: probe.error })
      const total = Number(probe.pageCount ?? 0)

      const parsed = parsePageRange(pagesSpec, total)
      if (parsed.errors.length > 0) {
        return dropUndefined({ ok: false, error: `pages 解析失败：${parsed.errors.join('；')}` })
      }

      const r = runPy(config.python, { path: pdfPath, pages: parsed.pages, scale, outDir })
      if (!r.ok) return dropUndefined({ ok: false, error: r.error })
      logger.info(`pdf_render: ${basename(pdfPath)} 渲染 ${parsed.pages.length} 页 → ${outDir}`)
      return dropUndefined({
        ok: true,
        pdf: pdfPath,
        pageCount: total,
        scale,
        outDir,
        images: r.images,
      })
    },
  }))
}

interface PyResult {
  ok: boolean
  pageCount?: number
  images?: Array<{ page: number; file: string; width: number; height: number; bytes: number }>
  error?: string
}

/** 跑一次渲染脚本。失败一律带原因返回（观测不反噬：不抛，交给工具层转成可读错误）。 */
function runPy(python: string, req: Record<string, unknown>): PyResult {
  try {
    const p = spawnSync(python, ['-c', RENDER_PY], {
      input: JSON.stringify(req),
      encoding: 'utf-8',
      timeout: 120_000,
    })
    if (p.error) return { ok: false, error: `无法启动 ${python}：${String(p.error)}` }
    if (p.status !== 0) {
      return { ok: false, error: `渲染进程退出码 ${p.status}：${(p.stderr || '').slice(0, 400)}` }
    }
    const out = (p.stdout || '').trim()
    const parsed = JSON.parse(out) as PyResult
    if (req.probeOnly) return { ok: parsed.ok, pageCount: parsed.pageCount, error: parsed.error }
    return parsed
  } catch (e) {
    return { ok: false, error: `渲染调用异常：${String(e)}` }
  }
}
