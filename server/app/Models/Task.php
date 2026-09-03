<?php

namespace App\Models;

use Database\Factories\TaskFactory;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Task extends Model
{
    /** @use HasFactory<TaskFactory> */
    use HasFactory;

    protected $guarded = [];

    protected $appends = ['workflow_status'];

    protected function casts(): array
    {
        return [
            'deadline' => 'datetime',
            'is_ai_generated' => 'boolean',
            'progress_percent' => 'integer',
            'role_score' => 'decimal:2',
            'workload_score' => 'decimal:2',
            'performance_score' => 'decimal:2',
            'final_score' => 'decimal:2',
            'completed_at' => 'datetime',
            'sequence' => 'integer',
            'delegation_snapshot' => 'array',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(Event::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by', 'school_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_to', 'school_id');
    }

    public function dependency(): BelongsTo
    {
        return $this->belongsTo(Task::class, 'depends_on_task_id');
    }

    public function getWorkflowStatusAttribute(): string
    {
        if ($this->status === 'completed') {
            return 'completed';
        }

        $dependency = $this->relationLoaded('dependency')
            ? $this->getRelation('dependency')
            : $this->dependency()->first();

        if ($dependency && $dependency->status !== 'completed') {
            return 'blocked';
        }

        return $this->status === 'pending' ? 'ready' : $this->status;
    }

    public function progressUpdates(): HasMany
    {
        return $this->hasMany(TaskProgressUpdate::class)->orderByDesc('created_at');
    }
}
