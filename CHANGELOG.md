# Changelog

## 2.3.0

- 导出改为只读 JSON 文本区，支持复制按钮及 Ctrl+C / Cmd+C 手工复制，不再下载 JSON 文件。
- 增加粘贴导入与完整数据校验，不自动读取剪贴板，兼容旧 profile 和过期格式。
- 导入一次性合并；同名记录覆盖需确认，取消或校验失败不写入任何配置。
- 剪贴板 API 拒绝/不可用时回退到选中文本；导入不自动应用权限。
- 增加复制、粘贴、无效数据、冲突、安全名称及并发/生命周期回归测试。

## 2.2.3

- 应用 profile 时先记录权限面快照，再切换 Repository access，并等待权限组件发生变化且稳定后才清理、添加或修改权限。
- 不同仓库范围使用各自重新渲染后的权限目录；不再复用范围切换前的旧 Access 按钮或旧 Add permissions 内容。
- 权限面未稳定或消失时停止后续权限和 expiration 修改，避免在错误仓库范围中应用。
- 应用顺序调整为 Repository access → 权限面稳定 → 权限清理/添加/级别 → expiration。
- 增加 React 整体替换、目录不同、无变化保守等待、超时和取消的时序回归测试。

## 2.2.2

- 修复仅显示 Metadata 的页面应用 profile 时找不到 Actions、Commit statuses、Contents、Issues、Pull requests 和 Variables 的问题。
- 缺失且可识别的权限通过 Add permissions 弹窗选择、确认，等待 React 主列表渲染后设置 Access 级别。
- 兼容 checkbox、ARIA option、原生 dialog、虚拟列表搜索及 React 替换；不重复添加已有项，不确认用户已有弹窗草稿，不修改隐藏值或提交 Token 表单。
- 保留 Metadata、Repository access、offset 和可选清理行为，策略禁用或未知权限仍安全跳过并报告。
- 从保存页面提取不含账户、仓库或表单 Token 的权限区回归夹具；原始示例保持不变并排除格式化、lint 和默认提交。

## 2.2.1

- 在包配置中添加作者、版权、MIT 许可证、项目主页、Git 仓库和问题反馈地址。
- 生产和开发用户脚本共用包配置生成作者、版权、许可、主页、源码与反馈链接。
- 构建和开发脚本包含完整 MIT 许可正文，并校验版权声明一致。
- 保留原 namespace 与功能行为，避免升级重复安装；增加元数据回归与产物检查。

## 2.2.0

- Profile 增加 Repository access 模式，只记录 public/all/selected，不保存具体仓库 ID 或名称列表。
- 相对过期改为 `{ mode: 'offset', days }`，应用时按本地当天重算；固定日期和永不过期单独保留。
- 兼容旧 `standard/value` 数据，保存和导出不再保留原始相对选项文字或已计算的日期。
- 增加“更新所选 Profile”，保持名字并确认覆盖；未能读取的仓库模式或过期字段保留旧记录。
- 增加默认关闭的“移除未记录权限” switch，使用 GitHub 移除控件或 No access 并验证状态，始终保留 Metadata。
- 仓库模式设置失败时停止后续权限、清理和过期修改；无法识别或移除的权限显式报告。
- 修复 GitHub CSP 阻止 localhost ES module 的开发加载问题：改为本地 watch-build + GM 请求 + 隔离用户脚本执行，不关闭 CSP。
- 开发构建通过 hash 自动替换旧实例，不刷新 GitHub 页面；需重启旧开发进程并重新安装开发脚本以更新权限。
- 增加 `pnpm verify:dev` 及仓库模式、offset、更新、清理、开发加载器回归与产物验证。

## 2.1.0

### 工程化

- 采用 create-monkey 的 vanilla-ts 模板迁移为 pnpm 11、Vite 8、vite-plugin-monkey 和 TypeScript 6。
- 固定包管理器和依赖版本，添加 pnpm 锁文件与严格依赖检查。
- 定向覆盖受 GHSA-g3hv-75wg-m249 影响的 minimatch 开发依赖至已修复版本，保留旧版 API。
- 开发文件监听排除覆盖率报告与原始备份，避免运行测试导致无关页面刷新。
- 将单文件逻辑拆分为存储、DOM、权限、过期时间、应用编排、界面和生命周期模块。
- 增加 ESLint Flat Config、Prettier、EditorConfig、Vitest/jsdom 回归测试及覆盖率门槛。
- 构建自动生成单个可安装用户脚本，并执行真实产物冒烟验证。
- 增加冻结锁文件安装、质量检查和 artifact 上传的 GitHub CI 配置。

### 行为改进

- 保留原存储键与 v1/v2 配置兼容，不读取或存储 Token 内容。
- 校验存储数据，安全处理特殊配置名和文本，显示存储/应用失败原因。
- 使用原生表单 setter 和冒泡事件，验证实际写入结果。
- 兼容 React 替换权限按钮，修复自定义过期模式切回标准模式失败的问题。
- 拒绝无效或非未来的自定义日期，不误报受控控件已应用成功。
- 防止配置应用期间的并发操作，离开页面或热更新时取消未完成任务。
- 支持 Turbo 页面切换、跨标签页配置更新、深色主题和键盘可访问性。
- 原始源码保留为 [未修改的备份](legacy/main.user.js)。
