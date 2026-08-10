<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $this->alignApprovalRequests();
        $this->extendExistingTables();
        $this->createSharedFeatureTables();
    }

    public function down(): void
    {
        Schema::dropIfExists('audit_logs');
        Schema::dropIfExists('financial_reports');
        Schema::dropIfExists('ai_outputs');

        $this->dropColumns('attendance', ['check_out_time', 'recorded_by', 'remarks']);
        $this->dropColumns('notifications', ['notification_type', 'reference_type', 'reference_id', 'scheduled_at', 'sent_at']);
        $this->dropColumns('elections', ['results_visible', 'approved_at']);
        $this->dropColumns('tasks', ['task_type', 'is_ai_generated', 'role_score', 'workload_score', 'performance_score', 'final_score', 'progress_percent', 'completed_at']);
        $this->dropColumns('orders', ['payment_method', 'payment_reference', 'payment_proof_url', 'officer_review_status', 'admin_review_status', 'review_remarks', 'claim_verified_by', 'claim_verified_at', 'transaction_id']);
        $this->dropColumns('financial_forecasts', ['predicted_balance', 'safe_spending_limit', 'model_details', 'generated_by']);
        $this->dropColumns('transactions', ['event_id', 'payer_id', 'receipt_number', 'receipt_file_url']);
        $this->dropColumns('budgets', ['remaining_amount', 'advisory_note', 'overspending_risk']);
        $this->dropColumns('events', ['requires_budget', 'planning_details', 'approved_at']);
        $this->dropColumns('announcements', ['approval_status', 'reviewed_by', 'review_remarks', 'published_at']);
        $this->dropColumns('users', ['notification_preferences']);
        $this->dropColumns('approval_requests', ['required_role']);
    }

    private function alignApprovalRequests(): void
    {
        if (! Schema::hasTable('approval_requests')) {
            return;
        }

        if (DB::getDriverName() === 'mysql') {
            DB::statement("ALTER TABLE `approval_requests` MODIFY `entity_type` VARCHAR(40) NOT NULL");
        }

        if (! Schema::hasColumn('approval_requests', 'required_role')) {
            Schema::table('approval_requests', function (Blueprint $table) {
                $table->string('required_role', 30)->default('DEPARTMENT_HEAD')->after('requested_by');
            });
        }

        if (Schema::hasIndex('approval_requests', 'approval_requests_entity_type_entity_id_unique')) {
            Schema::table('approval_requests', function (Blueprint $table) {
                $table->dropUnique('approval_requests_entity_type_entity_id_unique');
            });
        }

        $this->dropColumns('approval_requests', ['title', 'summary', 'created_at', 'updated_at']);

        if (! Schema::hasIndex('approval_requests', 'approval_entity_index')) {
            Schema::table('approval_requests', function (Blueprint $table) {
                $table->index(['entity_type', 'entity_id'], 'approval_entity_index');
            });
        }

        if (! Schema::hasIndex('approval_requests', 'approval_status_role_index')) {
            Schema::table('approval_requests', function (Blueprint $table) {
                $table->index(['status', 'required_role'], 'approval_status_role_index');
            });
        }
    }

    private function extendExistingTables(): void
    {
        Schema::table('users', function (Blueprint $table) {
            if (! Schema::hasColumn('users', 'notification_preferences')) {
                $table->longText('notification_preferences')->nullable()->after('biometric_template');
            }
        });

        Schema::table('announcements', function (Blueprint $table) {
            if (! Schema::hasColumn('announcements', 'approval_status')) {
                $table->string('approval_status', 20)->default('draft')->after('category');
            }
            if (! Schema::hasColumn('announcements', 'reviewed_by')) {
                $table->unsignedInteger('reviewed_by')->nullable()->after('approval_status');
                $table->foreign('reviewed_by')->references('school_id')->on('users')->nullOnDelete();
            }
            if (! Schema::hasColumn('announcements', 'review_remarks')) {
                $table->text('review_remarks')->nullable()->after('reviewed_by');
            }
            if (! Schema::hasColumn('announcements', 'published_at')) {
                $table->dateTime('published_at')->nullable()->after('is_published');
            }
        });

        if (! Schema::hasIndex('announcements', 'announcements_reviewed_by_index') && Schema::hasColumn('announcements', 'reviewed_by')) {
            Schema::table('announcements', function (Blueprint $table) {
                $table->index('reviewed_by', 'announcements_reviewed_by_index');
            });
        }

        DB::table('announcements')->where('is_published', true)->where('approval_status', 'draft')->update(['approval_status' => 'approved']);

        $this->dropColumns('budgets', ['status']);

        Schema::table('events', function (Blueprint $table) {
            if (! Schema::hasColumn('events', 'requires_budget')) {
                $table->boolean('requires_budget')->default(false)->after('status');
            }
            if (! Schema::hasColumn('events', 'planning_details')) {
                $table->longText('planning_details')->nullable()->after('requires_budget');
            }
            if (! Schema::hasColumn('events', 'approved_at')) {
                $table->dateTime('approved_at')->nullable()->after('planning_details');
            }
        });

        Schema::table('budgets', function (Blueprint $table) {
            if (! Schema::hasColumn('budgets', 'remaining_amount')) {
                $table->decimal('remaining_amount', 10, 2)->nullable()->after('allocated_amount');
            }
            if (! Schema::hasColumn('budgets', 'advisory_note')) {
                $table->text('advisory_note')->nullable()->after('warning_threshold');
            }
            if (! Schema::hasColumn('budgets', 'overspending_risk')) {
                $table->string('overspending_risk', 20)->nullable()->after('advisory_note');
            }
        });

        Schema::table('transactions', function (Blueprint $table) {
            if (! Schema::hasColumn('transactions', 'event_id')) {
                $table->foreignId('event_id')->nullable()->after('budget_id')->constrained('events')->nullOnDelete();
            }
            if (! Schema::hasColumn('transactions', 'payer_id')) {
                $table->unsignedInteger('payer_id')->nullable()->after('recorded_by');
                $table->foreign('payer_id')->references('school_id')->on('users')->nullOnDelete();
            }
            if (! Schema::hasColumn('transactions', 'receipt_number')) {
                $table->unsignedInteger('receipt_number')->nullable()->after('receipt_reference');
            }
            if (! Schema::hasColumn('transactions', 'receipt_file_url')) {
                $table->string('receipt_file_url', 500)->nullable()->after('receipt_number');
            }
        });

        if (! Schema::hasIndex('transactions', 'transactions_event_receipt_unique')) {
            Schema::table('transactions', function (Blueprint $table) {
                $table->unique(['event_id', 'receipt_number'], 'transactions_event_receipt_unique');
            });
        }

        Schema::table('financial_forecasts', function (Blueprint $table) {
            if (! Schema::hasColumn('financial_forecasts', 'predicted_balance')) {
                $table->decimal('predicted_balance', 10, 2)->nullable()->after('predicted_expense');
            }
            if (! Schema::hasColumn('financial_forecasts', 'safe_spending_limit')) {
                $table->decimal('safe_spending_limit', 10, 2)->nullable()->after('predicted_balance');
            }
            if (! Schema::hasColumn('financial_forecasts', 'model_details')) {
                $table->longText('model_details')->nullable()->after('confidence_note');
            }
            if (! Schema::hasColumn('financial_forecasts', 'generated_by')) {
                $table->unsignedInteger('generated_by')->nullable()->after('model_details');
                $table->foreign('generated_by')->references('school_id')->on('users')->nullOnDelete();
            }
        });

        Schema::table('orders', function (Blueprint $table) {
            if (! Schema::hasColumn('orders', 'payment_method')) {
                $table->string('payment_method', 20)->nullable()->after('total_price');
            }
            if (! Schema::hasColumn('orders', 'payment_reference')) {
                $table->string('payment_reference', 150)->nullable()->after('payment_method');
            }
            if (! Schema::hasColumn('orders', 'payment_proof_url')) {
                $table->string('payment_proof_url', 500)->nullable()->after('payment_reference');
            }
            if (! Schema::hasColumn('orders', 'officer_review_status')) {
                $table->string('officer_review_status', 20)->default('pending')->after('payment_proof_url');
            }
            if (! Schema::hasColumn('orders', 'admin_review_status')) {
                $table->string('admin_review_status', 20)->default('pending')->after('officer_review_status');
            }
            if (! Schema::hasColumn('orders', 'review_remarks')) {
                $table->text('review_remarks')->nullable()->after('admin_review_status');
            }
            if (! Schema::hasColumn('orders', 'claim_verified_by')) {
                $table->unsignedInteger('claim_verified_by')->nullable()->after('approved_by');
                $table->foreign('claim_verified_by')->references('school_id')->on('users')->nullOnDelete();
            }
            if (! Schema::hasColumn('orders', 'claim_verified_at')) {
                $table->dateTime('claim_verified_at')->nullable()->after('claim_verified_by');
            }
            if (! Schema::hasColumn('orders', 'transaction_id')) {
                $table->foreignId('transaction_id')->nullable()->after('claim_verified_at')->constrained('transactions')->nullOnDelete();
            }
        });

        Schema::table('tasks', function (Blueprint $table) {
            if (! Schema::hasColumn('tasks', 'task_type')) {
                $table->string('task_type', 20)->default('regular')->after('event_id');
            }
            if (! Schema::hasColumn('tasks', 'is_ai_generated')) {
                $table->boolean('is_ai_generated')->default(false)->after('task_type');
            }
            if (! Schema::hasColumn('tasks', 'role_score')) {
                $table->decimal('role_score', 6, 2)->nullable()->after('ai_recommendation_note');
            }
            if (! Schema::hasColumn('tasks', 'workload_score')) {
                $table->decimal('workload_score', 6, 2)->nullable()->after('role_score');
            }
            if (! Schema::hasColumn('tasks', 'performance_score')) {
                $table->decimal('performance_score', 6, 2)->nullable()->after('workload_score');
            }
            if (! Schema::hasColumn('tasks', 'final_score')) {
                $table->decimal('final_score', 8, 2)->nullable()->after('performance_score');
            }
            if (! Schema::hasColumn('tasks', 'progress_percent')) {
                $table->unsignedTinyInteger('progress_percent')->default(0)->after('final_score');
            }
            if (! Schema::hasColumn('tasks', 'completed_at')) {
                $table->dateTime('completed_at')->nullable()->after('progress_percent');
            }
        });

        Schema::table('elections', function (Blueprint $table) {
            if (! Schema::hasColumn('elections', 'results_visible')) {
                $table->boolean('results_visible')->default(true)->after('status');
            }
            if (! Schema::hasColumn('elections', 'approved_at')) {
                $table->dateTime('approved_at')->nullable()->after('results_visible');
            }
        });

        Schema::table('notifications', function (Blueprint $table) {
            if (! Schema::hasColumn('notifications', 'notification_type')) {
                $table->string('notification_type', 40)->default('general')->after('user_id');
            }
            if (! Schema::hasColumn('notifications', 'reference_type')) {
                $table->string('reference_type', 40)->nullable()->after('message');
            }
            if (! Schema::hasColumn('notifications', 'reference_id')) {
                $table->unsignedBigInteger('reference_id')->nullable()->after('reference_type');
            }
            if (! Schema::hasColumn('notifications', 'scheduled_at')) {
                $table->dateTime('scheduled_at')->nullable()->after('reference_id');
            }
            if (! Schema::hasColumn('notifications', 'sent_at')) {
                $table->dateTime('sent_at')->nullable()->after('scheduled_at');
            }
        });

        Schema::table('attendance', function (Blueprint $table) {
            if (! Schema::hasColumn('attendance', 'check_out_time')) {
                $table->dateTime('check_out_time')->nullable()->after('check_in_time');
            }
            if (! Schema::hasColumn('attendance', 'recorded_by')) {
                $table->unsignedInteger('recorded_by')->nullable()->after('method');
                $table->foreign('recorded_by')->references('school_id')->on('users')->nullOnDelete();
            }
            if (! Schema::hasColumn('attendance', 'remarks')) {
                $table->string('remarks')->nullable()->after('recorded_by');
            }
        });
    }

    private function createSharedFeatureTables(): void
    {
        if (! Schema::hasTable('ai_outputs')) {
            Schema::create('ai_outputs', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->nullable()->constrained('organizations')->nullOnDelete();
                $table->string('feature_type', 40);
                $table->string('reference_type', 40)->nullable();
                $table->unsignedBigInteger('reference_id')->nullable();
                $table->longText('prompt_text')->nullable();
                $table->longText('output_text');
                $table->string('model_name', 100)->nullable();
                $table->unsignedInteger('requested_by')->nullable();
                $table->timestamp('created_at')->useCurrent();

                $table->index(['reference_type', 'reference_id'], 'ai_outputs_reference_index');
                $table->foreign('requested_by')->references('school_id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('financial_reports')) {
            Schema::create('financial_reports', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->nullable()->constrained('organizations')->nullOnDelete();
                $table->foreignId('event_id')->nullable()->constrained('events')->nullOnDelete();
                $table->string('report_type', 40);
                $table->string('title');
                $table->date('period_start')->nullable();
                $table->date('period_end')->nullable();
                $table->longText('summary_text')->nullable();
                $table->longText('source_transaction_ids')->nullable();
                $table->string('pdf_url', 500)->nullable();
                $table->string('excel_url', 500)->nullable();
                $table->foreignId('ai_output_id')->nullable()->constrained('ai_outputs')->nullOnDelete();
                $table->unsignedInteger('generated_by')->nullable();
                $table->timestamp('generated_at')->useCurrent();

                $table->index('event_id', 'financial_reports_event_index');
                $table->foreign('generated_by')->references('school_id')->on('users')->nullOnDelete();
            });
        }

        if (! Schema::hasTable('audit_logs')) {
            Schema::create('audit_logs', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->nullable()->constrained('organizations')->nullOnDelete();
                $table->unsignedInteger('user_id')->nullable();
                $table->string('module', 50);
                $table->string('action', 100);
                $table->string('record_type', 50)->nullable();
                $table->unsignedBigInteger('record_id')->nullable();
                $table->longText('old_values')->nullable();
                $table->longText('new_values')->nullable();
                $table->string('ip_address', 45)->nullable();
                $table->timestamp('created_at')->useCurrent();

                $table->index(['record_type', 'record_id'], 'audit_record_index');
                $table->index(['module', 'action'], 'audit_module_action_index');
                $table->foreign('user_id')->references('school_id')->on('users')->nullOnDelete();
            });
        }
    }

    private function dropColumns(string $tableName, array $columns): void
    {
        if (! Schema::hasTable($tableName)) {
            return;
        }

        $existing = array_values(array_filter($columns, fn (string $column) => Schema::hasColumn($tableName, $column)));

        if ($existing === []) {
            return;
        }

        Schema::table($tableName, function (Blueprint $table) use ($existing) {
            $table->dropColumn($existing);
        });
    }
};