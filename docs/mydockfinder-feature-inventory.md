# MyDockFinder 功能参考清单

这份清单根据 `MyDockFinder10.10.9.3.zip` 中的目录、`config.ini`、`ico.ini` 和已编译文件推断。压缩包没有提供源码或明确的开源许可证，因此这里只记录功能思路，不复制其中的代码、主题或图标资源。

## 可以确认或高度可能存在的功能

| 功能 | 依据 | 对 Lume Dock 的建议 |
| --- | --- | --- |
| 程序坞图标放大、光影和高光 | `dockicoeffect`、`bglight`、`icolight`、`maxsize`、`defaultsize` | 已有，继续优化参数和设置项 |
| 磨砂、模糊、透明度 | `blur_dock`、`opacity_dock`、`systemaero` | 已实现自有 CSS 玻璃底座；设置面板可调透明度和模糊，并可继续调圆角、高光和阴影 |
| 自动隐藏和贴边唤出 | `hidetaskbar`、`edgedistance` | 已有，可继续验证任务栏和多显示器行为 |
| 启动台 / 全部应用 | `launchpad/`、`appname=launchpad` | 已有，当前版本重点功能 |
| Finder 风格顶部栏或菜单 | `dockfinder`、`finder/`、`findermenu` | 可作为下一阶段功能 |
| 系统托盘入口 | `systemtray`、`trayico/`、`trayico.exe` | 已实现 Windows 托盘菜单，支持打开 Dock、设置、自动隐藏和退出 |
| 电量、音量、Wi-Fi、蓝牙、显示器、时间、输入法 | `finder` 配置中的 `battery`、`audio`、`wifi`、`bluetooth`、`display`、`systemtime`、`systemIME` | 已实现时间、电池状态和声音设置入口；Wi-Fi、蓝牙等可继续扩展 |
| 日历和天气 | `cal/`、`weather_*.json`、`sunrise`、`sunset` | 可作为可选小组件，不放进第一版核心流程 |
| 主题和图标包 | `themes/`、`Tahoe 26 Light/Dark`、`dockicons` | 已支持浅色、深色和跟随系统外观；后续可增加自定义强调色与图标包 |
| 窗口缩略图 / Aero Peek | `DWMThumbnail`、`aeropeek`、`effect=genie` | 属于 Windows 原生集成，排在托盘和主题之后 |
| 最小化和窗口打开/关闭动画 | `[minimize]`、`[WindowsOpen]`、`[WindowsClose]` | 可研究实现，但需要 Windows 原生 API，Electron 网页动画不能完全替代 |
| 应用运行状态和提示 | `runicon`、`runicontag`、`MsgTips` | 可增加运行中标记；消息提示需要单独设计权限和稳定性 |
| 自定义入口、垃圾桶、分隔符 | `ico.ini` 中的 `trash`、`delimiter`、多个入口配置 | 已有手动添加；已增加可开关回收站入口，支持打开和确认后清空 |

## 对当前 Lume Dock 最有价值的功能

建议按这个顺序继续开发：

1. **系统托盘菜单**：方便暂停、设置和退出程序坞。
2. **时间、电量、音量信息区**：让程序坞更接近完整的桌面工具。
3. **主题切换**：浅色、深色和自定义强调色。
4. **回收站与分隔线入口**：属于程序坞常用基础能力。
5. **Finder 风格菜单**：显示当前用户目录、下载、桌面和系统操作。
6. **运行中应用标记**：在图标下方显示小圆点或高亮。
7. **窗口缩略图**：最后再做，因为需要 Windows 11 实机和原生窗口句柄验证。

## 和当前项目的关系

当前 Lume Dock 已经实现：

- Dock 磨砂外观（圆角、透明度、模糊、高光和阴影均可调）、图标放大和邻近让位动效。
- 全部应用按钮、应用扫描、搜索、固定和手动添加。
- 桌面快捷方式自动扫描。
- Windows 右键“加入 Lume Dock”并移入回收站的可选功能。
- 自动隐藏、登录启动和设置面板。
- Windows 系统托盘入口，可打开 Dock、设置、切换自动隐藏和退出程序。
- 系统信息区，可开关显示时间、电池状态和声音设置入口。
- 可开关回收站入口，单击打开回收站，右键确认后清空回收站。

因此不需要推倒重做。后续应继续使用现有 Electron 架构，按功能逐个增加 Windows IPC 或原生模块，并在 Windows 11 实机上验证。

## 版权和实现边界

该 ZIP 是一个已编译的 Windows 软件包，大小约 243 MB，共 601 个文件，包含多个 EXE、DLL、主题和图标资源。包内没有发现源码、README 或明确的开源许可证。可以观察它的功能和交互作为产品参考；如果没有作者明确授权，不应直接反编译、复制代码、打包其中的 DLL、主题或图标，也不应把它声明为 Lume Dock 的代码来源。
