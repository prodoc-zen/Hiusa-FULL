<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>{{ $report->title }}</title>
    <style>
        @page { margin: 106px 52px 54px; }
        * { box-sizing: border-box; }
        body { margin: 0; color: #111827; font-family: "Times New Roman", "Times", serif; font-size: 11px; line-height: 1.45; }
        .letterhead { position: fixed; top: -82px; left: 0; right: 0; height: 68px; border-bottom: 1px solid #64748b; padding: 0 8px 8px; text-align: left; }
        .letterhead img { display: block; max-width: 100%; max-height: 56px; }
        .letterhead-fallback { padding-top: 10px; color: #0f2f62; }
        .letterhead-fallback strong { display: block; font-size: 15px; }
        .letterhead-fallback span { display: block; margin-top: 3px; font-size: 9px; }
        .letter-date { margin: 4px 0 28px; }
        .subject { margin-bottom: 14px; font-weight: 700; }
        .recipient { margin-bottom: 22px; }
        .body-copy { margin: 0 0 24px; text-align: justify; font-family: "DejaVu Sans", sans-serif; }
        .report-table { width: 100%; border-collapse: collapse; font-size: 9px; }
        .report-table th, .report-table td { border: 1px solid #111827; padding: 5px 7px; }
        .report-table .document-title { background: #eef6fb; text-align: center; font-size: 10px; }
        .report-table .section { background: #f8fafc; font-weight: 700; }
        .report-table .label { width: 68%; }
        .report-table .amount { width: 32%; text-align: right; font-family: "DejaVu Sans", sans-serif; font-variant-numeric: tabular-nums; }
        .report-table .total td { font-weight: 700; }
        .report-table .net-label { background: #0b1831; color: #fff; font-weight: 700; text-align: right; }
        .report-table .negative { color: #991b1b; }
        .closing { margin-top: 22px; }
        .signatures { margin-top: 34px; page-break-inside: avoid; }
        .signatures table { width: 100%; border-collapse: collapse; }
        .signatures td { width: 50%; padding: 24px 18px 8px; text-align: center; vertical-align: top; }
        .signatures strong { display: block; border-top: 1px solid #111827; padding-top: 4px; }
        .signatures span { display: block; margin-top: 2px; color: #475569; font-size: 8px; }
    </style>
</head>
<body>
    @include('pdf.partials.letterhead')

    <p class="letter-date">{{ $letter['date'] }}</p>
    <p class="subject">Subject: {{ $letter['subject'] }}</p>
    <p class="recipient">{{ $letter['recipient'] }}</p>
    <p class="body-copy">{!! $letter['body_html'] !!}</p>

    <table class="report-table">
        <thead>
            <tr><th colspan="2" class="document-title">INCOME STATEMENT</th></tr>
        </thead>
        <tbody>
            <tr><td colspan="2" class="section">INCOME</td></tr>
            @forelse ($incomeCategories as $row)
                <tr><td class="label">{{ $row['category'] }}</td><td class="amount">₱{{ number_format($row['amount'], 2) }}</td></tr>
            @empty
                <tr><td class="label">No income recorded</td><td class="amount">₱0.00</td></tr>
            @endforelse
            <tr class="total"><td>TOTAL INCOME</td><td class="amount">₱{{ number_format($incomeTotal, 2) }}</td></tr>
            <tr><td colspan="2" class="section">LESS</td></tr>
            @forelse ($expenseCategories as $row)
                <tr><td class="label">{{ $row['category'] }}</td><td class="amount">₱{{ number_format($row['amount'], 2) }}</td></tr>
            @empty
                <tr><td class="label">No expenses recorded</td><td class="amount">₱0.00</td></tr>
            @endforelse
            <tr class="total"><td>TOTAL LESS</td><td class="amount">₱{{ number_format($expenseTotal, 2) }}</td></tr>
            <tr class="total"><td class="net-label">NET INCOME</td><td class="amount {{ $periodNet < 0 ? 'negative' : '' }}">₱{{ number_format($periodNet, 2) }}</td></tr>
        </tbody>
    </table>

    @if ($custody)
        <p style="margin: 16px 0 4px; font-weight: 700;">COLLECTIONS AND REMITTANCES</p>
        <p style="margin: 0 0 4px; color: #475569;">Remittances are custody movements and are excluded from net income.</p>
        <table class="report-table"><tbody>
            <tr><td>Verified collections</td><td class="amount">₱{{ number_format($custody['verified_collections'], 2) }}</td></tr>
            <tr><td>Recorded remittances</td><td class="amount">₱{{ number_format($custody['recorded_remittances'], 2) }}</td></tr>
        </tbody></table>
    @endif

    <p class="closing">{{ $letter['closing'] }}</p>
    @include('pdf.partials.signatories')
</body>
</html>
