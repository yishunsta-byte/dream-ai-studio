# Raw read-only Windows probes. Loading this file defines functions only.
# No normalization, known-absence classification, storage, retry or permission API.

function Test-B51Integer {
    param([object]$Value, [long]$Minimum = 0)
    return (($Value -is [byte] -or $Value -is [sbyte] -or $Value -is [int16] -or $Value -is [uint16] -or
        $Value -is [int] -or $Value -is [uint32] -or $Value -is [long] -or $Value -is [uint64]) -and
        $Value -ge $Minimum -and $Value -le [long]::MaxValue)
}

function New-WindowsCleanupProbeContext {
    param([object]$HostId, [object]$AttemptId, [object]$OriginId, [object]$OriginTicks,
          [object]$Frequency, [object]$Pids, [object]$Port, [object]$ClusterPath)
    foreach($s in @($HostId,$AttemptId,$OriginId,$ClusterPath)) {
        if($s -isnot [string] -or [string]::IsNullOrWhiteSpace($s) -or $s.Length -gt 2048 -or $s -match '[\x00-\x1f]') { throw 'B51 invalid binding string' }
    }
    if(-not (Test-B51Integer $OriginTicks) -or -not (Test-B51Integer $Frequency 1)) { throw 'B51 invalid clock origin' }
    if(-not (Test-B51Integer $Port 1) -or $Port -gt 65535) { throw 'B51 invalid port' }
    if($Pids -isnot [array] -or $Pids.Count -eq 0 -or $Pids.Count -gt 32) { throw 'B51 invalid PID inventory' }
    $seen=@{}; $owned=@()
    foreach($p in $Pids) {
        if(-not (Test-B51Integer $p 1) -or $p -gt [int]::MaxValue -or $seen.ContainsKey([string]$p)) { throw 'B51 invalid or duplicate PID' }
        $seen[[string]$p]=$true; $owned += [int]$p
    }
    return [pscustomobject]@{HostId=$HostId;AttemptId=$AttemptId;OriginId=$OriginId;OriginTicks=[long]$OriginTicks;
        Frequency=[long]$Frequency;Pids=[int[]]$owned;Port=[int]$Port;ClusterPath=$ClusterPath}
}

function Copy-B51Context {
    param([object]$Context)
    $keys=@('HostId','AttemptId','OriginId','OriginTicks','Frequency','Pids','Port','ClusterPath')
    if($null -eq $Context -or @($Context.PSObject.Properties).Count -ne $keys.Count) { throw 'B51 context schema' }
    foreach($key in $keys) {
        $p=$Context.PSObject.Properties[$key]
        if($null -eq $p -or $p.MemberType -ne 'NoteProperty') { throw 'B51 context must contain data properties' }
    }
    return New-WindowsCleanupProbeContext -HostId $Context.HostId -AttemptId $Context.AttemptId -OriginId $Context.OriginId `
        -OriginTicks $Context.OriginTicks -Frequency $Context.Frequency -Pids $Context.Pids -Port $Context.Port -ClusterPath $Context.ClusterPath
}

function Convert-B51Error {
    param([System.Management.Automation.ErrorRecord]$Record, [string]$Channel, [string]$Operation)
    $id=[string]$Record.FullyQualifiedErrorId
    if($id.Length -gt 256 -or $id -notmatch '^[A-Za-z0-9_.:,\-]+$' -or $id -match '(?i)password|secret|token|authorization|bearer|dsn|api.?key') { $id='[redacted-id]' }
    return [pscustomobject]@{Channel=$Channel;Operation=$Operation;FullyQualifiedErrorId=$id;
        Category=[string]$Record.CategoryInfo.Category;HResult=[int]$Record.Exception.HResult;
        Message='[native message omitted]';Classification='unclassified-error'}
}

function New-B51Failure {
    param([string]$Id,[string]$Operation)
    $e=[System.Management.Automation.ErrorRecord]::new([InvalidOperationException]::new($Id),$Id,
        [System.Management.Automation.ErrorCategory]::InvalidData,$null)
    return Convert-B51Error -Record $e -Channel 'Collector' -Operation $Operation
}

function Get-B51Clock {
    param([object]$Context,[scriptblock]$Clock)
    try {
        if($null -eq $Clock) {
            $utc=[DateTimeOffset]::UtcNow.ToString('o')
            $tick=[Diagnostics.Stopwatch]::GetTimestamp()
            $value=[pscustomobject]@{Utc=$utc;Ticks=$tick;Frequency=[Diagnostics.Stopwatch]::Frequency;
                HostId=$Context.HostId;AttemptId=$Context.AttemptId;OriginId=$Context.OriginId}
        } else { $values=@(& $Clock $Context); if($values.Count -ne 1){throw 'B51 clock envelope'}; $value=$values[0] }
        foreach($key in @('Utc','Ticks','Frequency','HostId','AttemptId','OriginId')) {
            if($null -eq $value.PSObject.Properties[$key] -or $value.PSObject.Properties[$key].MemberType -ne 'NoteProperty') { throw 'B51 clock schema' }
        }
        $parsed=[DateTimeOffset]::MinValue
        if($value.Utc -isnot [string] -or $value.Utc.Length -gt 64 -or $value.Utc -notmatch '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{7}(Z|[+-]\d\d:\d\d)$' -or
           -not [DateTimeOffset]::TryParse($value.Utc,[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::None,[ref]$parsed)) { throw 'B51 clock UTC' }
        if(-not (Test-B51Integer $value.Ticks) -or $value.Ticks -lt $Context.OriginTicks -or
           -not (Test-B51Integer $value.Frequency 1) -or $value.Frequency -ne $Context.Frequency -or
           $value.HostId -isnot [string] -or $value.AttemptId -isnot [string] -or $value.OriginId -isnot [string] -or
           $value.HostId -cne $Context.HostId -or $value.AttemptId -cne $Context.AttemptId -or $value.OriginId -cne $Context.OriginId) { throw 'B51 clock binding' }
        return [pscustomobject]@{Ok=$true;Utc=$value.Utc;Ticks=[long]$value.Ticks;Frequency=[long]$value.Frequency;
            OriginTicks=$Context.OriginTicks;OriginId=$Context.OriginId;HostId=$Context.HostId;AttemptId=$Context.AttemptId;
            Source=$(if($null -eq $Clock){'SystemUtc/Stopwatch'}else{'InjectedClock'})}
    } catch { return [pscustomobject]@{Ok=$false;Error=(Convert-B51Error $_ 'Clock' 'ClockRead')} }
}

function Invoke-B51WindowsProvider {
    param([object]$Request)
    # This is the only live-provider boundary. No call is made during load.
    $nativeErrors=@(); $errors=@(); $rows=@(); $completed=$true; $scalar=$null; $scalarPresent=$false
    try {
        switch($Request.Provider) {
            'GetProcess' { $rows=@(Get-Process -Id $Request.Target -ErrorAction SilentlyContinue -ErrorVariable +nativeErrors) }
            'CIM' { $rows=@(Get-CimInstance -ClassName Win32_Process -Property ProcessId,Name,CreationDate,ExecutablePath -Filter ('ProcessId='+$Request.Target) -ErrorAction SilentlyContinue -ErrorVariable +nativeErrors) }
            'TCP' { $rows=@(Get-NetTCPConnection -LocalPort $Request.Target -State Listen -ErrorAction SilentlyContinue -ErrorVariable +nativeErrors) }
            'TestPath' {
                $scalarPresent=$true
                $scalar=Test-Path -LiteralPath $Request.Target -PathType Leaf -ErrorAction SilentlyContinue -ErrorVariable +nativeErrors
                if($scalar -ceq $true) { $rows=@([pscustomobject]@{Path=$Request.Target;Exists=$true}) }
            }
            default { throw 'B51 unsupported provider' }
        }
    } catch { $completed=$false; $errors += [pscustomobject]@{Channel='Terminating';Record=$_} }
    foreach($e in $nativeErrors) { $errors += [pscustomobject]@{Channel='ErrorVariable';Record=$e} }
    return [pscustomobject]@{Completed=$completed;Rows=[object[]]$rows;Errors=[object[]]$errors;
        ScalarPresent=$scalarPresent;Scalar=$scalar}
}

function Read-B51Property {
    param([object]$Row,[string]$Property,[string]$Kind,[object]$Context,[scriptblock]$Clock)
    $begin=Get-B51Clock $Context $Clock; $errors=@(); $safe=$null; $ok=$false
    if($begin.Ok) {
        try {
            $v=$Row.$Property
            switch($Kind) {
                'pid' { if(-not (Test-B51Integer $v 1) -or $v -gt [int]::MaxValue){throw 'B51 invalid PID property'}; $safe=[int]$v }
                'port' { if(-not (Test-B51Integer $v 1) -or $v -gt 65535){throw 'B51 invalid port property'}; $safe=[int]$v }
                'text' { if($v -isnot [string] -or [string]::IsNullOrWhiteSpace($v) -or $v.Length -gt 2048 -or $v -match '[\x00-\x1f]'){throw 'B51 missing/unsafe string property'}; $safe=$v }
                'time' {
                    if($v -is [DateTimeOffset]) { $safe=[pscustomobject]@{Text=$v.ToString('o');NativeType='DateTimeOffset';Kind='Offset'} }
                    elseif($v -is [DateTime]) { $safe=[pscustomobject]@{Text=$v.ToString('o');NativeType='DateTime';Kind=[string]$v.Kind} }
                    else { throw 'B51 missing/unsupported time property' }
                }
                'bool' { if($v -isnot [bool]){throw 'B51 invalid boolean property'}; $safe=$v }
                default { throw 'B51 property kind' }
            }
            $ok=$true
        } catch { $errors += Convert-B51Error $_ 'Property' $Property }
    }
    $end=Get-B51Clock $Context $Clock
    return [pscustomobject]@{Property=$Property;Ok=$ok;Value=$safe;Begin=$begin;End=$end;Errors=[object[]]$errors}
}

function Invoke-B51RawProbe {
    param([object]$Context,[string]$Phase,[string]$Provider,[object]$Target,[int]$Index,
          [scriptblock]$Invoker,[scriptblock]$Clock)
    $request=[pscustomobject]@{HostId=$Context.HostId;AttemptId=$Context.AttemptId;OriginId=$Context.OriginId;
        Phase=$Phase;Index=$Index;Provider=$Provider;Target=$Target}
    $begin=Get-B51Clock $Context $Clock; $queryEnd=$null; $end=$null
    $queryErrors=@();$propertyErrors=@();$clockErrors=@();$safeRows=@();$snapshots=@($begin)
    $envelope=$null;$attempted=$false;$completed=$false;$nativeCount=$null;$scalarPresent=$false;$scalar=$null
    if($begin.Ok) {
        $attempted=$true
        try {
            if($null -eq $Invoker){$values=@(Invoke-B51WindowsProvider $request)}else{$values=@(& $Invoker $request)}
            if($values.Count -ne 1){throw 'B51 invoker envelope count'}; $envelope=$values[0]
            foreach($k in @('Completed','Rows','Errors','ScalarPresent','Scalar')) {
                if($null -eq $envelope.PSObject.Properties[$k] -or $envelope.PSObject.Properties[$k].MemberType -ne 'NoteProperty'){throw 'B51 invoker envelope schema'}
            }
            if($envelope.Completed -isnot [bool] -or $envelope.Rows -isnot [array] -or $envelope.Errors -isnot [array] -or $envelope.ScalarPresent -isnot [bool]){throw 'B51 invoker envelope types'}
            $completed=$envelope.Completed;$nativeCount=$envelope.Rows.Count;$scalarPresent=$envelope.ScalarPresent;$scalar=$envelope.Scalar
            foreach($entry in $envelope.Errors) {
                if($entry.Record -isnot [System.Management.Automation.ErrorRecord] -or $entry.Channel -notin @('Terminating','ErrorVariable')){throw 'B51 invoker error schema'}
                $queryErrors += Convert-B51Error $entry.Record $entry.Channel 'Query'
            }
            if(-not $completed -and $queryErrors.Count -eq 0){$queryErrors += New-B51Failure 'ProviderIncomplete' 'Query'}
            if($Provider -eq 'TestPath') {
                if(-not $scalarPresent -or $scalar -isnot [bool]){throw 'B51 TestPath scalar incomplete'}
                if(($scalar -and $nativeCount -ne 1) -or (-not $scalar -and $nativeCount -ne 0)){throw 'B51 TestPath scalar/row contradiction'}
            } elseif($scalarPresent -or $null -ne $scalar){throw 'B51 unexpected scalar'}
        } catch { $completed=$false; $queryErrors += Convert-B51Error $_ 'Collector' 'QueryEnvelope' }
        $queryEnd=Get-B51Clock $Context $Clock; $snapshots += $queryEnd
        if($null -ne $envelope -and $queryEnd.Ok -and $null -ne $nativeCount) {
            if($nativeCount -gt 128){$queryErrors += New-B51Failure 'RowLimitExceeded' 'Query'}
            $take=[Math]::Min([int]$nativeCount,128)
            for($i=0;$i -lt $take;$i++) {
                $row=$envelope.Rows[$i];$fields=@()
                switch($Provider) {
                    'GetProcess' { $map=@(@('Id','pid'),@('ProcessName','text'),@('StartTime','time'),@('Path','text')) }
                    'CIM' { $map=@(@('ProcessId','pid'),@('Name','text'),@('CreationDate','time'),@('ExecutablePath','text')) }
                    'TCP' { $map=@(@('LocalAddress','text'),@('LocalPort','port'),@('OwningProcess','pid')) }
                    'TestPath' { $map=@(@('Path','text'),@('Exists','bool')) }
                }
                foreach($pair in $map) {
                    $f=Read-B51Property $row $pair[0] $pair[1] $Context $Clock
                    $fields += $f;$snapshots += $f.Begin;$snapshots += $f.End;$propertyErrors += $f.Errors
                }
                if($fields[0].Ok -and $Provider -in @('GetProcess','CIM') -and $fields[0].Value -ne $Target){$propertyErrors += New-B51Failure 'ReturnedPidMismatch' 'RowBinding'}
                if($Provider -eq 'TCP' -and $fields[1].Ok -and $fields[1].Value -ne $Target){$propertyErrors += New-B51Failure 'ReturnedPortMismatch' 'RowBinding'}
                if($Provider -eq 'TestPath' -and (($fields[0].Ok -and $fields[0].Value -cne $Target) -or ($fields[1].Ok -and -not $fields[1].Value))){$propertyErrors += New-B51Failure 'ReturnedFileMismatch' 'RowBinding'}
                $safeRows += [pscustomobject]@{Fields=[object[]]$fields}
            }
        }
        $end=Get-B51Clock $Context $Clock;$snapshots += $end
    }
    $previous=$null
    foreach($stamp in $snapshots) {
        if(-not $stamp.Ok){$clockErrors += $stamp.Error;continue}
        if($null -ne $previous -and ($stamp.Ticks -lt $previous.Ticks -or [DateTimeOffset]$stamp.Utc -lt [DateTimeOffset]$previous.Utc)){$clockErrors += New-B51Failure 'ClockOrderInvalid' 'ClockSequence'}
        $previous=$stamp
    }
    $status='empty'
    if($nativeCount -gt 0){$status='present'}
    if($propertyErrors.Count -gt 0){$status='partial'}
    if($queryErrors.Count -gt 0 -or -not $completed){$status='error'}
    if($clockErrors.Count -gt 0){$status='clock-error'}
    return [pscustomobject]@{Binding=$request;Begin=$begin;QueryEnd=$queryEnd;End=$end;
        ClockReadOrder=$(if($null -eq $Clock){'UTC read before Stopwatch ticks'}else{'Injected pair; no native clock read'});
        QueryAttempted=$attempted;ProviderCompleted=$completed;ProviderRowCount=$nativeCount;RowCount=$safeRows.Count;Rows=[object[]]$safeRows;
        SnapshotIncomplete=($null -ne $nativeCount -and $safeRows.Count -ne $nativeCount);
        ScalarPresent=$scalarPresent;TestPathValue=$(if($scalar -is [bool]){$scalar}else{$null});Status=$status;
        QueryErrors=[object[]]$queryErrors;PropertyErrors=[object[]]$propertyErrors;ClockErrors=[object[]]$clockErrors;
        RawErrors=[object[]]@($queryErrors+$propertyErrors+$clockErrors);Classification='raw-unclassified';LiveProfileValidated=$false}
}

function Invoke-B51Collection {
    param([object]$Context,[string]$Phase,[scriptblock]$Invoker,[scriptblock]$Clock)
    $c=Copy-B51Context $Context;$records=@();$index=0
    foreach($p in $c.Pids) {
        foreach($provider in @('GetProcess','CIM')) {
            $records += Invoke-B51RawProbe $c $Phase $provider $p $index $Invoker $Clock;$index++
        }
    }
    if($Phase -eq 'cleanup') {
        $records += Invoke-B51RawProbe $c $Phase 'TCP' $c.Port $index $Invoker $Clock;$index++
        $records += Invoke-B51RawProbe $c $Phase 'TestPath' ($c.ClusterPath.TrimEnd('\','/')+'\postmaster.pid') $index $Invoker $Clock
    }
    $collectionErrors=@();$previous=$null
    foreach($r in $records) {
        if($null -ne $previous -and $previous.Ok -and $r.Begin.Ok -and ($previous.Ticks -gt $r.Begin.Ticks -or [DateTimeOffset]$previous.Utc -gt [DateTimeOffset]$r.Begin.Utc)){$collectionErrors += New-B51Failure 'CollectionClockOrderInvalid' 'CollectionSequence'}
        if($null -ne $r.End){$previous=$r.End}
    }
    return [pscustomobject]@{Schema='B51-raw-v1';Phase=$Phase;Context=$c;Records=[object[]]$records;
        CollectionErrors=[object[]]$collectionErrors;LiveProfileValidated=$false;Classification='raw-only-no-absence-decision'}
}

function Get-WindowsStartupIdentityRaw {
    param([object]$Context,[scriptblock]$Invoker,[scriptblock]$Clock)
    return Invoke-B51Collection $Context 'startup' $Invoker $Clock
}

function Get-WindowsCleanupCurrentRaw {
    param([object]$Context,[object]$StartupContext,[scriptblock]$Invoker,[scriptblock]$Clock)
    $current=Copy-B51Context $Context; $startup=Copy-B51Context $StartupContext
    foreach($key in @('HostId','AttemptId','OriginId','OriginTicks','Frequency','Port','ClusterPath')) {
        if($current.$key -cne $startup.$key){throw 'B51 startup/current binding mismatch'}
    }
    if($current.Pids.Count -ne $startup.Pids.Count){throw 'B51 startup/current PID coverage mismatch'}
    for($i=0;$i -lt $current.Pids.Count;$i++){if($current.Pids[$i] -ne $startup.Pids[$i]){throw 'B51 startup/current PID order mismatch'}}
    return Invoke-B51Collection $Context 'cleanup' $Invoker $Clock
}
