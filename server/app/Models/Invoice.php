<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
class Invoice extends Model { protected $guarded = []; protected function casts(): array { return ['amount_due'=>'decimal:2','due_date'=>'date']; } public function payments(): HasMany { return $this->hasMany(InvoicePayment::class); } }
