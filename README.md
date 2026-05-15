# WorldClock

Budapest + Beijing 双时区桌面时钟，基于 Tauri v2 构建。

## 构建步骤

```bash
# 1. 安装 Rust（如未安装）
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# 2. 安装 Tauri CLI
npm install

# 3. 开发模式（实时预览）
npm run dev

# 4. 打包 .exe
npm run build
# 产物：src-tauri/target/release/worldclock.exe（约 5–10 MB）
```

## 图标准备

打包前需在 `src-tauri/icons/` 放置以下文件：
- `32x32.png`、`128x128.png`、`128x128@2x.png`
- `icon.ico`（Windows 任务栏图标）
- `icon.icns`（macOS，可选）
- `tray.png`（16×16 或 32×32，系统托盘图标）

可用 `tauri icon <source.png>` 命令从单张 1024×1024 PNG 自动生成全套图标。
