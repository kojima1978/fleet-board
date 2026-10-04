param(
  [Parameter(Mandatory = $true)][string]$ProjectDirectory,
  [string]$Destination
)

$ErrorActionPreference = "Stop"
$projectPath = [System.IO.Path]::GetFullPath($ProjectDirectory)
$environmentPath = Join-Path $projectPath ".env.production"
if ([string]::IsNullOrWhiteSpace($Destination)) {
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = "FleetFlow production backups: select a NAS, USB drive, or synchronized folder."
  if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) { exit 0 }
  $Destination = $dialog.SelectedPath
}
$Destination = [System.IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Path $Destination -Force | Out-Null
$content = [System.IO.File]::ReadAllText($environmentPath, [System.Text.Encoding]::UTF8)
$escapedDestination = $Destination.Replace("`r", "").Replace("`n", "")
$content = [regex]::Replace($content, '(?m)^FLEETFLOW_BACKUP_DESTINATION=.*$', "FLEETFLOW_BACKUP_DESTINATION=$escapedDestination")
[System.IO.File]::WriteAllText($environmentPath, $content, (New-Object System.Text.UTF8Encoding($false)))

$taskName = "FleetFlow Production Backup Sync"
$scriptPath = Join-Path $projectPath "scripts\production\Backup-And-Sync.ps1"
$arguments = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ProjectDirectory `"$projectPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $arguments
$trigger = New-ScheduledTaskTrigger -Daily -At "19:00"
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "FleetFlow production backup to external storage" -Force | Out-Null
Write-Output "Backup destination configured: $Destination"
Write-Output "Scheduled task configured: $taskName (daily at 19:00)"
