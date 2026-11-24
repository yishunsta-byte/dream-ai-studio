# Functions only. No provider, clock, storage or continuation decision.
# Caller/controller and injected objects are trusted execution inputs, not a sandbox.

function Test-B54Integer {
    param([object]$Number, [long]$Minimum = 0)
    return (($Number -is [byte] -or $Number -is [sbyte] -or $Number -is [int16] -or
        $Number -is [uint16] -or $Number -is [int] -or $Number -is [uint32] -or
        $Number -is [long] -or $Number -is [uint64]) -and $Number -ge $Minimum -and
        $Number -le [long]::MaxValue)
}

function Test-B54DataShape {
    param([object]$Data, [string[]]$Keys)
    if($Data -isnot [System.Management.Automation.PSCustomObject]) { return $false }
    $members=@($Data.PSObject.Properties)
    if($members.Count -ne $Keys.Count) { return $false }
    foreach($key in $Keys) {
        $p=$Data.PSObject.Properties[$key]
        if($null -eq $p -or $p.Name -cne $key -or $p.MemberType -ne 'NoteProperty') { return $false }
    }
    return $true
}

function Convert-B54EnumMetadata {
    param([object]$EnumValue, [type]$ExpectedType, [switch]$Flags)
    $result=[pscustomobject]@{Ok=$false;EnumType=$null;EnumString=$null;NumericText=$null;
        UnderlyingType=$null;BitWidth=$null;UnsignedBitsText=$null;Known=$false;
        UnknownBitsText=$null;ErrorCode=$null}
    # No coercion or ToString until the value is an exact native enum of the expected type.
    if($null -eq $ExpectedType -or -not $ExpectedType.IsEnum -or $EnumValue -isnot [Enum] -or
       [object].GetMethod('GetType').Invoke($EnumValue,@()) -ne $ExpectedType) { $result.ErrorCode='UnsupportedEnumType'; return $result }
    try {
        $underlying=[Enum]::GetUnderlyingType($ExpectedType)
        switch($underlying.FullName) {
            'System.SByte' {$width=8}
            'System.Byte' {$width=8}
            'System.Int16' {$width=16}
            'System.UInt16' {$width=16}
            'System.Int32' {$width=32}
            'System.UInt32' {$width=32}
            'System.Int64' {$width=64}
            'System.UInt64' {$width=64}
            default { throw 'unsupported enum width' }
        }
        $culture=[Globalization.CultureInfo]::InvariantCulture
        $integer=[Convert]::ChangeType($EnumValue,$underlying,$culture)
        $text=$integer.ToString('D',$culture)
        $number=[System.Numerics.BigInteger]::Parse($text,$culture)
        $modulus=[System.Numerics.BigInteger]::Pow(2,$width)
        $bits=$number; if($bits.Sign -lt 0){$bits=$bits+$modulus}
        $unknown=[System.Numerics.BigInteger]::Zero
        $known=[Enum]::IsDefined($ExpectedType,$EnumValue)
        if($Flags) {
            $mask=[System.Numerics.BigInteger]::Zero
            foreach($v in [Enum]::GetValues($ExpectedType)) {
                $n=[Convert]::ChangeType($v,$underlying,$culture)
                $b=[System.Numerics.BigInteger]::Parse($n.ToString('D',$culture),$culture)
                if($b.Sign -lt 0){$b=$b+$modulus}
                $mask=[System.Numerics.BigInteger]::op_BitwiseOr($mask,$b)
            }
            $complement=[System.Numerics.BigInteger]::op_ExclusiveOr(($modulus-1),$mask)
            $unknown=[System.Numerics.BigInteger]::op_BitwiseAnd($bits,$complement)
            $known=$unknown.IsZero
        }
        $result.EnumType=$ExpectedType.FullName
        $result.EnumString=[Enum]::Format($ExpectedType,$EnumValue,'G'); $result.NumericText=$text
        $result.UnderlyingType=$underlying.FullName; $result.BitWidth=$width
        $result.UnsignedBitsText=$bits.ToString($culture); $result.Known=$known
        $result.UnknownBitsText=$unknown.ToString($culture);$result.Ok=$true
    } catch { $result.ErrorCode='EnumMetadataReadError' }
    return $result
}

function Get-CimPropertyMetadata {
    [CmdletBinding(DefaultParameterSetName='Native')]
    param(
        [Parameter(ParameterSetName='Native')][object]$CimResult,
        [Parameter(ParameterSetName='Injected')][object]$InjectedProperties,
        [object]$Binding, [object]$Bounds
    )
    $injected=$PSCmdlet.ParameterSetName -ceq 'Injected'
    $errors=[System.Collections.Generic.List[object]]::new()
    $rows=[System.Collections.Generic.List[object]]::new()
    $valid=[pscustomobject]@{Binding=$false;Bounds=$false;Collection=$false;
        PropertyMetadata=$null;KnownEnums=$null;Duplicates=$null;RequiredMetadata=$false}
    $out=[pscustomobject]@{Schema='B54-cim-metadata-v1';Status='stop-review';
        InputKind=$(if($injected){'trusted-injected-metadata'}else{'caller-owned-native-result'});
        Binding=$null;Bounds=$null;BoundsProvenance='caller-supplied-unverified-no-clock-read';
        Validity=$valid;Properties=[object[]]@();Errors=[object[]]@();
        Classification='metadata-only-no-value-or-acquisition-decision';LiveProfileValidated=$false}
    $bindingKeys=@('HostId','AttemptId','Phase','Target','Requested','SourceSha256')
    $boundKeys=@('HostId','AttemptId','Phase','Target','SourceSha256','OriginId','Frequency','BeginTicks','EndTicks')
    $expected=@('ProcessId','Name','CreationDate','ExecutablePath')
    $bindingOk=Test-B54DataShape $Binding $bindingKeys
    if($bindingOk) {
        foreach($k in @('HostId','AttemptId')) {
            $s=$Binding.$k
            if($s -isnot [string] -or [string]::IsNullOrWhiteSpace($s) -or $s.Length -gt 128 -or
               $s -match '[\x00-\x1f\x7f]'){$bindingOk=$false}
        }
        if($Binding.Phase -isnot [string] -or $Binding.Phase -cnotin @('startup','current') -or
           -not (Test-B54Integer $Binding.Target 1) -or $Binding.Target -gt [int]::MaxValue -or
           $Binding.SourceSha256 -isnot [string] -or $Binding.SourceSha256 -cnotmatch '^[0-9a-f]{64}$' -or
           $Binding.Requested -isnot [array] -or $Binding.Requested.Rank -ne 1 -or
           $Binding.Requested.Count -ne 4){$bindingOk=$false}
        if($bindingOk) {
            for($i=0;$i -lt 4;$i++) {
                if($Binding.Requested[$i] -isnot [string] -or $Binding.Requested[$i] -cne $expected[$i]){$bindingOk=$false}
            }
        }
    }
    if($bindingOk) {
        $valid.Binding=$true
        $out.Binding=[pscustomobject]@{HostId=$Binding.HostId;AttemptId=$Binding.AttemptId;Phase=$Binding.Phase;
            Target=[int]$Binding.Target;Requested=[string[]]$expected.Clone();SourceSha256=$Binding.SourceSha256}
    } else { $errors.Add([pscustomobject]@{Scope='Binding';Index=$null;Field=$null;Code='InvalidBinding'}) }
    $boundsOk=($bindingOk -and (Test-B54DataShape $Bounds $boundKeys))
    if($boundsOk) {
        foreach($k in @('HostId','AttemptId','Phase','SourceSha256')) {
            if($Bounds.$k -isnot [string] -or $Bounds.$k -cne $out.Binding.$k){$boundsOk=$false}
        }
        if(-not (Test-B54Integer $Bounds.Target 1) -or $Bounds.Target -ne $out.Binding.Target -or
           $Bounds.OriginId -isnot [string] -or [string]::IsNullOrWhiteSpace($Bounds.OriginId) -or
           $Bounds.OriginId.Length -gt 128 -or $Bounds.OriginId -match '[\x00-\x1f\x7f]' -or
           -not (Test-B54Integer $Bounds.Frequency 1) -or
           -not (Test-B54Integer $Bounds.BeginTicks) -or -not (Test-B54Integer $Bounds.EndTicks)){$boundsOk=$false}
        if($boundsOk) {
            $span=[System.Numerics.BigInteger]$Bounds.EndTicks-[System.Numerics.BigInteger]$Bounds.BeginTicks
            if($span.Sign -lt 0 -or $span -gt ([System.Numerics.BigInteger]$Bounds.Frequency*10)){$boundsOk=$false}
        }
    }
    if($boundsOk) {
        $valid.Bounds=$true
        $out.Bounds=[pscustomobject]@{HostId=$Bounds.HostId;AttemptId=$Bounds.AttemptId;Phase=$Bounds.Phase;
            Target=[int]$Bounds.Target;SourceSha256=$Bounds.SourceSha256;OriginId=$Bounds.OriginId;
            Frequency=[long]$Bounds.Frequency;BeginTicks=[long]$Bounds.BeginTicks;EndTicks=[long]$Bounds.EndTicks}
    } else { $errors.Add([pscustomobject]@{Scope='Bounds';Index=$null;Field=$null;Code='InvalidBounds'}) }
    # Invalid controller inputs cannot trigger native metadata reads or fixture getters.
    if(-not $bindingOk -or -not $boundsOk){$out.Errors=$errors.ToArray();return $out}
    $cimType='Microsoft.Management.Infrastructure.CimType' -as [type]
    $flagsType='Microsoft.Management.Infrastructure.CimFlags' -as [type]
    $instanceType='Microsoft.Management.Infrastructure.CimInstance' -as [type]
    if($null -eq $cimType -or $null -eq $flagsType -or $null -eq $instanceType) {
        $errors.Add([pscustomobject]@{Scope='Collection';Index=$null;Field=$null;Code='NativeTypesUnavailable'})
        $out.Errors=$errors.ToArray();return $out
    }
    $seen=[System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    $required=[System.Collections.Generic.Dictionary[string,string]]::new([StringComparer]::Ordinal)
    $required.Add('ProcessId','UInt32');$required.Add('Name','String')
    $required.Add('CreationDate','DateTime');$required.Add('ExecutablePath','String')
    $found=[System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    try {
        if($injected) {
            if($InjectedProperties -isnot [array] -or $InjectedProperties.Rank -ne 1){throw 'unsupported injected collection'}
            $properties=$InjectedProperties
        } else {
            if($null -eq $CimResult -or -not $instanceType.IsInstanceOfType($CimResult) -or
               [object].GetMethod('GetType').Invoke($CimResult,@()) -ne $instanceType){throw 'unsupported native result'}
            $properties=$instanceType.GetProperty('CimInstanceProperties').GetValue($CimResult,$null)
            if($null -eq $properties){throw 'missing property collection'}
        }
        $valid.Collection=$true; $valid.PropertyMetadata=$true;$valid.KnownEnums=$true;$valid.Duplicates=$true;$index=0
        foreach($p in $properties) {
            if($index -ge 128) {
                $valid.Collection=$false
                $errors.Add([pscustomobject]@{Scope='Collection';Index=$index;Field=$null;Code='PropertyLimitExceeded'});break
            }
            $row=[pscustomobject]@{Index=$index;Name=$null;NameOk=$false;CimType=$null;Flags=$null;
                Requested=$false;IsKey=$null;HasNotModified=$null;HasNullValue=$null;Kind='unclassified'}
            $nameValue=$null;$typeValue=$null;$flagsValue=$null
            foreach($field in @('Name','CimType','Flags')) {
                try {
                    if($null -eq $p){throw 'null property'}
                    if($injected) {
                        $member=$p.PSObject.Properties[$field]
                        if($null -eq $member){throw 'missing metadata'}
                        $v=$p.$field
                    } else { $v=[Microsoft.Management.Infrastructure.CimProperty].GetProperty($field).GetValue($p,$null) }
                    switch($field) {
                        'Name' {$nameValue=$v}
                        'CimType' {$typeValue=$v}
                        'Flags' {$flagsValue=$v}
                    }
                } catch {
                    $valid.PropertyMetadata=$false
                    $errors.Add([pscustomobject]@{Scope='Property';Index=$index;Field=$field;Code='MetadataReadError'})
                }
            }
            # Preserve bounded raw name text even if its identifier syntax is unsupported.
            if($nameValue -is [string] -and $nameValue.Length -le 128){$row.Name=$nameValue}
            if($nameValue -is [string] -and $nameValue -cmatch '^[A-Za-z_][A-Za-z0-9_]{0,127}$') {
                $row.Name=$nameValue;$row.NameOk=$true
                if(-not $seen.Add($nameValue)) {
                    $valid.Duplicates=$false
                    $errors.Add([pscustomobject]@{Scope='Property';Index=$index;Field='Name';Code='DuplicateName'})
                }
                $row.Requested=$required.ContainsKey($nameValue)
            } else {
                $valid.PropertyMetadata=$false
                $errors.Add([pscustomobject]@{Scope='Property';Index=$index;Field='Name';Code='InvalidName'})
            }
            $row.CimType=Convert-B54EnumMetadata $typeValue $cimType
            $row.Flags=Convert-B54EnumMetadata $flagsValue $flagsType -Flags
            foreach($field in @('CimType','Flags')) {
                $m=$row.$field
                if(-not $m.Ok) {
                    $valid.PropertyMetadata=$false
                    $errors.Add([pscustomobject]@{Scope='Property';Index=$index;Field=$field;Code=$m.ErrorCode})
                } elseif(-not $m.Known -or ($field -ceq 'CimType' -and $m.NumericText -ceq '0')) {
                    $valid.KnownEnums=$false
                    $errors.Add([pscustomobject]@{Scope='Property';Index=$index;Field=$field;Code='UnknownEnumOrBits'})
                }
            }
            if($row.Flags.Ok) {
                $bits=[System.Numerics.BigInteger]::Parse($row.Flags.UnsignedBitsText,[Globalization.CultureInfo]::InvariantCulture)
                $row.IsKey=(-not ([System.Numerics.BigInteger]::op_BitwiseAnd($bits,4096)).IsZero)
                $row.HasNotModified=(-not ([System.Numerics.BigInteger]::op_BitwiseAnd($bits,33554432)).IsZero)
                $row.HasNullValue=(-not ([System.Numerics.BigInteger]::op_BitwiseAnd($bits,536870912)).IsZero)
                if($row.NameOk) {
                    $row.Kind=$(if($row.Requested){'requested'}elseif($row.IsKey){'unrequested-key'}else{'unrequested-nonkey-descriptor'})
                }
            }
            if($row.Requested -and $row.CimType.Ok -and $row.CimType.EnumString -ceq $required[$row.Name]) {
                [void]$found.Add($row.Name)
            } elseif($row.Requested) {
                $errors.Add([pscustomobject]@{Scope='Required';Index=$index;Field='CimType';Code='RequestedTypeMismatch'})
            }
            $rows.Add($row);$index++
        }
    } catch {
        $valid.Collection=$false
        $errors.Add([pscustomobject]@{Scope='Collection';Index=$rows.Count;Field=$null;Code='CollectionReadError'})
    }
    $requiredErrors=0
    foreach($e in $errors){if($e.Scope -ceq 'Required'){$requiredErrors++}}
    $valid.RequiredMetadata=($found.Count -eq 4 -and $requiredErrors -eq 0)
    if(-not $valid.RequiredMetadata) {
        $errors.Add([pscustomobject]@{Scope='Required';Index=$null;Field=$null;Code='MissingOrInvalidRequestedMetadata'})
    }
    $out.Properties=$rows.ToArray();$out.Errors=$errors.ToArray()
    if($errors.Count -eq 0){$out.Status='metadata-recorded'}
    return $out
}
