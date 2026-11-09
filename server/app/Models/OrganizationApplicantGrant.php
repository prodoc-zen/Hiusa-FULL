<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

/** A dean's permission for one student of the college to apply for a new organization. One grant carries one application. */
class OrganizationApplicantGrant extends Model
{
    protected $guarded = [];

    protected function casts(): array
    {
        return ['revoked_at' => 'datetime'];
    }

    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereNull('used_application_id')->whereNull('revoked_at');
    }

    /** An open grant only counts while the student belongs to no active student organization. */
    public function scopeUsable(Builder $query): Builder
    {
        return $query->open()->whereNotExists(fn ($profiles) => self::activeMemberships($profiles)->whereColumn('account_profiles.user_school_id', 'organization_applicant_grants.user_school_id'));
    }

    /** The active student organization this student already belongs to, if any. Their college home organization does not count. */
    public static function blockingOrganization(int $schoolId): ?Organization
    {
        $organizationId = self::activeMemberships(DB::query())->where('account_profiles.user_school_id', $schoolId)->orderBy('account_profiles.id')->value('account_profiles.organization_id');

        return $organizationId ? Organization::find($organizationId, ['id', 'name']) : null;
    }

    private static function activeMemberships($query)
    {
        return $query->from('account_profiles')->join('organizations', 'organizations.id', '=', 'account_profiles.organization_id')
            ->where('account_profiles.account_status', 'active')
            ->where('organizations.organization_type', 'STUDENT_ORGANIZATION')
            ->where('organizations.lifecycle_status', 'active')
            ->where('organizations.is_active', true);
    }

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class)->withTrashed();
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_school_id', 'school_id');
    }

    public function grantor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'granted_by', 'school_id');
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(OrganizationApplication::class, 'used_application_id');
    }

    public function state(): string
    {
        return match (true) {
            $this->revoked_at !== null => 'revoked',
            $this->used_application_id !== null => 'used',
            default => 'open',
        };
    }
}
