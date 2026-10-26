param([string]$BaseUrl = 'http://127.0.0.1:3041')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$directory = Join-Path ([System.IO.Path]::GetTempPath()) ('fleetflow-setup-test-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $directory | Out-Null
try {
  $headers = @{ Host = '192.168.0.134:3035' }
  $url = $BaseUrl.TrimEnd('/') + '/api/scanner/setup'
  $head = Invoke-WebRequest -Uri $url -Method Head -Headers $headers -UseBasicParsing -TimeoutSec 45
  if ($head.StatusCode -ne 200) { throw 'Download endpoint failed' }
  $name = [regex]::Match([string]$head.Headers['Content-Disposition'], 'filename="([A-Za-z0-9_.-]+)"').Groups[1].Value
  if (-not $name) { throw 'Unsafe or missing download filename' }
  $encoded = $name.Substring('FleetFlow-Setup-'.Length).Replace('.exe', '').Replace('-', '+').Replace('_', '/')
  $encoded = $encoded.PadRight([int]([math]::Ceiling($encoded.Length / 4.0) * 4), '=')
  $origin = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($encoded))
  if ($origin -ne 'http://192.168.0.134:3035') { throw 'Download filename lost server origin' }
  $exe = Join-Path $directory $name
  Invoke-WebRequest -Uri $url -Headers $headers -UseBasicParsing -OutFile $exe -TimeoutSec 60
  if ((Get-Item -LiteralPath $exe).Length -ne [long]$head.Headers['Content-Length']) { throw 'Download length mismatch' }
  foreach ($suffix in @('', ' (1)')) {
    $path = $exe
    if ($suffix) {
      $path = Join-Path $directory ($name.Replace('.exe', $suffix + '.exe'))
      Copy-Item -LiteralPath $exe -Destination $path
    }
    $process = Start-Process -FilePath $path -ArgumentList '--verify-only' -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne 0) { throw "Setup verification failed: $($process.ExitCode)" }
  }
  $invalid = Join-Path $directory 'FleetFlow-Setup-invalid.exe'
  Copy-Item -LiteralPath $exe -Destination $invalid
  $process = Start-Process -FilePath $invalid -ArgumentList '--verify-only' -WindowStyle Hidden -PassThru -Wait
  if ($process.ExitCode -ne 1) { throw 'Installer accepted an invalid application URL' }
  Write-Host "Setup download and Windows verification passed ($((Get-Item $exe).Length) bytes). No installation or registry changes were performed."
}
finally {
  $resolved = [System.IO.Path]::GetFullPath($directory)
  $temporary = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
  if ($resolved.StartsWith($temporary, [System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolved -Leaf) -like 'fleetflow-setup-test-*') {
    Remove-Item -LiteralPath $resolved -Recurse -Force
  }
}
