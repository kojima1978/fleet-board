param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [string]$TaskName = "FleetFlow Production Autostart",
  [switch]$Remove,
  [switch]$NoUi
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath ".env.production"
$messagesPath = Join-Path $projectPath "nfc-bridge\messages.ja.json"
$messages = ConvertFrom-Json ([System.IO.File]::ReadAllText($messagesPath, [System.Text.Encoding]::UTF8))

function Show-Result([string]$Message) {
  if ($NoUi) { Write-Output $Message; return }
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($Message, $messages.autostartSetupTitle) | Out-Null
}

try {
  if ($Remove) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Show-Result $messages.autostartRemoved
    exit 0
  }
  if (-not (Test-Path -LiteralPath $environmentPath)) { throw $messages.autostartNotInitialized }

  # Docker Desktop runs only inside a signed-in session, so start at this user's sign-in rather than at boot.
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $scriptPath = Join-Path $projectPath "scripts\production\Start-ProductionAtLogon.ps1"
  $arguments = "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectDirectory `"$projectPath`""
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments -WorkingDirectory $projectPath
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Start FleetFlow production after the LAN address and Docker Desktop are ready" -Force | Out-Null
  Show-Result $messages.autostartRegistered
  exit 0
}
catch {
  Show-Result ($messages.autostartSetupFailed + [Environment]::NewLine + [Environment]::NewLine + $_.Exception.Message)
  exit 1
}
