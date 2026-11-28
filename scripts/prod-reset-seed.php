<?php

/*
 * Mode-specific seeding that runs right after `migrate:fresh`, through tinker:
 *
 *   HIUSA_RESET_MODE=first-time|seeded  HIUSA_RESET_HASH_FILE=/path/to/saved-hash  \
 *     php artisan tinker --execute="require '/path/to/prod-reset-seed.php';"
 *
 * Needs APP_ENV other than production (the demo seeders refuse under production).
 * HIUSA_RESET_HASH_FILE holds two lines written by the caller before the wipe: the SAO's
 * password_hash, then the SAO's email. It is never printed.
 *
 * first-time: the five colleges, each with its COLLEGE home organization, plus the SAO
 *   account 990001 (its profile comes from the User::created hook). The SAO organization is
 *   already made by migration 2026_09_13_000002. No academic year, no student organizations,
 *   no other users. AcademicStructureSeeder is NOT run: the student records upload takes
 *   program, year_level and section as free text (StudentRegistryController validation) and
 *   programs and sections are per-organization rows an organization admin creates later.
 * seeded: DatabaseSeeder already ran with `migrate:fresh --seed`; this only restores the hash.
 */

use App\Models\AccountProfile;
use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

$mode = getenv('HIUSA_RESET_MODE') ?: '';
$hashFile = getenv('HIUSA_RESET_HASH_FILE') ?: '';

if (! in_array($mode, ['first-time', 'seeded'], true)) {
    throw new RuntimeException('HIUSA_RESET_MODE must be first-time or seeded.');
}
if (app()->isProduction()) {
    throw new RuntimeException('Run with APP_ENV=staging; the reset refuses under production.');
}

$saved = $hashFile !== '' && is_file($hashFile) ? preg_split('/\r?\n/', trim((string) file_get_contents($hashFile))) : [];
$savedHash = $saved[0] ?? '';
$savedEmail = $saved[1] ?? '';
if (! preg_match('/^\$2[aby]\$/', $savedHash) && ! str_starts_with($savedHash, '$argon')) {
    throw new RuntimeException('The saved SAO hash is missing or is not a password hash; nothing was written.');
}

if ($mode === 'first-time') {
    (new Database\Seeders\CollegeSeeder())->run();

    foreach (College::orderBy('id')->get() as $college) {
        Organization::updateOrCreate(
            ['organization_type' => 'COLLEGE', 'college_id' => $college->id],
            ['name' => $college->name, 'slug' => Str::slug($college->name), 'college' => $college->name, 'acronym' => $college->code, 'is_active' => true]
        );
    }

    $saoOrganizationId = Organization::where('acronym', 'SAO')->where('organization_type', 'SYSTEM_ADMINISTRATION')->value('id');
    if (! $saoOrganizationId) {
        throw new RuntimeException('The SAO organization is missing; migration 2026_09_13_000002 did not create it.');
    }

    User::unguarded(fn () => User::create([
        'organization_id' => $saoOrganizationId,
        'school_id' => 990001,
        'first_name' => 'SAO',
        'last_name' => 'Director',
        'email' => 'sao.director@hiusa.local',
        'password_hash' => Str::random(40),
        'must_change_password' => false,
        'role' => 'SUPER_ADMIN',
        'position_title' => 'SAO Director',
        'account_status' => 'active',
        ...User::privacyConsentAttributes(),
    ]));
}

// Restore the SAO's own password raw (the model cast would hash it a second time), keep consent accepted.
$update = ['password_hash' => $savedHash, 'must_change_password' => false, 'updated_at' => now()];
$update += User::privacyConsentAttributes();
if ($savedEmail !== '' && filter_var($savedEmail, FILTER_VALIDATE_EMAIL)
    && ! DB::table('users')->where('email', $savedEmail)->where('school_id', '!=', 990001)->exists()) {
    $update['email'] = $savedEmail;
}
$touched = DB::table('users')->where('school_id', 990001)->update($update);
if ($touched !== 1) {
    throw new RuntimeException('SAO 990001 was not found to restore the password onto.');
}

$sao = DB::table('users')->where('school_id', 990001)->first(['organization_id', 'role', 'account_status', 'position_title']);
if (! DB::table('account_profiles')->where('user_school_id', 990001)->where('organization_id', $sao->organization_id)->exists()) {
    AccountProfile::create([
        'user_school_id' => 990001,
        'organization_id' => $sao->organization_id,
        'role' => $sao->role,
        'account_status' => $sao->account_status,
        'position_title' => $sao->position_title,
    ]);
}

$byType = DB::table('organizations')->select('organization_type', DB::raw('count(*) c'))->groupBy('organization_type')->pluck('c', 'organization_type')->all();
ksort($byType);
$row = DB::table('users')->where('school_id', 990001)->first(['password_hash', 'must_change_password', 'privacy_accepted_at']);

echo 'VERIFY mode='.$mode
    .' users='.DB::table('users')->count()
    .' colleges='.DB::table('colleges')->count()
    .' orgs='.json_encode($byType)
    .' academic_years='.DB::table('academic_years')->count()
    .' elections='.DB::table('elections')->count()
    .' account_profiles='.DB::table('account_profiles')->count()
    .' sao_profile='.DB::table('account_profiles')->where('user_school_id', 990001)->count()
    .' sao_hash_equals_saved='.(hash_equals($savedHash, (string) $row->password_hash) ? 'true' : 'false')
    .' sao_must_change_password='.($row->must_change_password ? 'true' : 'false')
    .' sao_consent='.($row->privacy_accepted_at ? 'true' : 'false')
    .PHP_EOL;
