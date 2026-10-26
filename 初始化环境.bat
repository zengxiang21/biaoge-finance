@echo off
setlocal
cd /d %~dp0

where python > "%TEMP%\biaoge_where_py.out" 2>&1
if errorlevel 1 (
  echo [错误] 命令行里找不到 python，请先装 Python 3.12 并勾选 Add to PATH。
  pause
  exit /b 1
)

echo ---- 1/3 建虚拟环境 ----
if exist .venv\Scripts\python.exe (
  echo .venv 已存在，跳过。
) else (
  python -m venv .venv
)

if not exist .venv\Scripts\python.exe (
  echo [提示] venv 建不起来（清理工具常削这块），改用 --target 装到 libs 目录。
  python -m pip install --target=libs -r backend\requirements.txt
  if errorlevel 1 goto :fail
  echo.
  echo 依赖已装进 libs。这种模式下启动后端要先设 PYTHONPATH：
  echo   set PYTHONPATH=%CD%\libs
  echo 然后执行 README「手动启动」那一节的命令。
  goto :frontend
)

echo ---- 2/3 装后端依赖 ----
set PYTHONIOENCODING=utf-8
.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if errorlevel 1 (
  echo [提示] venv 里的 pip 装不动，退回 --target 方案。
  python -m pip install --target=libs -r backend\requirements.txt
  if errorlevel 1 goto :fail
  echo 请用 PYTHONPATH=%CD%\libs 的方式启动后端，见 README 常见问题。
  goto :frontend
)

:frontend
echo ---- 3/3 装前端依赖 ----
where npm > "%TEMP%\biaoge_where_npm.out" 2>&1
if errorlevel 1 (
  echo [错误] 找不到 npm，请装 Node.js 后重跑本脚本。
  pause
  exit /b 1
)
pushd frontend
call npm install
set NPM_RC=%errorlevel%
popd
if not "%NPM_RC%"=="0" (
  echo [错误] npm install 失败，看上面的 npm 报错。
  pause
  exit /b 1
)

echo.
echo 初始化完成。以后双击「启动全部.bat」即可。
goto :end

:fail
echo [错误] 依赖安装失败，把上面的报错信息发我看。

:end
pause
