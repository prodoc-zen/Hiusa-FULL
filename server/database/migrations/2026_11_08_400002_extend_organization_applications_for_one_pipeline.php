<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organization_applications', function (Blueprint $table) {
            $table->unsignedSmallInteger('round')->default(1);
            $table->timestamp('submitted_at')->nullable();
            $table->text('endorsement_note')->nullable();
            $table->unsignedInteger('returned_by')->nullable();
            $table->string('returned_by_role', 20)->nullable();
            $table->timestamp('returned_at')->nullable();
        });

        // Rows that were already past email verification keep their place in the queue under the new names.
        DB::table('organization_applications')->where('status', 'pending_endorsement')->update(['status' => 'pending_dean']);
        DB::table('organization_applications')->where('status', 'endorsed')->update(['status' => 'pending_sao']);
        DB::table('organization_applications')->whereNull('submitted_at')->update(['submitted_at' => DB::raw('created_at')]);

        Schema::create('organization_application_requirement_reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_application_id')->constrained('organization_applications', indexName: 'org_app_reviews_app_id_fk')->cascadeOnDelete();
            $table->foreignId('requirement_type_id')->constrained('compliance_requirement_types', indexName: 'org_app_reviews_req_type_fk')->cascadeOnDelete();
            $table->unsignedSmallInteger('round')->default(1);
            $table->string('stage', 10);
            $table->string('status', 20);
            $table->text('note')->nullable();
            $table->unsignedInteger('reviewed_by')->nullable();
            $table->foreign('reviewed_by', 'org_app_reviews_by_fk')->references('school_id')->on('users')->nullOnDelete();
            $table->timestamps();
            $table->unique(['organization_application_id', 'requirement_type_id', 'round', 'stage'], 'org_app_review_unique');
        });

        Schema::create('organization_application_review_files', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_application_id')->constrained('organization_applications', indexName: 'org_app_review_files_app_fk')->cascadeOnDelete();
            $table->unsignedBigInteger('requirement_type_id')->nullable();
            $table->foreign('requirement_type_id', 'org_app_review_files_req_fk')->references('id')->on('compliance_requirement_types')->nullOnDelete();
            $table->unsignedSmallInteger('round')->default(1);
            $table->string('stage', 10);
            $table->unsignedInteger('uploaded_by')->nullable();
            $table->foreign('uploaded_by', 'org_app_review_files_by_fk')->references('school_id')->on('users')->nullOnDelete();
            $table->string('file_path', 500);
            $table->string('file_original_name', 255);
            $table->string('mime_type', 100);
            $table->unsignedInteger('file_size');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_application_review_files');
        Schema::dropIfExists('organization_application_requirement_reviews');
        DB::table('organization_applications')->where('status', 'pending_dean')->update(['status' => 'pending_endorsement']);
        DB::table('organization_applications')->where('status', 'pending_sao')->update(['status' => 'endorsed']);
        Schema::table('organization_applications', function (Blueprint $table) {
            $table->dropColumn(['round', 'submitted_at', 'endorsement_note', 'returned_by', 'returned_by_role', 'returned_at']);
        });
    }
};
