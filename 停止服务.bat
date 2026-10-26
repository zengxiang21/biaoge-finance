@echo off
setlocal enabledelayedexpansion
cd /d %~dp0

echo 只关本项目的两个端口：8750（后端）和 5173（前端）。
echo.

set /a hit=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":8750 "') do (
  echo 关闭后端 PID %%p
  taskkill /PID %%p /F
  set /a hit+=1
)
for /f "tokens=5" %%p in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":5173 "') do (
  echo 关闭前端 PID %%p
  taskkill /PID %%p /F
  set /a hit+=1
)

if !hit!==0 echo 这两个端口上没有在跑的服务，没事可做。
echo.
echo 完成。
pause
