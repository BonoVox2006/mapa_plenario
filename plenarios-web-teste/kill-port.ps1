$ErrorActionPreference = "SilentlyContinue"

$ports = @(5174)

foreach ($port in $ports) {
  $procs = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique

  foreach ($p in $procs) {
    if ($null -ne $p -and $p -ne 0) {
      try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } catch {}
    }
  }

  # wait until port is free (best-effort)
  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0 -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 250
  }

  $stillBusy = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -First 1

  if ($stillBusy) {
    Write-Output "Porta $port continua em uso (não consegui liberar por permissão/erro)."
    exit 2
  }
}

Write-Output "Porta 5174 liberada."
exit 0

