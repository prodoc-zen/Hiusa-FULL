<?php

namespace Database\Seeders;

use App\Models\Merchandise;
use App\Models\Order;
use App\Models\Transaction;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Str;

class OrderSeeder extends Seeder
{
    public function run(): void
    {
        $officer1 = User::where('school_id', 900001)->first();
        $admin = User::where('school_id', 990001)->first();

        $shirt = Merchandise::where('name', 'HIUSA T-Shirt (S/M)')->first();
        $toteBag = Merchandise::where('name', 'HIUSA Tote Bag')->first();
        $lanyard = Merchandise::where('name', 'HIUSA Lanyard')->first();

        if (! $shirt || ! $toteBag || ! $lanyard) {
            return;
        }

        // A fresh, untouched order - left pending on purpose so the officer
        // verification -> admin approval flow can be demonstrated live.
        Order::create([
            'student_id' => 2200451, // Rafael Aquino
            'merchandise_id' => $shirt->id,
            'quantity' => 2,
            'total_price' => $shirt->price * 2,
            'payment_method' => null,
            'officer_review_status' => 'pending',
            'admin_review_status' => 'pending',
            'status' => 'pending',
            'claim_token' => strtoupper(Str::random(16)),
        ]);
        $shirt->decrement('stock_quantity', 2);

        // A fully verified and paid order, with the matching ledger receipt an
        // approved payment produces via OrderFulfillmentService::ensureReceipt().
        $paidOrder = Order::create([
            'student_id' => 2300078, // Camille Garcia
            'merchandise_id' => $toteBag->id,
            'quantity' => 1,
            'total_price' => $toteBag->price,
            'payment_method' => 'cash',
            'officer_review_status' => 'approved',
            'admin_review_status' => 'approved',
            'status' => 'paid',
            'processed_by' => $admin?->school_id,
            'approved_by' => $admin?->school_id,
            'claim_token' => strtoupper(Str::random(16)),
        ]);
        $toteBag->decrement('stock_quantity', 1);

        $paidReceipt = Transaction::create([
            'recorded_by' => $admin?->school_id ?? $officer1->school_id,
            'type' => 'income',
            'category' => 'Merchandise',
            'amount' => $paidOrder->total_price,
            'description' => 'Merchandise order ORD-'.$paidOrder->id,
            'receipt_reference' => 'MERCH-ORD-'.$paidOrder->id,
            'receipt_number' => 1,
            'payer_id' => $paidOrder->student_id,
            'transaction_date' => now()->subDays(2),
        ]);
        $paidOrder->update(['transaction_id' => $paidReceipt->id]);

        // A fully completed order lifecycle - paid, then claimed at pickup.
        $claimedOrder = Order::create([
            'student_id' => 2300163, // Andrei Navarro
            'merchandise_id' => $lanyard->id,
            'quantity' => 1,
            'total_price' => $lanyard->price,
            'payment_method' => 'cash',
            'officer_review_status' => 'approved',
            'admin_review_status' => 'approved',
            'status' => 'claimed',
            'processed_by' => $officer1->school_id,
            'approved_by' => $admin?->school_id,
            'claim_verified_by' => $officer1->school_id,
            'claim_verified_at' => now()->subDay(),
            'claimed_at' => now()->subDay(),
            'claim_token' => strtoupper(Str::random(16)),
        ]);
        $lanyard->decrement('stock_quantity', 1);

        $claimedReceipt = Transaction::create([
            'recorded_by' => $admin?->school_id ?? $officer1->school_id,
            'type' => 'income',
            'category' => 'Merchandise',
            'amount' => $claimedOrder->total_price,
            'description' => 'Merchandise order ORD-'.$claimedOrder->id,
            'receipt_reference' => 'MERCH-ORD-'.$claimedOrder->id,
            'receipt_number' => 2,
            'payer_id' => $claimedOrder->student_id,
            'transaction_date' => now()->subDays(4),
        ]);
        $claimedOrder->update(['transaction_id' => $claimedReceipt->id]);
    }
}
