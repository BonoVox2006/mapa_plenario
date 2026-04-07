$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$portsToTry = @(5174)

function Get-ContentType([string]$path) {
  switch ([IO.Path]::GetExtension($path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8" }
    ".css"  { "text/css; charset=utf-8" }
    ".js"   { "application/javascript; charset=utf-8" }
    ".json" { "application/json; charset=utf-8" }
    ".png"  { "image/png" }
    ".jpg"  { "image/jpeg" }
    ".jpeg" { "image/jpeg" }
    ".gif"  { "image/gif" }
    ".svg"  { "image/svg+xml" }
    default { "application/octet-stream" }
  }
}

function Write-HttpResponse($stream, [int]$statusCode, [string]$contentType, [byte[]]$body) {
  $reason = switch ($statusCode) {
    200 { "OK" }
    400 { "Bad Request" }
    404 { "Not Found" }
    500 { "Internal Server Error" }
    default { "OK" }
  }
  $header =
    "HTTP/1.1 $statusCode $reason`r`n" +
    "Content-Type: $contentType`r`n" +
    "Content-Length: $($body.Length)`r`n" +
    "Access-Control-Allow-Origin: *`r`n" +
    "Connection: close`r`n" +
    "`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($header)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length -gt 0) {
    $stream.Write($body, 0, $body.Length)
  }
}

$listener = $null
$port = $null

foreach ($p in $portsToTry) {
  try {
    # Bind em todas as interfaces para permitir acesso por outras máquinas na rede.
    $l = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Any, $p)
    $l.Start()
    $listener = $l
    $port = $p
    break
  } catch {
    continue
  }
}

if (-not $listener) {
  # Mostra motivo real (porta em uso vs bloqueio).
  $busy = Get-NetTCPConnection -State Listen -LocalPort 5174 -ErrorAction SilentlyContinue |
    Select-Object LocalPort,OwningProcess

  if ($busy) {
    Write-Host "Não consegui iniciar: a porta 5174 já está em uso." -ForegroundColor Red
    $pids = $busy | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique
    $pidText = ($pids | ForEach-Object { "PID " + $_ }) -join ", "
    Write-Host ("Detalhe: " + $pidText) -ForegroundColor DarkRed
  } else {
    Write-Host "Não consegui iniciar servidor local em 5174." -ForegroundColor Red
    Write-Host "Possível causa: política/antivírus bloqueando servidor local." -ForegroundColor DarkRed
  }
  exit 1
}

Write-Host "Servidor iniciado:" -ForegroundColor Green
Write-Host "  http://localhost:$port/" -ForegroundColor Cyan

try {
  $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object {
    $_.IPAddress -and
      $_.IPAddress -ne "127.0.0.1" -and
      $_.IPAddress -notlike "169.254.*"
  } | Select-Object -ExpandProperty IPAddress)
  if ($ips.Count -gt 0) {
    Write-Host "  http://IP_DA_SUA_MAQUINA:$port/" -ForegroundColor Cyan
    Write-Host ("  IPs detectados: " + ($ips -join ", ")) -ForegroundColor DarkCyan
  }
} catch {
  # ignore
}
Write-Host "Pasta:" -ForegroundColor Green
Write-Host "  $root" -ForegroundColor Cyan
Write-Host ""
Write-Host "Deixe esta janela aberta enquanto usa o app." -ForegroundColor Yellow
Write-Host "Para parar: Ctrl+C" -ForegroundColor Yellow

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 4096, $true)

    $requestLine = $reader.ReadLine()
    if ([string]::IsNullOrWhiteSpace($requestLine)) {
      $client.Close()
      continue
    }

    # Parse headers
    $headers = @{}
    while ($true) {
      $h = $reader.ReadLine()
      if ($h -eq $null -or $h -eq "") { break }
      $idx = $h.IndexOf(":")
      if ($idx -gt 0) {
        $hn = $h.Substring(0, $idx).Trim().ToLowerInvariant()
        $hv = $h.Substring($idx + 1).Trim()
        $headers[$hn] = $hv
      }
    }

    $parts = $requestLine.Split(" ")
    $method = if ($parts.Length -ge 1) { $parts[0].ToUpperInvariant() } else { "GET" }
    $path = if ($parts.Length -ge 2) { $parts[1] } else { "/" }
    if ($path -eq "/" -or [string]::IsNullOrWhiteSpace($path)) { $path = "/index.html" }
    $rawPath = $path

    $contentLength = 0
    if ($headers.ContainsKey("content-length")) {
      [void][int]::TryParse($headers["content-length"], [ref]$contentLength)
    }
    $requestBody = ""
    if ($contentLength -gt 0) {
      $buf = New-Object char[] $contentLength
      $read = 0
      while ($read -lt $contentLength) {
        $n = $reader.Read($buf, $read, $contentLength - $read)
        if ($n -le 0) { break }
        $read += $n
      }
      if ($read -gt 0) {
        $requestBody = -join $buf[0..($read - 1)]
      }
    }

    $path = $path.Split("?")[0]
    $path = [Uri]::UnescapeDataString($path)
    $path = $path.TrimStart("/")
    $path = $path -replace "/", "\"

    # API endpoint: aggregate deputies from Câmara (server-side proxy)
    if ($path -eq "api\deputados" -or $path -eq "api/deputados") {
      try {
        # Ensure TLS 1.2+ and bypass proxies (common enterprise issue).
        try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor 3072 } catch {}
        Add-Type -AssemblyName System.Net.Http
        $handler = New-Object System.Net.Http.HttpClientHandler
        $handler.UseProxy = $false
        $clientHttp = New-Object System.Net.Http.HttpClient($handler)
        $clientHttp.DefaultRequestHeaders.Accept.Clear()
        $clientHttp.DefaultRequestHeaders.Accept.Add([System.Net.Http.Headers.MediaTypeWithQualityHeaderValue]::new("application/json"))

        $base = "https://dadosabertos.camara.leg.br/api/v2/deputados"
        $perPage = 100
        $page = 1
        $all = @()
        while ($true) {
          $ub = [System.UriBuilder]::new($base)
          $ub.Query = "itens=$perPage&pagina=$page&ordem=ASC&ordenarPor=nome"
          $url = $ub.Uri.AbsoluteUri
          $json = $clientHttp.GetStringAsync($url).GetAwaiter().GetResult()
          if (-not $json) { break }
          $resp = $json | ConvertFrom-Json
          if (-not $resp -or -not $resp.dados) { break }
          $dados = @($resp.dados)
          if ($dados.Count -eq 0) { break }
          $all += $dados
          if ($dados.Count -lt $perPage) { break }
          $page++
          if ($page -gt 60) { break }
        }

        # Enriquecimento: marca se o deputado é líder ou vice-líder (partidário)
        # Fonte: https://www2.camara.leg.br/deputados/liderancas-e-bancadas/liderancas-e-bancadas-partidarias
        $leadersUrl = "https://www2.camara.leg.br/deputados/liderancas-e-bancadas/liderancas-e-bancadas-partidarias"
        $leadersHtml = $clientHttp.GetStringAsync($leadersUrl).GetAwaiter().GetResult()

        $leadersSet = New-Object 'System.Collections.Generic.HashSet[long]'
        $viceSet = New-Object 'System.Collections.Generic.HashSet[long]'
        $role = $null

        $tokenRe = [regex]'(?i)(Líder\s*:|Vice-líderes\s*:|deputados/(\d+))'
        $matches = $tokenRe.Matches($leadersHtml)
        foreach ($m in $matches) {
          $tok = $m.Value
          if ($tok -match '(?i)^Líder') {
            $role = "leader"
            continue
          }
          if ($tok -match '(?i)^Vice') {
            $role = "vice"
            continue
          }
          if ($m.Groups.Count -ge 3 -and $m.Groups[2].Success) {
            $idNum = [long]$m.Groups[2].Value
            if ($role -eq "leader") {
              [void]$leadersSet.Add($idNum)
            } elseif ($role -eq "vice") {
              [void]$viceSet.Add($idNum)
            }
          }
        }

        foreach ($d in $all) {
          try {
            $did = [long]$d.id
            $isL = $leadersSet.Contains($did)
            $isV = $viceSet.Contains($did)
            Add-Member -InputObject $d -NotePropertyName "isLider" -NotePropertyValue $isL -Force | Out-Null
            Add-Member -InputObject $d -NotePropertyName "isViceLider" -NotePropertyValue $isV -Force | Out-Null
          } catch {}
        }

        try { $clientHttp.Dispose() } catch {}
        $payload = @{ dados = $all; fetchedAt = (Get-Date).ToString("o") } | ConvertTo-Json -Depth 6
        $body = [Text.Encoding]::UTF8.GetBytes($payload)
        Write-HttpResponse $stream 200 "application/json; charset=utf-8" $body
        $stream.Flush()
        $client.Close()
        continue
      } catch {
        $payload = @{ error = "Falha ao buscar Dados Abertos"; detail = $_.Exception.Message } | ConvertTo-Json -Depth 4
        $body = [Text.Encoding]::UTF8.GetBytes($payload)
        Write-HttpResponse $stream 500 "application/json; charset=utf-8" $body
        $stream.Flush()
        $client.Close()
        continue
      }
    }

    # API endpoint: shared plenary state (file-based)
    if ($path -eq "api\state" -or $path -eq "api/state") {
      try {
        $stateFile = Join-Path $root "shared-state.json"
        $store = @{}
        if (Test-Path -LiteralPath $stateFile -PathType Leaf) {
          try {
            $rawStore = Get-Content -LiteralPath $stateFile -Raw -Encoding UTF8
            if ($rawStore) {
              $objStore = $rawStore | ConvertFrom-Json
              if ($objStore -and $objStore.layouts) {
                foreach ($p in $objStore.layouts.PSObject.Properties) {
                  $store[$p.Name] = $p.Value
                }
              }
            }
          } catch {}
        }

        if ($method -eq "GET") {
          $layoutId = $null
          $qs = ""
          if ($rawPath -like "*`?*") {
            $partsQ = $rawPath.Split("?", 2)
            if ($partsQ.Length -eq 2) { $qs = $partsQ[1] }
          }
          if (-not [string]::IsNullOrWhiteSpace($qs)) {
            foreach ($pair in $qs.Split("&")) {
              if ([string]::IsNullOrWhiteSpace($pair)) { continue }
              $kv = $pair.Split("=", 2)
              $k = [Uri]::UnescapeDataString($kv[0])
              $v = if ($kv.Length -eq 2) { [Uri]::UnescapeDataString($kv[1]) } else { "" }
              if ($k -eq "layoutId") {
                $layoutId = $v
                break
              }
            }
          }
          if ([string]::IsNullOrWhiteSpace($layoutId)) {
            $payload = @{ error = "layoutId obrigatório" } | ConvertTo-Json -Depth 4
            $body = [Text.Encoding]::UTF8.GetBytes($payload)
            Write-HttpResponse $stream 400 "application/json; charset=utf-8" $body
            $stream.Flush()
            $client.Close()
            continue
          }

          $entry = $null
          if ($store.ContainsKey($layoutId)) { $entry = $store[$layoutId] }
          if (-not $entry) {
            $entry = @{
              layoutId = $layoutId
              allocations = @{}
              version = 0
              updatedAt = $null
            }
          }
          $payload = @{ dados = $entry } | ConvertTo-Json -Depth 8
          $body = [Text.Encoding]::UTF8.GetBytes($payload)
          Write-HttpResponse $stream 200 "application/json; charset=utf-8" $body
          $stream.Flush()
          $client.Close()
          continue
        }

        if ($method -eq "POST") {
          if ([string]::IsNullOrWhiteSpace($requestBody)) {
            $payload = @{ error = "Body JSON obrigatório" } | ConvertTo-Json -Depth 4
            $body = [Text.Encoding]::UTF8.GetBytes($payload)
            Write-HttpResponse $stream 400 "application/json; charset=utf-8" $body
            $stream.Flush()
            $client.Close()
            continue
          }

          $incoming = $requestBody | ConvertFrom-Json
          $layoutId = [string]$incoming.layoutId
          if ([string]::IsNullOrWhiteSpace($layoutId)) {
            $payload = @{ error = "layoutId obrigatório" } | ConvertTo-Json -Depth 4
            $body = [Text.Encoding]::UTF8.GetBytes($payload)
            Write-HttpResponse $stream 400 "application/json; charset=utf-8" $body
            $stream.Flush()
            $client.Close()
            continue
          }

          $allocations = @{}
          if ($incoming.allocations) {
            foreach ($p in $incoming.allocations.PSObject.Properties) {
              $allocations[$p.Name] = $p.Value
            }
          }

          $prevVersion = 0
          if ($store.ContainsKey($layoutId) -and $store[$layoutId].version) {
            try { $prevVersion = [int]$store[$layoutId].version } catch { $prevVersion = 0 }
          }

          $entry = @{
            layoutId = $layoutId
            allocations = $allocations
            version = ($prevVersion + 1)
            updatedAt = (Get-Date).ToString("o")
          }
          $store[$layoutId] = $entry

          $toWrite = @{ layouts = @{} }
          foreach ($k in $store.Keys) {
            $toWrite.layouts[$k] = $store[$k]
          }
          $jsonOut = $toWrite | ConvertTo-Json -Depth 12
          [IO.File]::WriteAllText($stateFile, $jsonOut, [Text.Encoding]::UTF8)

          $payload = @{ ok = $true; dados = $entry } | ConvertTo-Json -Depth 8
          $body = [Text.Encoding]::UTF8.GetBytes($payload)
          Write-HttpResponse $stream 200 "application/json; charset=utf-8" $body
          $stream.Flush()
          $client.Close()
          continue
        }

        $payload = @{ error = "Método não suportado para /api/state" } | ConvertTo-Json -Depth 4
        $body = [Text.Encoding]::UTF8.GetBytes($payload)
        Write-HttpResponse $stream 400 "application/json; charset=utf-8" $body
        $stream.Flush()
        $client.Close()
        continue
      } catch {
        $payload = @{ error = "Falha no estado compartilhado"; detail = $_.Exception.Message } | ConvertTo-Json -Depth 4
        $body = [Text.Encoding]::UTF8.GetBytes($payload)
        Write-HttpResponse $stream 500 "application/json; charset=utf-8" $body
        $stream.Flush()
        $client.Close()
        continue
      }
    }

    $file = Join-Path $root $path
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
      $body = [Text.Encoding]::UTF8.GetBytes("404 - Not found")
      Write-HttpResponse $stream 404 "text/plain; charset=utf-8" $body
      $stream.Flush()
      $client.Close()
      continue
    }

    $bytes = [IO.File]::ReadAllBytes($file)
    $ct = Get-ContentType $file
    Write-HttpResponse $stream 200 $ct $bytes
    $stream.Flush()
    $client.Close()
  } catch {
    try {
      $stream = $client.GetStream()
      $body = [Text.Encoding]::UTF8.GetBytes("500 - Internal server error")
      Write-HttpResponse $stream 500 "text/plain; charset=utf-8" $body
      $stream.Flush()
    } catch {}
    try { $client.Close() } catch {}
  }
}

