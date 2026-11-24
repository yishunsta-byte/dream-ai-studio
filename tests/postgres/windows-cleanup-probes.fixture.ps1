param([Parameter(Mandatory=$true)][string]$CollectorSource)
# Fixture execution only. The collector is loaded from supplied text; no file or
# live provider reads occur here. All collector calls receive invoker and clock.
$script:B51Forbidden=0;$script:B51ProcessOperations=0;$script:B51LiveBoundaryCalls=0;$script:B51DefaultClockCalls=0;$script:B51Cases=@()
function Get-Process { $script:B51Forbidden++;throw 'Live Get-Process forbidden' }
function Get-CimInstance { $script:B51Forbidden++;throw 'Live CIM forbidden' }
function Get-NetTCPConnection { $script:B51Forbidden++;throw 'Live TCP forbidden' }
function Test-Path { $script:B51Forbidden++;throw 'Live Test-Path forbidden' }
function Start-Process { $script:B51ProcessOperations++;throw 'Target process operation forbidden' }
function Stop-Process { $script:B51ProcessOperations++;throw 'Target process operation forbidden' }
function Assert-B51 {
    param([bool]$Condition,[string]$Label)
    if(-not $Condition){throw ('Fixture assertion: '+$Label)}
}
function Case-B51 {
    param([string]$Name,[scriptblock]$Test)
    & $Test
    $script:B51Cases += $Name
}
function Assert-B51CimProjectionContract {
    param([string]$Source)
    $t=$null;$e=$null
    $a=[System.Management.Automation.Language.Parser]::ParseInput($Source,[ref]$t,[ref]$e)
    Assert-B51 ($e.Count -eq 0) 'CIM contract parses'
    $cims=@($a.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst] -and $n.GetCommandName() -ceq 'Get-CimInstance'},$true))
    Assert-B51 ($cims.Count -eq 1) 'exactly one literal CIM request'
    $c=$cims[0];$owner=$c.Parent
    while($null -ne $owner -and $owner -isnot [System.Management.Automation.Language.FunctionDefinitionAst]){$owner=$owner.Parent}
    Assert-B51 ($null -ne $owner -and $owner.Name -ceq 'Invoke-B51WindowsProvider') 'CIM request in default provider only'
    $live=@($owner.Body.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]},$true))
    Assert-B51 ($live.Count -eq 4 -and (($live | ForEach-Object {$_.GetCommandName()}) -join ',') -ceq 'Get-Process,Get-CimInstance,Get-NetTCPConnection,Test-Path') 'no extra or dynamic default provider query'
    $parts=$c.CommandElements
    Assert-B51 ($parts.Count -eq 11 -and $c.InvocationOperator -eq 'Unknown') 'fixed unsplatted CIM command shape'
    $parameters=@('ClassName','Property','Filter','ErrorAction','ErrorVariable')
    for($i=0;$i -lt $parameters.Count;$i++) {
        $p=$parts[1+2*$i]
        Assert-B51 ($p -is [System.Management.Automation.Language.CommandParameterAst] -and $p.ParameterName -ceq $parameters[$i] -and $null -eq $p.Argument) 'exact CIM parameters, no Query/splat/abbreviation'
    }
    Assert-B51 ($parts[2] -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $parts[2].Value -ceq 'Win32_Process') 'fixed CIM class'
    Assert-B51 ($parts[4] -is [System.Management.Automation.Language.ArrayLiteralAst] -and $parts[4].Elements.Count -eq 4) 'explicit four-field array'
    $fields=@('ProcessId','Name','CreationDate','ExecutablePath')
    for($i=0;$i -lt $fields.Count;$i++) {
        $p=$parts[4].Elements[$i]
        Assert-B51 ($p -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $p.Value -ceq $fields[$i]) 'exact literal safe fields; no CommandLine or wildcard'
    }
    Assert-B51 ($parts[6] -is [System.Management.Automation.Language.ParenExpressionAst] -and $parts[6].Extent.Text -ceq '(''ProcessId=''+$Request.Target)') 'numeric bound PID filter expression'
    Assert-B51 ($parts[8] -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $parts[8].Value -ceq 'SilentlyContinue') 'native error display suppression retained'
    Assert-B51 ($parts[10] -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $parts[10].Value -ceq '+nativeErrors') 'append native error capture retained'
}

$tokens=$null;$parseErrors=$null
$ast=[System.Management.Automation.Language.Parser]::ParseInput($CollectorSource,[ref]$tokens,[ref]$parseErrors)
Assert-B51 ($parseErrors.Count -eq 0) 'collector parses'
Assert-B51 (@($ast.EndBlock.Statements | Where-Object {$_ -isnot [System.Management.Automation.Language.FunctionDefinitionAst]}).Count -eq 0) 'load contains function definitions only'
$forbidden=@('Start-Process','Stop-Process','Remove-Item','Set-Content','Add-Content','Invoke-Expression','Start-Sleep')
$commands=@($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]},$true))
Assert-B51 (@($commands | Where-Object {$_.GetCommandName() -in $forbidden}).Count -eq 0) 'no mutation/process/retry commands'
. ([scriptblock]::Create($CollectorSource))
Assert-B51 ($script:B51Forbidden -eq 0) 'load has zero live provider calls'
$script:B51OriginalClock=${function:Get-B51Clock}
function Get-B51Clock {
    param([object]$Context,[scriptblock]$Clock)
    if($null -eq $Clock){$script:B51DefaultClockCalls++;throw 'Default SystemClock forbidden in fixture'}
    return & $script:B51OriginalClock $Context $Clock
}
function Invoke-B51WindowsProvider {
    param([object]$Request)
    $script:B51LiveBoundaryCalls++
    throw 'Default live invoker forbidden in fixture'
}
Case-B51 'default CIM AST requests exactly four approved properties with fixed PID and error contract' {
    Assert-B51CimProjectionContract $CollectorSource
}
$projection='-Property ProcessId,Name,CreationDate,ExecutablePath'
$mutants=@(
    [pscustomobject]@{Name='missing projection';Text=$CollectorSource.Replace($projection+' ','')},
    [pscustomobject]@{Name='CommandLine added';Text=$CollectorSource.Replace($projection,$projection+',CommandLine')},
    [pscustomobject]@{Name='wildcard projection';Text=$CollectorSource.Replace($projection,'-Property *')},
    [pscustomobject]@{Name='dynamic projection';Text=$CollectorSource.Replace($projection,'-Property $fields')},
    [pscustomobject]@{Name='broad Query alternative';Text=$CollectorSource.Replace('-ClassName Win32_Process '+$projection,'-Query ''SELECT * FROM Win32_Process''')},
    [pscustomobject]@{Name='second CIM request';Text=$CollectorSource+"`nfunction Extra-B51Cim { Get-CimInstance -ClassName Win32_Process }"},
    [pscustomobject]@{Name='different class';Text=$CollectorSource.Replace('-ClassName Win32_Process','-ClassName Win32_OperatingSystem')},
    [pscustomobject]@{Name='unbound PID filter';Text=$CollectorSource.Replace('(''ProcessId=''+$Request.Target)','(''ProcessId=101'')')}
)
foreach($mutation in $mutants) {
    Case-B51 ('CIM AST rejects '+$mutation.Name) {
        Assert-B51 ($mutation.Text -cne $CollectorSource) 'mutation actually changes source'
        $blocked=$false;try{Assert-B51CimProjectionContract $mutation.Text}catch{$blocked=$true}
        Assert-B51 $blocked 'mutant rejected without executing it'
    }
}

function New-B51Fixture {
    $ctx=New-WindowsCleanupProbeContext -HostId 'fixture-host' -AttemptId 'fixture-attempt' -OriginId 'fixture-origin' `
        -OriginTicks ([long]0) -Frequency ([long]1000) -Pids @(101,102) -Port 62001 -ClusterPath 'D:\fixture\cluster'
    $state=@{Tick=[long]0;ClockCalls=0;Mode='empty';ClockMode='normal';SensitiveReads=0;Requests=[Collections.Generic.List[object]]::new()}
    $state.NativeError=[System.Management.Automation.ErrorRecord]::new([UnauthorizedAccessException]::new('password=DO_NOT_EXPOSE_TOKEN'),
        'FixtureAccessDenied',[System.Management.Automation.ErrorCategory]::PermissionDenied,$null)
    $clock={
        param($c)
        $state.ClockCalls++;$state.Tick++
        if($state.ClockMode -eq 'throw' -or ($state.ClockMode -eq 'query-end-throw' -and $state.ClockCalls -eq 2)){throw 'clock secret=DO_NOT_EXPOSE_TOKEN'}
        $tick=$state.Tick;$hostName=$c.HostId;$frequency=$c.Frequency;$origin=$c.OriginId
        if($state.ClockMode -eq 'wrong-host'){$hostName='other-host'}
        if($state.ClockMode -eq 'wrong-frequency'){$frequency=[long]999}
        if($state.ClockMode -eq 'wrong-origin'){$origin='other-origin'}
        if($state.ClockMode -eq 'reverse' -and $state.ClockCalls -eq 2){$tick=[long]0}
        $utc='2026-01-01T00:00:01.0000000+00:00'
        if($state.ClockMode -eq 'utc-reverse' -and $state.ClockCalls -eq 2){$utc='2026-01-01T00:00:00.0000000+00:00'}
        if($state.ClockMode -eq 'invalid-utc'){$utc='not-a-time'}
        [pscustomobject]@{Utc=$utc;Ticks=[long]$tick;Frequency=[long]$frequency;HostId=$hostName;AttemptId=$c.AttemptId;OriginId=$origin}
    }.GetNewClosure()
    $invoke={
        param($r)
        $state.Requests.Add($r)
        if($state.Mode -eq 'throw'){throw 'provider secret=DO_NOT_EXPOSE_TOKEN'}
        $rows=@();$errors=@();$scalar=$null;$scalarPresent=($r.Provider -eq 'TestPath')
        if($scalarPresent){$scalar=$false}
        if($state.Mode -in @('positive','partial','wrong-pid','positive-error','bad-time','native-unsigned','row-limit')) {
            if($r.Provider -in @('GetProcess','CIM')) {
                $number=[int]$r.Target;if($state.Mode -eq 'wrong-pid'){$number=999}
                $start=[DateTime]::SpecifyKind([DateTime]::Parse('2026-01-01T00:00:00'),[DateTimeKind]::Utc)
                $row=[pscustomobject]@{Id=$number;ProcessName='fixture-process';StartTime=$start;Path='D:\fixture\postgres.exe';
                    ProcessId=$number;Name='fixture-process';CreationDate=$start;ExecutablePath='D:\fixture\postgres.exe'}
                $deny={ $state.SensitiveReads++;throw 'sensitive property must not be read' }.GetNewClosure()
                $row | Add-Member -MemberType ScriptProperty -Name CommandLine -Value $deny
                $row | Add-Member -MemberType ScriptProperty -Name Environment -Value $deny
                if($state.Mode -eq 'partial') {
                    $name=$(if($r.Provider -eq 'GetProcess'){'Path'}else{'ExecutablePath'})
                    $row.PSObject.Properties.Remove($name)
                    $bad={throw [UnauthorizedAccessException]::new('secret=DO_NOT_EXPOSE_TOKEN')}
                    $row | Add-Member -MemberType ScriptProperty -Name $name -Value $bad
                }
                if($state.Mode -eq 'bad-time'){$row.StartTime='unverified time string';$row.CreationDate='unverified time string'}
                if($state.Mode -eq 'native-unsigned'){$row.ProcessId=[uint32]$number}
                $rows=@($row)
                if($state.Mode -eq 'row-limit'){$rows=@($row)*129}
            } elseif($r.Provider -eq 'TCP') {
                $rows=@([pscustomobject]@{LocalAddress='127.0.0.1';LocalPort=[int]$r.Target;OwningProcess=101})
                if($state.Mode -eq 'native-unsigned'){$rows[0].LocalPort=[uint16]$r.Target;$rows[0].OwningProcess=[uint32]101}
            } else { $scalar=$true;$rows=@([pscustomobject]@{Path=$r.Target;Exists=$true}) }
        }
        if($state.Mode -in @('query-error','positive-error','no-match')) {
            $e=$state.NativeError
            if($state.Mode -eq 'no-match'){$e=[System.Management.Automation.ErrorRecord]::new([InvalidOperationException]::new('No process'),
                'NoProcessFoundForGivenId',[System.Management.Automation.ErrorCategory]::ObjectNotFound,$null)}
            $errors=@([pscustomobject]@{Channel='ErrorVariable';Record=$e})
        }
        if($state.Mode -eq 'invalid-scalar' -and $scalarPresent){$scalar='secret=DO_NOT_EXPOSE_TOKEN'}
        $done=$true;if($state.Mode -eq 'incomplete'){$done=$false}
        [pscustomobject]@{Completed=$done;Rows=[object[]]$rows;Errors=[object[]]$errors;ScalarPresent=$scalarPresent;Scalar=$scalar}
    }.GetNewClosure()
    return [pscustomobject]@{Context=$ctx;State=$state;Clock=$clock;Invoker=$invoke}
}
function Cleanup-B51Fixture {
    param($Fixture)
    return Get-WindowsCleanupCurrentRaw -Context $Fixture.Context -StartupContext $Fixture.Context -Invoker $Fixture.Invoker -Clock $Fixture.Clock
}

Case-B51 'load and context construction perform no probes or clock reads' {
    $f=New-B51Fixture
    Assert-B51 ($f.State.Requests.Count -eq 0 -and $f.State.ClockCalls -eq 0 -and $script:B51Forbidden -eq 0) 'inert load/construction'
}
Case-B51 'empty success is raw empty with explicit scalar and complete bound coverage' {
    $f=New-B51Fixture;$r=Cleanup-B51Fixture $f
    Assert-B51 ($r.Records.Count -eq 6 -and $f.State.Requests.Count -eq 6) 'planned six probes once'
    Assert-B51 (@($r.Records | Where-Object {$_.Status -ne 'empty'}).Count -eq 0) 'raw empty status'
    for($i=0;$i -lt 6;$i++) {
        $p=$r.Records[$i]
        Assert-B51 ($p.Binding.Index -eq $i -and $p.Binding.AttemptId -ceq $f.Context.AttemptId -and $p.Binding.HostId -ceq $f.Context.HostId) 'binding/index'
        Assert-B51 ($p.Begin.Ok -and $p.QueryEnd.Ok -and $p.End.Ok -and $p.Begin.Ticks -le $p.QueryEnd.Ticks -and $p.QueryEnd.Ticks -le $p.End.Ticks) 'query clock bounds'
        Assert-B51 ($p.Begin.Source -eq 'InjectedClock') 'fixture clock explicitly marked'
        Assert-B51 ($p.ProviderRowCount -eq 0 -and $p.RowCount -eq 0 -and $p.RawErrors.Count -eq 0 -and -not $p.LiveProfileValidated) 'raw only'
    }
    Assert-B51 ($r.Records[5].ScalarPresent -and $r.Records[5].TestPathValue -ceq $false) 'false retained distinctly'
}
Case-B51 'startup has separate process-only capture and cleanup uses same context' {
    $f=New-B51Fixture;$f.State.Mode='positive'
    $s=Get-WindowsStartupIdentityRaw -Context $f.Context -Invoker $f.Invoker -Clock $f.Clock
    $r=Get-WindowsCleanupCurrentRaw -Context $f.Context -StartupContext $s.Context -Invoker $f.Invoker -Clock $f.Clock
    Assert-B51 ($s.Phase -eq 'startup' -and $s.Records.Count -eq 4 -and $r.Phase -eq 'cleanup' -and $r.Records.Count -eq 6) 'phase coverage'
    Assert-B51 (@($s.Records | Where-Object {$_.Binding.Provider -notin @('GetProcess','CIM')}).Count -eq 0) 'separate providers'
    Assert-B51 ($f.State.SensitiveReads -eq 0) 'no commandline/environment getter read'
}
Case-B51 'positive identity safe fields and property clocks preserved' {
    $f=New-B51Fixture;$f.State.Mode='positive';$r=Cleanup-B51Fixture $f;$p=$r.Records[0]
    Assert-B51 ($p.Status -eq 'present' -and $p.RowCount -eq 1 -and $p.ProviderRowCount -eq 1) 'positive not absence'
    Assert-B51 ($p.Rows[0].Fields.Count -eq 4 -and $p.Rows[0].Fields[0].Value -eq 101) 'safe identity fields'
    foreach($field in $p.Rows[0].Fields){Assert-B51 ($field.Ok -and $field.Begin.Ticks -le $field.End.Ticks) 'per-property bounds'}
    Assert-B51 ($p.Rows[0].Fields[2].Value.Kind -eq 'Utc' -and $f.State.SensitiveReads -eq 0) 'native time kind and secret exclusion'
    Assert-B51 ($r.Records[5].TestPathValue -ceq $true -and $r.Records[5].Status -eq 'present') 'positive TestPath raw scalar'
}
Case-B51 'property access-denied is partial and message is sanitized' {
    $f=New-B51Fixture;$f.State.Mode='partial';$r=Cleanup-B51Fixture $f;$p=$r.Records[0]
    Assert-B51 ($p.Status -eq 'partial' -and $p.ProviderCompleted -and $p.PropertyErrors.Count -gt 0 -and -not $p.Rows[0].Fields[3].Ok) 'partial property'
    Assert-B51 (($r | ConvertTo-Json -Depth 30 -Compress) -notmatch 'DO_NOT_EXPOSE_TOKEN') 'no native message leak'
}
Case-B51 'unsupported identity timestamp stays a property error, never parsed or reconstructed' {
    $f=New-B51Fixture;$f.State.Mode='bad-time';$r=Cleanup-B51Fixture $f
    Assert-B51 ($r.Records[0].Status -eq 'partial' -and -not $r.Records[0].Rows[0].Fields[2].Ok) 'raw time limitation'
}
Case-B51 'empty output plus nonterminating error is not empty success' {
    $f=New-B51Fixture;$f.State.Mode='query-error';$r=Cleanup-B51Fixture $f;$p=$r.Records[0]
    Assert-B51 ($p.Status -eq 'error' -and $p.RowCount -eq 0 -and $p.QueryErrors.Count -eq 1 -and $p.RawErrors[0].Channel -eq 'ErrorVariable') 'error separation'
    Assert-B51 ($p.RawErrors[0].Category -eq 'PermissionDenied' -and $null -ne $p.RawErrors[0].HResult) 'native error metadata'
    Assert-B51 (($r | ConvertTo-Json -Depth 30 -Compress) -notmatch 'DO_NOT_EXPOSE_TOKEN') 'query message sanitization'
}
Case-B51 'no-such-PID error remains unclassified error, not known absence' {
    $f=New-B51Fixture;$f.State.Mode='no-match';$r=Cleanup-B51Fixture $f;$p=$r.Records[0]
    Assert-B51 ($p.Status -eq 'error' -and $p.RawErrors[0].FullyQualifiedErrorId -eq 'NoProcessFoundForGivenId' -and $p.RawErrors[0].Classification -eq 'unclassified-error') 'no guessed classification'
}
Case-B51 'query error plus positive rows preserves rows and error status' {
    $f=New-B51Fixture;$f.State.Mode='positive-error';$r=Cleanup-B51Fixture $f
    Assert-B51 ($r.Records[0].Status -eq 'error' -and $r.Records[0].RowCount -eq 1 -and $r.Records[0].QueryErrors.Count -gt 0) 'positive plus error'
}
Case-B51 'thrown invoker produces structured error without caller text' {
    $f=New-B51Fixture;$f.State.Mode='throw';$r=Cleanup-B51Fixture $f
    Assert-B51 ($r.Records[0].Status -eq 'error' -and -not $r.Records[0].ProviderCompleted) 'thrown query'
    Assert-B51 (($r | ConvertTo-Json -Depth 30 -Compress) -notmatch 'DO_NOT_EXPOSE_TOKEN') 'throw text omitted'
}
Case-B51 'incomplete provider cannot claim empty success' {
    $f=New-B51Fixture;$f.State.Mode='incomplete';$r=Cleanup-B51Fixture $f
    Assert-B51 ($r.Records[0].Status -eq 'error' -and $r.Records[0].QueryErrors.Count -gt 0) 'incomplete provider'
}
Case-B51 'invalid TestPath scalar is rejected and never exposed' {
    $f=New-B51Fixture;$f.State.Mode='invalid-scalar';$r=Cleanup-B51Fixture $f
    Assert-B51 ($r.Records[5].Status -eq 'error' -and $null -eq $r.Records[5].TestPathValue) 'invalid scalar closed'
    Assert-B51 (($r | ConvertTo-Json -Depth 30 -Compress) -notmatch 'DO_NOT_EXPOSE_TOKEN') 'invalid scalar not leaked'
}
Case-B51 'wrong returned PID is a row-binding partial error' {
    $f=New-B51Fixture;$f.State.Mode='wrong-pid';$r=Cleanup-B51Fixture $f
    Assert-B51 ($r.Records[0].Status -eq 'partial' -and $r.Records[0].PropertyErrors[0].FullyQualifiedErrorId -eq 'ReturnedPidMismatch') 'target proof'
}
foreach($mode in @('wrong-host','wrong-frequency','wrong-origin','invalid-utc','throw')) {
    Case-B51 ('invalid begin clock '+$mode+' prevents any query') {
        $f=New-B51Fixture;$f.State.ClockMode=$mode;$r=Cleanup-B51Fixture $f
        Assert-B51 ($f.State.Requests.Count -eq 0 -and $r.Records[0].Status -eq 'clock-error' -and -not $r.Records[0].QueryAttempted) 'begin failure closed'
    }
}
foreach($mode in @('reverse','utc-reverse')) {
    Case-B51 ('clock order '+$mode+' retains evidence and closes') {
        $f=New-B51Fixture;$f.State.ClockMode=$mode;$r=Cleanup-B51Fixture $f
        Assert-B51 ($r.Records[0].Status -eq 'clock-error' -and $r.Records[0].QueryAttempted -and $r.Records[0].ClockErrors.Count -gt 0) 'clock sequence closed'
    }
}
Case-B51 'startup/current mismatches rejected before provider or clock' {
    $f=New-B51Fixture;$other=New-B51Fixture;$other.Context.AttemptId='other'
    $thrown=$false;try{Get-WindowsCleanupCurrentRaw $f.Context $other.Context $f.Invoker $f.Clock | Out-Null}catch{$thrown=$true}
    Assert-B51 ($thrown -and $f.State.Requests.Count -eq 0 -and $f.State.ClockCalls -eq 0) 'binding precondition'
}
Case-B51 'duplicate owned PID inventory rejected without probes' {
    $thrown=$false;try{New-WindowsCleanupProbeContext -HostId h -AttemptId a -OriginId o -OriginTicks 0 -Frequency 1 -Pids @(101,101) -Port 1 -ClusterPath x | Out-Null}catch{$thrown=$true}
    Assert-B51 $thrown 'unique PIDs'
}
Case-B51 'native CIM uint32 and TCP uint16 properties retain exact safe values' {
    $f=New-B51Fixture;$f.State.Mode='native-unsigned';$r=Cleanup-B51Fixture $f
    Assert-B51 ($r.Records[1].Status -eq 'present' -and $r.Records[1].Rows[0].Fields[0].Value -eq 101) 'unsigned CIM PID'
    Assert-B51 ($r.Records[4].Status -eq 'present' -and $r.Records[4].Rows[0].Fields[1].Value -eq 62001) 'unsigned TCP port'
}
Case-B51 'row limit explicitly retains original count and marks incomplete snapshot' {
    $f=New-B51Fixture;$f.State.Mode='row-limit';$r=Cleanup-B51Fixture $f;$p=$r.Records[0]
    Assert-B51 ($p.Status -eq 'error' -and $p.ProviderRowCount -eq 129 -and $p.RowCount -eq 128 -and $p.SnapshotIncomplete) 'no silent truncation'
}
Case-B51 'startup/current PID changes rejected before any query' {
    $f=New-B51Fixture;$other=New-B51Fixture;$other.Context.Pids[1]=103
    $thrown=$false;try{Get-WindowsCleanupCurrentRaw $f.Context $other.Context $f.Invoker $f.Clock | Out-Null}catch{$thrown=$true}
    Assert-B51 ($thrown -and $f.State.Requests.Count -eq 0) 'same target coverage'
}
Case-B51 'context rejects a string PID instead of coercing it' {
    $thrown=$false;try{New-WindowsCleanupProbeContext -HostId h -AttemptId a -OriginId o -OriginTicks 0 -Frequency 1 -Pids @('101') -Port 1 -ClusterPath x | Out-Null}catch{$thrown=$true}
    Assert-B51 $thrown 'no string PID coercion'
}
Case-B51 'query-end clock failure preserves provider count, marks missing snapshot, and never retries query' {
    $f=New-B51Fixture;$f.State.Mode='positive';$f.State.ClockMode='query-end-throw';$r=Cleanup-B51Fixture $f;$p=$r.Records[0]
    Assert-B51 ($p.Status -eq 'clock-error' -and $p.QueryAttempted -and $p.ProviderRowCount -eq 1 -and $p.RowCount -eq 0 -and $p.SnapshotIncomplete) 'no fabricated empty result'
    Assert-B51 ($f.State.Requests.Count -eq 6 -and @($f.State.Requests | Where-Object {$_.Provider -eq 'GetProcess' -and $_.Target -eq 101}).Count -eq 1) 'no automatic retry'
}
Case-B51 'context does not coerce numeric host binding into a string' {
    $thrown=$false;try{New-WindowsCleanupProbeContext -HostId 42 -AttemptId a -OriginId o -OriginTicks 0 -Frequency 1 -Pids @(101) -Port 1 -ClusterPath x | Out-Null}catch{$thrown=$true}
    Assert-B51 $thrown 'exact binding string'
}
Assert-B51 ($script:B51Forbidden -eq 0) 'all actual provider cmdlets uncalled'
Assert-B51 ($script:B51ProcessOperations -eq 0) 'no target process operations'
Assert-B51 ($script:B51LiveBoundaryCalls -eq 0 -and $script:B51DefaultClockCalls -eq 0) 'default provider/SystemClock never selected'
[pscustomobject]@{Passed=$script:B51Cases.Count;Cases=[string[]]$script:B51Cases;
    LiveCmdletCalls=$script:B51Forbidden;TargetProcessOperations=$script:B51ProcessOperations;
    LiveBoundaryCalls=$script:B51LiveBoundaryCalls;DefaultClockCalls=$script:B51DefaultClockCalls;
    Scope='injected fixture only; live provider profile unverified'}
