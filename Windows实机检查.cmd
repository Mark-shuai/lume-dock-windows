@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js，再按 README 安装开发依赖。
  pause
  exit /b 1
)
if not exist node_modules\electron\path.txt (
  echo 正在安装开发依赖，首次运行需要联网。
  call npm ci
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络后重试。
    pause
    exit /b 1
  )
)
echo 将运行隔离配置的 Windows 实机检查，默认常驻观察 60 分钟。
echo 结果保存在 reports 文件夹。测试期间请勿关闭测试窗口。
call npm run verify:windows -- %*
set "LUME_CHECK_EXIT=%ERRORLEVEL%"
pause
exit /b %LUME_CHECK_EXIT%
