<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>{{ $number }}</title>
    <style>
        @page { margin: 56px 56px; }
        body { margin: 0; color: #0f172a; font-family: "DejaVu Sans", sans-serif; font-size: 11px; line-height: 1.4; }
        h1 { margin: 0; font-family: "Times New Roman", "Times", serif; font-size: 28px; font-weight: 400; }
        .head { width: 100%; border-top: 2px solid #111827; border-bottom: 2px solid #111827; border-collapse: collapse; }
        .head td { padding: 8px 0; vertical-align: bottom; }
        .head .date { text-align: right; font-size: 10px; }
        .line { width: 100%; border-bottom: 1px solid #64748b; border-collapse: collapse; }
        .line td { padding: 10px 0; vertical-align: top; }
        .line .right { text-align: right; }
        .closing { width: 100%; border-bottom: 2px solid #111827; border-collapse: collapse; }
        .closing td { padding: 10px 0; width: 50%; }
        .org { margin-top: 12px; color: #475569; }
        .details { margin-top: 22px; padding: 12px; border: 1px solid #cbd5e1; background: #f1f5f9; }
        .details h2 { margin: 0 0 6px; font-size: 12px; color: #0f2f62; }
        .details td { padding: 2px 0; }
        .details .label { width: 30%; color: #64748b; }
    </style>
</head>
<body>
    @php
        $person = fn ($user) => trim(($user?->first_name ?? '').' '.($user?->last_name ?? '')) ?: 'Not recorded';
        $date = $receipt->transaction_date ? \Illuminate\Support\Carbon::parse($receipt->transaction_date)->timezone('Asia/Manila')->format('M j, Y g:i A') : 'Not recorded';
        $methods = ['cash' => 'Cash', 'gcash' => 'GCash', 'other' => 'Other'];
        $chosen = $method ? strtolower($method) : null;
    @endphp
    <table class="head"><tr><td><h1>Receipt</h1></td><td class="date"><strong>Date:</strong> {{ $date }}</td></tr></table>
    <table class="line"><tr><td><strong>Received from:</strong> {{ $person($receipt->payer) }}</td><td class="right"><strong>Number:</strong> {{ $number }}</td></tr></table>
    <table class="line"><tr><td><strong>Amount:</strong> &#8369;{{ number_format((float) $receipt->amount, 2) }}</td></tr></table>
    <table class="line"><tr><td>
        @if ($chosen)
            <strong>Mode of payment:</strong>
            @foreach ($methods as $value => $label)
                &nbsp;{{ $chosen === $value ? '[x]' : '[ ]' }} {{ $label }}
            @endforeach
        @else
            <strong>Mode of payment:</strong> Not recorded
        @endif
    </td></tr></table>
    <table class="line"><tr><td><strong>Payment for:</strong> {{ $receipt->description ?: ($receipt->category ?: 'Not recorded') }}</td></tr></table>
    <table class="closing"><tr><td><strong>Received by:</strong> {{ $person($receipt->recorder) }}</td><td><strong>Signature:</strong> ____________________</td></tr></table>
    <p class="org">{{ $organization }}</p>
    <div class="details">
        <h2>Transaction details</h2>
        <table>
            <tr><td class="label">Event</td><td>{{ $receipt->event?->title ?: 'Not linked' }}</td></tr>
            <tr><td class="label">Budget</td><td>{{ $receipt->budget?->title ?: 'Not linked' }}</td></tr>
            <tr><td class="label">Category</td><td>{{ $receipt->category ?: 'Not recorded' }}</td></tr>
        </table>
    </div>
</body>
</html>
