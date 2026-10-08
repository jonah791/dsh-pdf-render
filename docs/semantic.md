# dsh-pdf-render · 语义文档

> 元信息：版本 v0.1 · 状态 implemented（build 0 · 单测 31/31 · 离线冒烟 4/4）· 最近复核 2026-10-08 · owner agent-pdf-render

## 1 · 定位与反定位

**是什么**：把 PDF 的**指定页**渲染成 PNG，返回**文件路径与尺寸**——给模型一双「能看版式的眼睛」。

**不是什么**（反定位，避免被误当万能工具）：

- **不是** OCR / 文本抽取——要文字请走文本层；本工具产出位图，**文字不可再检索**
- **不是**图片处理——不裁剪、不旋转、不拼接、不压缩
- **不是**像素通道——**绝不返回像素**给模型，只返回路径（返回像素会把上下文打成筛子）
- **不是** PDF 编辑——只读
- **不是**通用文档预览——只认 PDF；Word/PPT 请先转 PDF

## 2 · 术语表

| 术语 | 含义 |
|---|---|
| 页号 | **1 起**（不是 0 起）：`pages: '1'` 是第一页 |
| scale | 渲染倍率：PDF 的 1pt ⇒ `scale` px。正文 10pt @1.5 ≈ 15px |
| 渲染后端 | `pypdfium2`（Chrome PDFium 的 Python 绑定），**不是** poppler |
| 探页 | 打开文档只取总页数、**不渲染**（`probeOnly` 分支在渲染之前返回） |

## 3 · 概念模型与不变量

```
调用 → 探页（打开 PDF，取总页数）→ 解析页范围（纯层）→ 渲染（pypdfium2）→ 回路径
```

不变量（违反即缺陷）：

1. **不返回像素**——数组元素只有 `{page, file, width, height, bytes}`
2. **页范围解析失败 ⇒ 整体失败**——不许「部分成功」（越界片段不产出任何页）
3. **越界不夹取**——`0` 与 `total+1` 报错，不当成第 1 页 / 最后一页
4. **探页不渲染**——否则每个调用都会多产出一张没人要的小图
5. **输出必过 lossless**——所有返回点经 `dropUndefined`（**含数组元素**），否则宿主校验会拒
6. **失败带原因**——`runPy` 不抛，把 stderr / 退出码 / 异常类型转成可读 error

## 4 · 契约

### 4.1 配置（Config schema）

| 字段 | 类型 | 缺省 | 语义 |
|---|---|---|---|
| `enabled` | boolean | `true` | 显式 `false` ⇒ 挂载但不注册工具（只认 `=== false`，未写视为启用） |
| `python` | string | `'python3'` | Python 可执行名（某些环境是 `python`） |
| `outRoot` | string | `''` | 输出根；空 ⇒ `<DSH_HOME>/_tmp_review` |

### 4.2 工具面

**`pdf_render`**

| 参数 | 类型 | 必填 | 缺省 | 语义 |
|---|---|---|---|---|
| `path` | string | ✅ | — | PDF 绝对路径 |
| `pages` | string | | `'1'` | `1` / `1-3` / `2,5` / `all` |
| `scale` | number | | `1.5` | 允许区间 `0 < scale ≤ 8` |
| `outDir` | string | | `<DSH_HOME>/_tmp_review/pdf-render` | 输出目录 |

返回：`{ok, pdf, pageCount, scale, outDir, images[], error?}` —— 失败时 `ok=false` 且 `error` 可读。

### 4.3 调用点清单 [MUST]

| 调用点 | 位置 | 说明 |
|---|---|---|
| **模型直接调用** `pdf_render` | 工具面 | 唯一入口；本插件**不调用**任何其它插件的能力 |
| 依赖 `tools` service | `src/index.ts` 的 `apply` | `inject = ['tools']`；`ctx.tools.register` |
| **外部进程依赖** `python3` + `pypdfium2` | `src/index.ts` 的 `runPy` | 进程外依赖，见 §5 |

## 5 · 边界与信任

- **输入信任级**：`path` 来自模型 ⇒ **低信任**。本插件只**读**它，不执行 PDF 内嵌脚本/动作（PDFium 渲染路径不跑 JS）⇒ 恶意 PDF 的最坏后果是渲染失败，已被兜住。
- **能力边界（capability ≠ 沙箱）**：插件与宿主**同进程**，却 **spawn 外部 python3** ⇒ 该子进程**不受宿主沙箱约束**。但它拿到的只有 stdin 的 JSON 与 `python3 -c` 的**固定脚本**——`path` / `pages` / `scale` 都是**数据**（经 JSON 传入），**不拼进脚本**，因此没有用户可控的代码注入面。
- **凭据与隐私**：不触凭据。输出 PNG 落在 `_tmp_review/`，**内容即 PDF 内容** ⇒ 敏感 PDF 的渲染件同样敏感，勿外发。
- **依赖诚实声明**：**依赖本机 `python3` + `pypdfium2`**；缺则报「pypdfium2 未安装或无渲染后端」。不用纯 JS 的理由：node 侧要 `pdfjs-dist` + `node-canvas`（原生模块，构建脆）。

## 6 · 与既有机制的关系

- 与 **`read_image` / `vision_ask`**：分工是「先生成路径，再读图」——本插件**只到路径**。
- 与宿主：宿主**无** PDF 渲染能力（本机 `pdftoppm`/`pdftocairo`/`mutool`/`gs` 实测全无）。
- 与其它插件：无耦合。

## 7 · 可证伪验收清单

| # | 可证伪命题 | 证据 | 状态 |
|---|---|---|---|
| A1 | 编译零错误 | `node node_modules/typescript/bin/tsc -p tsconfig.json` → exit 0 | 已实测 |
| A2 | 单测 31/31（15 自写用例，含 8 具尸体样本） | `node --test tests/*.test.mjs` | 已实测 |
| A3 | 正常路径真渲染出 PNG | 离线冒烟：45 页文档第 42 页 → 612×792 / 114900 B | 已实测 |
| A4 | 尸体·文件不存在 ⇒ 可读错误 | 「PDF 不存在：/tmp/nope.pdf」 | 已实测 |
| A5 | 尸体·页越界 ⇒ 可读错误（不夹取） | 「页号越界：999（文档共 45 页）」 | 已实测 |
| A6 | 尸体·非 PDF ⇒ 可读错误 | 「渲染失败（PdfiumError）：Failed to load document」 | 已实测 |
| A7 | 输出 lossless 往返 | 冒烟 R1–R4 **全 true** | 已实测 |
| A8 | 挂载进 profile，线上真调用成功 | 待 web 重启后实调 `pdf_render` + `read_image` 目验 | **待线上验收** |

## 8 · 与实现的关系

- 主实现：`src/index.ts`（工具层）· `src/range.ts`（纯层：`parsePageRange` + `dropUndefined`）
- 测试：`tests/range.test.mjs`（自写，含尸体样本）· `tests/smoke.test.mjs`（生成器骨架守卫）
- 同语义副本：无

## 9 · 实践修订记录

- **2026-10-08 首次生成**：`plugin_forge` 生成骨架。
- **2026-10-08 手写实现 + 修两处真缺陷**：
  1. `dropUndefined` **漏了数组**——`JSON.stringify([1, undefined, 3])` ⇒ `[1,null,3]`（null 化）⇒ 不是无损往返 ⇒ 宿主校验会挂。修：数组元素也过滤。
  2. `plugin_forge` 模板的 `declaredInject` **假定双引号**，而本仓代码风格是单引号（技能 `alice-code-style`）⇒ `JSON.parse("['tools']")` 直接抛 `Unexpected token "'"`。修：解析前归一引号——判据该落在「声明了哪些 service」，不是「用什么引号」。
  ⇒ **两条都由单测抓出**，不是靠 reviewer 读代码。

## 10 · 未决问题

- **U1 依赖外部 `python3`**：是否值得为「环境自足」重写为 node-canvas？⇒ 当前判断**不值得**（构建脆化换来的只是自足），但需在 README 显式标注。
- **U2 大页数批量**：`pages: 'all'` 在 500 页文档上产出 500 个 PNG ⇒ 是否需要页数上限 / 进度回调？⇒ **未验**。
- **U3 输出清理**：`_tmp_review/pdf-render/` 无自动清理策略，长期会累积。
