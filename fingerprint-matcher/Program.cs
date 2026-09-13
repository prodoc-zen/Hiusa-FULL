using System.Diagnostics;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Caching.Memory;
using SourceAFIS;

const string TemplateFormat = "fscanner-sourceafis-dotnet-3.14.0-png-v1";
const int PngSampleFormat = 5;
const int MaxImageBytes = 2 * 1024 * 1024;

var builder = WebApplication.CreateBuilder(args);
// Enrollment can contain eight base64-encoded captures (up to 2 MiB each at
// Laravel's boundary), so leave enough room for the JSON/base64 overhead.
builder.WebHost.ConfigureKestrel(options => options.Limits.MaxRequestBodySize = 24 * 1024 * 1024);
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
    options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
});

var apiKey = Environment.GetEnvironmentVariable("MATCHER_API_KEY") ?? string.Empty;
var matchThreshold = ReadDouble("MATCH_THRESHOLD", 40);
var enrollmentThreshold = ReadDouble("ENROLLMENT_CONSISTENCY_THRESHOLD", 25);
var fingerprintDpi = ReadDouble("FINGERPRINT_DPI", 512);
var templateCacheSize = ReadInt("TEMPLATE_CACHE_SIZE", 10000);
using var templateCache = new MemoryCache(new MemoryCacheOptions { SizeLimit = templateCacheSize });

var app = builder.Build();

app.Use(async (context, next) =>
{
    if (context.Request.Path == "/health")
    {
        await next();
        return;
    }

    if (string.IsNullOrWhiteSpace(apiKey))
    {
        await Results.Json(new { message = "MATCHER_API_KEY is not configured on the matcher service." }, statusCode: 503)
            .ExecuteAsync(context);
        return;
    }

    var authorization = context.Request.Headers.Authorization.ToString();
    var supplied = authorization.StartsWith("Bearer ", StringComparison.Ordinal) ? authorization[7..] : string.Empty;
    if (!SecureEquals(apiKey, supplied))
    {
        await Results.Json(new { message = "Invalid matcher API key." }, statusCode: 401).ExecuteAsync(context);
        return;
    }

    await next();
});

app.MapGet("/health", () => Results.Ok(new
{
    status = "ok",
    service = "hiusa-sourceafis-matcher",
    template_format = TemplateFormat,
    algorithm = "SourceAFIS .NET 3.14.0",
    certified = false,
    dpi = fingerprintDpi,
    threshold = matchThreshold,
}));

app.MapPost("/enroll", (EnrollRequest request) =>
{
    ValidateSamples(request.Samples, request.SampleFormat, 4, 8, "Enrollment");
    var templates = request.Samples!.Select(CreateTemplate).ToList();
    var connections = new int[templates.Count];
    var compatiblePairs = 0;

    for (var first = 0; first < templates.Count; first++)
    {
        for (var second = first + 1; second < templates.Count; second++)
        {
            var score = new FingerprintMatcher(templates[first]).Match(templates[second]);
            if (score >= enrollmentThreshold)
            {
                connections[first]++;
                connections[second]++;
                compatiblePairs++;
            }
        }
    }

    if (compatiblePairs < templates.Count - 1 || connections.Any(count => count == 0))
        throw new FingerprintRequestException("The enrollment scans do not appear to be the same finger. Use one finger for every scan.");

    var envelope = new TemplateEnvelope(
        1,
        "sourceafis-dotnet-3.14.0",
        fingerprintDpi,
        templates.Select(template => Convert.ToBase64String(template.ToByteArray())).ToList());

    return Results.Json(new { template = EncodeEnvelope(envelope), template_format = TemplateFormat }, statusCode: 201);
});

app.MapPost("/identify", (IdentifyRequest request) =>
{
    // HIUSA sends exactly one probe. The 1..4 bound keeps the Fscanner
    // adapter contract compatible while Laravel enforces the one-scan rule.
    ValidateSamples(request.Samples, request.SampleFormat, 1, 4, "Identification");
    if (request.Candidates is null || request.Candidates.Count == 0)
        throw new FingerprintRequestException("Identification requires at least one candidate.");
    if (request.Candidates.Count > 10000)
        throw new FingerprintRequestException("Identification accepts at most 10,000 candidates per request.");
    if (request.Candidates.Any(candidate => candidate.Id <= 0
        || string.IsNullOrWhiteSpace(candidate.Template)
        || candidate.TemplateFormat != TemplateFormat))
        throw new FingerprintRequestException("One or more identification candidates are invalid or incompatible.");

    var timer = Stopwatch.StartNew();
    var matchers = request.Samples!.Select(CreateTemplate).Select(probe => new FingerprintMatcher(probe)).ToList();
    var results = new List<IdentifyResult>(request.Candidates.Count);

    foreach (var candidate in request.Candidates)
    {
        var cacheKey = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(candidate.Template!)));
        var enrolled = templateCache.GetOrCreate(cacheKey, entry =>
        {
            entry.SetSize(1);
            entry.SetSlidingExpiration(TimeSpan.FromHours(1));
            var envelope = DecodeEnvelope(candidate.Template!);
            if (envelope.Version != 1 || envelope.Algorithm != "sourceafis-dotnet-3.14.0")
                throw new FingerprintRequestException("An identification candidate has an unsupported template version.");
            if (envelope.Samples.Count == 0)
                throw new FingerprintRequestException("An identification candidate contains no samples.");
            return envelope.Samples.Select(DecodeStoredTemplate).ToArray();
        })!;

        var bestScore = matchers
            .SelectMany(matcher => enrolled.Select(matcher.Match))
            .DefaultIfEmpty(0)
            .Max();
        results.Add(new IdentifyResult(candidate.Id, bestScore >= matchThreshold, Math.Round(bestScore, 4), matchThreshold));
    }

    timer.Stop();
    return Results.Ok(new
    {
        candidates = results.OrderByDescending(candidate => candidate.Score).ToList(),
        elapsed_ms = Math.Round(timer.Elapsed.TotalMilliseconds, 2),
    });
});

app.UseExceptionHandler(errorApp => errorApp.Run(async context =>
{
    var exception = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
    var rejected = exception is FingerprintRequestException
        || exception is ArgumentException
        || exception is InvalidOperationException
        || exception is JsonException
        || exception is FormatException;

    context.Response.StatusCode = rejected ? 422 : 500;
    await context.Response.WriteAsJsonAsync(new
    {
        message = rejected ? exception?.Message ?? "The fingerprint capture was rejected." : "The fingerprint matching engine failed unexpectedly.",
        code = rejected ? "invalid_fingerprint_capture" : "matcher_error",
    });
}));

app.Run();

FingerprintTemplate CreateTemplate(string encodedSample)
{
    var imageBytes = DecodeSample(encodedSample);
    try
    {
        var image = new FingerprintImage(imageBytes, new FingerprintImageOptions { Dpi = fingerprintDpi });
        return new FingerprintTemplate(image);
    }
    catch (Exception exception) when (exception is ArgumentException or InvalidOperationException)
    {
        throw new FingerprintRequestException("The fingerprint PNG could not be processed. Clean the reader and capture a clear image.", exception);
    }
}

static FingerprintTemplate DecodeStoredTemplate(string encoded)
{
    try
    {
        return new FingerprintTemplate(Convert.FromBase64String(encoded));
    }
    catch (Exception exception) when (exception is FormatException or ArgumentException or InvalidOperationException)
    {
        throw new FingerprintRequestException("The enrolled fingerprint template is damaged.", exception);
    }
}

static byte[] DecodeSample(string encoded)
{
    if (string.IsNullOrWhiteSpace(encoded))
        throw new FingerprintRequestException("Every fingerprint sample must be a non-empty string.");

    var value = encoded.Trim();
    if (value.StartsWith("data:", StringComparison.OrdinalIgnoreCase))
    {
        var comma = value.IndexOf(',');
        if (comma < 0)
            throw new FingerprintRequestException("The fingerprint image data URL is invalid.");
        value = value[(comma + 1)..];
    }

    value = value.Replace('-', '+').Replace('_', '/');
    value = value.PadRight(value.Length + ((4 - value.Length % 4) % 4), '=');

    try
    {
        var bytes = Convert.FromBase64String(value);
        if (bytes.Length == 0 || bytes.Length > MaxImageBytes)
            throw new FingerprintRequestException("A fingerprint image is empty or too large.");
        return bytes;
    }
    catch (FormatException exception)
    {
        throw new FingerprintRequestException("A fingerprint sample is not valid base64 data.", exception);
    }
}

static void ValidateSamples(List<string>? samples, int sampleFormat, int minimum, int maximum, string operation)
{
    if (sampleFormat != PngSampleFormat)
        throw new FingerprintRequestException("This matcher accepts DigitalPersona PNG samples (format 5) only.");
    if (samples is null || samples.Count < minimum || samples.Count > maximum)
        throw new FingerprintRequestException($"{operation} requires between {minimum} and {maximum} fingerprint scans.");
    if (samples.Any(string.IsNullOrWhiteSpace))
        throw new FingerprintRequestException("Every fingerprint sample must be a non-empty string.");
}

static string EncodeEnvelope(TemplateEnvelope envelope)
{
    var json = JsonSerializer.SerializeToUtf8Bytes(envelope);
    using var output = new MemoryStream();
    using (var gzip = new GZipStream(output, CompressionLevel.SmallestSize, leaveOpen: true))
        gzip.Write(json);
    return Convert.ToBase64String(output.ToArray());
}

static TemplateEnvelope DecodeEnvelope(string encoded)
{
    try
    {
        var compressed = Convert.FromBase64String(encoded);
        using var input = new MemoryStream(compressed);
        using var gzip = new GZipStream(input, CompressionMode.Decompress);
        var envelope = JsonSerializer.Deserialize<TemplateEnvelope>(gzip);
        return envelope ?? throw new FingerprintRequestException("The enrolled fingerprint template is invalid.");
    }
    catch (Exception exception) when (exception is FormatException or InvalidDataException or JsonException)
    {
        throw new FingerprintRequestException("The enrolled fingerprint template is invalid.", exception);
    }
}

static bool SecureEquals(string expected, string supplied)
{
    var expectedBytes = Encoding.UTF8.GetBytes(expected);
    var suppliedBytes = Encoding.UTF8.GetBytes(supplied);
    return expectedBytes.Length == suppliedBytes.Length && CryptographicOperations.FixedTimeEquals(expectedBytes, suppliedBytes);
}

static double ReadDouble(string name, double fallback)
{
    var value = Environment.GetEnvironmentVariable(name);
    return double.TryParse(value, System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed : fallback;
}

static int ReadInt(string name, int fallback)
{
    var value = Environment.GetEnvironmentVariable(name);
    return int.TryParse(value, out var parsed) && parsed > 0 ? parsed : fallback;
}

record EnrollRequest(List<string>? Samples, int SampleFormat);
record IdentifyRequest(List<string>? Samples, int SampleFormat, List<IdentifyCandidate>? Candidates);
record IdentifyCandidate(int Id, string? Template, string? TemplateFormat);
record IdentifyResult(int Id, bool Matched, double Score, double Threshold);
record TemplateEnvelope(int Version, string Algorithm, double Dpi, List<string> Samples);

sealed class FingerprintRequestException : Exception
{
    public FingerprintRequestException(string message) : base(message) { }
    public FingerprintRequestException(string message, Exception innerException) : base(message, innerException) { }
}
