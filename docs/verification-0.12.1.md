# 0.12.1 验证记录

日期：2026-10-18。宿主：macOS arm64，Electron 44.8.0。Windows接口在此宿主使用模拟数据，不能据此声明Windows安装和原生行为已经通过。

## 自动化

- npm test：52/52通过。覆盖快捷方式图标批处理与回退、进程匹配/缓存/失败恢复、启动延迟刷新、全屏辅助进程生命周期/部分输出/超时/退避、主动唤出豁免、窗口大小钳制和显式可见通知。安装包脚本回归确认编码文本传参，保留stdin探测通道，兼容app.asar及中文文本。
- test:ui、test:launcher、test:appearance、test:integration：通过。
- test:regressions：通过，覆盖拖放取消与提示清理、隐藏面板磨砂、不同宽度图标边界、长列表首末放大及透明角落。
- test:features：通过，覆盖新增设置默认值/保存/重载/导入/重置、分隔线排序删除与排除启动/搜索/图标读取、圆点错误恢复、暂停恢复、启动后刷新、40/64/72px与600/912px宽度组合，以及500入口容量回滚和不确认删除原快捷方式。
- test:stability：修复后通过。1,000个模拟应用、虚拟列表滚动/键盘跨行/迟到响应、配置异常与保存失败、后台任务暂停，以及预热后40轮打开/搜索/关闭。回收后的渲染JavaScript堆约 3.59 → 3.61 MiB；不是整个软件的内存占用，也不是Windows长时间实测。
- test:windows-icons：非Windows平台明确跳过，未计作通过。

Desktop unavailable、Test catalog unavailable、Injected process failure 日志来自主动故障注入，测试确认界面可恢复。

完整命令结果见 release-tests-0.12.1.json 和 release-tests-0.12.1.log。稳定性数据见 stability-report.json，截图见 features-settings.png、dock-size-40.png、dock-size-64.png、dock-size-72.png 和 dock-transparent-regression.png。

## 回归中发现并修复

初次整套运行在隐藏窗口后台任务检查失败；诊断发现macOS非激活窗口已经隐藏，但未及时提供原生hide事件，document.hidden也仍为false。现由程序控制显隐时显式发送主进程可见状态，时钟、电池、歌词及运行检测都依据该状态暂停；主进程单元测试和真实渲染通知测试共同覆盖。保留初次失败日志及JSON为 release-tests-0.12.1-initial.*，修复后整套UI与稳定性复测通过。

检查安装包边界时发现全屏辅助脚本原先使用外部 -File 路径，无法读取app.asar内的文件。改为Electron读取脚本文本，通过-EncodedCommand启动常驻辅助进程；已补专门回归。

0.11.2历史记录中的一次搜索数量偶发失败在本次顺序运行中没有复现，未把它当作已定位修复的问题。若Windows复现，仍需保留搜索值、焦点与结果状态进一步诊断。

## 构建与实机边界

安装包构建和归档校验结果见 artifact-verification-0.12.1.json（打包完成后生成）。Windows11原生PowerShell/COM/CIM/Explorer、进程权限、前台全屏分类、桌面合成透明效果、显示缩放、托盘、右键收纳及长时CPU/内存仍需目标电脑验收，步骤见windows-handoff.md。当前只支持主显示器，未代码签名，UWP/URL不显示运行圆点。
