<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
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

    /** Read once per model instance and dropped when the active profile changes; see activateProfile(). */
    private $usableMemberships = null;

    private ?array $memberOrganizationIdsCache = null;

    /** True on an instance listed among others, which never carries the signed-in only fields. */
    private bool $listedAmongOthers = false;

    /** True only on the instance a request is signed in as, when that person is the dean's office staff. */
    private bool $authorizesAsDean = false;

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
            // Only what this update changed: an election hand over moves the profile and leaves these columns behind, so an unchanged one is stale.
            $changed = array_intersect_key($user->getChanges(), array_flip(['organization_id', 'role', 'account_status', 'position_title']));

            if ($changed === []) {
                return;
            }

            $user->accountProfiles()->where('organization_id', $user->getRawOriginal('organization_id'))->update($changed);
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

    protected $with = ['organization:id,name,slug,college,college_id,organization_type,acronym,parent_organization_id,is_university_wide'];

    protected $appends = ['id', 'photo_url', 'modules'];

    protected $hidden = [
        'password_hash',
        'biometric_template',
        'photo_path',
        'privacy_accepted_at',
        'privacy_notice_version',
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
            'privacy_accepted_at' => 'datetime',
        ];
    }

    public function getIdAttribute(): int
    {
        return $this->school_id;
    }

    /**
     * The role this account authorizes with. Office staff hold an ADMIN profile on the college home organization but
     * carry the dean's scope, so on the request they are signed in as, every role check reads DEPARTMENT_HEAD and
     * behaves exactly as for the dean. Anywhere else (a listing, a profile row, the stored column) it is the stored role.
     */
    public function getRoleAttribute($value): string
    {
        $role = $this->profileRole();

        return $this->authorizesAsDean && $role === 'ADMIN' ? 'DEPARTMENT_HEAD' : $role;
    }

    /** The role stored on the active profile: what the account is, and what the client shows. */
    public function profileRole(): ?string
    {
        return $this->activeAccountProfile?->role ?? $this->attributes['role'] ?? null;
    }

    /** The client is shown the stored role, never the one a request authorizes with. */
    public function attributesToArray(): array
    {
        $attributes = parent::attributesToArray();

        if ($this->authorizesAsDean) {
            $attributes['role'] = $this->profileRole();
        }

        // Only the signed-in payload says it; a user marked as listed among others never costs a position or membership lookup.
        if ($this->activeAccountProfile && ! $this->listedAmongOthers) {
            $attributes['can_book_venues'] = $this->canBookVenues();
            $attributes['in_student_organization'] = $this->inStudentOrganization();
        }

        return $attributes;
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
        $profile = $this->activeAccountProfile;

        // A profile in another organization never borrows the title the account row holds for the home organization.
        if (! $profile || (int) $profile->organization_id === (int) $this->getRawOriginal('organization_id')) {
            return $profile?->position_title ?? $value;
        }

        return $profile->position_title;
    }

    /**
     * Whether this person holds an active profile in a student organization, whichever profile they are signed in to.
     * The college profile is the member's own account, so the profile in use says nothing about membership.
     */
    public function inStudentOrganization(): bool
    {
        return $this->usableStudentOrganizationMemberships()->isNotEmpty();
    }

    /** The student organization profiles this person can work in: active, in an active club whose college is not archived. */
    private function usableStudentOrganizationMemberships()
    {
        return $this->usableMemberships ??= AccountProfile::studentOrganizationMemberships($this->school_id)
            ->with('organization')
            ->get()
            ->filter(fn (AccountProfile $profile) => $profile->isUsable());
    }

    /**
     * Admins always book venues. An officer books when the position on the active profile has its "Can book venues"
     * switch on; a title the list does not hold (or no title) follows the position default.
     */
    public function canBookVenues(): bool
    {
        return match ($this->profileRole()) {
            'ADMIN' => true,
            'SBO_OFFICER' => $this->officerCanBookVenues(),
            default => false,
        };
    }

    /** The listed position is found by exact title, then by normalised title, so "Business-Manager" meets the "Business Manager" row; an inactive row never books. */
    private function officerCanBookVenues(): bool
    {
        $title = trim((string) $this->position_title);
        if ($title === '') {
            return false;
        }

        $wanted = SboPosition::normaliseTitle($title);
        $rows = SboPosition::where('organization_id', $this->organization_id)->where('role', 'SBO_OFFICER')->get(['title', 'can_book_venues', 'is_active']);
        $position = $rows->firstWhere('title', $title) ?? $rows->first(fn (SboPosition $row) => SboPosition::normaliseTitle($row->title) === $wanted);

        return $position ? $position->is_active && $position->can_book_venues : SboPosition::bookingDefaultFor($title);
    }

    public function activeProfile(): ?AccountProfile
    {
        return $this->activeAccountProfile;
    }

    /** An ADMIN profile on a college's own home organization: the dean's office staff, not an organization head. */
    public function isCollegeOfficeStaff(): bool
    {
        return $this->profileRole() === 'ADMIN' && $this->organization?->organization_type === 'COLLEGE' && $this->organization->college_id !== null;
    }

    /** The dean or the dean's delegate: the two accounts with college-wide reach over every student organization. */
    public function isCollegeOffice(): bool
    {
        return $this->profileRole() === 'DEPARTMENT_HEAD' || $this->isCollegeOfficeStaff();
    }

    /** An ADMIN who runs one organization, not the dean's delegate. */
    public function isOrganizationAdmin(): bool
    {
        return $this->profileRole() === 'ADMIN' && ! $this->isCollegeOfficeStaff();
    }

    /** The role whose approval steps this account works: office staff stand in for the dean. */
    public function approvalRole(): string
    {
        return $this->isCollegeOfficeStaff() ? 'DEPARTMENT_HEAD' : (string) $this->profileRole();
    }

    /** The org areas the active profile is limited to; null means every area for the role. */
    public function getModulesAttribute(): ?array
    {
        return $this->activeAccountProfile?->modules;
    }

    public function getActiveProfileIdAttribute(): ?int
    {
        return $this->activeAccountProfile?->id ?? $this->accountProfiles()->where('organization_id', $this->getRawOriginal('organization_id'))->value('id');
    }

    /** The organization columns a member's own account payload carries; reviewer and submitter ids and remarks are not among them. */
    public const SERIALIZED_ORGANIZATION_COLUMNS = [
        'id', 'name', 'slug', 'college', 'college_id', 'organization_type', 'acronym', 'parent_organization_id',
        'is_active', 'logo_url', 'color', 'lifecycle_status', 'is_university_wide',
    ];

    /**
     * What agreeing to the Data Privacy Notice writes. These columns are not fillable, so no request body can name them:
     * a caller that has validated the person's agreement applies this with forceFill, and the time and version are the server's.
     *
     * @return array{privacy_accepted_at: Carbon, privacy_notice_version: string}
     */
    public static function privacyConsentAttributes(): array
    {
        return [
            'privacy_accepted_at' => now(),
            'privacy_notice_version' => (string) config('hiusa.privacy_notice_version'),
        ];
    }

    /** Whether someone agreed to the privacy notice is theirs to see: hidden on every serialization, shown only on the payload a person gets about themselves. */
    public function asOwnPayload(): static
    {
        return $this->makeVisible(['privacy_accepted_at', 'privacy_notice_version']);
    }

    /** Marks this instance as one row of a list, so serializing it skips the fields only the signed-in person's payload carries. */
    public function listAmongOthers(): static
    {
        $this->listedAmongOthers = true;

        return $this;
    }

    /** Only UseAccountProfile passes `$signedInRequest`: it is the one place a request takes on the dean's role for office staff. */
    public function activateProfile(AccountProfile $profile, bool $signedInRequest = false): void
    {
        $this->activeAccountProfile = $profile;
        $this->usableMemberships = null;
        $this->memberOrganizationIdsCache = null;
        $profile->organization?->setVisible(self::SERIALIZED_ORGANIZATION_COLUMNS);
        $this->setRelation('organization', $profile->organization?->withoutRelations()->setVisible(self::SERIALIZED_ORGANIZATION_COLUMNS));
        $this->authorizesAsDean = $signedInRequest && $this->isCollegeOfficeStaff();
    }

    /** Notification kinds this person chose to hide; always a subset of Notification::MUTABLE_TYPES. */
    public function mutedNotificationTypes(): array
    {
        return array_values(array_intersect(Notification::MUTABLE_TYPES, (array) data_get($this->notification_preferences, 'muted', [])));
    }

    /** One key for the same person however they typed it: an email in lower case, or the school ID as digits. */
    public static function normalizeIdentifier(mixed $identifier): ?string
    {
        if (! is_string($identifier) && ! is_int($identifier)) {
            return null;
        }

        $identifier = trim((string) $identifier);

        if (mb_strlen($identifier) > 100) {
            return null;
        }

        if (str_contains($identifier, '@')) {
            return mb_strtolower($identifier);
        }

        $digits = preg_replace('/\D/', '', $identifier);

        return $digits === '' ? null : $digits;
    }

    public static function findByIdentifier(?string $normalized): ?self
    {
        if ($normalized === null) {
            return null;
        }

        if (str_contains($normalized, '@')) {
            // Email is a login identity; if more than one account holds it, no account is the right one.
            $matches = static::where('email', $normalized)->limit(2)->get();

            return $matches->count() === 1 ? $matches->first() : null;
        }

        return strlen($normalized) <= 8 ? static::find((int) $normalized) : null;
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

        if (! $this->isCollegeOffice()) {
            return [$organizationId];
        }

        $home = Organization::whereKey($organizationId)->first(['id', 'organization_type', 'college_id']);

        if (! $home || $home->organization_type !== 'COLLEGE' || ! $home->college_id) {
            return [$organizationId];
        }

        return Organization::student()->where('college_id', $home->college_id)->pluck('id')->all();
    }

    /**
     * Open organizations whose elections this person votes in from the profile they are signed in to. An organization
     * profile votes in that organization only. The college profile is the member's own account, so it lists the college
     * home and every organization of that college where they hold a voting profile: a plain member votes without
     * switching profile. An organization they hold no active voting profile in is never listed.
     *
     * @return array<int, int>
     */
    public function votingOrganizationIds(): array
    {
        $current = $this->organization ?? Organization::find($this->organization_id);
        if (! $current) {
            return [];
        }

        $memberships = AccountProfile::votingMembers()
            ->where('account_profiles.user_school_id', $this->school_id)
            ->with('organization.catalogCollege')
            ->get()
            ->filter(fn (AccountProfile $profile) => $profile->organization?->isWritable());

        if ($current->organization_type !== 'COLLEGE' || ! $current->college_id) {
            $memberships = $memberships->where('organization_id', $current->id);
        } else {
            $memberships = $memberships->filter(fn (AccountProfile $profile) => (int) $profile->organization->college_id === (int) $current->college_id);
        }

        return $memberships->pluck('organization_id')->map(fn ($id) => (int) $id)->values()->all();
    }

    /**
     * Organizations whose shop and announcements a student reads from the profile they are signed in to. A club profile
     * reads that club only. The college profile is the member's own account, so it reads the college home and every
     * club where they hold an active student profile: "Give access" as Member adds exactly that profile and leaves the
     * account on the college. A club is an active organization that is not a college.
     *
     * @return array<int, int>
     */
    public function memberOrganizationIds(): array
    {
        return $this->memberOrganizationIdsCache ??= $this->resolveMemberOrganizationIds();
    }

    private function resolveMemberOrganizationIds(): array
    {
        $current = $this->organization ?? Organization::find($this->organization_id);
        if (! $current || $current->organization_type !== 'COLLEGE') {
            return [(int) $this->organization_id];
        }

        $clubIds = $this->usableStudentOrganizationMemberships()->pluck('organization_id');

        return $clubIds->push($current->id)->map(fn ($id) => (int) $id)->unique()->values()->all();
    }

    /**
     * The organizations whose announcements and shop this account reads: a student's memberships, anyone else's own scope.
     *
     * @return array<int, int>
     */
    public function contentOrganizationIds(): array
    {
        return $this->role === 'STUDENT' ? $this->memberOrganizationIds() : $this->scopedOrganizationIds();
    }

    /**
     * Organizations whose elections this person reads: a student reads the ones the current profile votes in, anyone
     * else reads their own scope.
     *
     * @return array<int, int>
     */
    public function electionOrganizationIds(): array
    {
        return $this->role === 'STUDENT' ? $this->votingOrganizationIds() : $this->scopedOrganizationIds();
    }

    /**
     * Organizations whose elections this account may read. The SAO has no organization of its own to vote or manage in:
     * it reads only the university-wide organizations, whose elections it reviews (the dean's reach is the college's).
     *
     * @return array<int, int>
     */
    public function electionReadOrganizationIds(): array
    {
        if ($this->role === 'SUPER_ADMIN') {
            return Organization::where('is_university_wide', true)->pluck('id')->all();
        }

        return $this->electionOrganizationIds();
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

    /** Votes cast before ballots became secret; newer votes carry no voter id. */
    public function votes(): HasMany
    {
        return $this->hasMany(Vote::class, 'voter_id', 'school_id');
    }

    /** The rounds of elections this person took part in. The choices live apart and are not linked to the person. */
    public function ballots(): HasMany
    {
        return $this->hasMany(ElectionBallot::class, 'voter_id', 'school_id');
    }

    public function systemNotifications(): HasMany
    {
        return $this->hasMany(Notification::class, 'user_id', 'school_id');
    }
}
