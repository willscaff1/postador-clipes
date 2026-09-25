@echo off
title Postador de Clipes
cd /d "%~dp0"
start "" http://localhost:8790
node server.js
pause
