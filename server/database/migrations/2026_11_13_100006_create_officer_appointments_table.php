<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('officer_appointments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('election_id')->nullable()->constrained('elections')->nullOnDelete();
            $table->unsignedBigInteger('election_position_id')->nullable();
            $table->unsignedInteger('user_school_id');
            $table->string('position_title', 100);
            $table->boolean('is_executive')->default(false);
            $table->string('role', 20);
            // incoming, outgoing
            $table->string('kind', 10)->default('incoming');
            $table->string('academic_year', 20)->nullable();
            $table->unsignedBigInteger('academic_semester_id')->nullable();
            // The last Compliance deadline the start date was calculated from; never edited by hand.
            $table->dateTime('deadline_at')->nullable();
            $table->date('term_starts_on')->nullable();
            $table->date('term_ends_on')->nullable();
            // upcoming, active, ended
            $table->string('status', 12)->default('upcoming');
            // scheduled, active, failed
            $table->string('activation_status', 12)->default('scheduled');
            // missing_deadline, start_passed
            $table->string('flag', 40)->nullable();
            $table->timestamp('result_final_at')->nullable();
            $table->timestamp('last_recalculated_at')->nullable();
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('ended_at')->nullable();
            $table->timestamp('start_notice_at')->nullable();
            $table->timestamp('end_notice_at')->nullable();
            $table->timestamps();

            $table->unique(['election_id', 'election_position_id', 'user_school_id'], 'officer_appointments_winner_unique');
            $table->index(['organization_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('officer_appointments');
    }
};
