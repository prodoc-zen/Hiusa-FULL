<?php

namespace Tests\Feature;

use App\Models\College;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Laravel\Sanctum\Sanctum;
use Tests\Concerns\CreatesCollegeFixtures;
use Tests\TestCase;

class SyncCollegesCommandTest extends TestCase
{
    use CreatesCollegeFixtures;
    use RefreshDatabase;

    private array $files = [];

    protected function tearDown(): void
    {
        foreach ($this->files as $file) {
            @unlink($file);
        }

        parent::tearDown();
    }

    private function listFile(string $contents): string
    {
        $path = tempnam(sys_get_temp_dir(), 'colleges-sync-test-');
        file_put_contents($path, $contents);

        return $this->files[] = $path;
    }

    private function counts(): array
    {
        return [
            'colleges' => College::count(),
            'organizations' => Organization::count(),
            'snapshot' => College::orderBy('id')->get()->toArray(),
        ];
    }

    private function homeOf(College $college): ?Organization
    {
        return Organization::where('organization_type', 'COLLEGE')->where('college_id', $college->id)->first();
    }

    public function test_it_creates_new_colleges_and_their_home_organizations_from_the_list(): void
    {
        $file = $this->listFile("# the real colleges\n\n  College of Business  ,cba\r\nCollege of Law\n   \n# done\n");
        $colleges = College::count();
        $organizations = Organization::count();

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Created college "College of Business" with code CBA.')
            ->expectsOutputToContain('Created college "College of Law".')
            ->expectsOutputToContain('Created the home organization for "College of Law".')
            ->expectsOutputToContain('2 colleges created')
            ->assertExitCode(0);

        $this->assertSame($colleges + 2, College::count());
        $this->assertSame($organizations + 2, Organization::count());

        $business = College::where('name', 'College of Business')->firstOrFail();
        $this->assertSame('CBA', $business->code);
        $this->assertTrue($business->is_active);
        $home = $this->homeOf($business);
        $this->assertSame('College of Business', $home->name);
        $this->assertSame('college-of-business', $home->slug);
        $this->assertSame('College of Business', $home->college);
        $this->assertSame('CBA', $home->acronym);
        $this->assertTrue($home->is_active);
        $this->assertSame('active', $home->lifecycle_status);

        $law = College::where('name', 'College of Law')->firstOrFail();
        $this->assertNull($law->code);
        $this->assertNotNull($this->homeOf($law));
    }

    public function test_a_second_run_changes_nothing(): void
    {
        $file = $this->listFile("College of Business,CBA\nCollege of Law\n");
        $this->artisan('colleges:sync', ['file' => $file])->assertExitCode(0);
        $before = $this->counts();

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('College "College of Business" already exists.')
            ->expectsOutputToContain('0 colleges created')
            ->assertExitCode(0);

        $this->assertSame($before, $this->counts());
    }

    public function test_names_match_ignoring_case_and_spacing_and_a_different_code_is_never_overwritten(): void
    {
        $computing = College::create(['name' => 'COLLEGE OF COMPUTER STUDIES', 'is_active' => true]);
        $engineering = College::create(['name' => 'College of Engineering', 'code' => 'COE', 'is_active' => true]);
        $colleges = College::count();
        $file = $this->listFile("  college of computer   studies  ,ccs\nCOLLEGE OF ENGINEERING,eng\n");

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Filled the code of "COLLEGE OF COMPUTER STUDIES": CCS.')
            ->expectsOutputToContain('The code of "College of Engineering" is COE but the list says ENG; left as it is.')
            ->assertExitCode(0);

        $this->assertSame($colleges, College::count());
        $this->assertSame('CCS', $computing->fresh()->code);
        $this->assertSame('COLLEGE OF COMPUTER STUDIES', $computing->fresh()->name);
        $this->assertSame('COE', $engineering->fresh()->code);
        $this->assertSame('College of Engineering', $engineering->fresh()->name);
    }

    public function test_an_existing_college_without_a_home_organization_gets_one(): void
    {
        $nursing = College::create(['name' => 'College of Nursing', 'is_active' => true]);
        $withHome = $this->makeCollege('CAS');
        $home = $this->makeCollegeHome($withHome);
        $file = $this->listFile("College of Nursing\n{$withHome->name},CAS\n");

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Created the home organization for "College of Nursing".')
            ->assertExitCode(0);

        $created = $this->homeOf($nursing);
        $this->assertNotNull($created);
        $this->assertSame('College of Nursing', $created->name);
        $this->assertNull($created->acronym);
        $this->assertSame(1, Organization::where('organization_type', 'COLLEGE')->where('college_id', $withHome->id)->count());
        $this->assertSame($home->id, $this->homeOf($withHome)->id);
    }

    public function test_the_home_organization_name_and_slug_get_a_suffix_when_taken(): void
    {
        Organization::factory()->create(['name' => 'College of Law', 'slug' => 'college-of-law', 'organization_type' => 'STUDENT_ORGANIZATION']);
        $file = $this->listFile("College of Law\n");

        $this->artisan('colleges:sync', ['file' => $file])->assertExitCode(0);

        $law = College::where('name', 'College of Law')->firstOrFail();
        $home = $this->homeOf($law);
        $this->assertSame('College of Law (College)', $home->name);
        $this->assertSame('college-of-law-college', $home->slug);
        $this->assertSame('College of Law', $home->college);
    }

    public function test_a_dry_run_prints_the_plan_and_writes_nothing(): void
    {
        College::create(['name' => 'College of Nursing', 'is_active' => true]);
        $before = $this->counts();
        $file = $this->listFile("College of Business,CBA\nCollege of Nursing,CON\n");

        $this->artisan('colleges:sync', ['file' => $file, '--dry-run' => true])
            ->expectsOutputToContain('Would create college "College of Business" with code CBA.')
            ->expectsOutputToContain('Would fill the code of "College of Nursing": CON.')
            ->expectsOutputToContain('Would create the home organization for "College of Nursing".')
            ->expectsOutputToContain('Dry run: nothing was written.')
            ->assertExitCode(0);

        $this->assertSame($before, $this->counts());
    }

    public function test_two_lines_that_fold_to_the_same_name_abort_and_write_nothing(): void
    {
        $before = $this->counts();
        $file = $this->listFile("College of Business,CBA\nCollege of Law\n  COLLEGE OF  business \n");

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Line 3 repeats the college on line 1')
            ->expectsOutputToContain('Nothing was written.')
            ->assertExitCode(1);

        $this->assertSame($before, $this->counts());
    }

    public function test_a_missing_unreadable_or_empty_list_fails_and_writes_nothing(): void
    {
        College::create(['name' => 'College of Nursing', 'is_active' => true]);
        $before = $this->counts();

        $this->artisan('colleges:sync', ['file' => sys_get_temp_dir().'/colleges-sync-test-does-not-exist.txt'])
            ->expectsOutputToContain('Cannot read the file')
            ->assertExitCode(1);
        $this->artisan('colleges:sync', ['file' => sys_get_temp_dir()])
            ->expectsOutputToContain('Cannot read the file')
            ->assertExitCode(1);
        $this->artisan('colleges:sync', ['file' => $this->listFile("# nothing here\n\n   \n")])
            ->expectsOutputToContain('The list has no colleges.')
            ->assertExitCode(1);
        $this->artisan('colleges:sync', ['file' => $this->listFile('')])
            ->expectsOutputToContain('The list has no colleges.')
            ->assertExitCode(1);

        $this->assertSame($before, $this->counts());
    }

    public function test_bad_lines_and_clashing_codes_abort_and_write_nothing(): void
    {
        College::create(['name' => 'College of Nursing', 'code' => 'CON', 'is_active' => true]);
        $before = $this->counts();

        $cases = [
            ['Line 1 has no code after the comma', "College of Business,\n"],
            ['Line 1 has no college name', ",CBA\n"],
            ['Line 1 has a comma but "C B A" is not a code', "College of Business,C B A\n"],
            ['Line 1 has a comma but "AAAAAAAAA" is not a code', "College of Business,AAAAAAAAA\n"],
            ['Line 1 has a comma but "HUMANITIES" is not a code', "College of Arts and Science, HUMANITIES\n"],
            ['Line 1 has a name longer than 245 characters', str_repeat('A', 246)."\n"],
            ['Line 2 uses the code CBA, which line 1 already uses', "College of Business,CBA\nCollege of Law,cba\n"],
            ['The code CON already belongs to "College of Nursing"', "College of Law,con\n"],
        ];

        foreach ($cases as [$message, $contents]) {
            $this->artisan('colleges:sync', ['file' => $this->listFile($contents)])
                ->expectsOutputToContain($message)
                ->assertExitCode(1);
            $this->assertSame($before, $this->counts());
        }
    }

    public function test_a_comma_inside_a_name_is_never_read_as_a_code(): void
    {
        College::create(['name' => 'College of Nursing', 'is_active' => true]);
        $before = $this->counts();

        $cases = [
            ['Line 1 has a comma but "Midwifery" is not a code', "College of Nursing, Midwifery\n"],
            ['Line 1 has a comma but "Accountancy" is not a code', "College of Nursing,Accountancy\n"],
            ['Line 1 has a name with a comma: "College of Law,CL"', "College of Law,CL,X\n"],
            ['Line 1 has a name that starts or ends with a double quote', "\"College of Business, Accountancy\",CBA\n"],
        ];

        foreach ($cases as [$message, $contents]) {
            $this->artisan('colleges:sync', ['file' => $this->listFile($contents)])
                ->expectsOutputToContain($message)
                ->expectsOutputToContain('Nothing was written.')
                ->assertExitCode(1);
            $this->assertSame($before, $this->counts());
        }
    }

    public function test_a_name_with_commas_is_written_in_the_pipe_form_without_a_code(): void
    {
        $name = 'College of Hospitality, Tourism and Customs Administration';
        $organizations = Organization::count();

        $this->artisan('colleges:sync', ['file' => $this->listFile("{$name}\n")])->assertExitCode(1);
        $this->artisan('colleges:sync', ['file' => $this->listFile("{$name} |\n")])
            ->expectsOutputToContain("Created college \"{$name}\".")
            ->assertExitCode(0);

        $college = College::where('name', $name)->firstOrFail();
        $this->assertNull($college->code);
        $this->assertSame(1, College::where('name', $name)->count());
        $this->assertSame($organizations + 1, Organization::count());
        $home = $this->homeOf($college);
        $this->assertSame($name, $home->name);
        $this->assertSame($name, $home->college);
        $this->assertNull($home->acronym);
    }

    public function test_a_name_with_commas_in_the_pipe_form_takes_the_code_after_the_pipe(): void
    {
        $name = 'College of Hospitality, Tourism and Customs Administration';

        $this->artisan('colleges:sync', ['file' => $this->listFile("  {$name}   |  chtca \n")])
            ->expectsOutputToContain("Created college \"{$name}\" with code CHTCA.")
            ->assertExitCode(0);

        $college = College::where('name', $name)->firstOrFail();
        $this->assertSame('CHTCA', $college->code);
        $this->assertSame('CHTCA', $this->homeOf($college)->acronym);
    }

    public function test_a_pipe_form_line_with_a_bad_code_aborts_and_writes_nothing(): void
    {
        College::create(['name' => 'College of Nursing', 'is_active' => true]);
        $before = $this->counts();
        $name = 'College of Hospitality, Tourism and Customs Administration';

        foreach (['Midwifery', 'AAAAAAAAA', 'C B A', 'CHT,CA'] as $tail) {
            $this->artisan('colleges:sync', ['file' => $this->listFile("College of Business\n{$name} | {$tail}\n")])
                ->expectsOutputToContain("Line 2 has \"{$tail}\" after the pipe, which is not a code")
                ->expectsOutputToContain('Nothing was written.')
                ->assertExitCode(1);
            $this->assertSame($before, $this->counts());
        }
    }

    public function test_more_than_one_pipe_on_a_line_aborts_and_writes_nothing(): void
    {
        $before = $this->counts();

        foreach (["College of Business\nCollege of Law | Arts | CL\n", "College of Business\nCollege of Law || CL\n"] as $contents) {
            $this->artisan('colleges:sync', ['file' => $this->listFile($contents)])
                ->expectsOutputToContain('Line 2 has more than one pipe')
                ->expectsOutputToContain('Nothing was written.')
                ->assertExitCode(1);
            $this->assertSame($before, $this->counts());
        }
    }

    public function test_the_comma_form_of_a_name_with_commas_is_still_refused_and_points_to_the_pipe_form(): void
    {
        $before = $this->counts();
        $example = 'College of Hospitality, Tourism and Customs Administration | CHTCA';

        foreach ([
            ['Line 1 has a comma but "Tourism and Customs Administration" is not a code', 'College of Hospitality, Tourism and Customs Administration
'],
            ['Line 1 has a name with a comma: "College of Law,CL"', 'College of Law,CL,X
'],
            ['Line 1 has a name that starts or ends with a double quote', '"College of Business, Accountancy",CBA
'],
        ] as [$message, $contents]) {
            $exit = Artisan::call('colleges:sync', ['file' => $this->listFile($contents)]);
            $output = Artisan::output();

            $this->assertSame(1, $exit);
            $this->assertStringContainsString($message, $output);
            $this->assertStringContainsString($example, $output);
            $this->assertStringContainsString('Nothing was written.', $output);
            $this->assertSame($before, $this->counts());
        }
    }

    public function test_the_other_name_checks_still_apply_to_the_pipe_form(): void
    {
        $before = $this->counts();
        $cases = [
            ['Line 1 has a name that starts or ends with a double quote', "\"College of Business, Accountancy\" | CBA\n"],
            ['Line 1 has no college name', " | CBA\n"],
            ['Line 1 has a name longer than 245 characters', str_repeat('A, ', 83)."| CBA\n"],
            ['Line 1 has an invisible or control character', "College of\u{200B} Law, Arts | CL\n"],
            ['Line 2 repeats the college on line 1', "College of Law, Arts | CL\ncollege of  law, ARTS |\n"],
            ['Line 2 repeats the college on line 1', "College of Law, Arts\u{00E9} | CL\nCollege of Law, Artse | CE\n"],
        ];

        foreach ($cases as [$message, $contents]) {
            $this->artisan('colleges:sync', ['file' => $this->listFile($contents)])
                ->expectsOutputToContain($message)
                ->expectsOutputToContain('Nothing was written.')
                ->assertExitCode(1);
            $this->assertSame($before, $this->counts());
        }
    }

    public function test_a_pipe_line_and_a_plain_line_work_in_one_file(): void
    {
        $name = 'College of Hospitality, Tourism and Customs Administration';
        $file = $this->listFile("College of Business,CBA\n{$name} | CHTCA\nCollege of Law\n");

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('3 colleges created')
            ->assertExitCode(0);

        $this->assertSame('CBA', College::where('name', 'College of Business')->value('code'));
        $this->assertSame('CHTCA', College::where('name', $name)->value('code'));
        $this->assertNull(College::where('name', 'College of Law')->value('code'));
        $this->assertNotNull($this->homeOf(College::where('name', $name)->first()));
    }

    public function test_the_pipe_form_is_idempotent_and_matches_an_existing_college_ignoring_case(): void
    {
        $existing = College::create(['name' => 'COLLEGE OF HOSPITALITY, TOURISM AND CUSTOMS ADMINISTRATION', 'is_active' => true]);
        $file = $this->listFile("College of Hospitality,  Tourism and Customs Administration | chtca\n");

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Filled the code of "COLLEGE OF HOSPITALITY, TOURISM AND CUSTOMS ADMINISTRATION": CHTCA.')
            ->assertExitCode(0);
        $this->assertSame(1, College::count());
        $this->assertSame('CHTCA', $existing->fresh()->code);
        $this->assertSame('COLLEGE OF HOSPITALITY, TOURISM AND CUSTOMS ADMINISTRATION', $existing->fresh()->name);
        $this->assertNotNull($this->homeOf($existing));
        $before = $this->counts();

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('already exists.')
            ->expectsOutputToContain('0 colleges created')
            ->assertExitCode(0);

        $this->assertSame($before, $this->counts());
    }

    public function test_a_dry_run_prints_the_parsed_name_and_code_of_a_pipe_line_on_one_line(): void
    {
        $before = $this->counts();

        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Hospitality, Tourism and Customs Administration | chtca\n"), '--dry-run' => true])
            ->expectsOutputToContain('Would create college "College of Hospitality, Tourism and Customs Administration" with code CHTCA.')
            ->expectsOutputToContain('Dry run: nothing was written.')
            ->assertExitCode(0);

        $this->assertSame($before, $this->counts());
    }

    public function test_a_code_is_all_capitals_or_all_lowercase_with_digits_and_hyphens(): void
    {
        $file = $this->listFile("College of Business,cba\nCollege of Law,CL-2\nCollege of Arts,12\nCollege of Music,ABCDEFGH\n");

        $this->artisan('colleges:sync', ['file' => $file])->assertExitCode(0);

        $this->assertSame('CBA', College::where('name', 'College of Business')->value('code'));
        $this->assertSame('CL-2', College::where('name', 'College of Law')->value('code'));
        $this->assertSame('12', College::where('name', 'College of Arts')->value('code'));
        $this->assertSame('ABCDEFGH', College::where('name', 'College of Music')->value('code'));
    }

    public function test_a_code_of_zero_is_a_code_and_not_an_absent_one(): void
    {
        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Arts,0\n"), '--dry-run' => true])
            ->expectsOutputToContain('Would create college "College of Arts" with code 0.')
            ->assertExitCode(0);
        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Arts,0\n")])
            ->expectsOutputToContain('Created college "College of Arts" with code 0.')
            ->assertExitCode(0);

        $this->assertSame('0', College::where('name', 'College of Arts')->value('code'));
    }

    public function test_unicode_whitespace_at_the_ends_of_a_line_does_not_reach_the_stored_name(): void
    {
        $file = $this->listFile("\u{00A0}College of Law\u{00A0}\r\nCollege of Business,CBA\u{00A0}\r\n");

        $this->artisan('colleges:sync', ['file' => $file])->assertExitCode(0);

        $this->assertSame(['College of Business', 'College of Law'], College::orderBy('name')->pluck('name')->all());
        $this->assertSame('CBA', College::where('name', 'College of Business')->value('code'));
        $this->assertSame('College of Law', $this->homeOf(College::where('name', 'College of Law')->first())->name);
    }

    public function test_a_blank_code_counts_as_no_code_and_the_home_acronym_follows_the_filled_code(): void
    {
        $nursing = College::create(['name' => 'College of Nursing', 'code' => '', 'is_active' => true]);
        $home = $this->makeCollegeHome($nursing);
        $home->update(['acronym' => null]);
        $file = $this->listFile("College of Nursing,CON\n");

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Filled the code of "College of Nursing": CON.')
            ->assertExitCode(0);

        $this->assertSame('CON', $nursing->fresh()->code);
        $this->assertSame('CON', $home->fresh()->acronym);
    }

    public function test_a_stored_code_with_a_trailing_space_still_owns_the_code(): void
    {
        College::create(['name' => 'College of Computer Studies', 'code' => 'CCS ', 'is_active' => true]);
        College::create(['name' => 'College of Law', 'is_active' => true]);
        $before = $this->counts();

        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Law,CCS\n")])
            ->expectsOutputToContain('The code CCS already belongs to "College of Computer Studies"')
            ->expectsOutputToContain('Nothing was written.')
            ->assertExitCode(1);
        $this->assertSame($before, $this->counts());

        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Computer Studies,CCS\n")])
            ->expectsOutputToContain('College "College of Computer Studies" already exists.')
            ->expectsOutputToContain('0 code mismatches left as they are')
            ->assertExitCode(0);
    }

    public function test_filling_a_code_fills_a_blank_home_acronym_but_never_overwrites_one(): void
    {
        $blank = College::create(['name' => 'College of Nursing', 'is_active' => true]);
        $blankHome = $this->makeCollegeHome($blank);
        $blankHome->update(['acronym' => '  ']);
        $named = College::create(['name' => 'College of Law', 'is_active' => true]);
        $namedHome = $this->makeCollegeHome($named);
        $namedHome->update(['acronym' => 'LAW-HOME']);
        $file = $this->listFile("College of Nursing,CON\nCollege of Law,CL\n");

        $this->artisan('colleges:sync', ['file' => $file, '--dry-run' => true])->assertExitCode(0);
        $this->assertSame('  ', $blankHome->fresh()->acronym);

        $this->artisan('colleges:sync', ['file' => $file])->assertExitCode(0);

        $this->assertSame('CON', $blankHome->fresh()->acronym);
        $this->assertSame('CL', $named->fresh()->code);
        $this->assertSame('LAW-HOME', $namedHome->fresh()->acronym);
    }

    public function test_a_name_the_database_would_treat_as_an_existing_college_aborts_before_any_write(): void
    {
        College::create(['name' => "College of\u{200B} Law", 'is_active' => true]);
        $before = $this->counts();

        foreach ([[], ['--dry-run' => true]] as $options) {
            $this->artisan('colleges:sync', ['file' => $this->listFile("College of Business\nCollege of Law\n")] + $options)
                ->expectsOutputToContain('which contains an invisible character and must be fixed by hand in the database first')
                ->expectsOutputToContain('Nothing was written.')
                ->assertExitCode(1);
            $this->assertSame($before, $this->counts());
        }

        Artisan::call('colleges:sync', ['file' => $this->listFile("College of Business\nCollege of Law\n")]);
        $this->assertStringContainsString('Line 2 "College of Law" collides with the existing college', Artisan::output());
        Artisan::call('colleges:sync', ['file' => $this->listFile("College of Law\n")]);
        $this->assertStringNotContainsString('exactly', Artisan::output());
    }

    public function test_two_new_lines_the_database_treats_as_equal_abort_in_the_dry_run_and_the_real_run(): void
    {
        $before = $this->counts();

        foreach ([["College of Law\nCollege of L\u{00E1}w\n", 'Line 2 repeats the college on line 1'],
            ["Colegio de Enfermer\u{00ED}a\nColegio de Enfermeria\n", 'Line 2 repeats the college on line 1'],
            ["Stra\u{00DF}e College\nStrasse College\n", 'Line 2 repeats the college on line 1']] as [$contents, $message]) {
            foreach ([[], ['--dry-run' => true]] as $options) {
                $this->artisan('colleges:sync', ['file' => $this->listFile($contents)] + $options)
                    ->expectsOutputToContain($message)
                    ->expectsOutputToContain('Nothing was written.')
                    ->assertExitCode(1);
                $this->assertSame($before, $this->counts());
            }
        }
    }

    public function test_names_that_differ_in_symbols_the_ascii_fold_cannot_map_are_not_treated_as_equal(): void
    {
        $this->artisan('colleges:sync', ['file' => $this->listFile("\u{1F393} College\n\u{1F4DA} College\n")])->assertExitCode(0);

        $this->assertSame(2, College::count());
    }

    public function test_a_unique_violation_during_the_write_is_one_friendly_line_and_rolls_everything_back(): void
    {
        $before = $this->counts();
        College::creating(function (College $college) {
            if ($college->name === 'College of Law') {
                DB::table('colleges')->insert(['name' => 'College of Law', 'is_active' => true]);
            }
        });

        $exit = Artisan::call('colleges:sync', ['file' => $this->listFile("College of Business\nCollege of Law\n")]);
        $output = Artisan::output();

        $this->assertSame(1, $exit);
        $this->assertStringContainsString('The database refused a name or code as a duplicate:', $output);
        $this->assertStringContainsString('Nothing was written.', $output);
        $this->assertStringNotContainsString('Stack trace', $output);
        $this->assertStringNotContainsString('#0', $output);
        $this->assertStringNotContainsString('insert into', $output);
        $this->assertSame($before, $this->counts());
    }

    public function test_invisible_format_and_control_characters_in_a_name_are_rejected(): void
    {
        $before = $this->counts();

        foreach (["College of\u{200B} Law", "College\u{00AD}of Law", "College of Law\u{FEFF},CL", "College of\x07Law"] as $contents) {
            $this->artisan('colleges:sync', ['file' => $this->listFile("College of Business\n{$contents}\n")])
                ->expectsOutputToContain('Line 2 has an invisible or control character')
                ->expectsOutputToContain('Nothing was written.')
                ->assertExitCode(1);
            $this->assertSame($before, $this->counts());
        }
    }

    public function test_a_name_is_capped_so_the_home_organization_name_fits_its_column(): void
    {
        $name = str_repeat('A', 245);
        Organization::factory()->create(['name' => $name, 'slug' => 'taken', 'organization_type' => 'STUDENT_ORGANIZATION']);

        $this->artisan('colleges:sync', ['file' => $this->listFile("{$name}\n")])->assertExitCode(0);

        $home = $this->homeOf(College::where('name', $name)->firstOrFail());
        $this->assertSame($name.' (College)', $home->name);
        $this->assertLessThanOrEqual(255, mb_strlen($home->name));
    }

    public function test_the_home_organization_name_stays_inside_its_column_for_the_third_suffix_too(): void
    {
        $name = str_repeat('A', 245);
        Organization::factory()->create(['name' => $name, 'slug' => 'taken-1', 'organization_type' => 'STUDENT_ORGANIZATION']);
        Organization::factory()->create(['name' => $name.' (College)', 'slug' => 'taken-2', 'organization_type' => 'STUDENT_ORGANIZATION']);

        $this->artisan('colleges:sync', ['file' => $this->listFile("{$name}\n")])->assertExitCode(0);

        $home = $this->homeOf(College::where('name', $name)->firstOrFail());
        $this->assertSame(str_repeat('A', 243).' (College 3)', $home->name);
        $this->assertLessThanOrEqual(255, mb_strlen($home->name));
    }

    public function test_a_name_with_no_letters_still_gets_a_unique_slug(): void
    {
        $this->artisan('colleges:sync', ['file' => $this->listFile("!!!\n???\n")])->assertExitCode(0);

        $this->assertSame('college', $this->homeOf(College::where('name', '!!!')->firstOrFail())->slug);
        $this->assertSame('college-2', $this->homeOf(College::where('name', '???')->firstOrFail())->slug);
    }

    public function test_a_slug_that_grows_when_transliterated_stays_inside_its_column(): void
    {
        $name = str_repeat("\u{00DF}", 200);

        $this->artisan('colleges:sync', ['file' => $this->listFile("{$name}\n")])->assertExitCode(0);

        $home = $this->homeOf(College::where('name', $name)->firstOrFail());
        $this->assertLessThanOrEqual(240, strlen($home->slug));
    }

    public function test_typographic_quotes_match_straight_quotes_and_are_stored_straight(): void
    {
        $womens = College::create(['name' => "Women's College", 'is_active' => true]);
        $file = $this->listFile("Women\u{2019}s College,WC\nCollege of \u{201C}Arts\u{201D} and Sciences\nSt. John\u{2018}s College\nSt. Paul\u{02BC}s College\nSt. Mark\u{201B}s College\nSt. Luke\u{201A}s College\nCollege of \u{201E}Music\u{201D} Studies\n");

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Filled the code of "Women\'s College": WC.')
            ->assertExitCode(0);

        $this->assertSame(7, College::count());
        $this->assertSame('WC', $womens->fresh()->code);
        $this->assertNotNull(College::where('name', 'College of "Arts" and Sciences')->first());
        $this->assertNotNull(College::where('name', "St. John's College")->first());
        $this->assertNotNull(College::where('name', "St. Paul's College")->first());
        $this->assertNotNull(College::where('name', "St. Mark's College")->first());
        $this->assertNotNull(College::where('name', "St. Luke's College")->first());
        $this->assertNotNull(College::where('name', 'College of "Music" Studies')->first());
    }

    public function test_a_college_missing_from_the_list_is_left_completely_untouched(): void
    {
        $nursing = College::create(['name' => 'College of Nursing', 'is_active' => true]);
        $retired = College::create(['name' => 'College of Retired Arts', 'code' => 'CRA', 'is_active' => false]);
        $nursingBefore = $nursing->fresh()->getAttributes();
        $retiredBefore = $retired->fresh()->getAttributes();
        $homes = Organization::where('organization_type', 'COLLEGE')->count();

        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Business\n")])
            ->expectsOutputToContain('Not in the list, left untouched:')
            ->expectsOutputToContain('College of Nursing')
            ->expectsOutputToContain('College of Retired Arts')
            ->expectsOutputToContain('2 not in the list')
            ->assertExitCode(0);

        $this->assertSame($nursingBefore, $nursing->fresh()->getAttributes());
        $this->assertSame($retiredBefore, $retired->fresh()->getAttributes());
        $this->assertNull($this->homeOf($nursing));
        $this->assertNull($this->homeOf($retired));
        $this->assertSame($homes + 1, Organization::where('organization_type', 'COLLEGE')->count());
    }

    private function unlinkedStudentOrganization(string $college, array $overrides = []): Organization
    {
        return Organization::factory()->create([
            'college' => $college,
            'college_id' => null,
            'organization_type' => 'STUDENT_ORGANIZATION',
            ...$overrides,
        ]);
    }

    public function test_a_real_run_links_unlinked_student_organizations_whose_college_name_matches_and_a_dry_run_does_not(): void
    {
        $fisheries = College::create(['name' => 'College of Fisheries', 'is_active' => true]);
        $first = $this->unlinkedStudentOrganization('College of Fisheries');
        $second = $this->unlinkedStudentOrganization('  college of FISHERIES ');
        $other = $this->unlinkedStudentOrganization('College of Law');
        $file = $this->listFile("COLLEGE OF FISHERIES\nCollege of Business\n");

        $this->artisan('colleges:sync', ['file' => $file, '--dry-run' => true])
            ->expectsOutputToContain('Would link 2 student organizations to "College of Fisheries".')
            ->expectsOutputToContain('2 student organizations would be linked')
            ->assertExitCode(0);
        $this->assertNull($first->fresh()->college_id);
        $this->assertNull($second->fresh()->college_id);

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Linked 2 student organizations to "College of Fisheries".')
            ->expectsOutputToContain('2 student organizations linked')
            ->assertExitCode(0);
        $this->assertSame($fisheries->id, $first->fresh()->college_id);
        $this->assertSame($fisheries->id, $second->fresh()->college_id);
        $this->assertNull($other->fresh()->college_id);
    }

    public function test_a_newly_created_college_gets_its_matching_student_organizations_linked(): void
    {
        $org = $this->unlinkedStudentOrganization('College of Business');
        $file = $this->listFile("College of Business\n");

        $this->artisan('colleges:sync', ['file' => $file, '--dry-run' => true])
            ->expectsOutputToContain('Would link 1 student organization to "College of Business".')
            ->assertExitCode(0);
        $this->assertNull($org->fresh()->college_id);

        $this->artisan('colleges:sync', ['file' => $file])
            ->expectsOutputToContain('Linked 1 student organization to "College of Business".')
            ->assertExitCode(0);
        $this->assertSame(College::where('name', 'College of Business')->value('id'), $org->fresh()->college_id);
    }

    public function test_a_student_organization_that_already_has_a_college_is_never_moved(): void
    {
        $fisheries = College::create(['name' => 'College of Fisheries', 'is_active' => true]);
        $law = College::create(['name' => 'College of Law', 'is_active' => true]);
        $org = $this->unlinkedStudentOrganization('College of Fisheries', ['college_id' => $law->id]);
        $file = $this->listFile("College of Fisheries\nCollege of Law\n");

        $this->artisan('colleges:sync', ['file' => $file])
            ->doesntExpectOutputToContain('Linked')
            ->expectsOutputToContain('0 student organizations linked')
            ->assertExitCode(0);

        $this->assertSame($law->id, $org->fresh()->college_id);
        $this->assertNotSame($fisheries->id, $org->fresh()->college_id);
    }

    public function test_only_student_organizations_are_linked(): void
    {
        College::create(['name' => 'College of Fisheries', 'is_active' => true]);
        $home = $this->unlinkedStudentOrganization('College of Fisheries', ['organization_type' => 'COLLEGE']);

        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Fisheries\n")])->assertExitCode(0);

        $this->assertNull($home->fresh()->college_id);
    }

    public function test_linking_is_idempotent(): void
    {
        College::create(['name' => 'College of Fisheries', 'is_active' => true]);
        $this->unlinkedStudentOrganization('College of Fisheries');
        $file = $this->listFile("College of Fisheries\n");
        $this->artisan('colleges:sync', ['file' => $file])->assertExitCode(0);
        $before = Organization::orderBy('id')->get()->toArray();

        $this->artisan('colleges:sync', ['file' => $file])
            ->doesntExpectOutputToContain('Linked')
            ->expectsOutputToContain('0 student organizations linked')
            ->assertExitCode(0);

        $this->assertSame($before, Organization::orderBy('id')->get()->toArray());
    }

    public function test_a_linked_organization_shows_up_for_the_department_head_of_that_college(): void
    {
        $fisheries = College::create(['name' => 'College of Fisheries', 'is_active' => true]);
        $org = $this->unlinkedStudentOrganization('College of Fisheries');
        $this->artisan('colleges:sync', ['file' => $this->listFile("College of fisheries\n")])->assertExitCode(0);
        $head = $this->makeCollegeHead($fisheries);

        $this->assertSame([$org->id], $head->scopedOrganizationIds());
    }

    public function test_a_code_of_hyphens_only_is_refused(): void
    {
        $before = $this->counts();

        foreach (["College of Arts | -\n", "College of Arts | --\n", "College of Arts,-\n", "College of Arts,--\n"] as $contents) {
            $this->artisan('colleges:sync', ['file' => $this->listFile($contents)])
                ->expectsOutputToContain('not a code')
                ->expectsOutputToContain('Nothing was written.')
                ->assertExitCode(1);
            $this->assertSame($before, $this->counts());
        }

        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Arts,A-\nCollege of Law,-1\n")])->assertExitCode(0);
        $this->assertSame('A-', College::where('name', 'College of Arts')->value('code'));
        $this->assertSame('-1', College::where('name', 'College of Law')->value('code'));
    }

    public function test_a_look_alike_pipe_is_refused_with_a_retype_message(): void
    {
        $before = $this->counts();

        foreach (["\u{FF5C}", "\u{00A6}", "\u{2223}", "\u{01C0}"] as $bar) {
            foreach (["College of Business\nCollege of Law {$bar} CL\n", "College of Business\nCollege of Law, Arts {$bar}\n"] as $contents) {
                $this->artisan('colleges:sync', ['file' => $this->listFile($contents)])
                    ->expectsOutputToContain('Line 2 has a character that looks like a pipe but is not one')
                    ->expectsOutputToContain('Nothing was written.')
                    ->assertExitCode(1);
                $this->assertSame($before, $this->counts());
            }
        }
    }

    public function test_a_synced_college_can_be_given_a_department_head_by_the_sao(): void
    {
        $sao = Organization::factory()->create(['organization_type' => 'SYSTEM_ADMINISTRATION']);
        $director = User::factory()->superAdmin()->create(['organization_id' => $sao->id]);
        $this->artisan('colleges:sync', ['file' => $this->listFile("College of Business,CBA\n")])->assertExitCode(0);
        $college = College::where('name', 'College of Business')->firstOrFail();
        Sanctum::actingAs($director);

        $this->postJson("/api/system/colleges/{$college->id}/department-head", [
            'school_id' => 20269001,
            'first_name' => 'Ramon',
            'last_name' => 'Castillo',
            'email' => 'ramon.castillo@example.edu',
            'password' => 'Dean2026!Pass',
            'password_confirmation' => 'Dean2026!Pass',
        ])->assertCreated();

        $this->assertSame($this->homeOf($college)->id, User::findOrFail(20269001)->organization_id);
    }
}
