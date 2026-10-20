# 0.12.2 安装修复

用户反馈：手动退出后，0.12.1 安装器仍提示“Lume Dock无法关闭”，随后显示“Failed to uninstall old application files ... : 2”。截图中的安装路径为 E:\Software\LUME-DOCK\Lume Dock。

## 判断依据

安装器使用的 electron-builder 26.0.12 模板在卸载旧版时，将旧卸载器复制到系统临时目录，并通过 --updated 调用它。旧卸载器的 un.atomicRMDir 使用 Rename 将应用文件移到自己的 $PLUGINSDIR/old-install；安装卷和系统临时卷不同就会失败。重试超过次数又共用“无法关闭”的提示，所以即使应用已退出也可能继续报同样的错。

用户的 E: 盘路径与此失败条件相符，但尚未在用户机器上采集日志，因此不能排除权限、文件占用或安全软件的额外影响。

## 使用新版

1. 取消并关闭之前失败的安装窗口。
2. 运行 Lume-Dock-Setup-0.12.2-x64.exe，选择原来的安装目录。
3. 程序坞配置及已收纳的快捷方式副本保留，不需要删除 %APPDATA%\lume-dock。
4. 如果仍失败，在资源管理器输入 %LOCALAPPDATA%\Lume Dock\InstallerLogs，保留最新 upgrade-*.log。日志包含旧安装目录、暂存目录、匹配的进程PID及卸载退出码，不包含快捷方式内容或账户凭据。

也可使用 Lume-Dock-0.12.2-Windows免安装版.zip：完整解压到一个新目录，运行 Lume Dock.exe，保持文件夹完整，不要在压缩包内直接运行。此方式绕过旧卸载器，不会删除或卸载旧版本；每次只运行一个版本。

## 修复的行为边界

- 使用原安装目录所在卷的随机独立暂存目录；Windows下查询实际卷，防止盘符判断被目录联接误导。
- 旧卸载器复制后校验 SHA-256。仅运行注册安装目录内预期名称的卸载器，不执行任意命令文本。
- 每个旧安装分别调用包装器，保留原有当前用户/所有用户卸载范围及快捷方式选项。
- 只有旧卸载子进程的 TEMP/TMP/工作目录改变；父安装器、系统环境及新应用不改变。
- 卸载参数严格允许列表，始终传 /KEEP_APP_DATA 和 --updated。应用数据不会主动删除。
- 失败退出即停止安装，保留可能含已移动文件的暂存目录，不靠忽略错误或清空注册表继续覆盖。日志说明位置。
- 卸载运行上限90秒，有等待心跳；超时结束指定卸载进程并保留暂存文件。需要人工恢复时按日志检查，不能直接清空暂存目录。
- 应用进程关闭继续使用 electron-builder 的既有检查，不会批量结束其他软件或所有 PowerShell 进程。

## 开发

npm ci 后使用 npm run dist。scripts/build-windows.cjs 在当前构建进程中为 NsisTarget.computeFinalScript 加入边界检查后的模板替换；保留默认的两遍卸载器生成流程，不使用会关闭该流程的 nsis.script 配置，也不修改 node_modules。package-lock 锁定构建器；模板/API变化时应重新审查补丁。

npm test 检查模板替换边界；npm run test:upgrade 在Windows使用自带PowerShell运行实际包装器的fixture，包括中文/空格/&路径、同卷暂存策略、子进程独立环境、成功清理、失败保留及用户数据保留。macOS可通过 LUME_TEST_POWERSHELL 指定 PowerShell Core 验证可移植逻辑，但不能取代 Windows NSIS跨盘安装实测。

Windows还需实际验证：旧版位于E:且TEMP位于C:、同盘C:升级、当前用户/所有用户模式、变更安装位置、文件被锁定/权限不足时的日志与恢复、新装及普通卸载。测试前可记录用户配置与快捷方式副本校验值，成功更新后核对不变。
