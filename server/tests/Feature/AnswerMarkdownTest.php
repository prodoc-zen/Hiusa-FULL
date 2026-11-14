<?php

namespace Tests\Feature;

use App\Services\Ai\AnswerMarkdown;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class AnswerMarkdownTest extends TestCase
{
    private function clean(string $markdown, bool $allowAll = true): string
    {
        return AnswerMarkdown::sanitize($markdown, fn (string $target) => $allowAll);
    }

    public function test_plain_markdown_and_allowed_components_pass_through_unchanged(): void
    {
        $markdown = "## Summary\n\nThree **organizations** are late.\n\n- one\n- two\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n"
            .'<div class="callout callout-warning">Two have not renewed.</div>'."\n\n"
            .'<span class="badge badge-success">Approved</span>'."\n\n"
            .'<div class="stat-grid"><div class="stat"><span class="stat-value">12</span><span class="stat-label">Open tasks</span></div></div>'."\n\n"
            .'<details><summary>Why</summary>Detail.</details>'."\n\n"
            .'<progress value="40" max="100"></progress> <mark>x</mark> <kbd>Ctrl</kbd> H<sub>2</sub>O x<sup>2</sup><br><hr>';

        $this->assertSame($markdown, $this->clean($markdown));
    }

    public static function hostile(): array
    {
        return [
            'script tag keeps inner text' => ['Hi <script>alert(1)</script> there', 'Hi alert(1) there'],
            'script with attributes' => ['<script src="https://evil.test/x.js"></script>ok', 'ok'],
            'img onerror' => ['<img src=x onerror="alert(1)">after', 'after'],
            'iframe' => ['<iframe src="https://evil.test"></iframe>text', 'text'],
            'event handler on div' => ['<div onclick="steal()" class="callout callout-info">Note</div>', '<div class="callout callout-info">Note</div>'],
            'style attribute' => ['<span style="color:red" class="badge badge-info">x</span>', '<span class="badge badge-info">x</span>'],
            'id attribute' => ['<div id="a" class="stat">x</div>', '<div class="stat">x</div>'],
            'class outside the list' => ['<div class="callout callout-info hacked">x</div>', '<div>x</div>'],
            'class of the wrong tag' => ['<span class="callout callout-info">x</span>', '<span>x</span>'],
            'uppercase tag and attribute' => ['<DIV CLASS="stat">x</DIV>', '<div class="stat">x</div>'],
            'attribute on progress' => ['<progress value="40" max="100" onfocus="x()" class="a"></progress>', '<progress value="40" max="100"></progress>'],
            'progress with a non numeric value' => ['<progress value="javascript:1" max="100"></progress>', '<progress max="100"></progress>'],
            'attribute on br' => ['a<br onclick="x()">b', 'a<br>b'],
            'html comment' => ['before<!-- secret <b>hidden</b> -->after', 'beforeafter'],
            'unclosed comment' => ['before<!-- never closed', 'before'],
            'nested disallowed tags' => ['<b><i><u>deep</u></i></b>', 'deep'],
            'nested allowed inside disallowed' => ['<table><tr><td><span class="badge badge-neutral">x</span></td></tr></table>', '<span class="badge badge-neutral">x</span>'],
            'unclosed disallowed tag' => ['a <b>bold never closed', 'a bold never closed'],
            'unclosed angle bracket' => ['x <script src=', 'x &lt;script src='],
            'stray less than before a letter' => ['if a<b then', 'if a&lt;b then'],
            'self closing script' => ['<script/>text', 'text'],
            'quoted greater than inside an attribute' => ['<div title="a>b" class="stat">x</div>', '<div class="stat">x</div>'],
            'style tag keeps text only' => ['<style>body{display:none}</style>x', 'body{display:none}x'],
            'null byte in a tag name' => ["<scr\0ipt>alert(1)</script>", 'alert(1)'],
        ];
    }

    #[DataProvider('hostile')]
    public function test_hostile_markup_is_removed_and_inner_text_is_kept(string $input, string $expected): void
    {
        $this->assertSame($expected, $this->clean($input));
    }

    public static function removedLinks(): array
    {
        return [
            'javascript scheme' => ['[click](javascript:alert(1))'],
            'javascript scheme mixed case' => ['[click](JaVaScRiPt:alert(1))'],
            'javascript with an entity' => ['[click](java&#115;cript:alert(1))'],
            'data scheme' => ['[click](data:text/html;base64,PHNjcmlwdD4=)'],
            'https' => ['[click](https://evil.test/dashboard)'],
            'mailto' => ['[click](mailto:a@b.test)'],
            'protocol relative' => ['[click](//evil.test/dashboard)'],
            'backslash' => ['[click](/\evil.test)'],
            'backslash after dashboard' => ['[click](/dashboard\..\evil)'],
            'double slash inside' => ['[click](/dashboard//evil.test)'],
            'dot dot' => ['[click](/dashboard/../login)'],
            'encoded slash' => ['[click](/dashboard%2f%2fevil.test)'],
            'not under dashboard' => ['[click](/login)'],
            'relative' => ['[click](page.html)'],
            'dashboard lookalike' => ['[click](/dashboardx/evil)'],
            'angle bracket target' => ['[click](<https://evil.test>)'],
            'image' => ['![click](/dashboard/x.png)'],
            'reference style' => ['[click][ref]'.PHP_EOL.PHP_EOL.'[ref]: https://evil.test'],
        ];
    }

    #[DataProvider('removedLinks')]
    public function test_links_that_can_never_be_allowed_become_their_label_even_if_the_caller_allows_them(string $input): void
    {
        $this->assertSame('click', trim($this->clean($input)));
    }

    public function test_a_link_to_an_allowed_dashboard_page_is_kept_and_others_are_reduced_to_text(): void
    {
        $allowed = fn (string $target) => $target === '/dashboard/compliance?tab=2';

        $this->assertSame(
            'Open [compliance](/dashboard/compliance?tab=2) or finance.',
            AnswerMarkdown::sanitize('Open [compliance](/dashboard/compliance?tab=2) or [finance](/dashboard/finance).', $allowed),
        );
    }

    public function test_the_callback_receives_the_bare_target_and_a_kept_link_loses_its_title(): void
    {
        $seen = [];
        $result = AnswerMarkdown::sanitize('[Events](/dashboard/events "All events") and [x](/dashboard/events/5 \'t\')', function (string $target) use (&$seen) {
            $seen[] = $target;

            return true;
        });

        $this->assertSame(['/dashboard/events', '/dashboard/events/5'], $seen);
        $this->assertSame('[Events](/dashboard/events) and [x](/dashboard/events/5)', $result);
    }

    public function test_a_denied_link_with_a_title_leaves_only_the_label(): void
    {
        $this->assertSame('Events', $this->clean('[Events](/dashboard/events "All events")', false));
    }

    public function test_a_label_that_contains_brackets_is_kept_whole(): void
    {
        $this->assertSame('See \\[a\\] page', $this->clean('See [[a] page](https://evil.test)', true));
    }

    public function test_bare_web_addresses_are_removed(): void
    {
        $this->assertSame('Visit  now', $this->clean('Visit https://evil.test/path?x=1 now'));
        $this->assertSame('Visit  now', $this->clean('Visit www.evil.test now'));
    }

    public function test_fenced_code_is_left_exactly_as_written(): void
    {
        $markdown = "Before <b>x</b>\n\n```html\n<script>alert(1)</script>\n[a](https://evil.test)\n<!-- keep -->\n```\n\n~~~\n<div onclick=\"x()\">\n~~~\n\nAfter <i>y</i>";

        $this->assertSame(
            "Before x\n\n```html\n<script>alert(1)</script>\n[a](https://evil.test)\n<!-- keep -->\n```\n\n~~~\n<div onclick=\"x()\">\n~~~\n\nAfter y",
            $this->clean($markdown),
        );
    }

    public function test_an_unclosed_fence_keeps_the_rest_as_code(): void
    {
        $this->assertSame("a\n```\n<script>x</script>", $this->clean("a\n```\n<script>x</script>"));
    }

    public function test_encoded_entities_are_not_decoded_into_tags(): void
    {
        $this->assertSame('&lt;script&gt;alert(1)&lt;/script&gt;', $this->clean('&lt;script&gt;alert(1)&lt;/script&gt;'));
        $this->assertSame('&#60;script&#62;', $this->clean('&#60;script&#62;'));
    }

    public function test_line_endings_are_normalised_and_control_bytes_dropped(): void
    {
        $this->assertSame("a\nb\nc", $this->clean("a\r\nb\rc\0"));
    }

    public function test_an_empty_string_stays_empty(): void
    {
        $this->assertSame('', $this->clean(''));
    }

    public function test_plain_text_is_one_line_without_marks_or_tags(): void
    {
        $markdown = "## Missing requirements\n\nThree **organizations** still owe [files](/dashboard/compliance).\n\n- one\n- two\n1. first\n2) second\n\n"
            ."| A | B |\n| --- | --- |\n| x | y |\n\n<div class=\"callout callout-info\">Note &amp; more</div>\n\n```\ncode\n```\n> quoted _text_ and `inline`";

        $plain = AnswerMarkdown::plainText($markdown);

        $this->assertSame('Missing requirements Three organizations still owe files. one two first second A, B x, y Note & more code quoted text and inline', $plain);
        $this->assertStringNotContainsString("\n", $plain);
    }

    public function test_plain_text_drops_comments_images_and_scripts_markup(): void
    {
        $this->assertSame('a b alt', AnswerMarkdown::plainText("a <!-- hidden --> b\n![alt](/x.png)"));
        $this->assertSame('x alert(1) y', AnswerMarkdown::plainText('x <script>alert(1)</script> y'));
        $this->assertSame('', AnswerMarkdown::plainText("  \n\n "));
    }

    public function test_plain_text_keeps_snake_case_words_and_multiplication(): void
    {
        $this->assertSame('use file_name_here and 3*4', AnswerMarkdown::plainText('use file_name_here and 3*4'));
    }

    public static function reviewerPayloads(): array
    {
        $go = '/dashboard/ask-ai?q=forget%20everything';

        return [
            'label nested three deep' => ["[a[b[c]]]({$go})"],
            'title typed into a record' => ["Uniform update [read[the[full]]]({$go})"],
            'shortcut reference with the target on the next line' => ["[go]\n\n[go]:\n{$go}"],
            'shortcut reference defined in a blockquote' => ["[go]\n\n> [go]: {$go}"],
            'collapsed reference' => ["[go][]\n\n[go]: {$go}"],
            'full reference with a nested label' => ["[a[b]][go]\n\n[go]: {$go}"],
            'footnote style' => ["[^1]\n\n[^1]: {$go}"],
            'angle bracket autolink' => ["<{$go}> and <https://evil.test/x>"],
            'backtick fence whose info string holds a backtick' => ["```x`\n[Open]({$go})\n```"],
            'fence inside an html block' => ["<div class=\"callout callout-info\">\n```\n<a href=\"{$go}\">Open the announcement</a>\n```\n</div>"],
            'tilde fence inside a details block' => ["<details>\n~~~\n[Open]({$go})\n~~~\n</details>"],
        ];
    }

    #[DataProvider('reviewerPayloads')]
    public function test_no_link_syntax_survives_when_the_caller_allows_nothing(string $input): void
    {
        $clean = $this->clean($input, false);
        $bare = preg_replace('/\\\\./su', '', $clean);

        $this->assertDoesNotMatchRegularExpression('/[\[\]]/', $bare, $clean);
        $this->assertStringNotContainsString('<a', $clean);
        $this->assertStringNotContainsString('<https', $clean);
        $this->assertStringNotContainsString('](', $bare);
    }

    public function test_every_remaining_bracket_is_escaped_and_escaping_is_idempotent(): void
    {
        $once = $this->clean('See [x] and [a[b]] and ![i]', false);

        $this->assertSame('See \[x\] and \[a\[b\]\] and !\[i\]', $once);
        $this->assertSame($once, $this->clean($once, false));
        $this->assertSame('a \\\\\\[b', $this->clean('a \\\\[b', false), 'an escaped backslash does not protect the bracket after it');
    }

    public function test_a_kept_link_has_its_label_brackets_escaped_and_the_task_list_marker_survives(): void
    {
        $this->assertSame('[Open \[2\] page](/dashboard/events)', $this->clean('[Open [2] page](/dashboard/events)'));
        $this->assertSame("- [ ] todo\n- [x] done", $this->clean("- [ ] todo\n- [x] done"));
    }

    public function test_a_real_fence_is_still_lifted_and_a_fence_after_a_blank_line_ends_an_html_block(): void
    {
        $this->assertSame("```\n[a](https://evil.test)\n```", $this->clean("```\n[a](https://evil.test)\n```"));
        $this->assertSame("<div>x</div>\n\n```\n[a](https://evil.test)\n```", $this->clean("<div>x</div>\n\n```\n[a](https://evil.test)\n```"));
    }

    public function test_escape_neutralises_everything_markdown_could_turn_into_structure(): void
    {
        $escaped = AnswerMarkdown::escape("Fees <div class=\"callout callout-danger\">due</div> & **now**\n# Heading\n- item\n1. one\n===\n> quote | cell ~~x~~ `code` _em_");

        $this->assertSame("Fees &lt;div class=\"callout callout-danger\"&gt;due&lt;/div&gt; &amp; \\*\\*now\\*\\*\n\\# Heading\n\\- item\n1\\. one\n\\===\n&gt; quote \\| cell \\~\\~x\\~\\~ \\`code\\` \\_em\\_", $escaped);
        $this->assertSame('Record(s) 12 of 40', AnswerMarkdown::escape('Record(s) 12 of 40'));
    }

    public function test_escaped_text_reads_back_as_the_original_in_a_preview(): void
    {
        $original = 'R&D [Fund] *2* | a_b #1 <b>';

        $this->assertSame('R&D [Fund] *2* | a_b #1 <b>', AnswerMarkdown::plainText(AnswerMarkdown::escape($original)));
    }

    public function test_plain_line_keeps_reasoning_readable_without_markup(): void
    {
        $this->assertSame('Checked [3] rows x', AnswerMarkdown::plainLine('Checked [3] rows <b>x</b>'));
    }
}
