# HIUSA SourceAFIS fingerprint matcher

This private service is integrated from the Fscanner algorithm. It turns four DigitalPersona PNG enrollment captures into a SourceAFIS template and compares one attendance probe against every compatible enrollment in the operator's organization.

It is not a certified biometric engine. Evaluate accuracy with the target DigitalPersona 4500 hardware and intended population before production use. Never expose port 9100 publicly.

## Local setup

1. Install the .NET 9 SDK.
2. Copy `.env.example` to `.env` and set a long random `MATCHER_API_KEY`.
3. Put the same value in `server/.env` as `FINGERPRINT_MATCHER_KEY`.
4. Run `dotnet restore`, then `.\start.ps1`.
5. Confirm `http://127.0.0.1:9100/health` returns `status: ok`.

Laravel also needs:

```dotenv
FINGERPRINT_MATCHER_DRIVER=http
FINGERPRINT_MATCHER_URL=http://127.0.0.1:9100
FINGERPRINT_MATCHER_KEY=the-same-private-key
FINGERPRINT_MATCHER_TIMEOUT=15
FINGERPRINT_MATCHER_TEMPLATE_FORMAT=fscanner-sourceafis-dotnet-3.14.0-png-v1
```

The browser requires HID Authentication Device Client and the DigitalPersona 4500 driver. Enrollment uses four scans of one finger for template quality. Attendance identification uses exactly one scan and requires operator confirmation before Laravel records check-in or checkout.

`MATCH_THRESHOLD` has a hard minimum of `60` for campus-scale one-to-many searches. Laravel independently enforces `FINGERPRINT_MIN_MATCH_SCORE=60` and `FINGERPRINT_MIN_SCORE_MARGIN=10` by default. Raise these only after testing genuine and impostor captures from the actual reader population; a higher score lowers false matches but increases rejected genuine scans.
