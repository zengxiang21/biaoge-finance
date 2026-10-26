@echo off
setlocal
cd /d %~dp0frontend

if not exist node_modules (
  echo [提示] 第一次运行，先装前端依赖，可能要几分钟。
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败，检查 Node 是否装好、网络是否通。
    pause
    exit /b 1
  )
)

echo 前端启动中  浏览器访问 http://127.0.0.1:5173
echo 这个窗口别关，关掉页面就打不开了。
echo.

call npm run dev

echo.
echo 前端进程已退出。
pause
