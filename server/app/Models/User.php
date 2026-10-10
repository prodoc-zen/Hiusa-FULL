<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasApiTokens, HasFactory, Notifiable;

    protected $authPasswordName = 'password_hash';

    protected $primaryKey = 'school_id';

    protected $keyType = 'int';

    public $incrementing = false;

    protected $rememberTokenName = '';

    private ?AccountProfile $activeAccountProfile = null;

    protected static function booted(): void
    {
        static::created(function (User $user): void {
            $user->accountProfiles()->create([
                'organization_id' => $user->getAttributes()['organization_id'],
                'role' => $user->getAttributes()['role'],
                'account_status' => $user->getAttributes()['account_status'],
                'position_title' => $user->getAttributes()['position_title'] ?? null,
            ]);
        });

        static::updated(function (User $user): void {
            if (! $user->isDirty(['organization_id', 'role', 'account_status', 'position_title'])) {
                return;
            }

            $user->accountProfiles()->where('organization_id', $user->getRawOriginal('organization_id'))
                ->update([
                    'organization_id' => $user->getAttributes()['organization_id'],
                    'role' => $user->getAttributes()['role'],
                    'account_status' => $user->getAttributes()['account_status'],
                    'position_title' => $user->getAttributes()['position_title'] ?? null,
                ]);
        });

        static::deleted(function (User $user): void {
            if ($user->photo_path) {
                DB::afterCommit(fn () => Storage::disk('public')->delete($user->photo_path));
            }
        });
    }

    protected $fillable = [
        'organization_id',
        'school_id',
        'first_name',
        'last_name',
        'email',
        'contact_number',
        'password_hash',
        'must_change_password',
        'role',
        'account_status',
        'position_title',
        'is_member',
        'biometric_template',
        'notification_preferences',
        'department',
        'program',
        'year_level',
        'major',
        'section',
        'photo_path',
    ];

    protected $with = ['organization:id,name,slug,college,acronym,parent_organization_id'];

    protected $appends = ['id', 'photo_url'];

    protected $hidden = [
        'password_hash',
        'biometric_template',
        'photo_path',
    ];

    public function getPhotoUrlAttribute(): ?string
    {
        return $this->photo_path ? Storage::disk('public')->url($this->photo_path) : null;
    }

    protected function casts(): array
    {
        return [
            'school_id' => 'integer',
            'is_member' => 'boolean',
            'must_change_password' => 'boolean',
            'password_hash' => 'hashed',
            'notification_preferences' => 'array',
        ];
    }

    public function getIdAttribute(): int
    {
        return $this->school_id;
    }

    public function getRoleAttribute($value): string
    {
        return $this->activeAccountProfile?->role ?? $value;
    }

    public function getOrganizationIdAttribute($value): ?int
    {
        return $this->activeAccountProfile?->organization_id ?? $value;
    }

    public function getAccountStatusAttribute($value): ?string
    {
        return $this->activeAccountProfile?->account_status ?? $value;
    }

    public function getPositionTitleAttribute($value): ?string
    {
        return $this->activeAccountProfile?->position_title ?? $value;
    }

    public function getActiveProfileIdAttribute(): ?int
    {
        return $this->activeAccountProfile?->id ?? $this->accountProfiles()->where('organization_id', $this->getRawOriginal('organization_id'))->value('id');
    }

    public function activateProfile(AccountProfile $profile): void
    {
        $this->activeAccountProfile = $profile;
        $this->setRelation('organization', $profile->organization);
    }

    /** Notification kinds this person chose to hide; always a subset of Notification::MUTABLE_TYPES. */
    public function mutedNotificationTypes(): array
    {
        return array_values(array_intersect(Notification::MUTABLE_TYPES, (array) data_get($this->notification_preferences, 'muted', [])));
    }

    public function accountProfiles(): HasMany
    {
        return $this->hasMany(AccountProfile::class, 'user_school_id', 'school_id');
    }

    public function announcements(): HasMany
    {
        return $this->hasMany(Announcement::class, 'created_by', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** @return array<int, int> */
    public function scopedOrganizationIds(): array
    {
        $organizationId = $this->organization_id;

        if ($this->role !== 'DEPARTMENT_HEAD') {
            return [$organizationId];
        }

        $home = Organization::whereKey($organizationId)->first(['id', 'organization_type', 'college_id']);

        if (! $home || $home->organization_type !== 'COLLEGE' || ! $home->college_id) {
            return [$organizationId];
        }

        return Organization::student()->where('college_id', $home->college_id)->pluck('id')->all();
    }

    public function events(): HasMany
    {
        return $this->hasMany(Event::class, 'created_by', 'school_id');
    }

    public function createdTasks(): HasMany
    {
        return $this->hasMany(Task::class, 'created_by', 'school_id');
    }

    public function assignedTasks(): HasMany
    {
        return $this->hasMany(Task::class, 'assigned_to', 'school_id');
    }

    public function attendanceRecords(): HasMany
    {
        return $this->hasMany(Attendance::class, 'user_id', 'school_id');
    }

    public function fingerprints(): HasMany
    {
        return $this->hasMany(Fingerprint::class, 'user_id', 'school_id');
    }

    public function recordedTransactions(): HasMany
    {
        return $this->hasMany(Transaction::class, 'recorded_by', 'school_id');
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class, 'student_id', 'school_id');
    }

    public function processedOrders(): HasMany
    {
        return $this->hasMany(Order::class, 'processed_by', 'school_id');
    }

    public function approvedOrders(): HasMany
    {
        return $this->hasMany(Order::class, 'approved_by', 'school_id');
    }

    public function candidacies(): HasMany
    {
        return $this->hasMany(Candidate::class, 'user_id', 'school_id');
    }

    public function votes(): HasMany
    {
        return $this->hasMany(Vote::class, 'voter_id', 'school_id');
    }

    public function systemNotifications(): HasMany
    {
        return $this->hasMany(Notification::class, 'user_id', 'school_id');
    }
}
