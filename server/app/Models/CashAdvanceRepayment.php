<?php
namespace App\Models;
use Illuminate\Database\Eloquent\Model;
class CashAdvanceRepayment extends Model { protected $guarded = []; protected function casts(): array { return ['amount'=>'decimal:2','repaid_at'=>'datetime']; } }
