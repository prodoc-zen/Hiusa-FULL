<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
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

    protected $fillable = [
        'organization_id',
        'school_id',
        'first_name',
        'last_name',
        'email',
        'password_hash',
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
    ];

    protected $with = ['organization:id,name,slug,college,acronym'];

    protected $appends = ['id'];

    protected $hidden = [
        'password_hash',
        'biometric_template',
    ];

    protected function casts(): array
    {
        return [
            'school_id' => 'integer',
            'is_member' => 'boolean',
            'password_hash' => 'hashed',
            'notification_preferences' => 'array',
        ];
    }

    public function getIdAttribute(): int
    {
        return $this->school_id;
    }

    public function announcements(): HasMany
    {
        return $this->hasMany(Announcement::class, 'created_by', 'school_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
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
