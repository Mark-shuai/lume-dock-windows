# GitHub 同类项目评估与采用记录

评估日期：2026-10-20。通过 GitHub API 查看上游仓库元数据、README 和下述源码。许可证以此次查看的版本为准；本次独立实现功能，没有复制上游源码、图标或其他资产。

| 项目与此次查看的提交 | 许可证 | 上游证据 | 对 Lume Dock 的决定 |
| --- | --- | --- | --- |
| [Flow Launcher](https://github.com/Flow-Launcher/Flow.Launcher/tree/3b89277c65981c8228f2c0525270a5a716506cca) | MIT | README 的应用搜索、优先级和键盘流程；[StringMatcher.cs](https://github.com/Flow-Launcher/Flow.Launcher/blob/3b89277c65981c8228f2c0525270a5a716506cca/Flow.Launcher.Infrastructure/StringMatcher.cs) 中的单词首字母、顺序字符和多词匹配 | 采用名称缩写与结果排序的交互思路，独立编写小型 JS 匹配模块；保留已有键盘操作。上游支持拼音，本次没有加入拼音。 |
| [Cedro Modern Dock](https://github.com/Cedro-Software/cedro-modern-dock/tree/258d6160178b712cf0959dee88f577bf76a2fd56) | GPL-3.0 | README 的运行窗口预览、未固定运行应用、拖动排序、纵向 Dock、升级保留配置与 Windows 适配层 | 作为 Windows Dock 功能参考。本次不移植代码；窗口预览/多窗口管理需要 Windows 原生接口及实机验证，暂缓加入。 |
| [Zebar](https://github.com/glzr-io/zebar/tree/5f90d341867122175cb4a57af594a44752885056) | GPL-3.0 | README 描述 Rust 配合原生 WebView 的桌面组件架构，并称其比 Electron 更轻量 | 提示未来可以评估框架成本；它不证明 Lume Dock 迁移后的实测占用。本次保留 Electron，优先验证索引复用、有限图标缓存和关闭释放。 |
| [CleverDock](https://github.com/dlacaille/clever-dock) | 本次未确认 | README 明确停止维护，面向 Vista/7/8/8.1；提到动画、自动隐藏及窗口识别 | 仅作历史行为参考，不作为 Windows 11 的实现依据。 |

## 实际改进

- `renderer/app-search.js`：预先构建名称、词边界和首字母索引；查询只标准化一次。按完整名称、名称前缀、词前缀、包含、首字母、紧凑顺序字符的次序评分，同分保持名称排序。
- 缩写至少2个 ASCII 字母/数字，顺序字符至少3个、最多64个，并限制跨度；中文与标点保持字面包含。不会跨不相关别名拼接模糊字符，多词查询要求每个词都匹配。
- `renderer/launcher.js`：复用已有列表索引及分类过滤；关闭释放索引，没有引入搜索依赖、定时器、网络服务或额外进程。
- 回归检查另发现图标缓存竞态：请求在新网格绘制后、可见区域通知前完成时，新节点没有从缓存补图。现在通知时优先读取缓存；不扩大缓存上限、不轮询重试，保留自定义图标优先级。

## 暂缓事项

运行窗口预览、任务栏替代、原生 WebView 框架迁移、多显示器重构均需单独评估与 Windows 测试，不为模仿功能清单而一起加入。上游项目功能说明与许可证不是对 Lume Dock 无故障或低内存的保证；本版验证范围见 [验证说明](verification-0.12.13.md)。
