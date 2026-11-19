# New Workspace 视觉与流程验收

以下对照图左侧是 #569 固定的原型，右侧是 Chromium 打开的 New Workspace。两边都使用 seed oil 示例、相同的开场稿和调查问题。实现侧使用可重复的素材与模型响应。

| 状态 | 对照图 |
| --- | --- |
| 默认三栏，第一份素材展开摘要 | [查看默认工作台](workbench.webp) |
| 从带时间戳的观点进入左侧调查 | [查看左侧深究](investigation.webp) |
| 研究台最大化，保留当前调查 | [查看研究台最大化](research-max.webp) |
| 交接单条发现后最大化创作搭档 | [查看创作搭档最大化](writer-max.webp) |
| 两侧同时收起，脚本保留在中间 | [查看专注写作](writing.webp) |
| 窄屏展开观点，依次访问三个面板 | [查看窄屏整页](narrow.webp) |

桌面截图使用 1440 × 900 视口和 100% 缩放。浏览器实测三栏宽度为 358 / 591 / 376 CSS 像素，栏间距为 14 像素。移动截图使用 390 × 844 视口截取整页，文档宽度为 390 像素。实现使用应用的全局导航，标题旁提供原项目资料入口，编辑区底部提供保存状态和草稿选择。折叠后可以用键盘重新打开两侧面板。

## 验证范围

- 本地 Playwright 通过应用的登录态页面、项目路由和受控 Supabase 数据运行。用例检查了项目归属、手写保存与重开、时间戳、调查与追问、来源交接、续写、选区改写、撤销、失效建议、失败恢复、PDF 页码和六种布局。研究和共创的模型输出使用固定响应。
- PostgreSQL 回归执行实际迁移，检查项目归属、并发版本、PDF 原件与素材的原子写入及项目删除后的清理。
- 独立联网检查通过应用的读取逻辑取得了 Minnesota Coronary Experiment 的 Europe PMC 摘要和 WHO Healthy diet 网页正文。
- 当前分支尚未部署，已有 seed oil 项目的线上登录态验收待运行。线上用例在指定测试项目内新建草稿、调查一个观点、打开出版物、交给创作搭档、续写并刷新验证。

在仓库根目录复现本地浏览器流程：

```sh
BASE_URL=http://localhost:3000 pnpm exec playwright test smoke-tests/e2e-workspace.spec.ts -g 'New Workspace|Video Space research'
```

部署迁移和应用后，设置 `PROD_URL`、`TEST_LIVE_SUMMARY_EMAIL`、`TEST_LIVE_SUMMARY_PASSWORD` 和 `TEST_VIDEO_SPACE_ID`，运行指定测试项目的登录态用例：

```sh
pnpm exec playwright test --config playwright.production.config.ts smoke-tests/e2e-video-space-production.spec.ts
```
