$ErrorActionPreference = "Stop"

$id = "204379"
$u = "https://dadosabertos.camara.leg.br/api/v2/deputados/$id"

$null = Add-Type -AssemblyName System.Net.Http

$handler = New-Object System.Net.Http.HttpClientHandler
$handler.UseProxy = $false
$client = New-Object System.Net.Http.HttpClient($handler)

$json = $client.GetStringAsync($u).GetAwaiter().GetResult()
$obj = $json | ConvertFrom-Json

$dados = $obj.dados

"Keys (dados):"
if ($dados -is [System.Array]) {
  $dados[0].psobject.Properties.Name | Select-Object -First 120
} else {
  $dados.psobject.Properties.Name | Select-Object -First 120
}

"---"
"Contains word 'lider' in JSON?"
if ($json -match "(?i)lider") { "YES" } else { "NO" }

"---"
"Contains 'vice' in JSON?"
if ($json -match "(?i)vice") { "YES" } else { "NO" }

"---"
"Sample snippet (first 600 chars):"
$len = [Math]::Min(600, $json.Length)
$json.Substring(0, $len)

