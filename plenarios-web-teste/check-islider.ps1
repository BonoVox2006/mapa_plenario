$ErrorActionPreference = "Stop"

$resp = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:5174/api/deputados"
$body = $resp.Content

$hasL = $body -match '\"isLider\"'
$hasV = $body -match '\"isViceLider\"'

Write-Output ("has isLider: {0}" -f $hasL)
Write-Output ("has isViceLider: {0}" -f $hasV)

if ($hasL -or $hasV) {
  $idx = $body.IndexOf('"isLider"')
  if ($idx -lt 0) { $idx = $body.IndexOf('"isViceLider"') }
  $start = [Math]::Max(0, $idx - 200)
  $len = [Math]::Min(500, $body.Length - $start)
  Write-Output $body.Substring($start, $len)
}

