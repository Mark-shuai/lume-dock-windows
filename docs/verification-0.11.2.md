# 0.11.2 验证记录

日期：2026-10-18。宿主：macOS arm64，Electron 44.8.0。

- npm test：36/36 通过，包括新增图标批处理、乱序结果匹配、失败回退和并发检查。
- test:ui、test:launcher、test:appearance、test:integration：通过。测试日志中的 Desktop unavailable / Test catalog unavailable 属于预期的故障注入。
- test:regressions：通过。检查初始隐藏、5条拖放退出路径、隐藏磨砂面板、600/720/912/1100像素宽度下图像边界、长列表两端和透明角落；截图见 dock-transparent-regression.png。
- test:stability：首次全套运行在结果数量断言处失败（显示“找到1个结果”）；追加搜索状态诊断后单独复测通过。保留这个偶发失败记录，尚不能确认是运行时输入干扰还是稳定性问题；若Windows复现，应结合新增诊断继续定位，不能据单次重跑宣称彻底排除。
- 复测稳定性报告：1,000个模拟应用，预热后40轮打开/搜索/关闭，回收后渲染JavaScript堆约3.55→3.57MiB。详见 stability-report.json；这不是整个软件占用或Windows实机结果。
- npm run dist：Windows x64 NSIS交叉构建成功，app.asar内确认包含 windows-icons.js、scripts/resolve-icons.ps1、renderer/dock-motion.js，内容与源码一致，版本为0.11.2。

Windows原生PowerShell/COM/Explorer以及桌面合成透明效果尚未实测。新增 npm run test:windows-icons 可在Windows自动创建临时快捷方式，验证中文/空格/&路径、真实目标、DLL非零资源索引和.url图标；非Windows平台会明确跳过，不能计为通过。
