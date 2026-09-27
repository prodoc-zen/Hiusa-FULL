<header class="letterhead">
    @if ($letterheadDataUri)
        <img src="{{ $letterheadDataUri }}" alt="">
    @else
        <div class="letterhead-fallback">
            <strong>{{ $organization?->name ?? 'Student Organization' }}</strong>
            @if ($organization?->acronym)
                <span>{{ $organization->acronym }}</span>
            @endif
        </div>
    @endif
</header>
