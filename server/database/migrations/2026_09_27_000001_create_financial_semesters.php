<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('financial_semesters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->date('starts_on');
            $table->date('ends_on');
            $table->timestamps();
            $table->unique(['organization_id', 'name']);
        });

        Schema::table('financial_reports', function (Blueprint $table) {
            $table->foreignId('financial_semester_id')->nullable()->constrained('financial_semesters')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('financial_reports', fn (Blueprint $table) => $table->dropConstrainedForeignId('financial_semester_id'));
        Schema::dropIfExists('financial_semesters');
    }
};
