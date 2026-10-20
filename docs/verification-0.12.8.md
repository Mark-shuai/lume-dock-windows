# 0.12.8：图标透明度与玻璃底座

## 改动

- Windows 注册应用图标原先经 `Image.FromHbitmap` 转成 PNG，该路径会丢失 alpha，透明角变成黑色方块。现在用 `GetDIBits` 读取原始 BGRA，转换预乘颜色后保存为带 alpha 的 PNG。保留真实黑色内容，未给所有图标强制裁圆角或删除黑色像素。
- 传统无 alpha 图标改取 Shell HICON，通过原有 AND mask 转换。释放 HBITMAP、DC、HICON、PIDL、COM 对象及托管图像资源；快捷方式资源图标继续使用原来的 HICON 路径。
- 已保存的图标增加 `iconVersion: 2`。旧图标缓存失效后重新读取，保留固定项、启动目标、收纳来源、应用库和偏好；无需清空用户配置或重新固定。注册应用固定项也可通过共享图标缓存读取 AppsFolder 图标。新缓存继续受并发数、数量、大小和过期时间限制，不增加常驻轮询。
- 底座采用单段连续渐变，边缘高光保留；放大时调整底座左右边界，取消背景采样层的 `scaleX`。保留现有圆角、透明度、模糊、高光、阴影滑块及竖向分隔符。截图中的横线不是有意设置的分隔符；本机未复现 Windows 合成接缝，无法确认其全部驱动/缩放相关原因。

## 已验证

环境为 macOS arm64 / Electron 44.8.0，Windows x64 交叉构建。

- `LUME_TEST_POWERSHELL=... npm test`：71/71 通过，包含生产 C# 编译、透明像素/真黑/白色/半透明边缘转换、旧缓存失效保留数据、AppsFolder 图标重读与缓存。
- `npm run test:material`：旧固定项自动重读、重新固定后保存新版图标；40/64/72px、浅/深主题、透明度 10/35/75%、模糊 0/28/48、圆角 8/22/40 共六组组合，底座中央相邻像素连续，采样层不缩放。
- `npm run test:appearance`、`npm run test:regressions`：真实 Electron 截图与人工查看，检查邻近放大、提示、减少动效、透明窗口边角、四种窗口宽度和多图标首尾滚动。
- `npm run test:settings`、`npm run test:dedup`：设置实时预览、图标尺寸增减、跨入口去重与星号固定/取消及失败回滚。

C# 转换算法已在 PowerShell Core 编译运行；本机不能执行 Windows Shell、GDI 和传统 ICO 掩码测试。已有 `npm run test:windows-icons` 的 Windows 原生测试新增可控 HBITMAP alpha→PNG、传统 24 位 ICO 的透明角和黑色中心检查；在 Windows 上运行才会执行，本机跳过不能算通过。整体内存和 Windows 长期稳定性未由这次短时测试证明。

## Windows 11 检查

1. 安装到原目录即可保留设置与固定项，版本应显示 0.12.8，不必清除注册表或配置。
2. 等待首次图标读取，检查哔哩哔哩、Chrome 文档、系统工具等透明角，并查看 Dock、全部应用和设置管理列表。首次重读可能有短暂的通用图标。若列表已打开，可关闭再打开或点“刷新列表”。
3. 检查深色/浅色壁纸、Windows 100%/125%/150% 缩放下底座中央；悬停放大、改变尺寸、透明度和模糊，检查是否仍有细横线。
4. 新固定、取消固定、重新启动，确认图标与固定状态正常，收纳副本仍在。检查本身带黑色内容的图标没有被挖空，异形图标没有被裁坏。
5. 开发环境运行 `npm ci`、`npm test`、`npm run test:windows-icons`、`npm run test:material`。后者使用模拟图标以验证界面与迁移，不能替代前者的 Windows 原生图标读取测试。

安装包、源码及哈希校验见 `artifact-verification-0.12.8.json`。Windows 实机安装和显示效果仍需验证。
