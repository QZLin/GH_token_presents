# GitHub Fine-grained Token Profiles

在 GitHub 细粒度 Personal Access Token 创建页保存和应用 **Repository access 模式、权限与过期时间** 的用户脚本。配置保存在当前浏览器的 GitHub `localStorage` 中，**不读取或保存 Token，不保存具体仓库列表，也不自动提交创建表单**。

## 作者、版权与项目链接

作者、版权声明、许可证、主页、仓库和问题反馈地址集中在 [package.json](package.json) 的 `author`、`copyright`、`license`、`homepage`、`repository`、`bugs` 字段。作者没有填写未提供的邮箱。

[统一元数据模块](scripts/project-metadata.mjs) 从包配置生成 `@author`、`@copyright`、`@license`、`@homepageURL`、`@source`、`@supportURL`，生产构建与隔离开发脚本共用。完整许可正文读取自 [LICENSE](LICENSE)，构建会核对其版权声明与包配置一致，并将全文作为注释加入产物。

修改这些字段后重新构建；开发模式下重启并重新安装开发脚本以刷新元信息。沿用原 `https://github.com/` namespace，避免升级时产生不同身份的重复脚本。

## 工程方案

项目基于 **pnpm 11 + create-monkey（vanilla-ts）+ Vite 8 + TypeScript 6**，不引入 React/Vue 等额外运行时。生产构建将代码和样式打包为单个可安装的 `.user.js` 文件。

- [package.json](package.json) 固定 pnpm 版本并提供开发、检查、测试和构建命令。
- [pnpm-lock.yaml](pnpm-lock.yaml) 锁定依赖，CI 使用 `--frozen-lockfile` 保证可复现安装。
- [pnpm-workspace.yaml](pnpm-workspace.yaml) 集中配置 pnpm 11 的 `engineStrict`、`saveExact` 和 `strictPeerDependencies`；当前是单包项目。
- [vite.config.ts](vite.config.ts) 用 `vite-plugin-monkey` 构建生产用户脚本，版本号取自包配置。
- 沿用 `gh-fg-token-presets-v1` 存储键，兼容旧版权限 map 和 `{ permissions, expiration }` 配置。

原始模板来自：

```sh
pnpm dlx create-monkey@1.44.0 scaffold --template vanilla-ts
```

TypeScript 6 是有意选择的兼容版本：当前 typescript-eslint 尚不支持 TypeScript 7。

开发工具链的 minimatch 7–10/11.0.0 受 [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) 影响；[pnpm-workspace.yaml](pnpm-workspace.yaml) 将受影响版本定向覆盖为已修复的 11.0.5，保留旧版 3.x API。修改覆盖项后应重跑 lint、测试和构建。

安全审计使用官方 registry 的 API，避免部分镜像缺少审计端点：

```sh
pnpm audit --registry=https://registry.npmjs.org/ --audit-level=moderate
```

## 环境与快速开始

推荐 **Node.js 24 LTS**，版本见 [.node-version](.node-version)；包管理器为 **pnpm 11.28.5**。完整环境范围见 [package.json](package.json) 的 `engines`。安装 pnpm 可参考 [官方说明](https://pnpm.io/installation)。

```sh
pnpm install
pnpm check
pnpm test:coverage
pnpm build
```

生产产物：[github-token-profiles.user.js](dist/github-token-profiles.user.js)。`pnpm build` 自动执行 [生产冒烟验证](scripts/verify-build.mjs)，检查元数据、独立运行、旧数据兼容、仓库模式、offset、更新、可选清理、隐私、表单安全及重复加载清理。生产脚本保持 `@grant none`，无需外部 `@require`、`@resource` 或运行时服务器。

### 安装与使用

1. 安装 Tampermonkey 或 Violentmonkey。
2. 将 [构建脚本](dist/github-token-profiles.user.js) 导入管理器，替换旧生产版本，不要同时启用多个版本。
3. 打开 [GitHub Token 创建页](https://github.com/settings/personal-access-tokens/new)，等待右侧 Token Profiles 面板出现。
4. 调整 Repository access 模式、权限及过期时间，点击“保存当前”。保存到同名 profile 时需要确认覆盖。
5. 选择已有 profile，点击“更新所选 Profile”可用当前页面设置覆盖它，**不改变名字**。更新前需要确认；没有读到的仓库模式或过期时间保留原记录，权限以当前读取到的配置为准。
6. 决定是否开启“移除未记录权限”，再点击“应用 Profile”。开关默认关闭；开启后清理当前未记录的可识别权限，`Metadata` 始终保留。开关不写入 profile，面板重新加载后默认关闭。
7. 查看权限应用和清理结果，核对表单，再自行生成 Token。脚本不会自动提交。
8. 可删除 profile；点击“导出/复制”打开已选中的只读 JSON，再点“复制 JSON”或按 Ctrl+C / Cmd+C 保存。点击“粘贴导入”，手动粘贴完整 JSON，再点“校验并导入”。不会下载文件，也不会自动读取剪贴板。

### 复制粘贴导入导出

导出包含所有 profile，格式仍为 `{ "Profile 名称": profile }`。剪贴板 API 不可用或被浏览器拒绝时保留已选中的文本，使用 Ctrl+C / Cmd+C 手工复制即可。

导入先校验完整 JSON、profile、权限、仓库模式和过期时间，再一次性合并。旧版权限 map 和 `standard/value` 过期格式会迁移；只保留支持的字段，不保存具体仓库列表。数据无效时不写入任何配置。

同名 profile 会明确提示数量和名称：确认后覆盖同名记录，取消则本次不导入任何内容；没有冲突时直接合并，其他已有 profile 保持不变。导入不会自动应用权限，仍需选中 profile 后主动点击应用。关闭文本区会丢弃未导入的粘贴文本。

需要通过浏览器 URL 安装生产产物时：

```sh
pnpm preview
```

访问终端显示的预览地址下的 `/github-token-profiles.user.js`，默认 `http://127.0.0.1:4173/github-token-profiles.user.js`。

### 缺失权限的自动添加

GitHub 初始页面可能只显示 Metadata，其余权限要通过 Add permissions 才会出现 Access 按钮。应用 profile 会先确认仓库范围，等待权限组件发生变化并稳定，再按需切到 Repositories，打开本次操作自己的权限弹窗，仅从**新范围当前提供的目录**选择记录中的缺失项，确认并等待权限行渲染后设置级别。已有权限不会重复添加，No access 撤销指令不会为了撤销而新增权限。

支持原生 checkbox、ARIA 选项、Search/Filter 虚拟列表以及原生 dialog。用户已打开的权限弹窗不会被自动确认，请先关闭再应用。策略禁用、不可用权限或超时会报告失败，不会绕过限制，也不会直接改隐藏表单值或点击 Token 生成按钮。

回归测试使用从保存页面提取的 [脱敏权限区夹具](tests/fixtures/github-permissions-initial.html)，仅保留公开权限定义与控件。原始页面和资源保留本地、排除格式化/lint 与默认 Git 提交，避免账户或会话数据进入仓库。

## Profile 数据格式

```json
{
  "Development": {
    "repositoryAccess": "selected",
    "permissions": { "Contents": "Read-only", "Issues": "Read and write" },
    "expiration": { "mode": "offset", "days": 30 }
  }
}
```

- `repositoryAccess` 只保存 `public`、`all`、`selected`，分别代表公开仓库、全部仓库和仅所选仓库；`null` 表示没有记录，应用时不改变当前模式。**不保存、回填或操作具体仓库 ID/名称列表**；选择 `selected` 后需要在 GitHub 自行选择仓库。GitHub 自身切换模式时可能重置已有选择。
- 相对过期只保存 `{ "mode": "offset", "days": 30 }` 这样的整数天数，不保存原始选项文字或当时算出的绝对日期。应用时按本地当天重新计算。
- 明确选择的固定日期保存为 `{ "mode": "custom", "date": "2099-01-01" }`，必须有效且晚于本地当天。
- 永不过期单独保存为 `{ "mode": "none" }`；`expiration: null` 则表示未记录，应用时不改变过期时间。
- 如果当前页面没有匹配的相对选项，会尝试用 Custom 控件设置“当天 + offset”，但 profile 仍保留 offset。之后用户编辑过期控件，则按其明确的日期/选择重新记录。
- 读取旧数据不会改写原存储。旧的 `standard/value` 标签会在内存中迁移成 offset；保存、更新和导出使用规范格式。

## CSP 兼容开发与自动更新

```sh
pnpm dev
```

**从旧开发版升级时必须重启并重新安装开发脚本：**

1. 在运行旧 `vite` 开发进程的终端按 `Ctrl+C`，再执行 `pnpm dev`。
2. 打开终端显示的安装地址，默认 `http://127.0.0.1:5173/github-token-profiles.dev.user.js`，重新安装名称带 `server:` 前缀的开发脚本。
3. 确认其开发权限包含 `GM_xmlhttpRequest`、`@connect 127.0.0.1`，并使用 DOM/content 隔离环境。禁用旧开发脚本和生产脚本，避免重复运行。
4. 刷新 GitHub Token 创建页，保持开发进程运行。

原来的 `__vite-plugin-monkey.entry.js` 页面 ES module 注入会被 GitHub `script-src` CSP 拦截。新方式由 Vite **watch build** 生成经典 IIFE，开发加载器通过用户脚本管理器的 `GM_xmlhttpRequest` 获取本机产物，并在**隔离用户脚本环境**中执行，不创建 localhost 页面模块、也不依赖页面的 WebSocket/fetch 权限。**不需要关闭或放宽 GitHub CSP。**

开发加载器约每秒检查构建 hash，仅当代码改变时替换旧实例。它更新面板，不刷新 GitHub 页面；替换时会取消未完成的应用任务。开发构建放在依赖缓存目录，不覆盖生产产物。服务器只监听本机地址，不自动打开浏览器，端口被占用时直接报错。

可用独立端口测试，避免停止已有进程：

```sh
pnpm dev -- --port 5174
pnpm verify:dev -- http://127.0.0.1:5174
```

[开发冒烟验证](scripts/verify-dev.mjs) 检查安装端点、经典脚本语法、隔离加载、实例替换和未改变 hash 时的 204 响应。无参数的 `pnpm verify:dev` 检查默认 5173 端口，需要先运行开发服务。

Firefox 对 `layout-shift` 或 `longtask` 的 performance observer 支持提示来自页面性能库，和开发脚本加载失败不是同一问题，可以忽略。

开发版具有本机请求权限，仅用于可信的本地源码。停止开发后禁用它，改装生产构建，不要在日常使用时同时启用开发版与生产版。

## 常用命令

| 命令                          | 用途                                        |
| ----------------------------- | ------------------------------------------- |
| `pnpm dev`                    | CSP 兼容的本地 watch-build 与隔离开发加载器 |
| `pnpm verify:dev`             | 检查运行中的开发服务与加载器                |
| `pnpm typecheck`              | 严格检查源码、测试和配置类型                |
| `pnpm lint`                   | ESLint Flat Config 代码检查                 |
| `pnpm format`                 | Prettier 格式化                             |
| `pnpm format:check`           | 仅检查格式                                  |
| `pnpm test` / `pnpm test:run` | 交互式测试 / 全部回归测试                   |
| `pnpm test:coverage`          | 测试与覆盖率门槛                            |
| `pnpm check`                  | 类型、lint、格式及测试完整检查              |
| `pnpm build`                  | 类型检查、生产构建与产物冒烟验证            |
| `pnpm preview`                | 本地提供生产产物安装 URL                    |

回归测试覆盖仓库模式隐私、offset、固定日期、旧数据迁移、受控输入事件、React 按钮替换、真实移除/No access、范围失败保护、更新、并发、导出、跨标签页同步、应用生命周期和隔离开发加载器。jsdom 测试不会访问 GitHub 或创建 Token。

源码覆盖率排除薄入口和类型声明，语句/函数/行门槛为 95%，分支门槛为 90%，见 [vitest.config.ts](vitest.config.ts)。HTML 报告：[覆盖率报告](coverage/index.html)。

## 源码结构

```text
src/
  main.ts                启动及重复加载清理
  app.ts                 表单就绪、Turbo 导航和生命周期
  ui.ts                  保存、更新、应用、清理开关、删除和导出
  styles.css             GitHub 主题、switch、响应式与可访问样式
  storage.ts             旧格式迁移及规范 profile 存储
  repository-access.ts   仓库访问模式识别/应用，不操作具体列表
  permissions.ts         权限识别、状态验证与安全移除
  permission-picker.ts   Add permissions 选择、确认与渲染等待
  permission-names.ts    权限名称列表
  expiration-values.ts   offset 归一化及本地日历计算
  expiration.ts          过期控件、固定日期及相对日期应用
  apply.ts               仓库范围、过期、清理、权限应用编排
  dom.ts                 原生赋值、菜单查询与可取消等待
  types.ts               profile、offset 和操作结果类型
scripts/
  dev.mjs                本机 HTTP 安装端点及 Vite watch build
  dev-userscript.mjs     隔离环境 GM 开发加载器
  verify-dev.mjs         真实开发端点冒烟验证
  verify-build.mjs       真实生产产物冒烟验证
tests/                    单元、DOM 及开发加载器回归测试
legacy/main.user.js        未修改的原始脚本备份，仅作参考
```

修改 [TypeScript 入口](src/main.ts) 及模块，不要直接修改 [生成脚本](dist/github-token-profiles.user.js)。原始单文件保留为 [备份](legacy/main.user.js)，不参与当前构建或 lint。

[GitHub CI](.github/workflows/ci.yml) 配置冻结锁文件安装、安全审计、完整检查、覆盖率测试、生产构建和用户脚本 artifact 上传；提交到 GitHub 后由 Actions 执行。

## 行为与安全边界

- 不记录 Token 内容/名称、具体仓库或资源所有者；这些需要在 GitHub 自行选择。
- 应用顺序为 **Repository access → 等待权限组件变化并稳定 → 可选清理 → 添加/设置记录权限 → expiration**。仓库范围变化后只使用重新渲染的新权限目录和 Access 按钮；**范围设置失败或权限面超时未稳定时停止后续修改**，避免在更宽、错误或旧的范围中应用权限。
- 对已记录且可识别的缺失权限，先通过 GitHub 的 Add permissions 弹窗选择并确认，等待主列表出现后再设置 Access 级别；不直接修改隐藏表单值。未知权限、禁用选项或添加失败会跳过并报告，绝不自动扩大仓库范围。
- 清理开关默认关闭。开启时点击 GitHub 的移除控件，或使用 No access 撤销，再核对状态，**不会仅从 DOM 中删除一行**。未知权限或缺少移除控件会报告未处理/失败，不会强制猜测删除。
- `Metadata` 不保存也不尝试修改。旧 profile 中显式的 No access 按撤销指令执行。
- 遵守可识别的日期最小值、最大值与禁用/只读控件；无效或过期日期不静默改为永不过期。组织策略可能导致未完全应用。
- GitHub DOM 或英文标签变化可能导致识别失败，应用后必须核对面板结果与实际权限。
- `localStorage` 不是加密存储，清理 GitHub 网站数据会删除 profile，建议按需导出备份。
- 已完成本地 DOM、生产产物和开发端点验证，但仍需在**真实已登录的 GitHub 页面**人工验收，尤其是用户脚本管理器、组织策略及后续页面改版。
