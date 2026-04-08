@echo off
setlocal

set REPO=C:\Users\jiesh\AI codes hub\market_dashboard
set PY_APP=%REPO%\apps\market_dashboard
set NEXT_PUBLIC=%REPO%\apps\usStockChatBot\public\market-dashboard

echo [%date% %time%] Starting market data refresh...

:: Build market data
python "%PY_APP%\scripts\build_data.py" --out-dir "%PY_APP%\data"
if errorlevel 1 (
    echo [%date% %time%] ERROR: build_data.py failed
    exit /b 1
)

:: Copy data into Next.js public folder
if not exist "%NEXT_PUBLIC%\charts" mkdir "%NEXT_PUBLIC%\charts"
copy /Y "%PY_APP%\data\snapshot.json" "%NEXT_PUBLIC%\"
copy /Y "%PY_APP%\data\events.json"   "%NEXT_PUBLIC%\"
copy /Y "%PY_APP%\data\meta.json"     "%NEXT_PUBLIC%\"
copy /Y "%PY_APP%\data\charts\*.png"  "%NEXT_PUBLIC%\charts\" 2>nul

echo [%date% %time%] Market data refresh complete.
endlocal
