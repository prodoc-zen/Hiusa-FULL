<?php

namespace Tests\Feature;

use App\Services\Ai\Evaluation\ReportCheckFixture;
use App\Services\Finance\FinancialReportChecks;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Runs the report checks over the held-out ledgers written by someone other than the rule author
 * (server/tests/Fixtures/ai-eval/report-checks.dev.json and .test.json). Every case is seeded through the real
 * columns, the checks run, and the codes and refs found must equal the codes and refs expected; precision and recall
 * over the whole set are printed. The files are copied in by the merge stage, so the test skips until they exist.
 * FinancialReportChecksTest proves the same loader and rules on inline cases.
 */
class FinancialReportChecksHeldOutTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, array{0: string}> */
    public static function splits(): array
    {
        return ['dev' => ['dev'], 'test' => ['test']];
    }

    #[DataProvider('splits')]
    public function test_the_checks_return_exactly_the_expected_findings(string $split): void
    {
        $path = base_path("tests/Fixtures/ai-eval/report-checks.{$split}.json");
        if (! is_file($path)) {
            $this->markTestSkipped("The held-out set report-checks.{$split}.json is not in server/tests/Fixtures/ai-eval yet; the merge stage copies the eval sets there.");
        }

        $set = json_decode((string) file_get_contents($path), true);
        $this->assertIsArray($set['cases'] ?? null, 'The case file has no cases list.');

        $truePositives = $falsePositives = $falseNegatives = 0;
        $wrong = [];
        foreach ($set['cases'] as $case) {
            $fixture = ReportCheckFixture::seed($case);
            $found = $fixture->signatures(app(FinancialReportChecks::class)->forReport($fixture->report));
            $expected = ReportCheckFixture::expectedSignatures($case);

            $truePositives += count(array_intersect($found, $expected));
            $falsePositives += count(array_diff($found, $expected));
            $falseNegatives += count(array_diff($expected, $found));
            if ($found !== $expected) {
                $wrong[] = $case['id'].': expected ['.implode(', ', $expected).'] but found ['.implode(', ', $found).']';
            }
        }

        $precision = $truePositives + $falsePositives === 0 ? 1.0 : $truePositives / ($truePositives + $falsePositives);
        $recall = $truePositives + $falseNegatives === 0 ? 1.0 : $truePositives / ($truePositives + $falseNegatives);
        fwrite(STDERR, sprintf("\nreport-checks %s: %d cases, precision %.1f%%, recall %.1f%%\n", $split, count($set['cases']), $precision * 100, $recall * 100));

        $this->assertSame([], $wrong, "Cases that did not match:\n".implode("\n", $wrong));
    }
}
