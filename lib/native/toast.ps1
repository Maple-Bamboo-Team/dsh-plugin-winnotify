$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    $message = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $appId = 'WinNotify.DeepSeekHarness'
    $registryPath = 'Software\Classes\AppUserModelId\' + $appId
    $assetDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'WinNotify\assets'
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null
    if ($message.action -eq 'unregister') {
        [Windows.UI.Notifications.ToastNotificationManager]::History.Clear($appId)
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($registryPath, $false)
        # Remove only the two assets owned by this application identity.
        foreach ($file in @('deepseek-harness-black.png', 'deepseek-harness.ico')) {
            $path = Join-Path $assetDir $file
            if ([System.IO.File]::Exists($path)) { [System.IO.File]::Delete($path) }
        }
        exit 0
    }
    if ($message.action -ne 'show') { throw 'Unknown WinNotify action.' }
    if ([string]::IsNullOrWhiteSpace($message.title) -or $message.body -isnot [string]) { throw 'Missing notification text.' }
    [System.IO.Directory]::CreateDirectory($assetDir) | Out-Null
    $icon = Join-Path $assetDir 'deepseek-harness-black.png'
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\assets\deepseek-harness-64.png') -Destination $icon -Force
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\assets\deepseek-harness.ico') -Destination (Join-Path $assetDir 'deepseek-harness.ico') -Force
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($registryPath)
    try {
        $key.SetValue('DisplayName', 'DeepSeek Harness', [Microsoft.Win32.RegistryValueKind]::String)
        $key.SetValue('IconUri', $icon, [Microsoft.Win32.RegistryValueKind]::String)
        $key.SetValue('IconBackgroundColor', '00000000', [Microsoft.Win32.RegistryValueKind]::String)
    } finally { $key.Dispose() }
    $document = [System.Xml.XmlDocument]::new()
    $document.LoadXml('<toast><visual><binding template="ToastGeneric"><text/><text/></binding></visual></toast>')
    $texts = $document.SelectNodes('//text')
    $texts[0].InnerText = $message.title
    $texts[1].InnerText = $message.body
    if ($message.url) {
        $uri = [Uri]$message.url
        if ($uri.Scheme -notin @('http', 'https')) { throw 'Notification URL must be HTTP(S).' }
        $document.DocumentElement.SetAttribute('activationType', 'protocol')
        $document.DocumentElement.SetAttribute('launch', $uri.AbsoluteUri)
    }
    if ($message.sound -eq $false) {
        $audio = $document.CreateElement('audio')
        $audio.SetAttribute('silent', 'true')
        $document.DocumentElement.AppendChild($audio) | Out-Null
    }
    $xml = [Windows.Data.Xml.Dom.XmlDocument]::new()
    $xml.LoadXml($document.OuterXml)
    $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
    $toast.Tag = $message.tag
    $toast.Group = 'winnotify'
    $toast.ExpirationTime = [DateTimeOffset]::Now.AddHours(1)
    $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
    $notifier.Show($toast)
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
