@echo off
setlocal
cd /d %~dp0

if not exist .venv\Scripts\python.exe (
  echo [错误] 找不到 .venv\Scripts\python.exe
  echo 请先双击「初始化环境.bat」，或按 README 里的回退方案装依赖。
  pause
  exit /b 1
)

echo 后端启动中  接口地址 http://127.0.0.1:8750
echo 这个窗口别关，关掉后端就停了。Ctrl+C 可以停。
echo.

set PYTHONIOENCODING=utf-8
.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8750 --app-dir backend

echo.
echo 后端进程已退出，上面是它的输出，报错就往回滚看。
pause
