<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>{{ $report['title'] }}</title>
    <style>
        body { font-family: 'DejaVu Sans', sans-serif; font-size: 10px; color: #0f172a; }
        h1 { font-size: 16px; margin: 0 0 4px; }
        .meta { color: #475569; margin: 0 0 14px; }
        table { width: 100%; border-collapse: collapse; }
        th { background: #f1f5f9; text-align: left; font-weight: bold; }
        th, td { border: 1px solid #cbd5e1; padding: 5px 6px; vertical-align: top; }
        .empty { color: #475569; margin-top: 12px; }
    </style>
</head>
<body>
    <h1>{{ $report['title'] }}</h1>
    <p class="meta">
        {{ $report['election']['title'] }}
        @if (! empty($report['election']['organization'])) | {{ $report['election']['organization'] }} @endif
        @if (! empty($report['election']['academic_year'])) | {{ $report['election']['academic_year'] }} @endif
        | Generated {{ $report['generated_at'] }}
    </p>

    <table>
        <thead>
            <tr>
                @foreach ($report['columns'] as $column)
                    <th>{{ $column }}</th>
                @endforeach
            </tr>
        </thead>
        <tbody>
            @foreach ($report['rows'] as $row)
                <tr>
                    @foreach ($row as $cell)
                        <td>{{ $cell }}</td>
                    @endforeach
                </tr>
            @endforeach
        </tbody>
    </table>

    @if (count($report['rows']) === 0)
        <p class="empty">Nothing to report yet.</p>
    @endif
</body>
</html>
