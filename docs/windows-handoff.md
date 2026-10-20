# Windows 11 开发交接：0.12.13

当前源码已经补齐用户提供的 0.12.0 README 中缺失的功能。后续以本项目为开发起点，不需要旧版源码。历史 README 保存在 windows-readme-0.12.0-reference.md，仅供对照；实际行为以根 README 和当前代码为准。

## 搬到 Windows

1. 解压 Lume-Dock-0.12.13-Windows开发包.zip。里面包含完整源码，以及 dist/Lume-Dock-Setup-0.12.13-x64.exe。
2. 退出已经运行的 Lume Dock，再运行新安装包。每次只运行一个实例。旧版源码不参与安装或开发。
3. 如需继续开发，安装 Node.js 20 或更高版本，在解压的 Windows程序坞目录运行 npm ci，再运行 npm start。依赖没有放进压缩包，首次安装需联网。
4. 修改完成后运行 npm test 和对应 Electron 测试，再运行 npm run dist，生成新的 Windows x64 安装包。

用户配置通常位于 %APPDATA%\lume-dock。安装程序会沿用用户数据；不想继承旧偏好时，退出应用后将该文件夹重命名，再启动即可使用默认配置。该文件夹也保存已收纳的快捷方式副本，保留重命名后的文件夹便于找回入口；不需要保留旧版代码。

安装失败的处理与新构建入口见 [0.12.2 安装修复](install-fix-0.12.2.md)。更新前先退出旧安装窗口；仍可选择原 E: 盘路径，不要求改到 C: 盘。

安装与退出修复见 [0.12.7 验证说明](verification-0.12.7.md)。请保留旧版配置，不要为了升级手动清除注册表。退出后卸载信息及开启中的右键菜单仍存在属正常现象。

## 新增实现与修复

- 0.12.13：新增 renderer/app-search.js，提供首字母、驼峰词、紧凑字母与全角名称搜索；完整名称优先，保留别名、分类和筛选。修复图标已缓存但重绘节点仍显示默认图标的时序问题。无新增依赖或轮询。见 [GitHub 参考评估](github-reference-review-0.12.13.md) 和 [验证记录](verification-0.12.13.md)。
- 0.12.12：renderer/launcher.js 按数据变化复用搜索索引，关闭释放临时数据；app.js 简化事件委托、ID查找和偏好保存；custom-icons.js 减少重复序列化；dock-motion.js 复用布局与帧计算数组，隐藏取消动画，显示重测布局。新增 npm run test:performance 和动画回归。对比结果见 [资源优化](verification-0.12.12.md)。

- 0.12.11：auto-hide.js 连续停留区域、12px容差及1秒最短显示时间，修复快速滑到底部时窗口空隙/任务栏造成的显隐反复。main.js 只在可见状态需改变时发送显隐请求，不增加轮询。新增 auto-hide 单测与实际Electron窗口轨迹回放，见 [自动隐藏修复](verification-0.12.11.md)。

- 0.12.10：启动台“应用 / 快捷方式”分开，renderer/app-identity.js 在合并组上派生分类，保留程序身份去重。搜索、固定、最近使用随分类切换，不增加扫描或轮询；tests/categories-ui.cjs 覆盖分类隔离、快捷方式操作和440px双主题。见 [分类说明](verification-0.12.10.md)。

- 0.12.9：全部应用改为中性灰色/银灰色面板，新增 custom-icon-image.js、renderer/custom-icons.js、renderer/icon-editor.js。右键或“⋯”选择PNG/JPG/ICO，支持恢复默认、别名同步、双窗口同步、重启与配置导入导出；不需要保留原图片。容量、格式和验收步骤见 [外观与自定义图标](verification-0.12.9.md)。

- 0.12.8：修复 scripts/list-apps.ps1 的 HBITMAP 透明通道转换，保留真黑像素与半透明边缘，无 alpha 时回退传统图标掩码。旧 PNG 缓存失效后可从 apps-folder 重新读取，缓存保持并发和容量限制。连续渐变底座改为调整边界，避免 scaleX 缩放背景采样。详情与 Windows 原生测试见 [图标与玻璃修复](verification-0.12.8.md)。

- 0.12.7：新增 helper-processes.js，统一跟踪并结束本程序的 PowerShell/reg 辅助进程；退出销毁两个窗口且阻止重启工作，不跟踪用户打开的程序。新增 --quit 控制命令、scripts/stop-installed-app.ps1 和安装宏，按准确安装路径与创建时间清理旧进程；缺失旧卸载器时修复安装，保留配置。详见 [退出与升级修复](verification-0.12.7.md)。

- 0.12.6：实际程序/Windows AppID 去重，带图标入口优先、别名搜索、跨别名固定/取消及最近筛选；只整理显示，不删除原文件。新增 app-identities.js、scripts/app-identities.ps1、renderer/app-identity.js、tests/app-identities.test.cjs、tests/dedup-ui.cjs。身份查询使用有界缓存与串行批量处理，只在打开/刷新列表时触发，详见 [应用去重说明](verification-0.12.6.md)。

- 0.12.5：程序坞布局 IPC 只更新 Dock 边界，尺寸增减不再重设设置窗口。显示器变化时单独校正设置窗口；新增双向尺寸及零设置窗口边界写入断言，详见 [尺寸修复](verification-0.12.5.md)。

- 0.12.4：自动桌面扫描只收录到全部应用、星号双向固定/取消、保留取消后的搜索入口、旧扫描项迁移、玻璃内滚动与左右导航；详见 [扫描与固定修复](verification-0.12.4.md)。

- 0.12.3：设置使用独立可移动/缩放窗口，关闭后销毁。外观与增删快捷方式双向同步，设置打开期间保留 Dock 预览并暂停自动隐藏；详见 [浮动设置说明](verification-0.12.3.md)。

- windows-processes.js、scripts/running-processes.ps1、scripts/resolve-targets.ps1：实际 exe 路径匹配、lnk 解析、缓存、串行批处理和超时；隐藏/启动台展开时停止轮询，启动后安排刷新。
- fullscreen-monitor.js、scripts/session-monitor.ps1：常驻辅助进程、主屏前台检测、排除普通最大化和系统桌面、失败退避、关闭后清理；从 app.asar 读取后使用编码脚本文本启动，兼容安装版。主动唤出只豁免当前全屏会话。
- renderer/app.js、index.html、styles.css、dock-motion.js：运行圆点、分隔线排序/删除、六组预设与自定义强调色、40–72px 图标及40%–100%宽度。设置即时预览、持久化、导入/导出与尺寸重置。
- main.js、preload.js：窗口尺寸、全屏策略和运行查询 IPC；托盘/快捷键显式唤出。
- windows-icons.js、scripts/resolve-icons.ps1：原生快捷方式自定义 IconLocation / IconFile、DLL 资源索引、中文/空格/& 路径；逐项回退与资源清理。
- 主进程显式通知窗口可见性，隐藏后时钟/电池/歌词与运行检测停止；不依赖网页可见事件及时到达。
- 拖放提示默认隐藏，取消/失焦/离开后清理；隐藏设置面板不绘制磨砂层；透明窗口无原生阴影，放大两端留白并按实际布局决定滚动。
- 配置最多 500 个固定入口/分隔线，新增失败回滚，右键收纳在持久化成功后才确认回收桌面原件。

## Windows 实机验收

本机为 macOS，已完成的模拟测试与交叉构建见 verification-0.12.13.md；它们不等于 Windows 安装或原生接口验证。建议按以下顺序在 Windows 11 执行：

1. npm run test:performance、npm run test:stability、npm run test:quit、npm run test:upgrade、npm test、npm run test:custom-icons、npm run test:dedup、npm run test:library、npm run test:settings、npm run test:windows-icons、npm run test:features、npm run test:regressions 和其余 README 测试。windows-icons 会创建临时 fixture，结束后清理。
2. 安装后打开全部应用并刷新，同一程序的桌面/开始菜单入口应合并，别名能搜索；试用 vsc、wt、gchr 和全角输入，确认完整名称优先；检查取消固定/再次固定及最近筛选。不同参数和32/64位版本、说明文档与官网入口应保留。再检查托盘、退出、登录启动、全局快捷键、应用启动和个人/公共/OneDrive 桌面扫描。
3. 对 exe / lnk / url、中文/空格/& 路径、自定义 ico、DLL 非零/负索引和失效入口检查图标。打开入口仍执行原始快捷方式。
4. 打开/退出普通 exe 应用，等待最多一个刷新周期检查圆点；关闭标记后消失，UWP/URL 不显示；启动台展开时暂停，独立设置打开时继续显示。
5. 主屏视频 F11 / 游戏全屏检查隐藏和恢复；普通最大化应保留 Dock，副屏全屏不触发。全屏中托盘或快捷键主动唤出应保持显示，结束后下一次全屏重新隐藏。关闭“全屏时自动隐藏”开关后辅助进程应退出。
6. 先手动移动/缩放设置窗口，再将图标64→72→40→64px、宽度80%→40%→80%反复拖动，确认 Dock 可放大/缩小，设置窗口大小和位置不变；调整强调色和分隔线位置，重启检查；100%/125%/150%/200%缩放检查左右端放大、横向滚动、玻璃透明边角及设置开关残留。
7. 开启桌面右键收纳，用测试快捷方式右键“显示更多选项 → 加入 Lume Dock”。成功后检查副本、启动、桌面原件进入回收站；保存失败/达到500个时应保留原件。关闭开关后菜单移除。
8. 设置窗口开着时从托盘退出，检查 Dock/设置/通知图标及 Lume Dock.exe 进程组消失，本程序的 PowerShell 辅助进程结束，之前由 Dock 打开的其他程序保持运行。随后从原目录升级，检查配置、固定入口和收纳副本仍在；额外在测试安装中移走旧卸载器验证修复安装，不清理注册表。
9. 在全部应用右键一个未固定应用，选择透明PNG，确认未自动固定；点星号后图标沿用。用设置列表“图标”恢复默认，检查Dock和全部应用同步。更换JPG/ICO、取消选择、错误文件、移动原图、重启及配置导出/导入；检查中文和空格路径、Windows浅/深主题及缩放。
10. 在任务管理器记录应用整个进程组启动、空闲10分钟、反复打开面板后及1小时后的CPU/内存；包括 PowerShell 辅助进程。休眠唤醒后重查。JavaScript堆不是整个应用内存，不能直接拿来宣传资源占用。

反馈问题时记录版本、Windows版本、显示缩放、是否安装版、快捷方式类型、复现步骤与截图。不要发送账户凭据或私人文件内容。
