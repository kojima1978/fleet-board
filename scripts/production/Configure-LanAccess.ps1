param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [string]$Address,
  [switch]$Development,
  [switch]$NoFirewall,
  [switch]$NoRestart,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath $(if ($Development) { ".env" } else { ".env.production" })
$composePath = Join-Path $projectPath $(if ($Development) { "compose.yaml" } else { "compose.production.yaml" })
$addressName = if ($Development) { "FLEETFLOW_DEV_BIND_ADDRESS" } else { "FLEETFLOW_BIND_ADDRESS" }
$modeName = if ($Development) { "開発" } else { "本番" }
. (Join-Path $PSScriptRoot "FleetFlow-Network.ps1")

function Show-Result([string]$Message, [string]$Title = "FleetFlow LAN設定") {
  if ($NoUi) { Write-Output $Message; return }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, $Title) | Out-Null
}

function Test-Administrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

try {
  if (-not $Development -and -not (Test-Path -LiteralPath $environmentPath)) { throw "先に FleetFlow Production Start.cmd を実行してください。" }
  if (-not (Test-Path -LiteralPath $composePath)) { throw "$composePath が見つかりません。" }

  if (-not $NoFirewall -and -not (Test-Administrator)) {
    $arguments = @(
      "-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ('"{0}"' -f $PSCommandPath),
      "-ProjectDirectory", ('"{0}"' -f $projectPath)
    )
    if (-not [string]::IsNullOrWhiteSpace($Address)) { $arguments += @("-Address", $Address) }
    if ($NoRestart) { $arguments += "-NoRestart" }
    if ($Development) { $arguments += "-Development" }
    if ($NoUi) { $arguments += "-NoUi" }
    $process = Start-Process -FilePath "powershell.exe" -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    exit $process.ExitCode
  }

  $candidates = @(Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction Stop | Where-Object {
    $_.IPAddress -notlike "127.*" -and
    $_.IPAddress -notlike "169.254.*" -and
    $_.InterfaceAlias -notmatch "vEthernet|Loopback|WSL|Docker" -and
    (Test-FleetFlowPrivateIPv4 $_.IPAddress)
  })

  if ([string]::IsNullOrWhiteSpace($Address)) {
    $defaultRoutes = @(Get-NetRoute -AddressFamily IPv4 -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Sort-Object RouteMetric, InterfaceMetric)
    foreach ($route in $defaultRoutes) {
      $selected = $candidates | Where-Object { $_.InterfaceIndex -eq $route.InterfaceIndex } | Select-Object -First 1
      if ($selected) { $Address = $selected.IPAddress; break }
    }
    if ([string]::IsNullOrWhiteSpace($Address) -and $candidates.Count -eq 1) { $Address = $candidates[0].IPAddress }
    if ([string]::IsNullOrWhiteSpace($Address)) { throw "利用する固定LAN IPv4アドレスを -Address で指定してください。" }
  }

  if (-not (Test-FleetFlowPrivateIPv4 $Address)) { throw "社内LAN用のプライベートIPv4アドレス（10.x、172.16-31.x、192.168.x）を指定してください。" }
  $selectedAddress = $candidates | Where-Object { $_.IPAddress -eq $Address } | Select-Object -First 1
  if (-not $selectedAddress) { throw "$Address はこのPCの有効なLANアドレスではありません。固定IP設定を確認してください。" }

  $port = if ($Development) { "3035" } else { Get-FleetFlowEnvironmentValue -Path $environmentPath -Name "FLEETFLOW_PORT" }
  if ($port -notmatch '^\d{2,5}$' -or [int]$port -gt 65535) { throw "FLEETFLOW_PORT が正しくありません。" }
  $networkCidr = Get-FleetFlowNetworkCidr -Address $Address -PrefixLength $selectedAddress.PrefixLength
  $overrideAddress = [Environment]::GetEnvironmentVariable($addressName)
  if ($overrideAddress -and $overrideAddress -ne $Address) { throw "$addressName が環境変数で上書きされています。環境変数を解除してから再実行してください。" }

  if (-not $NoFirewall) {
    $ruleName = "FleetFlow LAN (TCP $port)"
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -DisplayName $ruleName -Group "FleetFlow" -Direction Inbound -Action Allow `
      -Protocol TCP -LocalPort $port -LocalAddress $Address -RemoteAddress $networkCidr -Profile Private,Domain | Out-Null
  }

  Set-FleetFlowEnvironmentValue -Path $environmentPath -Name $addressName -Value $Address
  $appUrl = Get-FleetFlowAppUrl -EnvironmentPath $environmentPath -Development:$Development
  $restartMessage = "次回の${modeName}起動から設定が反映されます。"

  if (-not $NoRestart -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    $composeArguments = @("compose", "--project-directory", $projectPath, "--env-file", $environmentPath, "-f", $composePath)
    $containerId = (& docker @composeArguments ps -q app 2>$null | Select-Object -First 1)
    $containerRunning = if ($containerId) { (& docker inspect --format '{{.State.Running}}' $containerId 2>$null | Select-Object -First 1) } else { "false" }
    if ($containerRunning -eq "true") {
      & docker @composeArguments up -d --no-deps --force-recreate app
      if ($LASTEXITCODE -ne 0) { throw "設定は保存しましたが、${modeName}アプリの再起動に失敗しました。${modeName}用の起動コマンドを実行してください。" }
      $restartMessage = "稼働中のアプリを新しい設定で再起動しました。"
    }
  }

  $firewallMessage = if ($NoFirewall) { "Windowsファイアウォール規則は変更していません。" } else { "Windowsファイアウォールは $networkCidr からのTCP $portだけを許可しました。" }
  Show-Result @"
${modeName}環境のLANアクセスを設定しました。

接続URL: $appUrl
$firewallMessage
$restartMessage

別PCのブラウザーで上記URLを開いてください。
NFCを使う場合は、そのPCのNFC BridgeにもこのURLを許可Originとして設定してください。
"@
  exit 0
}
catch {
  Show-Result ("LANアクセスを設定できませんでした。`n`n" + $_.Exception.Message) "FleetFlow LAN設定エラー"
  exit 1
}
