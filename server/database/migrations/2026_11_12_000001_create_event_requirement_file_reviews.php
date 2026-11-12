<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // One mark per file per reviewing step. A replaced file is a new row, so it starts unmarked
        // while the untouched files keep the acceptance they already earned.
        Schema::create('event_requirement_file_reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_requirement_file_id')->constrained('event_requirement_files', indexName: 'event_file_reviews_file_id_fk')->cascadeOnDelete();
            $table->string('stage', 10);
            $table->string('status', 20);
            $table->text('note')->nullable();
            $table->unsignedInteger('reviewed_by')->nullable();
            $table->foreign('reviewed_by', 'event_file_reviews_by_fk')->references('school_id')->on('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['event_requirement_file_id', 'stage'], 'event_file_review_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('event_requirement_file_reviews');
    }
};
