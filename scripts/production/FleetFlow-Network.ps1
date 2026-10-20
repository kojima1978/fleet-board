function Get-FleetFlowEnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Name))=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -split "=", 2)[1].Trim()
}

function Set-FleetFlowEnvironmentValue {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Value
  )

  $content = if (Test-Path -LiteralPath $Path) { [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8).TrimEnd() } else { "" }
  $line = "$Name=$Value"
  if ($content -match "(?m)^$([regex]::Escape($Name))=") {
    $content = [regex]::Replace($content, "(?m)^$([regex]::Escape($Name))=.*$", $line)
  }
  else {
    $content += [Environment]::NewLine + $line
  }
  [System.IO.File]::WriteAllText($Path, $content + [Environment]::NewLine, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-FleetFlowAppUrl {
  param(
    [Parameter(Mandatory = $true)][string]$EnvironmentPath,
    [switch]$Development,
    [string]$Path = "/"
  )

  $addressName = if ($Development) { "FLEETFLOW_DEV_BIND_ADDRESS" } else { "FLEETFLOW_BIND_ADDRESS" }
  $address = [Environment]::GetEnvironmentVariable($addressName)
  if ([string]::IsNullOrWhiteSpace($address)) { $address = Get-FleetFlowEnvironmentValue -Path $EnvironmentPath -Name $addressName }
  if ([string]::IsNullOrWhiteSpace($address) -or $address -eq "0.0.0.0") { $address = "127.0.0.1" }
  $port = if ($Development) { "3035" } else { [Environment]::GetEnvironmentVariable("FLEETFLOW_PORT") }
  if (-not $Development -and [string]::IsNullOrWhiteSpace($port)) { $port = Get-FleetFlowEnvironmentValue -Path $EnvironmentPath -Name "FLEETFLOW_PORT" }
  if ($port -notmatch '^\d{2,5}$' -or [int]$port -gt 65535) { $port = "3035" }
  if (-not $Path.StartsWith("/")) { $Path = "/$Path" }

  $parsedAddress = $null
  if ([System.Net.IPAddress]::TryParse($address, [ref]$parsedAddress) -and $parsedAddress.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) {
    $address = "[$address]"
  }
  return "http://${address}:$port$Path"
}

function Test-FleetFlowPrivateIPv4 {
  param([Parameter(Mandatory = $true)][string]$Address)

  $parsed = $null
  if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$parsed)) { return $false }
  if ($parsed.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { return $false }
  $bytes = $parsed.GetAddressBytes()
  return $bytes[0] -eq 10 -or
    ($bytes[0] -eq 172 -and $bytes[1] -ge 16 -and $bytes[1] -le 31) -or
    ($bytes[0] -eq 192 -and $bytes[1] -eq 168)
}

function Wait-FleetFlowLocalAddress {
  param(
    [Parameter(Mandatory = $true)][string]$Address,
    [int]$TimeoutSeconds = 300,
    [int]$IntervalSeconds = 5
  )

  # Docker cannot publish a port on an address the PC does not have yet, so wait for it after sign-in.
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ($true) {
    if (Get-NetIPAddress -IPAddress $Address -AddressState Preferred -ErrorAction SilentlyContinue) { return $true }
    if ((Get-Date) -ge $deadline) { return $false }
    Start-Sleep -Seconds $IntervalSeconds
  }
}

function Test-FleetFlowPublicNetwork {
  param([Parameter(Mandatory = $true)][string]$Address)

  # The firewall rule covers Private/Domain only, so other PCs cannot connect while this LAN is Public.
  $ipAddress = Get-NetIPAddress -IPAddress $Address -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $ipAddress) { return $false }
  $connectionProfile = Get-NetConnectionProfile -InterfaceIndex $ipAddress.InterfaceIndex -ErrorAction SilentlyContinue | Select-Object -First 1
  return [bool]($connectionProfile -and $connectionProfile.NetworkCategory -eq "Public")
}

function Get-FleetFlowNetworkCidr {
  param(
    [Parameter(Mandatory = $true)][string]$Address,
    [Parameter(Mandatory = $true)][ValidateRange(1, 32)][int]$PrefixLength
  )

  $bytes = ([System.Net.IPAddress]::Parse($Address)).GetAddressBytes()
  $remaining = $PrefixLength
  for ($index = 0; $index -lt 4; $index++) {
    $bits = [Math]::Min(8, [Math]::Max(0, $remaining))
    $mask = if ($bits -eq 0) { 0 } else { (0xff -shl (8 - $bits)) -band 0xff }
    $bytes[$index] = $bytes[$index] -band $mask
    $remaining -= $bits
  }
  return "$([System.Net.IPAddress]::new($bytes).ToString())/$PrefixLength"
}
