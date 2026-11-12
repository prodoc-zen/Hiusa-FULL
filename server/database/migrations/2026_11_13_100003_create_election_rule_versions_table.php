<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('election_rule_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('election_id')->constrained('elections')->cascadeOnDelete();
            $table->unsignedSmallInteger('version');
            $table->longText('rules')->nullable();
            $table->string('tie_break_rule', 500)->nullable();
            $table->unsignedInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();
            $table->unique(['election_id', 'version']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('election_rule_versions');
    }
};
