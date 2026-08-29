@echo off
chcp 65001 >nul
title 星伴 - AI 伴学
cd /d "%~dp0"
echo 正在启动星伴伴学系统...
call pnpm start
