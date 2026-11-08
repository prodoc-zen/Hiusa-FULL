<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        $foreignKeys = DB::getDriverName() !== 'sqlite';

        Schema::create('student_registry', function (Blueprint $table) use ($foreignKeys) {
            $table->id();
            $table->unsignedInteger('school_id')->unique();
            $table->string('first_name', 60);
            $table->string('last_name', 60);
            $table->date('birth_date');
            $table->unsignedBigInteger('college_id')->index();
            $table->string('program', 120);
            $table->string('year_level', 30);
            $table->string('section', 30)->nullable();
            $table->timestamp('claimed_at')->nullable();
            $table->timestamps();

            if ($foreignKeys) {
                $table->foreign('college_id')->references('id')->on('colleges')->restrictOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('student_registry');
    }
};
