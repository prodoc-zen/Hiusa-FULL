$ErrorActionPreference = "Stop"
Push-Location "$PSScriptRoot\server"
try {
    $phpCode = @'
<?php
require __DIR__ . '/vendor/autoload.php';
$app = require_once __DIR__ . '/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Models\OrganizationApplication;

$appModel = OrganizationApplication::where('status', 'pending_verification')->latest('id')->first();
if (!$appModel) {
    echo "No pending_verification public application found.\n";
} else {
    $appModel->update([
        'status' => 'pending_endorsement',
        'email_verified_at' => now(),
    ]);
    echo "Verified public application #{$appModel->id}: {$appModel->name} ({$appModel->acronym}) -> now pending_endorsement for Department Head!\n";
}
'@
    $tmpFile = Join-Path $PSScriptRoot "server\verify_app.php"
    [System.IO.File]::WriteAllText($tmpFile, $phpCode)
    php $tmpFile
    Remove-Item $tmpFile -Force -ErrorAction SilentlyContinue
} finally {
    Pop-Location
}
Start-Process "http://localhost:5173/register-organization?verified=1"
