@echo off
title Smart Factory Configurator & Runner
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File .\start_factory.ps1
