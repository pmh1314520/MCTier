param([Parameter(Mandatory = $true)][string]$TestExecutable)
$ErrorActionPreference = 'Stop'
$probeExe = [IO.Path]::GetFullPath($TestExecutable)
$probeId = [Guid]::NewGuid().ToString('N')
$probeName = 'MCTier-QuarkTest-' + $probeId
$probeRoot = Join-Path ([IO.Path]::GetTempPath()) $probeName
$probeKey = 'quark-test-' + $probeId
$probeState = Join-Path $probeRoot 'quark-test.bin'
$probeDone = Join-Path $probeRoot 'done.txt'
$probeHelper = Join-Path $probeRoot 'silent-probe.exe'
New-Item -ItemType Directory -Path $probeRoot | Out-Null
$scheduler = New-Object -ComObject Schedule.Service
$scheduler.Connect()
$folder = $scheduler.GetFolder('\')
function Invoke-Probe([string]$Mode) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $probeExe
    $start.Arguments = '--exact modules::quark_support::tests::scheduled_storage_probe --ignored --nocapture'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.EnvironmentVariables['MCTIER_TEST_QUARK_STATE'] = $probeState
    $start.EnvironmentVariables['MCTIER_TEST_QUARK_KEY'] = $probeKey
    $start.EnvironmentVariables['MCTIER_TEST_QUARK_PROBE'] = $Mode
    $process = [Diagnostics.Process]::Start($start)
    if (-not $process.WaitForExit(30000)) { $process.Kill(); throw "Probe timed out: $Mode" }
    if ($process.ExitCode -ne 0) { throw "Probe failed: $Mode" }
    $process.Dispose()
}
function Invoke-Definition([string]$Mode) {
    $start = New-Object Diagnostics.ProcessStartInfo
    $start.FileName = $probeExe
    $start.Arguments = '--exact modules::quark_scheduler::tests::native_scheduler_probe --ignored --nocapture'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.EnvironmentVariables['MCTIER_TEST_TASK_EXE'] = $probeHelper
    $start.EnvironmentVariables['MCTIER_TEST_TASK_NAME'] = $probeName
    $start.EnvironmentVariables['MCTIER_TEST_TASK_MODE'] = $Mode
    $process = [Diagnostics.Process]::Start($start)
    if (-not $process.WaitForExit(30000)) { $process.Kill(); throw 'Task configuration timed out' }
    if ($process.ExitCode -ne 0) { throw "Task configuration failed: $Mode" }
    $process.Dispose()
}
function Run-ScheduledProbe {
    if (Test-Path -LiteralPath $probeDone) { Remove-Item -LiteralPath $probeDone }
    $task = $folder.GetTask($probeName)
    $instance = $task.Run($null)
    $deadline = [DateTime]::UtcNow.AddSeconds(40)
    while (-not (Test-Path -LiteralPath $probeDone)) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Scheduled worker did not finish' }
        Start-Sleep -Milliseconds 150
    }
    if ([IO.File]::ReadAllText($probeDone).Trim() -ne '0') { throw 'Scheduled vault/storage check failed' }
    while ($task.GetInstances(0).Count -gt 0) {
        if ([DateTime]::UtcNow -gt $deadline) { throw 'Scheduled worker stayed resident' }
        Start-Sleep -Milliseconds 150
    }
    if ($task.LastTaskResult -ne 0) { throw 'Scheduler returned failure' }
}
try {
    Invoke-Probe 'seed'
    # Scheduled children do not inherit the caller's environment. A GUI-subsystem,
    # test-only native launcher passes isolated settings without a console or shell.
    $worker = @'
using System;
using System.Diagnostics;
using System.IO;
class Probe {
  static int Main() {
    var s = new ProcessStartInfo();
    s.FileName = @EXE@;
    s.Arguments = "--exact modules::quark_support::tests::scheduled_storage_probe --ignored --nocapture";
    s.UseShellExecute = false; s.CreateNoWindow = true;
    s.EnvironmentVariables["MCTIER_TEST_QUARK_STATE"] = @STATE@;
    s.EnvironmentVariables["MCTIER_TEST_QUARK_KEY"] = @KEY@;
    s.EnvironmentVariables["MCTIER_TEST_QUARK_PROBE"] = "worker";
    var p = Process.Start(s);
    long peak = 0; bool window = false;
    while (!p.WaitForExit(10)) {
      p.Refresh();
      if (!p.HasExited) { peak = Math.Max(peak, p.WorkingSet64); window |= p.MainWindowHandle != IntPtr.Zero; }
    }
    File.AppendAllText(@METRICS@, "peakBytes=" + peak + ", cpuMs=" + p.TotalProcessorTime.TotalMilliseconds + ", window=" + window + Environment.NewLine);
    File.WriteAllText(@DONE@, (window ? 2 : p.ExitCode).ToString());
    return window ? 2 : p.ExitCode;
  }
}
'@
    function CSharp-Literal([string]$Value) { return '@"' + $Value.Replace('"', '""') + '"' }
    $probeMetrics = Join-Path $probeRoot 'metrics.txt'
    $worker = $worker.Replace('@EXE@', (CSharp-Literal $probeExe)).Replace('@STATE@', (CSharp-Literal $probeState)).Replace('@KEY@', (CSharp-Literal $probeKey)).Replace('@DONE@', (CSharp-Literal $probeDone)).Replace('@METRICS@', (CSharp-Literal $probeMetrics))
    $probeCode = Join-Path $probeRoot 'probe.cs'
    [IO.File]::WriteAllText($probeCode, $worker)
    & "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe "/out:$probeHelper" $probeCode
    if ($LASTEXITCODE -ne 0) { throw 'Unable to compile silent test worker' }
    Invoke-Definition 'ensure'
    Invoke-Definition 'ensure' # Registration is idempotent, no duplicate job.
    $definition = $folder.GetTask($probeName).Definition
    if ($definition.Principal.LogonType -ne 3 -or $definition.Principal.RunLevel -ne 0) { throw 'Wrong user context' }
    if ($definition.Settings.Priority -ne 10 -or -not $definition.Settings.Hidden) { throw 'Wrong background settings' }
    if ($definition.Triggers.Count -ne 2 -or $definition.Triggers.Item(2).Repetition.Interval) { throw 'Unexpected repeated wakeups' }
    Run-ScheduledProbe
    Invoke-Probe 'verify' # GUI-side read sees the successful scheduled save.
    Run-ScheduledProbe # Repeated task cannot submit a second save today.
    if ([IO.File]::ReadAllLines([IO.Path]::ChangeExtension($probeState, 'submissions')).Count -ne 1) { throw 'Duplicate transfer' }
    Invoke-Probe 'logout'
    Run-ScheduledProbe
    Invoke-Probe 'verify_logout'
    if ([IO.File]::ReadAllLines([IO.Path]::ChangeExtension($probeState, 'submissions')).Count -ne 1) { throw 'Transfer continued after logout' }
    Invoke-Definition 'remove'
    if (@($folder.GetTasks(1) | Where-Object Name -EQ $probeName).Count -ne 0) { throw 'Task removal failed' }
    Write-Output 'PASS: real scheduler registration/update/run/removal; same-user vault decryption; shared encrypted statistics; daily deduplication; logout; process exit.'
    Get-Content -LiteralPath $probeMetrics
} finally {
    foreach ($task in @($folder.GetTasks(1))) {
        if ($task.Name -eq $probeName) { $task.Stop(0); $folder.DeleteTask($probeName, 0) }
    }
    Invoke-Probe 'cleanup'
    $resolvedProbe = [IO.Path]::GetFullPath($probeRoot)
    $expectedProbe = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) $probeName))
    if ($resolvedProbe -ne $expectedProbe -or -not $probeName.StartsWith('MCTier-QuarkTest-')) { throw 'Unsafe cleanup path' }
    Remove-Item -LiteralPath $resolvedProbe -Recurse -Force
}
