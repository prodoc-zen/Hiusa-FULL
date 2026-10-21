<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organization_applications', function (Blueprint $table) {
            $table->boolean('requires_documents')->default(false);
            $table->unsignedSmallInteger('required_documents_count')->default(0);
        });
        Schema::create('organization_application_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_application_id')->constrained('organization_applications', indexName: 'org_app_docs_app_id_fk')->cascadeOnDelete();
            $table->foreignId('requirement_type_id')->constrained('compliance_requirement_types', indexName: 'org_app_docs_req_type_fk')->restrictOnDelete();
            $table->string('file_path', 500);
            $table->string('file_original_name', 255);
            $table->string('mime_type', 100);
            $table->unsignedInteger('file_size');
            $table->timestamps();
            $table->unique(['organization_application_id', 'requirement_type_id'], 'application_document_requirement_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('organization_application_documents');
        Schema::table('organization_applications', function (Blueprint $table) {
            $table->dropColumn(['requires_documents', 'required_documents_count']);
        });
    }
};
