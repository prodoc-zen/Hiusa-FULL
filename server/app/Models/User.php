<?php

namespace App\Models;

use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, HasApiTokens;

    protected $authPasswordName = 'password_hash';

    protected $rememberTokenName = '';

    protected $fillable = [
        'school_id',
        'first_name',
        'last_name',
        'email',
        'password_hash',
        'role',
        'is_member',
        'biometric_template',
    ];

    protected $hidden = [
        'password_hash',
        'biometric_template',
    ];

    protected function casts(): array
    {
        return [
            'password_hash' => 'hashed',
        ];
    }

    public function announcements(): HasMany
    {
        return $this->hasMany(Announcement::class, 'created_by');
    }

    public function events(): HasMany
    {
        return $this->hasMany(Event::class, 'created_by');
    }

    public function createdTasks(): HasMany
    {
        return $this->hasMany(Task::class, 'created_by');
    }

    public function assignedTasks(): HasMany
    {
        return $this->hasMany(Task::class, 'assigned_to');
    }

    public function attendanceRecords(): HasMany
    {
        return $this->hasMany(Attendance::class);
    }

    public function recordedTransactions(): HasMany
    {
        return $this->hasMany(Transaction::class, 'recorded_by');
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class, 'student_id');
    }

    public function processedOrders(): HasMany
    {
        return $this->hasMany(Order::class, 'processed_by');
    }

    public function approvedOrders(): HasMany
    {
        return $this->hasMany(Order::class, 'approved_by');
    }

    public function candidacies(): HasMany
    {
        return $this->hasMany(Candidate::class);
    }

    public function votes(): HasMany
    {
        return $this->hasMany(Vote::class, 'voter_id');
    }

    public function systemNotifications(): HasMany
    {
        return $this->hasMany(Notification::class);
    }
}
