<!--
  DSH 插件生态公约声明（plugin-ecosystem-convention · 组合优先/声明清晰/兼容优先）
  purpose: PDF → 图片渲染：把 PDF 的指定页渲染成 PNG 供模型亲眼看版式/表格/图表（本机无 poppler/gs，走已装的 pypdfium2）
  inject: 'tools'
  tools: pdf_render
  runtime: host-only
  envDeps: pypdfium2（**本机无 poppler / ghostscript**，故不走 pdftoppm）
  boundary: 只返回**文件路径**不返回像素（看图走 read_image / vision_ask）；不解析 PDF 文本（那是另一件事）
  compat: cordis ^4.0.1 / schemastery ^3.18.1-rc.1 / dsh-tools >=0.1.0-rc.6
-->
# dsh-pdf-render

<p align="center">
  <a href="https://github.com/jonah791/dsh-pdf-render"><img src="https://img.shields.io/badge/version-0.1.0-blue" alt="version"></a>
  <img src="https://img.shields.io/badge/License-MIT-green" alt="license">
  <img src="https://img.shields.io/badge/TypeScript-3178C6" alt="TypeScript">
  <img src="https://img.shields.io/badge/tests-31%20passed-brightgreen" alt="tests">
</p>

**一句话**：把 PDF 的指定页渲染成 PNG——**让模型亲眼看见**版式、表格与图表，而不是只读文本层。

**为什么值得用**：PDF 的文本层常常丢版式（多栏被读成一行、表格错位、图表完全丢失）。把页面渲染成图再走多模态读图，是「**亲眼看**」而不是「听转述」。本机没有 poppler / ghostscript，所以走已装的 `pypdfium2`——**依赖少一个是一个**。

## 工具
- `pdf_render`：把 PDF 的指定页渲染为 PNG 并返回文件路径（不返回像素：看图请用 read_image / vision_ask）。pages 支持 1 / 1-3 / 2,5 / all。

## 生态契约

> 依据《DSH 插件生态倡议书》三条原则：**组合优先 / 声明清晰 / 兼容优先**。

- **依赖 service**（`inject`）：`tools` —— 组合行装载时等待这些 service
- **贡献面**：工具 `pdf_render`；slot 无；service 无
- 组合行 id：`agent-pdf-render`
- **Fabric manifest**：`dsh-plugin.json`（RFC 0001 v0.1 **Draft** 形状）——`id` = `com.jonah791.pdf-render`，required = （无），optional = （无）
- **Fabric 入口**：`src/fabric.ts` → `lib/fabric.js`（骨架，**不依赖 DSH/Cordis**；Fabric SDK 发布后填充实现）

> ⚠ **不是认证**：Fabric 目前只有文档草案（无正式 schema、无 SDK、无 conformance 套件），因此**不得**声称本插件
> 「通过 Fabric 认证」或「已符合 Fabric 标准」。对齐的是 RFC 0001 的 manifest 形状 + 可机械校验的明文规则；
> `dsh-plugin.json` 的 `$schema` 是**自证 draft 的占位**，Phase 0 发布 canonical identifier 后替换。

组合片段（`cordis.patch.yml`）：

```yaml
- insert:
    - id: agent-pdf-render
      name: dsh-pdf-render
      config: {}
```

## 能力边界（诚实声明）

本插件与宿主**同进程、全权限**运行。「能力声明」用于兼容判断、用户确认与审计，**不构成安全沙箱**——不要把它当权限边界。
本插件不导入其他插件或宿主的内部路径（组合优先），也不覆盖别人的内部实现。

### 两个面，别混淆

- **Fabric 契约面**：`dsh-plugin.json` + `src/fabric.ts`（host entrypoint）。这是**前瞻声明**——Fabric 目前只有 RFC Draft，
  没有正式 schema / SDK / conformance 套件，官方 `docs/plugin-development.md` 明示其**尚不能作为依赖或发布目标**；
  `$schema` 是自证 draft 的 `.invalid` 占位（RFC §14-1 未定 canonical identifier），**不是** schema 校验通过，也**不是**认证。
- **DSH/Cordis 面（非标准扩展路径）**：`src/index.ts` + `cordis.patch.yml`——本插件**现在真正可运行**的形态。
  `tools` 不在 Fabric v0.1 的 capability 表内（v0.1 只有 host.info / log / 生命周期取消 + `storage.local` / `commands` / `messages.observe`），
  故这属标准之外的扩展路径：**不得**当作可移植 API，也**不得**成为 Fabric entrypoint 的依赖。

## 构建与挂载

```sh
pnpm build
# 挂载到 web profile（dsh plugin-manager 或 plugin_mount）
```

## 快速开始

**1) 装依赖**：

```jsonc
"dsh-pdf-render": "link:E:/alice/self-plugins/dsh-pdf-render"
```

**2) 挂组合**：

```yaml
- id: agent-pdf-render
  name: dsh-pdf-render
  config: {}
```

**3) 30 秒验证**：`pdf_render {path: "<某个 PDF>", pages: "1"}` → 应返回 **PNG 文件路径**（不是像素、不是 base64）；再用 `read_image` 打开它 → 应看见该页版式。

## 配置

| 项 | 默认 | 说明 |
|---|---|---|
| `outDir` | `$DSH_HOME/_tmp_review/pdf-render` | 渲染输出目录 |
| `scale` | `1.5` | 渲染倍率（2.0 更清晰但文件更大） |

## 落盘与自证

| 文件 | 何时写 | 内容 |
|---|---|---|
| `<outDir>/<pdf名>-p<N>.png` | 每次 `pdf_render` | 该页的 PNG（返回的是**路径**） |

**一条命令答五问**：`ls -la <outDir>` → ① 渲染产物在不在 ② 谁的（文件名含源 PDF 名）③ 哪一页（`-p<N>`）④ 质量（文件大小与倍率）⑤ 时间（mtime）。

## 生效判据与回退

**判据**：行为级——`pdf_render` 返回路径且该文件存在、能被 `read_image` 打开。
**回退**：① `git revert` + 重建 + 预检重启；② patch 行 `disabled: true`；③ 已渲染的 PNG 留在 `outDir`，可手工清理。

## 测试

```bash
cd self-plugins/dsh-pdf-render && npm test
```

**31 条用例**（跑一次得到）：覆盖 pages 解析（`1` / `1-3` / `2,5` / `all` 与非法输入）· 路径与输出命名 · **文件不存在 ⇒ 响亮失败**（不是空图）。无需网络。

## 设计要点

- **只返回路径**：不返回像素、不返回 base64——看图是 `read_image` / `vision_ask` 的职责（**职责单一**，且避免把二进制塞进上下文）。
- **pages 解析是纯函数**：`src/range.ts` 无 IO，可离线单测（31 条里大半在这一层）。
- **走 pypdfium2 而非 pdftoppm**：本机没有 poppler / ghostscript——**依赖少一个是一个**。

## License

MIT © jonah791

---

本插件属于**爱丽丝 DSH 自研插件生态**（[alice-digital-life](https://github.com/jonah791/alice-digital-life) · 73 个插件 · 8 个模块）：单一职责、独立仓库、独立可用。
