# WorldClock

Budapest + Beijing 双时区桌面时钟，基于 Tauri v2 构建。目标是做成一个可独立发送到 Windows 内网机器使用的小型桌面挂件。

## 当前功能

- Budapest / Beijing 双地时间显示，支持夏令时自动换算
- 数字、模拟时钟、双显三种展示模式
- 深色 / 浅色主题
- 城市名和时区可配置
- 窗口置顶、拖动位置、调整大小
- Windows 托盘菜单，作为次要功能启用
- 配置持久化到系统应用配置目录
- 窗口锁定后禁用拖动，避免误移动
- 界面缩放

## 在 Mac 上预览

不需要 Windows 也可以先看界面效果：

```bash
open src/index.html
```

这个方式只能预览前端界面和时钟逻辑，不能验证托盘、置顶、开机自启、窗口隐藏等 Tauri 桌面能力。

如果要在 Mac 上预览真实桌面窗口，需要安装 Rust 工具链后运行：

```bash
npm install
npm run dev
```

## GitHub Actions 打包 Windows

仓库内置了 `.github/workflows/windows-build.yml`，可以在 GitHub 的 Windows runner 上生成 Windows 产物。目标 Windows 机器不需要安装 Node、Rust 或 Tauri 开发环境。

使用方式：

1. 把项目推到 GitHub 仓库。
2. 打开 GitHub 仓库的 `Actions` 页面。
3. 选择 `Build Windows App`。
4. 点击 `Run workflow`。
5. 构建完成后，在 workflow run 页面下载 `worldclock-windows` artifact。

常见产物位置：

- `dist/worldclock-portable.zip`
- `dist/worldclock.exe`

建议优先分发 `worldclock-portable.zip`。目标机解压后直接运行 `worldclock.exe`，不需要安装流程。

## 本地 Windows 打包

如果后续有 Windows 开发机，也可以直接运行：

```bash
npm install
npm run build
```

如果目标内网机没有安装 Microsoft Edge WebView2 Runtime，Tauri 应用可能无法启动。多数较新的 Windows 10/11 已内置；如果内网环境较老，交付前需要单独确认。

如果 Windows 上双击安装后的程序仍然没有窗口，可以先检查启动日志：

- `%TEMP%\\worldclock-startup.log`

这个日志会记录主窗口创建、托盘初始化和 Rust panic，适合排查“点了运行但没有界面”的问题。

## 图标准备

打包前需在 `src-tauri/icons/` 放置以下文件：

- `32x32.png`
- `128x128.png`
- `128x128@2x.png`
- `icon.ico`，Windows 任务栏图标
- `icon.icns`，macOS 图标
- `tray.png`，系统托盘图标

可用下面命令从单张 1024x1024 PNG 自动生成全套图标：

```bash
npm run tauri icon path/to/source.png
```

## 交付建议

当前交付目标按 Windows 优先处理。先通过 GitHub Actions 生成 Windows artifact，再在目标内网机器上验证启动、拖动位置、调整大小、置顶、锁定和配置保存。托盘功能作为第二优先级验证。
