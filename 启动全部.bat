@echo off
setlocal enabledelayedexpansion
cd /d %~dp0

if not exist .venv\Scripts\python.exe (
  echo [错误] 还没装好后端环境，请先双击「初始化环境.bat」。
  pause
  exit /b 1
)

echo 正在开后端和前端两个窗口...
start "彪哥财经-后端" cmd /k 启动后端.bat
start "彪哥财经-前端" cmd /k 启动前端.bat

where curl > "%TEMP%\biaoge_where.out" 2>&1
if errorlevel 1 (
  echo 没找到 curl，等 15 秒后直接开浏览器。
  ping -n 16 127.0.0.1 > "%TEMP%\biaoge_sleep.out"
  goto open
)

set /a n=0
:probe
set /a n+=1
curl -s -o "%TEMP%\biaoge_probe.out" http://127.0.0.1:5173/
if not errorlevel 1 goto open
if !n! geq 30 (
  echo [提示] 60 秒内页面还没起来，去看那两个窗口里的报错。
  echo 常见原因：端口被占（先跑「停止服务.bat」）、依赖没装（跑「初始化环境.bat」）。
  pause
  exit /b 1
)
echo 等待服务就绪... !n!/30
ping -n 3 127.0.0.1 > "%TEMP%\biaoge_sleep.out"
goto probe

:open
echo 已就绪：http://127.0.0.1:5173/
start "" http://127.0.0.1:5173/
echo 登录账号 admin / Biaoge@2026
echo 这两个服务窗口保持开着即可，本窗口可以关掉。
pause
