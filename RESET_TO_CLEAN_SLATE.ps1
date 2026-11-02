$ErrorActionPreference = "Stop"
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " HIUSA: RESETTING DATABASE TO CLEAN SLATE FOR LIVE DEMO" -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

Push-Location "$PSScriptRoot\server"
try {
    php artisan migrate:fresh --force

    $phpCode = @'
<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use App\Models\Venue;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

$saoOrg = Organization::updateOrCreate(
    ['acronym' => 'SAO'],
    [
        'name' => 'Student Affairs Office',
        'slug' => 'student-affairs-office',
        'organization_type' => 'SYSTEM_ADMINISTRATION',
        'description' => 'System administration office for university-wide student organization oversight.',
        'lifecycle_status' => 'active',
        'is_active' => true,
    ]
);

$saoUser = User::updateOrCreate(
    ['school_id' => 990001],
    [
        'organization_id' => $saoOrg->id,
        'first_name' => 'SAO',
        'last_name' => 'Director',
        'email' => 'sao.director@hiusa.local',
        'password_hash' => 'Admin@123456',
        'role' => 'SUPER_ADMIN',
        'position_title' => 'SAO Director',
        'account_status' => 'active',
        'is_member' => true,
    ]
);

$ccs = College::updateOrCreate(
    ['name' => 'College of Computer Studies'],
    [
        'code' => 'CCS',
        'color' => '#0B8ED0',
        'description' => 'Academic college for Information Technology and Computer Science programs.',
        'is_active' => true,
    ]
);

$ccsOrg = Organization::updateOrCreate(
    ['organization_type' => 'COLLEGE', 'college_id' => $ccs->id],
    [
        'name' => $ccs->name,
        'slug' => Str::slug($ccs->name),
        'college' => $ccs->name,
        'acronym' => $ccs->code,
        'lifecycle_status' => 'active',
        'is_active' => true,
    ]
);

$dean = User::updateOrCreate(
    ['school_id' => 940001],
    [
        'organization_id' => $ccsOrg->id,
        'first_name' => 'Ramon',
        'last_name' => 'Castillo',
        'email' => 'dean.ccs@hiusa.local',
        'password_hash' => 'Demo@12345',
        'role' => 'DEPARTMENT_HEAD',
        'department' => $ccs->name,
        'position_title' => 'College Dean',
        'account_status' => 'active',
        'is_member' => true,
    ]
);

DB::table('account_profiles')->updateOrInsert(
    ['user_school_id' => $dean->school_id, 'organization_id' => $ccsOrg->id],
    [
        'role' => 'DEPARTMENT_HEAD',
        'account_status' => 'active',
        'position_title' => 'College Dean',
        'created_at' => now(),
        'updated_at' => now(),
    ]
);

foreach ([
    ['name' => 'UC Main Auditorium', 'location' => 'Main Campus Building', 'capacity' => 500, 'description' => 'Stage lighting, LED wall, PA sound system, podium'],
    ['name' => 'CCS Function Hall / AVR', 'location' => 'CCS Building 4th Floor', 'capacity' => 150, 'description' => 'Projector, wireless microphones, air conditioning'],
    ['name' => 'University Gymnasium', 'location' => 'Sports Complex', 'capacity' => 1200, 'description' => 'Full court, bleachers, PA system, scoreboard'],
] as $venue) {
    Venue::updateOrCreate(
        ['name' => $venue['name']],
        [
            ...$venue,
            'is_active' => true,
            'created_by' => $saoUser->school_id,
        ]
    );
}

echo "Clean slate seeded successfully! Users: " . User::count() . ", Student Orgs: " . Organization::student()->count() . ", Academic Years: " . \App\Models\AcademicYear::count() . "\n";
'@

    $tmpFile = Join-Path $PSScriptRoot "server\clean_slate_seed.php"
    [System.IO.File]::WriteAllText($tmpFile, $phpCode)
    php $tmpFile
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
} finally {
    Pop-Location
}

Write-Host ""
Write-Host "CLEAN SLATE IS ACTIVE!" -ForegroundColor Green
Write-Host "  - Academic Years & Semesters: 0 (Ready to create from scratch)"
Write-Host "  - Student Organizations:      0 (Ready to create from scratch)"
Write-Host "  - SAO Login:                  990001 / Admin@123456"
Write-Host "  - CCS Dean Login:             940001 / Demo@12345"
Write-Host "  - Sample PDFs for Upload:     c:\BSIT\React\Hiusa-FULL\demo-sample-files\"
