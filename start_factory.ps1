# Get active local IPv4 address
$ip = (Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias 'Wi-Fi', 'Ethernet' | Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '127.*' } | Select-Object -First 1).IPAddress
if (-not $ip) {
    $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '169.254.*' -and $_.IPAddress -notlike '127.*' } | Select-Object -First 1).IPAddress
}
if (-not $ip) {
    $ip = "127.0.0.1"
}

Clear-Host
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "         Smart Factory Service Start & Configurator       " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This script configures and launches backend & frontend services." -ForegroundColor White
Write-Host "It will automatically configure all files to target the system IP." -ForegroundColor White
Write-Host ""
Write-Host "Detected active Local IP address: " -NoNewline -ForegroundColor White
Write-Host "$ip" -ForegroundColor Yellow
Write-Host ""

$inputIp = Read-Host "Press ENTER to use this IP, or enter a new IP address to override"
if ($inputIp -ne "") {
    $ip = $inputIp
}

Write-Host ""
Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Configuring IP address: $ip" -ForegroundColor Yellow
Write-Host "----------------------------------------------------------" -ForegroundColor Cyan

# 1. Update Frontend env config
$envPath = ".\factory-pulse-ai-main\.env"
if (Test-Path $envPath) {
    $content = Get-Content $envPath
    $content = $content -replace 'VITE_API_BASE_URL=.*', "VITE_API_BASE_URL=http://$($ip):5000/api"
    $content | Set-Content $envPath
    Write-Host "[CONFIG] Frontend .env updated to: http://$($ip):5000/api" -ForegroundColor Green
} else {
    Write-Host "[WARNING] Frontend .env not found at $envPath" -ForegroundColor Yellow
}

# 2. Update Frontend api candidates
$apiPath = ".\factory-pulse-ai-main\src\api\api.ts"
if (Test-Path $apiPath) {
    $content = Get-Content $apiPath
    # Replace the hardcoded 172.x.x.x string or update candidates
    $content = $content -replace '"http://\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:5000/api"', `""http://$($ip):5000/api`""
    $content | Set-Content $apiPath
    Write-Host "[CONFIG] Frontend api.ts candidates updated." -ForegroundColor Green
}

# 3. Update Arduino Gateway configuration
$gwPath = ".\arduino\gateway\gateway.ino"
if (Test-Path $gwPath) {
    $content = Get-Content $gwPath
    $content = $content -replace 'const char\* serverBase = "http://.*";', "const char* serverBase = `"http://$($ip):5000`";"
    $content | Set-Content $gwPath
    Write-Host "[CONFIG] Arduino gateway.ino serverBase updated to: http://$($ip):5000" -ForegroundColor Green
}

# 4. Update Mock Simulator configuration
$simPath = ".\backend\mock_ingest_simulator.py"
if (Test-Path $simPath) {
    $content = Get-Content $simPath
    $content = $content -replace 'API_URL = .*', "API_URL = `"http://$($ip):5000/api/data`""
    $content | Set-Content $simPath
    Write-Host "[CONFIG] Mock simulator API URL updated to: http://$($ip):5000/api/data" -ForegroundColor Green
}

# 5. Update Serial Bridge defaults
$bridgePath = ".\backend\serial_bridge_ingest.py"
if (Test-Path $bridgePath) {
    $content = Get-Content $bridgePath
    $content = $content -replace '--api      Flask API base URL    \(default: http://.*/api/data\)', "--api      Flask API base URL    (default: http://$($ip):5000/api/data)"
    $content = $content -replace '--sse-url  Flask SSE push URL    \(default: http://.*/api/stream/push\)', "--sse-url  Flask SSE push URL    (default: http://$($ip):5000/api/stream/push)"
    $content = $content -replace 'parser\.add_argument\("--api",\s+default="http://.*/api/data",', "parser.add_argument(`"--api`",      default=`"http://$($ip):5000/api/data``","
    $content = $content -replace 'parser\.add_argument\("--sse-url",\s+default="http://.*/api/stream/push",', "parser.add_argument(`"--sse-url`",  default=`"http://$($ip):5000/api/stream/push``","
    $content | Set-Content $bridgePath
    Write-Host "[CONFIG] Serial bridge ingest defaults updated." -ForegroundColor Green
}

# 6. Update Historical Analysis chart fallback
$histPath = ".\factory-pulse-ai-main\src\components\dashboard\HistoricalAnalysis.tsx"
if (Test-Path $histPath) {
    $content = Get-Content $histPath
    $content = $content -replace 'const baseUrl = \(API\.defaults\.baseURL \|\| "http://.*"\)\.replace.*', "const baseUrl = (API.defaults.baseURL || `"http://$($ip):5000/api`").replace(/\/$/, `"`");"
    $content | Set-Content $histPath
    Write-Host "[CONFIG] HistoricalAnalysis.tsx fallback URL updated." -ForegroundColor Green
}

Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
Write-Host "Configuration completed successfully!" -ForegroundColor Green
Write-Host "----------------------------------------------------------" -ForegroundColor Cyan
Write-Host ""
Write-Host "Which services would you like to run?" -ForegroundColor White
Write-Host "1. Start Flask Backend Only (starts python app.py in new window)" -ForegroundColor White
Write-Host "2. Start Vite Frontend Only (starts npm run dev with network host)" -ForegroundColor White
Write-Host "3. Start BOTH Frontend & Backend (recommended, launches in separate windows)" -ForegroundColor White
Write-Host "4. Configure IP only and Exit" -ForegroundColor White
Write-Host ""

$choice = Read-Host "Select option (1-4)"

if ($choice -eq "1" -or $choice -eq "3") {
    Write-Host "Launching Flask Backend in a new window..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd backend; python app.py"
}

if ($choice -eq "2" -or $choice -eq "3") {
    Write-Host "Launching Vite Frontend in a new window..." -ForegroundColor Yellow
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd factory-pulse-ai-main; npm run dev -- --host"
}

Write-Host ""
Write-Host "Done! If you need to flash the ESP32 Gateway, remember to open the gateway sketch in Arduino IDE and upload it." -ForegroundColor Green
Write-Host "Press any key to exit..."
[void][System.Console]::ReadKey($true)
