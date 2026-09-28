@if (! empty($report->signatories))
    <section class="signatures">
        <table>
            <tr>
                <td><strong>{{ $report->signatories['treasurer'] ?? '' }}</strong><span>Treasurer</span></td>
                <td><strong>{{ $report->signatories['president'] ?? '' }}</strong><span>President</span></td>
            </tr>
            <tr>
                <td><strong>{{ $report->signatories['adviser'] ?? '' }}</strong><span>Adviser</span></td>
                <td><strong>{{ $report->signatories['sbo_adviser'] ?? '' }}</strong><span>SBO Adviser</span></td>
            </tr>
        </table>
    </section>
@endif
