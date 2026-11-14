<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasManyThrough;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Support\Facades\Storage;

class Organization extends Model
{
    use HasFactory;

    // Uploads live on the private disk under gcash-qr/; QRs saved before that sit in the public uploads folder.
    public const GCASH_QR_PRIVATE_FOLDER = 'gcash-qr/';

    public const GCASH_QR_LEGACY_FOLDER = '/uploads/gcash/';

    protected $guarded = [];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'is_university_wide' => 'boolean',
            'admin_payload' => 'array',
            'submitted_at' => 'datetime',
            'reviewed_at' => 'datetime',
            'archived_at' => 'datetime',
        ];
    }

    /** The one answer to "does this organization's GCash QR file exist": its path on disk, or null when none is saved or the file is gone. */
    public function gcashQrPath(): ?string
    {
        return self::resolveGcashQrPath($this->gcash_qr_url);
    }

    public static function resolveGcashQrPath(?string $saved): ?string
    {
        if (! $saved) {
            return null;
        }

        if (str_starts_with($saved, self::GCASH_QR_LEGACY_FOLDER)) {
            $name = substr($saved, strlen(self::GCASH_QR_LEGACY_FOLDER));
            $path = public_path('uploads/gcash/'.$name);

            return $name === basename($name) && is_file($path) ? $path : null;
        }

        return self::isPrivateGcashQrPath($saved) && Storage::disk('local')->exists($saved)
            ? Storage::disk('local')->path($saved)
            : null;
    }

    public static function isPrivateGcashQrPath(string $saved): bool
    {
        return str_starts_with($saved, self::GCASH_QR_PRIVATE_FOLDER) && ! str_contains($saved, '..');
    }

    public function scopeStudent(Builder $query): Builder
    {
        return $query->where('organization_type', 'STUDENT_ORGANIZATION');
    }

    public function isArchived(): bool
    {
        return $this->lifecycle_status === 'archived';
    }

    public function isWritable(): bool
    {
        return $this->lifecycle_status === 'active' && $this->collegeAllowsAccess();
    }

    public function collegeAllowsAccess(): bool
    {
        if ($this->is_university_wide) {
            return true;
        }
        if ($this->organization_type === 'SYSTEM_ADMINISTRATION' || (! $this->college_id && ! $this->getRawOriginal('college'))) {
            return true;
        }
        $college = $this->college_id
            ? ($this->relationLoaded('catalogCollege') ? $this->getRelation('catalogCollege') : College::withTrashed()->find($this->college_id))
            : College::withTrashed()->where('name', $this->getRawOriginal('college'))->first();

        return $college ? ($college->is_active && ! $college->trashed()) : ! $this->college_id;
    }

    public function catalogCollege(): BelongsTo
    {
        return $this->belongsTo(College::class, 'college_id')->withTrashed();
    }

    public function approvalRole(string $default): string
    {
        return $this->is_university_wide && $default === 'DEPARTMENT_HEAD' ? 'SUPER_ADMIN' : $default;
    }

    public function college(): BelongsTo
    {
        return $this->belongsTo(College::class);
    }

    public function collegeHomeOrganization(): HasOne
    {
        return $this->hasOne(Organization::class, 'college_id', 'college_id')->where('organization_type', 'COLLEGE');
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function accountProfiles(): HasMany
    {
        return $this->hasMany(AccountProfile::class);
    }

    public function parentOrganization(): BelongsTo
    {
        return $this->belongsTo(Organization::class, 'parent_organization_id');
    }

    public function suborganizations(): HasMany
    {
        return $this->hasMany(Organization::class, 'parent_organization_id');
    }

    /** Users holding an ADMIN profile here, whatever their primary organization; select profile columns for the role-bearing fields. */
    public function administrators(): HasManyThrough
    {
        return $this->hasManyThrough(User::class, AccountProfile::class, 'organization_id', 'school_id', 'id', 'user_school_id')
            ->where('account_profiles.role', 'ADMIN');
    }
}
