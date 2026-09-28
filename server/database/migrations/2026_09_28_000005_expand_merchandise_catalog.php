<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('merchandise', function (Blueprint $table) {
            $table->unsignedInteger('low_stock_threshold')->default(9);
            $table->decimal('promotion_price', 10, 2)->nullable();
            $table->unsignedInteger('promotion_buyer_limit')->nullable();
        });

        Schema::create('merchandise_variants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('merchandise_id')->constrained('merchandise')->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->string('name', 100);
            $table->unsignedInteger('stock_quantity')->default(0);
            $table->string('image_url')->nullable();
            $table->timestamps();
            $table->unique(['merchandise_id', 'name']);
        });

        Schema::table('orders', function (Blueprint $table) {
            $table->foreignId('merchandise_variant_id')->nullable()->constrained('merchandise_variants')->nullOnDelete();
            $table->string('variant_name', 100)->nullable();
            $table->decimal('unit_price', 10, 2)->nullable();
            $table->boolean('promotion_applied')->default(false);
        });
    }

    public function down(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->dropConstrainedForeignId('merchandise_variant_id');
            $table->dropColumn(['variant_name', 'unit_price', 'promotion_applied']);
        });
        Schema::dropIfExists('merchandise_variants');
        Schema::table('merchandise', function (Blueprint $table) {
            $table->dropColumn(['low_stock_threshold', 'promotion_price', 'promotion_buyer_limit']);
        });
    }
};
