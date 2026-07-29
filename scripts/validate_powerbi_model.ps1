<#
.SYNOPSIS
    Validate the ARPI Power BI semantic model against its SQL baseline, using a running
    Power BI Desktop instance.

.DESCRIPTION
    GitHub Actions cannot run Power BI Desktop. Everything a text file can prove about
    this model is already proven by `scripts/check_powerbi_model.py` in CI. What no static
    check can prove is that the model actually OPENS, that it REFRESHES against a real
    PostgreSQL database, and that its DAX returns the same numbers the governed SQL does
    under filter context. That is what this script is for, and it is the reason Lifecycle
    Phase 5 is not complete until a human has run it once.

    The script:

      1. Finds the running Power BI Desktop instance and its local Analysis Services port.
      2. Connects with the ADOMD.NET client and reads the model's own metadata through
         the DISCOVER/DMV schema rowsets.
      3. Checks the table, relationship and measure inventories against
         powerbi/validation/model_expectations.json.
      4. Executes every query in powerbi/validation/validation_queries.dax.
      5. Compares each returned value with powerbi/validation/sql_baseline.json.
      6. Writes powerbi/validation/desktop_validation_results.json.
      7. Exits non-zero if anything failed.

    It never prints, logs or stores a credential. It reads no password and asks for none:
    the connection is to the local Desktop instance, which is already authenticated as
    you.

.PARAMETER Port
    Local Analysis Services port. Omit to auto-detect the running Power BI Desktop.

.PARAMETER Tolerance
    Relative tolerance for a floating-point comparison. Defaults to 1e-6. Counts are
    compared exactly regardless of this value.

.PARAMETER SkipRefresh
    Record the refresh result as "not attempted" instead of requiring that you refreshed
    before running. Use only when you have just refreshed by hand; the default assumes
    you refreshed in Desktop immediately before running this.

.EXAMPLE
    PS> .\scripts\validate_powerbi_model.ps1

.NOTES
    Requires Windows, Power BI Desktop, and the ADOMD.NET client library, which Power BI
    Desktop installs. Requires python on PATH for the model-source hash, so that the hash
    this script records and the hash CI computes come from one implementation rather than
    two that can disagree.
#>

[CmdletBinding()]
param(
    [int] $Port = 0,
    [double] $Tolerance = 1e-6,
    [switch] $SkipRefresh
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot       = Split-Path -Parent $PSScriptRoot
$ValidationDir  = Join-Path $RepoRoot 'powerbi\validation'
$BaselinePath   = Join-Path $ValidationDir 'sql_baseline.json'
$ExpectationsPath = Join-Path $ValidationDir 'model_expectations.json'
$QueriesPath    = Join-Path $ValidationDir 'validation_queries.dax'
$ResultsPath    = Join-Path $ValidationDir 'desktop_validation_results.json'

$passed = [System.Collections.Generic.List[string]]::new()
$failed = [System.Collections.Generic.List[string]]::new()
$differences = [System.Collections.Generic.List[object]]::new()

function Write-Step { param([string] $Message) Write-Host "==> $Message" }
function Add-Pass   { param([string] $Id) $script:passed.Add($Id) | Out-Null }
function Add-Fail   { param([string] $Id, [string] $Detail)
    $script:failed.Add($Id) | Out-Null
    Write-Host "    FAIL  $Id  $Detail" -ForegroundColor Red
}

# ---------------------------------------------------------------------------------------
# 1. Locate the running Power BI Desktop model
# ---------------------------------------------------------------------------------------
function Find-AnalysisServicesPort {
    <#
        Power BI Desktop writes the port of its embedded Analysis Services instance to
        msmdsrv.port.txt inside the workspace folder it creates for the open file. There
        is one folder per open document; if several are open the newest is used and the
        script says so, because validating the wrong document silently would be worse
        than failing.
    #>
    $roots = @(
        Join-Path $env:LOCALAPPDATA 'Microsoft\Power BI Desktop\AnalysisServicesWorkspaces'
        Join-Path $env:LOCALAPPDATA 'Microsoft\Power BI Desktop Store App\AnalysisServicesWorkspaces'
    ) | Where-Object { Test-Path $_ }

    $portFiles = foreach ($root in $roots) {
        Get-ChildItem -Path $root -Filter 'msmdsrv.port.txt' -Recurse -ErrorAction SilentlyContinue
    }
    $portFiles = @($portFiles | Sort-Object LastWriteTime -Descending)

    if ($portFiles.Count -eq 0) {
        throw 'No running Power BI Desktop model was found. Open ARPI_Performance_Intelligence.pbip in Power BI Desktop, refresh it, and leave it open.'
    }
    if ($portFiles.Count -gt 1) {
        Write-Warning "$($portFiles.Count) Power BI Desktop models are open; using the most recently written workspace. Close the others to remove any doubt about which one was validated."
    }
    $text = (Get-Content -Path $portFiles[0].FullName -Raw -Encoding Unicode).Trim([char]0, ' ', "`r", "`n")
    return [int] $text
}

function Get-AdomdConnection {
    param([int] $Port)

    $candidates = @(
        "${env:ProgramFiles}\Microsoft.NET\ADOMD.NET\160\Microsoft.AnalysisServices.AdomdClient.dll"
        "${env:ProgramFiles}\Microsoft.NET\ADOMD.NET\150\Microsoft.AnalysisServices.AdomdClient.dll"
        "${env:ProgramFiles}\Microsoft.NET\ADOMD.NET\140\Microsoft.AnalysisServices.AdomdClient.dll"
        "${env:ProgramFiles(x86)}\Microsoft.NET\ADOMD.NET\150\Microsoft.AnalysisServices.AdomdClient.dll"
    )
    $dll = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $dll) {
        try   { Add-Type -AssemblyName 'Microsoft.AnalysisServices.AdomdClient' }
        catch { throw 'The ADOMD.NET client library was not found. It ships with Power BI Desktop and with SQL Server Management Studio; install either, or add Microsoft.AnalysisServices.AdomdClient.dll to the GAC.' }
    }
    else {
        Add-Type -Path $dll
    }

    # localhost with no credential: this is the embedded instance, already running as you.
    $connection = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$Port")
    $connection.Open()
    return $connection
}

function Invoke-Dax {
    param(
        [Parameter(Mandatory)] $Connection,
        [Parameter(Mandatory)] [string] $Query
    )
    $command = $Connection.CreateCommand()
    $command.CommandText = $Query
    $adapter = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdDataAdapter($command)
    $table = New-Object System.Data.DataTable
    [void] $adapter.Fill($table)
    return $table
}

# ---------------------------------------------------------------------------------------
# 2. Parse the generated DAX query file
# ---------------------------------------------------------------------------------------
function Read-ContextQueries {
    param([string] $Path)

    $queries = [ordered] @{}
    $currentId = $null
    $buffer = [System.Text.StringBuilder]::new()

    foreach ($line in Get-Content -Path $Path) {
        if ($line -match '^//\s*ARPI-CONTEXT:\s*(\S+)\s*$') {
            if ($currentId) { $queries[$currentId] = $buffer.ToString() }
            $currentId = $Matches[1]
            $buffer = [System.Text.StringBuilder]::new()
            continue
        }
        if ($currentId -and -not ($line -match '^\s*//')) {
            [void] $buffer.AppendLine($line)
        }
    }
    if ($currentId) { $queries[$currentId] = $buffer.ToString() }
    return $queries
}

# ---------------------------------------------------------------------------------------
# 3. Run
# ---------------------------------------------------------------------------------------
foreach ($required in @($BaselinePath, $ExpectationsPath, $QueriesPath)) {
    if (-not (Test-Path $required)) {
        throw "Required validation artefact is missing: $required. Run scripts/generate_sql_baseline.py against a development-profile database first."
    }
}

$baseline     = Get-Content -Raw -Path $BaselinePath     | ConvertFrom-Json
$expectations = Get-Content -Raw -Path $ExpectationsPath | ConvertFrom-Json

Write-Step 'Computing the model source hash'
$modelHash = (& python (Join-Path $RepoRoot 'scripts\check_desktop_validation_freshness.py') --print-hash).Trim()
if ($LASTEXITCODE -ne 0 -or -not ($modelHash -match '^[0-9a-f]{64}$')) {
    throw 'Could not compute the model source hash. python must be on PATH and scripts/check_desktop_validation_freshness.py must be present.'
}
Write-Host "    $modelHash"

if ($Port -le 0) {
    Write-Step 'Locating the running Power BI Desktop model'
    $Port = Find-AnalysisServicesPort
}
Write-Host "    Analysis Services endpoint: localhost:$Port"

Write-Step 'Connecting'
$connection = Get-AdomdConnection -Port $Port

$desktopVersion = $null
$compatibilityLevel = $null
$tableCount = $null
$importedTableCount = $null
$measureTableCount = $null
$relationshipCount = $null
$activeRelationshipCount = $null
$inactiveRelationshipCount = $null
$measureCount = $null
$rowCounts = [ordered] @{}

try {
    # -----------------------------------------------------------------------------------
    # Model metadata, read from the model itself rather than from the TMDL on disk. The
    # point of this script is to prove that what Desktop loaded matches what was written.
    # -----------------------------------------------------------------------------------
    Write-Step 'Reading model metadata'
    $catalogs = Invoke-Dax -Connection $connection -Query 'SELECT [CATALOG_NAME], [COMPATIBILITY_LEVEL] FROM $SYSTEM.DBSCHEMA_CATALOGS'
    if ($catalogs.Rows.Count -gt 0) {
        $compatibilityLevel = [int] $catalogs.Rows[0]['COMPATIBILITY_LEVEL']
    }
    try {
        $desktopVersion = (Get-Process -Name 'PBIDesktop' -ErrorAction SilentlyContinue |
            Select-Object -First 1).FileVersion
    } catch { $desktopVersion = $null }

    $tables = Invoke-Dax -Connection $connection -Query 'SELECT [Name], [IsHidden] FROM $SYSTEM.TMSCHEMA_TABLES'
    $tableNames = @($tables.Rows | ForEach-Object { [string] $_['Name'] })
    $tableCount = $tableNames.Count
    $measureTableNames = @($tableNames | Where-Object { $_ -like '* Measures' })
    $measureTableCount = $measureTableNames.Count
    $importedTableCount = $tableCount - $measureTableCount

    $relationships = Invoke-Dax -Connection $connection -Query 'SELECT [IsActive], [CrossFilteringBehavior], [FromCardinality], [ToCardinality] FROM $SYSTEM.TMSCHEMA_RELATIONSHIPS'
    $relationshipCount = $relationships.Rows.Count
    $activeRelationshipCount = @($relationships.Rows | Where-Object { [bool] $_['IsActive'] }).Count
    $inactiveRelationshipCount = $relationshipCount - $activeRelationshipCount
    $bidirectional = @($relationships.Rows | Where-Object { [int] $_['CrossFilteringBehavior'] -ne 1 }).Count
    $manyToMany = @($relationships.Rows | Where-Object { [int] $_['ToCardinality'] -ne 1 }).Count

    $measures = Invoke-Dax -Connection $connection -Query 'SELECT [Name] FROM $SYSTEM.TMSCHEMA_MEASURES'
    $measureCount = $measures.Rows.Count

    function Assert-Count {
        param([string] $Id, $Actual, $Expected)
        if ($Actual -eq $Expected) { Add-Pass "inventory:$Id" }
        else { Add-Fail "inventory:$Id" "expected $Expected, model reports $Actual" }
    }

    Assert-Count 'tables'                  $tableCount                $expectations.table_count
    Assert-Count 'imported-tables'         $importedTableCount        $expectations.imported_table_count
    Assert-Count 'measure-tables'          $measureTableCount         $expectations.measure_table_count
    Assert-Count 'relationships'           $relationshipCount         $expectations.relationship_count
    Assert-Count 'active-relationships'    $activeRelationshipCount   $expectations.active_relationship_count
    Assert-Count 'inactive-relationships'  $inactiveRelationshipCount $expectations.inactive_relationship_count
    Assert-Count 'measures'                $measureCount              $expectations.measure_count
    Assert-Count 'bidirectional-relationships' $bidirectional 0
    Assert-Count 'many-to-many-relationships'  $manyToMany    0

    # -----------------------------------------------------------------------------------
    # Row counts: proof that the refresh actually loaded data, per table, and that it
    # loaded the profile the baseline was taken from.
    # -----------------------------------------------------------------------------------
    Write-Step 'Counting loaded rows'
    foreach ($property in $expectations.expected_row_counts.PSObject.Properties) {
        $table = $property.Name
        $expected = [int] $property.Value
        $result = Invoke-Dax -Connection $connection -Query "EVALUATE ROW ( ""n"", COUNTROWS ( '$table' ) )"
        $actual = if ($result.Rows.Count -gt 0 -and $result.Rows[0][0] -isnot [DBNull]) { [int] $result.Rows[0][0] } else { 0 }
        $rowCounts[$table] = $actual
        if ($actual -eq 0) {
            Add-Fail "rows:$table" 'refreshed to zero rows'
        }
        elseif ($actual -ne $expected) {
            Add-Fail "rows:$table" "expected $expected (development profile), loaded $actual"
        }
        else {
            Add-Pass "rows:$table"
        }
    }

    # -----------------------------------------------------------------------------------
    # SQL to DAX, context by context
    # -----------------------------------------------------------------------------------
    Write-Step 'Comparing DAX with the SQL baseline'
    $queries = Read-ContextQueries -Path $QueriesPath

    foreach ($context in $baseline.contexts) {
        $contextId = $context.context_id
        if (-not $queries.Contains($contextId)) {
            Add-Fail "sql-to-dax:$contextId" 'no DAX query was generated for this context'
            continue
        }

        $table = Invoke-Dax -Connection $connection -Query $queries[$contextId]
        if ($table.Rows.Count -ne 1) {
            Add-Fail "sql-to-dax:$contextId" "the query returned $($table.Rows.Count) rows; exactly one was expected"
            continue
        }
        $row = $table.Rows[0]

        foreach ($measureProperty in $context.measures.PSObject.Properties) {
            $key = $measureProperty.Name
            if ($key.StartsWith('_')) { continue }   # diagnostics, not measures
            $expected = $measureProperty.Value

            $column = @($table.Columns | Where-Object { $_.ColumnName -like "*$key*" } | Select-Object -First 1)
            if (-not $column) {
                Add-Fail "sql-to-dax:${contextId}:$key" 'the DAX query returned no column for this measure'
                continue
            }
            $raw = $row[$column[0].ColumnName]
            $actual = if ($raw -is [DBNull]) { $null } else { [double] $raw }

            $checkId = "sql-to-dax:${contextId}:$key"
            $measureName = $expectations.measure_map.$key

            if ($null -eq $expected -and $null -eq $actual) { Add-Pass $checkId; continue }
            if ($null -eq $expected -or $null -eq $actual) {
                # A blank on one side and a number on the other is the single most
                # important failure this script can catch: it is how a zero denominator
                # starts rendering as $0 instead of as a gap.
                Add-Fail $checkId "SQL=$expected DAX=$actual (one side is blank and the other is not)"
                $differences.Add([ordered] @{
                    context_id = $contextId; measure_key = $key; measure_name = $measureName
                    sql_value = $expected; dax_value = $actual
                    absolute_difference = $null; tolerance = $Tolerance
                }) | Out-Null
                continue
            }

            $delta = [math]::Abs([double] $expected - $actual)
            $scale = [math]::Max(1.0, [math]::Abs([double] $expected))
            if ($delta / $scale -le $Tolerance) {
                Add-Pass $checkId
            }
            else {
                Add-Fail $checkId "SQL=$expected DAX=$actual delta=$delta"
                $differences.Add([ordered] @{
                    context_id = $contextId; measure_key = $key; measure_name = $measureName
                    sql_value = [double] $expected; dax_value = $actual
                    absolute_difference = $delta; tolerance = $Tolerance
                }) | Out-Null
            }
        }
    }
}
finally {
    $connection.Close()
}

# ---------------------------------------------------------------------------------------
# 4. Record the evidence
# ---------------------------------------------------------------------------------------
$overall = if ($failed.Count -eq 0) { 'passed' } else { 'failed' }

$result = [ordered] @{
    schema                      = 'arpi.desktop_validation_results/1'
    validated_at                = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    model_source_hash           = $modelHash
    power_bi_desktop_version    = $desktopVersion
    compatibility_level         = $compatibilityLevel
    refresh_result              = if ($SkipRefresh) { 'not attempted' } else { 'succeeded' }
    table_count                 = $tableCount
    imported_table_count        = $importedTableCount
    measure_table_count         = $measureTableCount
    relationship_count          = $relationshipCount
    active_relationship_count   = $activeRelationshipCount
    inactive_relationship_count = $inactiveRelationshipCount
    measure_count               = $measureCount
    row_counts                  = $rowCounts
    passed_checks               = @($passed)
    failed_checks               = @($failed)
    sql_to_dax_differences      = @($differences)
    overall_result              = $overall
    notes                       = 'Written by scripts/validate_powerbi_model.ps1 against a running Power BI Desktop instance. The model_source_hash above is what makes this evidence falsifiable: edit the TMDL and CI reports the evidence as stale rather than as passed.'
}

$result | ConvertTo-Json -Depth 6 | Set-Content -Path $ResultsPath -Encoding UTF8

Write-Host ''
Write-Host "passed: $($passed.Count)   failed: $($failed.Count)   result: $overall"
Write-Host "wrote  : powerbi/validation/desktop_validation_results.json"
Write-Host ''
if ($overall -ne 'passed') {
    Write-Host 'Desktop validation FAILED. Do not mark the pull request ready.' -ForegroundColor Red
    exit 1
}
Write-Host 'Desktop validation PASSED. Commit desktop_validation_results.json to the pull request branch.' -ForegroundColor Green
exit 0
