$ErrorActionPreference = "Stop"
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$speaker = New-Object -ComObject SAPI.SpVoice

function Get-Voices {
    $tokens = $speaker.GetVoices()
    $voices = for ($i = 0; $i -lt $tokens.Count; $i++) {
        $token = $tokens.Item($i)
        [pscustomobject]@{
            id = $token.Id
            name = $token.GetDescription()
            language = $(try { $token.GetAttribute("Language") } catch { "" })
            vendor = $(try { $token.GetAttribute("Vendor") } catch { "" })
        }
    }
    return @($voices)
}

function Send-Message($value) {
    [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 5))
    [Console]::Out.Flush()
}

Send-Message @{
    type = "ready"
    voices = @(Get-Voices)
}

while (($line = [Console]::In.ReadLine()) -ne $null) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $command = $null
    try {
        $command = $line | ConvertFrom-Json
        if ($command.type -eq "list") {
            Send-Message @{ type = "voices"; voices = @(Get-Voices) }
            continue
        }
        if ($command.type -ne "speak") { continue }

        $tokens = $speaker.GetVoices()
        $selected = $null
        for ($i = 0; $i -lt $tokens.Count; $i++) {
            $token = $tokens.Item($i)
            if ($token.Id -eq [string]$command.voice -or $token.GetDescription() -eq [string]$command.voice) {
                $selected = $token
                break
            }
        }
        if ($selected) { $speaker.Voice = $selected }

        $rate = [double]$command.rate
        if ([double]::IsNaN($rate) -or [double]::IsInfinity($rate)) { $rate = 1 }
        $speaker.Rate = [Math]::Max(-10, [Math]::Min(10, [Math]::Round(($rate - 1) * 5)))
        $speaker.Volume = 100

        $timer = [Diagnostics.Stopwatch]::StartNew()
        $null = $speaker.Speak([string]$command.text)
        $timer.Stop()
        Send-Message @{
            type = "done"
            id = [string]$command.id
            elapsedMs = [Math]::Round($timer.Elapsed.TotalMilliseconds)
        }
    } catch {
        Send-Message @{
            type = "error"
            id = if ($command) { [string]$command.id } else { "" }
            error = $_.Exception.Message
        }
    }
}
