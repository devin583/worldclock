# WorldClock

WorldClock 是面向 Windows 10/11 的轻量桌面世界时钟，基于 Tauri 2 构建。它可以只显示一个地点，也可以并排比较两个地点；城市名称、IANA 时区、主题、显示模式和窗口行为都可配置。

## 功能

- 单时钟或双时钟布局，支持数字、模拟、数字＋模拟三种模式。
- 按时钟数量、模式和秒数显示自动采用紧凑窗口尺寸；仍可手动调整大小和位置。
- 默认关闭秒数显示，分钟级更新；开启秒数后才使用秒级更新。窗口隐藏或页面进入后台时暂停时钟刷新，减少笔记本常驻功耗。
- 使用 IANA 时区和 `Intl.DateTimeFormat` 处理夏令时，内置 Budapest、Beijing 及常见全球时区，也支持有效的自定义 IANA 时区。
- 24/12 小时制、四种主题、透明/实体表面、不透明度、始终置顶、开机自启、窗口锁定和番茄钟。
- Windows 单实例：重复启动会唤回现有窗口，不会生成多组窗口和托盘图标。
- 自动保存配置和窗口位置；保存前执行字段校验，并通过同目录临时文件与备份替换降低配置损坏风险。
- 完全使用本地资源，不依赖在线字体或运行时网络接口。

## 更适合笔记本的单/双时钟用法

只看一个地点时，在设置中选择“1 个”。应用会把内容居中并收紧窗口；数字模式且不显示秒数占用最小，适合固定在屏幕角落。需要观察秒级变化时再打开“显示秒数”，窗口会为 `HH:MM:SS` 留出空间。

比较两个地点时，选择“2 个”。宽度足够时两个时钟横向排列，窗口较窄时布局会避免内容重叠。双数字＋关闭秒数是日常跨时区工作的高信息密度方案；模拟或双显模式会采用更大的建议尺寸。

这些尺寸以逻辑像素计算，Windows 的 125%/150% 显示缩放不会把窗口错误缩成物理像素尺寸。修改时钟数量、显示模式或秒数开关时会触发内容适配；之后手动缩放和移动的结果仍会保存。

## Windows 安装与操作

发布页提供三种 x64 程序产物：

- `WorldClock_0.4.0_windows-x86_64-setup.exe`：NSIS 安装程序。
- `WorldClock_0.4.0_windows-x86_64-portable.exe`：无需安装的原始可执行文件。
- `WorldClock_0.4.0_windows-x86_64-portable.zip`：解压后直接运行，内含 portable `.exe`。

同时提供 `SHA256SUMS`。可用 PowerShell 对下载文件重新计算摘要：

```powershell
Get-FileHash .\WorldClock_0.4.0_windows-x86_64-setup.exe -Algorithm SHA256
```

把结果与 `SHA256SUMS` 中对应文件比较。当前发布产物没有 Windows 代码签名，因此 SmartScreen 可能显示“未知发布者”或“Windows 已保护你的电脑”；摘要匹配只能验证文件与 GitHub Release 中发布的字节一致，不能替代代码签名。

常用操作：

- 在未锁定状态拖动时钟区域移动窗口，通过窗口边缘调整大小。
- 右键时钟打开原生快捷菜单；也可从托盘打开完整设置。
- 左键单击托盘图标显示/隐藏主窗口。
- 在 Windows 上关闭主窗口或按 `Alt+F4` 只会隐藏到托盘。要结束进程，使用托盘菜单中的“退出”。
- 锁定窗口后禁止误拖动；仍可通过右键菜单或托盘解除锁定。

### 运行前提

- Windows 10 或 Windows 11，x86-64。
- Microsoft Edge WebView2 Runtime。多数仍受支持的 Windows 10/11 已安装；离线或经过裁剪的系统应由管理员预装 WebView2 Runtime。

用户无需安装 Node.js、Rust 或 Tauri。配置和启动日志分别位于：

- `%APPDATA%\com.worldclock.desktop\config.json`
- `%TEMP%\worldclock-startup.log`

## 开发与验证

固定的开发工具版本：

- Node.js 24.19.0（见 `.node-version`）
- Rust 1.97.1，含 `rustfmt` 和 `clippy`（见 `rust-toolchain.toml`）
- Tauri CLI 2.11.4、Tauri Rust crate 2.11.5（由两个 lockfile 固定传递依赖）

安装依赖并运行全部前端生产代码测试、语法检查和静态审计：

```bash
npm ci
npm run check
```

检查 Rust：

```bash
cd src-tauri
cargo fmt --all --check
cargo clippy --locked --all-targets --all-features -- -D warnings
cargo test --locked --all-targets --all-features
```

运行桌面开发版：

```bash
npm run dev
```

只预览前端时，可在项目根目录启动静态服务器：

```bash
python3 -m http.server 4174 --directory src
```

然后打开 `http://127.0.0.1:4174/`。静态预览不会提供托盘、开机启动、窗口置顶、单实例和原生窗口尺寸等 Tauri 能力。

### Windows 本机构建前提

除上述 Node/Rust 版本外，还需要：

- Microsoft C++ Build Tools（Visual Studio 2022 的“使用 C++ 的桌面开发”工作负载）。
- WebView2 开发/运行环境。

构建 NSIS 安装程序：

```powershell
npm ci
npm run check
npm run tauri -- build --bundles nsis --ci -- --locked
```

原始可执行文件和 NSIS 安装器会分别出现在 `src-tauri\target\release\` 与 `src-tauri\target\release\bundle\nsis\`。

## CI 与发布

`.github/workflows/windows-build.yml` 在 pull request、`main` 推送和 `v*` tag 上执行相同的前端/Rust 质量门禁与 RustSec 依赖审计，然后在 Windows runner 上构建并逐一验证 portable executable、portable zip、NSIS installer 和 SHA-256 清单。普通构建上传临时 Actions artifact；只有与 `package.json` 版本完全匹配、Windows 构建和 RustSec 审计均通过的 tag，才会进入具有 `contents: write` 权限的独立发布 job。

维护者发布步骤：

1. 合并通过 Windows CI 的版本提交。
2. 创建与版本一致的 tag，例如 `v0.4.0`。
3. 推送 tag；workflow 验证产物和摘要后创建 GitHub Release。

依赖更新由 Dependabot 按月检查 npm、Cargo 和 GitHub Actions 三个生态。

## 许可

仓库当前未声明开源许可证；在许可证补充之前，不应假定获得复制、修改或再分发授权。
