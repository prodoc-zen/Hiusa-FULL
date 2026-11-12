<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('partylists', function (Blueprint $table) {
            $table->string('motto')->nullable();
            $table->string('color', 7)->nullable();
            $table->foreignId('election_id')->nullable()->constrained('elections')->nullOnDelete();
            $table->unsignedInteger('representative_school_id')->nullable();
        });

        Schema::create('election_applications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('election_id')->constrained('elections')->cascadeOnDelete();
            $table->foreignId('position_id')->constrained('election_positions')->cascadeOnDelete();
            $table->unsignedInteger('user_school_id');
            $table->foreignId('partylist_id')->nullable()->constrained('partylists')->nullOnDelete();
            $table->unsignedInteger('submitted_by')->nullable();
            // draft, pending_review, for_revision, approved, rejected, withdrawn
            $table->string('status', 16)->default('draft');
            $table->text('platform')->nullable();
            $table->string('photo_url')->nullable();
            $table->string('coc_path')->nullable();
            $table->string('credentials_path')->nullable();
            $table->unsignedSmallInteger('rules_version')->nullable();
            $table->timestamp('rules_accepted_at')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->text('review_notes')->nullable();
            $table->unsignedInteger('reviewed_by')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->foreignId('candidate_id')->nullable()->constrained('candidates')->nullOnDelete();
            $table->timestamps();

            $table->unique(['election_id', 'user_school_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('election_applications');

        Schema::table('partylists', function (Blueprint $table) {
            $table->dropConstrainedForeignId('election_id');
            $table->dropColumn(['motto', 'color', 'representative_school_id']);
        });
    }
};
