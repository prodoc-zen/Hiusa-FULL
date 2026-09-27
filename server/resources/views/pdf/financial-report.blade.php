<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>{{ $report->title }}</title>
    <style>
        @page { margin: 104px 46px 54px; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111827; font-family: "DejaVu Sans", sans-serif; font-size: 9px; line-height: 1.35; }
        .letterhead { position: fixed; top: -80px; left: 0; right: 0; height: 66px; border-bottom: 1px solid #64748b; padding: 0 8px 8px; }
        .letterhead img { display: block; max-width: 100%; max-height: 54px; }
        .letterhead-fallback { padding-top: 10px; color: #0f2f62; }
        .letterhead-fallback strong { display: block; font-size: 15px; }
        .letterhead-fallback span { display: block; margin-top: 3px; font-size: 9px; }
        h1 { margin: 0 0 8px; text-align: center; font-size: 12px; }
        .period { margin: 0 0 12px; text-align: center; color: #475569; }
        .report-table { width: 100%; border-collapse: collapse; }
        .report-table thead { display: table-header-group; }
        .report-table tr { page-break-inside: avoid; }
        .report-table th, .report-table td { border: 1px solid #111827; padding: 5px 6px; vertical-align: top; }
        .report-table .band { background: #5d9eaa; color: #fff; text-align: center; font-weight: 700; }
        .report-table .section { background: #9cc8eb; color: #111827; text-align: center; font-weight: 700; }
        .report-table .columns { background: #111; color: #fff; }
        .report-table .date { width: 22%; text-align: center; white-space: nowrap; }
        .report-table .description { width: 56%; }
        .report-table .amount { width: 22%; text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .report-table .total-label { background: #8fd14f; font-weight: 700; text-align: right; }
        .report-table .balance-label { background: #fff200; font-weight: 700; text-align: right; }
        .report-table .spacer td { height: 8px; border: 0; padding: 0; }
        .signatures { margin-top: 34px; page-break-inside: avoid; }
        .signatures table { width: 100%; border-collapse: collapse; }
        .signatures td { width: 50%; padding: 24px 18px 8px; text-align: center; vertical-align: top; }
        .signatures strong { display: block; border-top: 1px solid #111827; padding-top: 4px; }
        .signatures span { display: block; margin-top: 2px; color: #475569; font-size: 8px; }
    </style>
</head>
<body>
    @include('pdf.partials.letterhead')

    <h1>FINANCIAL REPORT</h1>
    <p class="period">{{ $report->title }}</p>
    <table class="report-table">
        <thead>
            <tr><th colspan="3" class="band">DETAILED LEDGER</th></tr>
            <tr><th colspan="3" class="section">INFLOWS</th></tr>
            <tr class="columns"><th>Date</th><th>Description</th><th>Amount</th></tr>
        </thead>
        <tbody>
            @if ($openingBalance != 0.0)
                <tr><td class="date">Before period</td><td class="description">Opening balance</td><td class="amount">PHP {{ number_format($openingBalance, 2) }}</td></tr>
            @endif
            @forelse ($incomeTransactions as $transaction)
                <tr>
                    <td class="date">{{ optional($transaction->transaction_date)->format('M j, Y') ?? $transaction->transaction_date }}</td>
                    <td class="description">{{ $transaction->category }} | {{ $transaction->description }}</td>
                    <td class="amount">PHP {{ number_format((float) $transaction->amount, 2) }}</td>
                </tr>
            @empty
                <tr><td class="date">N/A</td><td class="description">No inflows recorded</td><td class="amount">PHP 0.00</td></tr>
            @endforelse
            <tr><td colspan="2" class="total-label">TOTAL INFLOW</td><td class="amount">PHP {{ number_format($incomeTotal, 2) }}</td></tr>
            <tr><td colspan="2" class="balance-label">BALANCE BEFORE OUTFLOWS</td><td class="amount">PHP {{ number_format($openingBalance + $incomeTotal, 2) }}</td></tr>
            <tr class="spacer"><td colspan="3"></td></tr>
            <tr><td colspan="3" class="section">CASH OUTFLOW</td></tr>
            <tr class="columns"><td class="date"><strong>Date</strong></td><td class="description"><strong>Description</strong></td><td class="amount"><strong>Amount</strong></td></tr>
            @forelse ($expenseTransactions as $transaction)
                <tr>
                    <td class="date">{{ optional($transaction->transaction_date)->format('M j, Y') ?? $transaction->transaction_date }}</td>
                    <td class="description">{{ $transaction->category }} | {{ $transaction->description }}</td>
                    <td class="amount">PHP {{ number_format((float) $transaction->amount, 2) }}</td>
                </tr>
            @empty
                <tr><td class="date">N/A</td><td class="description">No cash outflows recorded</td><td class="amount">PHP 0.00</td></tr>
            @endforelse
            <tr><td colspan="2" class="section">TOTAL OUTFLOW</td><td class="amount">PHP {{ number_format($expenseTotal, 2) }}</td></tr>
            <tr><td colspan="2" class="balance-label">BALANCE</td><td class="amount">PHP {{ number_format($closingBalance, 2) }}</td></tr>
        </tbody>
    </table>

    @include('pdf.partials.signatories')
</body>
</html>
