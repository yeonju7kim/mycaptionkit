$ErrorActionPreference = 'Stop'

try {
  $desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)
  if ([string]::IsNullOrWhiteSpace($desktopPath)) {
    throw 'Windows could not find the Desktop folder.'
  }

  $shortcutPath = Join-Path $desktopPath 'AI Translator.lnk'
  if (Test-Path -LiteralPath $shortcutPath) {
    exit 0
  }

  $launcherPath = Join-Path $PSScriptRoot 'start-captionkit.cmd'
  $iconPath = Join-Path $PSScriptRoot 'public\ai-translator.ico'
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = $launcherPath
  $shortcut.WorkingDirectory = $PSScriptRoot
  $shortcut.IconLocation = "$iconPath,0"
  $shortcut.Description = 'Start AI Translator'
  $shortcut.WindowStyle = 1
  $shortcut.Save()

  Write-Host 'Desktop shortcut created: AI Translator'
} catch {
  Write-Warning "Could not create the AI Translator desktop shortcut: $($_.Exception.Message)"
}
