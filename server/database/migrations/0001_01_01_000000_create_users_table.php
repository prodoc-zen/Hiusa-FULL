<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('users', function (Blueprint $table) {
            $table->unsignedInteger('school_id')->primary();
            $table->string('first_name', 60);
            $table->string('last_name', 60);
            $table->boolean('is_member')->default(false);
            $table->string('email', 100)->unique();
            $table->string('password_hash', 255);
            $table->enum('role', ['student', 'officer', 'admin', 'adviser'])->default('student');
            $table->binary('biometric_template')->nullable();
            $table->timestamps();
        });

        if (in_array(DB::getDriverName(), ['mysql', 'mariadb'], true)) {
            DB::statement('ALTER TABLE users MODIFY biometric_template LONGBLOB NULL');
            DB::statement('ALTER TABLE users ADD CONSTRAINT users_school_id_8_digits_check CHECK (school_id BETWEEN 1 AND 99999999)');
        } elseif (DB::getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE users ADD CONSTRAINT users_school_id_8_digits_check CHECK (school_id BETWEEN 1 AND 99999999)');
        }

        Schema::create('password_reset_tokens', function (Blueprint $table) {
            $table->string('email')->primary();
            $table->string('token');
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('sessions', function (Blueprint $table) {
            $table->string('id')->primary();
            $table->unsignedInteger('user_id')->nullable()->index();
            $table->string('ip_address', 45)->nullable();
            $table->text('user_agent')->nullable();
            $table->longText('payload');
            $table->integer('last_activity')->index();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('password_reset_tokens');
        Schema::dropIfExists('sessions');
    }
};
