param([Parameter(Mandatory=$true)][string]$ObserverSource)
# Run supplied source text in this host. No policy changes, files or live probes.
$script:B54Cases=[System.Collections.Generic.List[string]]::new()
$script:B54SensitiveReads=0;$script:B54Forbidden=0;$script:B54MetadataReads=0
$script:B54AllowedMetadataReads=0
$script:B54RankInvalidReads=0;$script:B54RankValidReads=0
function Get-CimInstance {$script:B54Forbidden++;throw 'provider forbidden'}
function Get-CimClass {$script:B54Forbidden++;throw 'provider forbidden'}
function Get-Process {$script:B54Forbidden++;throw 'provider forbidden'}
function Get-NetTCPConnection {$script:B54Forbidden++;throw 'provider forbidden'}
function Test-Path {$script:B54Forbidden++;throw 'provider forbidden'}
function Start-Process {$script:B54Forbidden++;throw 'process forbidden'}
function Stop-Process {$script:B54Forbidden++;throw 'process forbidden'}
function Get-Date {$script:B54Forbidden++;throw 'clock forbidden'}
function Assert-B54 {param([bool]$Check,[string]$Label);if(-not $Check){throw ('B54 assertion: '+$Label)}}
function Case-B54 {param([string]$Name,[scriptblock]$Test);& $Test;$script:B54Cases.Add($Name)}
$b54Tokens=$null;$b54ParseErrors=$null
$b54Ast=[System.Management.Automation.Language.Parser]::ParseInput($ObserverSource,[ref]$b54Tokens,[ref]$b54ParseErrors)
Assert-B54 ($b54ParseErrors.Count -eq 0) 'source parser'
Assert-B54 ($null -eq $b54Ast.BeginBlock -and $null -eq $b54Ast.ProcessBlock -and
    $null -eq $b54Ast.ParamBlock -and $b54Ast.EndBlock.Statements.Count -eq 4) 'four definition-only source statements'
foreach($b54Statement in $b54Ast.EndBlock.Statements) {
    Assert-B54 ($b54Statement -is [System.Management.Automation.Language.FunctionDefinitionAst]) 'no load execution'
}
# Static whitelist is an audit of this fixed source, not an arbitrary-script sandbox.
$b54Commands=@($b54Ast.FindAll({param($n)$n -is [System.Management.Automation.Language.CommandAst]},$true))
foreach($b54Command in $b54Commands) {
    Assert-B54 ($b54Command.GetCommandName() -cin @('Test-B54Integer','Test-B54DataShape','Convert-B54EnumMetadata')) 'no provider/storage/dynamic command'
}
Assert-B54 ($ObserverSource -notmatch '(?i)::UtcNow|::Now|Stopwatch|DateTimeOffset|\.CimClass|\.Value\b|\.CommandLine\b|\.Environment\b|CimSystemProperties') 'forbidden getter/clock source sites absent'
. ([scriptblock]::Create($ObserverSource))
Assert-B54 ($script:B54Forbidden -eq 0 -and $script:B54SensitiveReads -eq 0) 'inert load'

function New-B54Fixture {
    $binding=[pscustomobject]@{HostId='literal-star';AttemptId='literal-attempt';Phase='startup';Target=101;
        Requested=[string[]]@('ProcessId','Name','CreationDate','ExecutablePath');SourceSha256=('a'*64)}
    $bounds=[pscustomobject]@{HostId=$binding.HostId;AttemptId=$binding.AttemptId;Phase=$binding.Phase;
        Target=$binding.Target;SourceSha256=$binding.SourceSha256;OriginId='literal-origin';Frequency=[long]1000;
        BeginTicks=[long]100;EndTicks=[long]110}
    $properties=@()
    foreach($pair in @(@('ProcessId','UInt32'),@('Name','String'),@('CreationDate','DateTime'),@('ExecutablePath','String'),@('Handle','String'),@('CommandLine','String'))) {
        $flags=[Microsoft.Management.Infrastructure.CimFlags]::Property
        if($pair[0] -ceq 'Handle'){$flags=$flags -bor [Microsoft.Management.Infrastructure.CimFlags]::Key}
        $p=[pscustomobject]@{Name=$pair[0];CimType=[Enum]::Parse([Microsoft.Management.Infrastructure.CimType],$pair[1]);Flags=$flags}
        foreach($forbiddenName in @('Value','CommandLine','Environment','CimClass','CimSystemProperties')) {
            $p | Add-Member -MemberType ScriptProperty -Name $forbiddenName -Value {
                $script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'
            }
        }
        $p | Add-Member -MemberType ScriptMethod -Name ToString -Force -Value {
            $script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'
        }
        $properties += $p
    }
    return [pscustomobject]@{Binding=$binding;Bounds=$bounds;Properties=[object[]]$properties}
}
function Run-B54Fixture {param($Fixture)
    return Get-CimPropertyMetadata -Binding $Fixture.Binding -Bounds $Fixture.Bounds -InjectedProperties $Fixture.Properties
}
function Assert-B54Stop {param($Result,[string]$Scope,[string]$Code)
    Assert-B54 ($Result.Status -ceq 'stop-review') 'unsupported stops'
    Assert-B54 (@($Result.Errors | Where-Object {$_.Scope -ceq $Scope -and $_.Code -ceq $Code}).Count -gt 0) ($Scope+'/'+$Code)
    $json=$Result | ConvertTo-Json -Depth 16 -Compress
    Assert-B54 (-not $json.Contains('SENSITIVE_SENTINEL')) 'no exception message or secret output'
}

Case-B54 'definition-only load and static forbidden-site audit' {
    Assert-B54 ($script:B54Forbidden -eq 0 -and $script:B54SensitiveReads -eq 0) 'load counters zero'
}
Case-B54 'normal extra names including CommandLine do not fail' {
    $f=New-B54Fixture;$r=Run-B54Fixture $f
    Assert-B54 ($r.Status -ceq 'metadata-recorded' -and $r.Errors.Count -eq 0 -and $r.Properties.Count -eq 6) 'extra normal'
    Assert-B54 ($r.Properties[4].Kind -ceq 'unrequested-key' -and $r.Properties[4].IsKey) 'derived key'
    Assert-B54 ($r.Properties[5].Kind -ceq 'unrequested-nonkey-descriptor' -and -not $r.Properties[5].HasNotModified) 'no mandatory NotModified assumption'
    Assert-B54 ($r.InputKind -ceq 'trusted-injected-metadata' -and -not $r.LiveProfileValidated) 'injection provenance'
    foreach($p in $r.Properties) {
        Assert-B54 (($p.PSObject.Properties.Name -join ',') -ceq 'Index,Name,NameOk,CimType,Flags,Requested,IsKey,HasNotModified,HasNullValue,Kind') 'explicit output only'
    }
    Assert-B54 ($script:B54SensitiveReads -eq 0) 'sensitive getters and whole object ToString never read'
}
Case-B54 'current label is a caller claim and performs no current query' {
    $f=New-B54Fixture;$f.Binding.Phase='current';$f.Bounds.Phase='current'
    $r=Run-B54Fixture $f
    Assert-B54 ($r.Status -ceq 'metadata-recorded' -and $r.Binding.Phase -ceq 'current' -and $script:B54Forbidden -eq 0) 'label not live continuation'
}
Case-B54 'trusted allowed metadata getter executes once without sandbox claim' {
    $f=New-B54Fixture;$f.Properties[5].PSObject.Properties.Remove('Name')
    $f.Properties[5] | Add-Member ScriptProperty Name {$script:B54AllowedMetadataReads++;return 'CommandLine'}
    $r=Run-B54Fixture $f
    Assert-B54 ($r.Status -ceq 'metadata-recorded' -and $script:B54AllowedMetadataReads -eq 1) 'trusted injection can execute code'
}
foreach($count in @(128,129)) {
    Case-B54 ('unique property count boundary '+$count) {
        $f=New-B54Fixture
        for($i=6;$i -lt $count;$i++) {
            $f.Properties += [pscustomobject]@{Name=('Extra'+$i);CimType=[Microsoft.Management.Infrastructure.CimType]::String;
                Flags=[Microsoft.Management.Infrastructure.CimFlags]::None}
        }
        $r=Run-B54Fixture $f
        Assert-B54 ($r.Properties.Count -eq 128) 'bounded unique prefix'
        Assert-B54 (($r.Status -ceq 'metadata-recorded') -eq ($count -eq 128)) 'exact limit policy'
    }
}
Case-B54 'complete original flags retained and annotations separate' {
    $f=New-B54Fixture
    $v=[Microsoft.Management.Infrastructure.CimFlags]::Property -bor [Microsoft.Management.Infrastructure.CimFlags]::Key -bor
       [Microsoft.Management.Infrastructure.CimFlags]::NotModified -bor [Microsoft.Management.Infrastructure.CimFlags]::NullValue -bor
       [Microsoft.Management.Infrastructure.CimFlags]::Adopt
    $f.Properties[5].Flags=$v;$r=Run-B54Fixture $f;$p=$r.Properties[5]
    Assert-B54 ($r.Status -ceq 'metadata-recorded' -and $p.Flags.EnumString -ceq $v.ToString()) 'native enum string'
    Assert-B54 ($p.Flags.NumericText -ceq '2717913092' -and $p.Flags.UnderlyingType -ceq 'System.Int64') 'lossless beyond signed32'
    Assert-B54 ($p.IsKey -and $p.HasNotModified -and $p.HasNullValue) 'bit derivations'
}
Case-B54 'literal binding copied without normalization or aliasing' {
    $f=New-B54Fixture;$f.Binding.HostId='a*?[]$`';$f.Bounds.HostId=$f.Binding.HostId
    $r=Run-B54Fixture $f;$f.Binding.Requested[0]='Changed';$f.Binding.HostId='Changed'
    Assert-B54 ($r.Binding.HostId -ceq 'a*?[]$`' -and $r.Binding.Requested[0] -ceq 'ProcessId') 'literal deep scalar snapshot'
}
Case-B54 'binding validation does not dispatch GetType or ToString methods' {
    $f=New-B54Fixture
    foreach($data in @($f.Binding,$f.Bounds)) {
        $data | Add-Member ScriptMethod GetType -Force {$script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'}
        $data | Add-Member ScriptMethod ToString -Force {$script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'}
    }
    Assert-B54 ((Run-B54Fixture $f).Status -ceq 'metadata-recorded' -and $script:B54SensitiveReads -eq 0) 'data validation uses native is type gate'
}
foreach($key in @('HostId','AttemptId','Phase','Target','SourceSha256')) {
    Case-B54 ('bounds literal mismatch '+$key) {
        $f=New-B54Fixture
        if($key -ceq 'Target'){$f.Bounds.$key=102}else{$f.Bounds.$key=($f.Bounds.$key+'x')}
        Assert-B54Stop (Run-B54Fixture $f) 'Bounds' 'InvalidBounds'
    }
}
foreach($mode in @('null','extra','getter','empty-host','control','phase-case','float-target','zero-target','overflow-target','source-case','requested-order','requested-case','requested-null','requested-scalar')) {
    Case-B54 ('invalid binding '+$mode) {
        $f=New-B54Fixture
        switch($mode) {
            'null' {$f.Binding=$null}
            'extra' {$f.Binding | Add-Member NoteProperty Extra 1}
            'getter' {$f.Binding.PSObject.Properties.Remove('HostId');$f.Binding | Add-Member ScriptProperty HostId {$script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'}}
            'empty-host' {$f.Binding.HostId=' '}
            'control' {$f.Binding.HostId="bad`n"}
            'phase-case' {$f.Binding.Phase='Startup'}
            'float-target' {$f.Binding.Target=101.0}
            'zero-target' {$f.Binding.Target=0}
            'overflow-target' {$f.Binding.Target=[uint64]::MaxValue}
            'source-case' {$f.Binding.SourceSha256='A'*64}
            'requested-order' {$f.Binding.Requested=@('Name','ProcessId','CreationDate','ExecutablePath')}
            'requested-case' {$f.Binding.Requested[0]='processid'}
            'requested-null' {$f.Binding.Requested=$null}
            'requested-scalar' {$f.Binding.Requested='ProcessId,Name,CreationDate,ExecutablePath'}
        }
        Assert-B54Stop (Run-B54Fixture $f) 'Binding' 'InvalidBinding'
    }
}
foreach($preference in @('Stop','Continue')) {
    foreach($shape in @('rank2','rank3','flat-string','flat-object','non-array','nonzero-lower-bound','wrong-order')) {
        Case-B54 ('Requested shape '+$shape+' caller preference '+$preference) {
            $f=New-B54Fixture;$expected=@('ProcessId','Name','CreationDate','ExecutablePath')
            switch($shape) {
                'rank2' {
                    $requested=[object[,]]::new(2,2)
                    $requested[0,0]=$expected[0];$requested[0,1]=$expected[1]
                    $requested[1,0]=$expected[2];$requested[1,1]=$expected[3]
                }
                'rank3' {
                    $requested=[object[,,]]::new(1,2,2)
                    $requested[0,0,0]=$expected[0];$requested[0,0,1]=$expected[1]
                    $requested[0,1,0]=$expected[2];$requested[0,1,1]=$expected[3]
                }
                'flat-string' {$requested=[string[]]$expected.Clone()}
                'flat-object' {$requested=[object[]]$expected.Clone()}
                'non-array' {
                    $requested=[System.Collections.Generic.List[string]]::new()
                    $requested.AddRange([string[]]$expected)
                }
                'nonzero-lower-bound' {
                    $requested=[array]::CreateInstance([object],[int[]]@(4),[int[]]@(1))
                    for($i=0;$i -lt 4;$i++){$requested.SetValue($expected[$i],$i+1)}
                }
                'wrong-order' {$requested=[string[]]@('Name','ProcessId','CreationDate','ExecutablePath')}
            }
            $f.Binding.Requested=$requested
            $rankState=[pscustomobject]@{Reads=0}
            foreach($p in $f.Properties) {
                foreach($field in @('Name','CimType','Flags')) {
                    $rankValue=$p.$field
                    $p.PSObject.Properties.Remove($field)
                    $reader={$rankState.Reads++;return $rankValue}.GetNewClosure()
                    $p | Add-Member ScriptProperty $field $reader
                }
            }
            $previousPreference=$ErrorActionPreference;$rankErrors=@();$caught=$false;$records=@()
            try {
                $ErrorActionPreference=$preference
                $records=@(Get-CimPropertyMetadata -Binding $f.Binding -Bounds $f.Bounds -InjectedProperties $f.Properties -ErrorVariable +rankErrors)
            } catch {$caught=$true} finally {$ErrorActionPreference=$previousPreference}
            Assert-B54 (-not $caught -and $rankErrors.Count -eq 0 -and $records.Count -eq 1) 'one structured result, no error stream or throw'
            $r=$records[0]
            if($shape -cin @('flat-string','flat-object')) {
                Assert-B54 ($r.Status -ceq 'metadata-recorded' -and $rankState.Reads -eq 18) 'normal arrays reach exactly allowed metadata getters'
                $script:B54RankValidReads += $rankState.Reads
            } else {
                Assert-B54Stop $r 'Binding' 'InvalidBinding'
                Assert-B54 (-not $r.Validity.Binding -and $null -eq $r.Binding -and $r.Properties.Count -eq 0 -and $rankState.Reads -eq 0) 'all binding checks finish before metadata reads'
                $script:B54RankInvalidReads += $rankState.Reads
            }
        }
    }
}
foreach($mode in @('null','extra','origin-empty','frequency-zero','frequency-float','begin-negative','end-float','reverse','too-wide','uint64-overflow')) {
    Case-B54 ('invalid bounds '+$mode) {
        $f=New-B54Fixture
        switch($mode) {
            'null' {$f.Bounds=$null}
            'extra' {$f.Bounds | Add-Member NoteProperty Extra 1}
            'origin-empty' {$f.Bounds.OriginId=''}
            'frequency-zero' {$f.Bounds.Frequency=0}
            'frequency-float' {$f.Bounds.Frequency=1000.0}
            'begin-negative' {$f.Bounds.BeginTicks=-1}
            'end-float' {$f.Bounds.EndTicks=110.0}
            'reverse' {$f.Bounds.EndTicks=99}
            'too-wide' {$f.Bounds.EndTicks=10101}
            'uint64-overflow' {$f.Bounds.EndTicks=[uint64]::MaxValue}
        }
        Assert-B54Stop (Run-B54Fixture $f) 'Bounds' 'InvalidBounds'
    }
}
Case-B54 'invalid bounds prevent even trusted metadata getters' {
    $f=New-B54Fixture;$f.Bounds.EndTicks=0
    $p=[pscustomobject]@{};$p | Add-Member ScriptProperty Name {$script:B54MetadataReads++;throw 'SENSITIVE_SENTINEL'}
    $f.Properties=@($p);$r=Run-B54Fixture $f
    Assert-B54 ($r.Properties.Count -eq 0 -and $script:B54MetadataReads -eq 0) 'no read after invalid bounds'
}
Case-B54 'zero span and maximum frequency do not overflow bound arithmetic' {
    $f=New-B54Fixture;$f.Bounds.Frequency=[long]::MaxValue;$f.Bounds.BeginTicks=[long]::MaxValue;$f.Bounds.EndTicks=[long]::MaxValue
    Assert-B54 ((Run-B54Fixture $f).Status -ceq 'metadata-recorded') 'exact BigInteger span'
}
foreach($mode in @('null','scalar','multidimensional','empty','null-entry','missing-field','wrong-enum-type','enum-string','malformed-name','duplicate','duplicate-case','required-missing','required-type','known-unknown-type','unknown-type','unknown-bits','count-limit')) {
    Case-B54 ('metadata malformed or unsupported '+$mode) {
        $f=New-B54Fixture
        switch($mode) {
            'null' {$f.Properties=$null}
            'scalar' {$f.Properties=$f.Properties[0]}
            'multidimensional' {$f.Properties=[object[,]]::new(2,2)}
            'empty' {$f.Properties=@()}
            'null-entry' {$f.Properties[5]=$null}
            'missing-field' {$f.Properties[5].PSObject.Properties.Remove('Flags')}
            'wrong-enum-type' {$f.Properties[5].Flags=[System.IO.FileAttributes]::ReadOnly}
            'enum-string' {$f.Properties[5].Flags='Property'}
            'malformed-name' {$f.Properties[5].Name='bad name'}
            'duplicate' {$f.Properties += $f.Properties[0]}
            'duplicate-case' {$f.Properties[5].Name='processid'}
            'required-missing' {$f.Properties=@($f.Properties[1..5])}
            'required-type' {$f.Properties[0].CimType=[Microsoft.Management.Infrastructure.CimType]::String}
            'known-unknown-type' {$f.Properties[5].CimType=[Microsoft.Management.Infrastructure.CimType]::Unknown}
            'unknown-type' {$f.Properties[5].CimType=[Enum]::ToObject([Microsoft.Management.Infrastructure.CimType],[int]2147483647)}
            'unknown-bits' {$f.Properties[5].Flags=[Enum]::ToObject([Microsoft.Management.Infrastructure.CimFlags],[long]134217728)}
            'count-limit' {$f.Properties=@($f.Properties[0])*129}
        }
        $r=Run-B54Fixture $f
        Assert-B54 ($r.Status -ceq 'stop-review' -and $r.Errors.Count -gt 0) 'malformed stop'
        if($mode -ceq 'unknown-bits') {
            Assert-B54 ($r.Properties[5].Flags.NumericText -ceq '134217728' -and $r.Properties[5].Flags.UnknownBitsText -ceq '134217728') 'unknown bits retained'
        }
        if($mode -ceq 'unknown-type'){Assert-B54 ($r.Properties[5].CimType.NumericText -ceq '2147483647') 'unknown enum retained'}
        if($mode -ceq 'malformed-name'){Assert-B54 ($r.Properties[5].Name -ceq 'bad name' -and -not $r.Properties[5].NameOk) 'bounded malformed name retained'}
        if($mode -ceq 'count-limit'){Assert-B54 ($r.Properties.Count -eq 128 -and -not $r.Validity.Collection) 'bounded prefix retained'}
    }
}
foreach($field in @('Name','CimType','Flags')) {
    Case-B54 ('partial throwing metadata getter '+$field) {
        $f=New-B54Fixture;$f.Properties[5].PSObject.Properties.Remove($field)
        $f.Properties[5] | Add-Member ScriptProperty $field {throw 'SENSITIVE_SENTINEL'}
        $r=Run-B54Fixture $f
        Assert-B54 ($r.Status -ceq 'stop-review' -and $r.Properties.Count -eq 6) 'partial records retained'
        Assert-B54 (-not (($r | ConvertTo-Json -Depth 16 -Compress).Contains('SENSITIVE_SENTINEL'))) 'message omitted'
        if($field -cne 'Flags'){Assert-B54 ($r.Properties[5].Flags.Ok) 'independent flag capture survives'}
        if($field -cne 'CimType'){Assert-B54 ($r.Properties[5].CimType.Ok) 'independent CimType capture survives'}
    }
}
Case-B54 'native entry rejects mock result before its property getter' {
    $f=New-B54Fixture;$mock=[pscustomobject]@{}
    $mock | Add-Member ScriptProperty CimInstanceProperties {$script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'}
    $mock | Add-Member ScriptMethod GetType -Force {return [Microsoft.Management.Infrastructure.CimInstance]}
    $r=Get-CimPropertyMetadata -CimResult $mock -Binding $f.Binding -Bounds $f.Bounds
    Assert-B54Stop $r 'Collection' 'CollectionReadError'
    Assert-B54 ($script:B54SensitiveReads -eq 0) 'fake native getter not read'
}
foreach($text in @('9223372036854775807','-9223372036854775808','-1','2147483648','9007199254740993')) {
    Case-B54 ('integrated raw Int64 flags '+$text) {
        $f=New-B54Fixture
        $f.Properties[5].Flags=[Enum]::ToObject([Microsoft.Management.Infrastructure.CimFlags],[long]::Parse($text,[Globalization.CultureInfo]::InvariantCulture))
        $r=Run-B54Fixture $f
        Assert-B54 ($r.Properties[5].Flags.NumericText -ceq $text) 'integrated exact flags preserved'
        Assert-B54 (($r.Status -ceq 'metadata-recorded') -eq ($text -ceq '2147483648')) 'known Adopt versus unresolved flags'
    }
}
Case-B54 'typed raw enum max and sign boundary regression' {
    foreach($text in @('9223372036854775807','-9223372036854775808','-1','2147483648','9007199254740993')) {
        $v=[Enum]::ToObject([Microsoft.Management.Infrastructure.CimFlags],[long]::Parse($text,[Globalization.CultureInfo]::InvariantCulture))
        $m=Convert-B54EnumMetadata $v ([Microsoft.Management.Infrastructure.CimFlags]) -Flags
        Assert-B54 ($m.Ok -and $m.NumericText -ceq $text -and $m.EnumString -ceq $v.ToString()) 'real Int64 exact numeric and enum text'
        Assert-B54 ($m.Known -eq ($text -ceq '2147483648')) 'known Adopt versus unknown raw bits'
    }
}
# Pure in-memory CLR enum fixtures, all integer widths/signs; no Add-Type/compiler/provider.
$b54Assembly=[AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('B54LocalEnumFixtures'),[Reflection.Emit.AssemblyBuilderAccess]::Run)
$b54Module=$b54Assembly.DefineDynamicModule('B54LocalEnumFixtures')
foreach($underlying in @([sbyte],[byte],[int16],[uint16],[int],[uint32],[long],[uint64])) {
    $builder=$b54Module.DefineEnum(('B54Fixture'+$underlying.Name),[Reflection.TypeAttributes]::Public,$underlying)
    [void]$builder.DefineLiteral('Zero',[Convert]::ChangeType(0,$underlying,[Globalization.CultureInfo]::InvariantCulture))
    [void]$builder.DefineLiteral('One',[Convert]::ChangeType(1,$underlying,[Globalization.CultureInfo]::InvariantCulture))
    $enumType=$builder.CreateType()
    foreach($boundary in @('MinValue','MaxValue')) {
        Case-B54 ('local CLR enum '+$underlying.Name+' '+$boundary) {
            $integer=$underlying.GetField($boundary).GetRawConstantValue()
            $v=[Enum]::ToObject($enumType,$integer)
            $m=Convert-B54EnumMetadata $v $enumType -Flags
            $text=$integer.ToString('D',[Globalization.CultureInfo]::InvariantCulture)
            Assert-B54 ($m.Ok -and $m.NumericText -ceq $text -and $m.UnderlyingType -ceq $underlying.FullName) 'width and sign exact'
            $expected=[System.Numerics.BigInteger]::Parse($text,[Globalization.CultureInfo]::InvariantCulture)
            if($expected.Sign -lt 0){$expected=$expected+[System.Numerics.BigInteger]::Pow(2,$m.BitWidth)}
            Assert-B54 ($m.UnsignedBitsText -ceq $expected.ToString([Globalization.CultureInfo]::InvariantCulture)) 'two complement bit pattern exact'
        }
    }
}
Case-B54 'non enum impostor cannot trigger ToString' {
    $p=[pscustomobject]@{};$p | Add-Member ScriptMethod ToString -Force {$script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'}
    $p | Add-Member ScriptMethod GetType -Force {return [Microsoft.Management.Infrastructure.CimFlags]}
    $m=Convert-B54EnumMetadata $p ([Microsoft.Management.Infrastructure.CimFlags]) -Flags
    Assert-B54 (-not $m.Ok -and $script:B54SensitiveReads -eq 0) 'no arbitrary ToString'
}
Case-B54 'native enum ETS method overrides do not execute' {
    $v=[psobject]([Microsoft.Management.Infrastructure.CimFlags]::Property)
    $v | Add-Member ScriptMethod ToString -Force {$script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'}
    $v | Add-Member ScriptMethod GetType -Force {$script:B54SensitiveReads++;throw 'SENSITIVE_SENTINEL'}
    $m=Convert-B54EnumMetadata $v ([Microsoft.Management.Infrastructure.CimFlags]) -Flags
    Assert-B54 ($m.Ok -and $m.EnumString -ceq 'Property' -and $m.NumericText -ceq '4' -and $script:B54SensitiveReads -eq 0) 'native formatting bypasses ETS methods'
}
Assert-B54 ($script:B54SensitiveReads -eq 0 -and $script:B54Forbidden -eq 0 -and $script:B54MetadataReads -eq 0 -and
    $script:B54RankInvalidReads -eq 0 -and $script:B54RankValidReads -eq 72) 'all traps zero and rank controls exercised'
[pscustomobject]@{Passed=$script:B54Cases.Count;Cases=$script:B54Cases.ToArray();SensitiveReads=$script:B54SensitiveReads;
    ForbiddenProviderProcessClockCalls=$script:B54Forbidden;UnexpectedMetadataReads=$script:B54MetadataReads;
    ExplicitTrustedMetadataGetterCalls=$script:B54AllowedMetadataReads;
    RankRegressionInvalidMetadataReads=$script:B54RankInvalidReads;RankRegressionValidMetadataReads=$script:B54RankValidReads;
    NativeLiveResultTested=$false;LiveProfileValidated=$false} | ConvertTo-Json -Depth 6
