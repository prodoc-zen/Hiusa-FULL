<?php

namespace App\Services\Ai;

/**
 * Cleans Markdown a model wrote before it is stored or shown. The client sanitizes again; this is the
 * server's own gate, so a stored answer never carries markup the product did not offer.
 */
final class AnswerMarkdown
{
    private const TAGS = ['div', 'span', 'details', 'summary', 'mark', 'kbd', 'sub', 'sup', 'br', 'hr', 'progress'];

    private const VOID_TAGS = ['br', 'hr'];

    private const TONES = ['info', 'success', 'warning', 'danger'];

    /**
     * @param  callable(string): bool  $linkAllowed  receives a link target; true keeps the link
     */
    public static function sanitize(string $markdown, callable $linkAllowed): string
    {
        $markdown = str_replace(["\0", "\x01", "\x02", "\x03", "\x04", "\r\n", "\r"], ['', '', '', '', '', "\n", "\n"], $markdown);
        [$text, $blocks] = self::liftFences($markdown);

        $links = [];
        $text = preg_replace('/<!--.*?(?:-->|\z)/su', '', $text) ?? '';
        $text = self::rewriteTags($text);
        $text = self::rewriteLinks($text, $linkAllowed, $links);
        $text = preg_replace('/^[ \t]{0,3}(?:>[ \t]*)*\[[^\]\n]+\]:[ \t]*\S.*$/mu', '', $text) ?? $text;
        $text = preg_replace('/(?<![\pL\pN])(?:(?:https?|ftp):\/\/|www\.)[^\s<>]*/iu', '', $text) ?? $text;
        $text = self::escapeBrackets($text);

        return strtr(strtr($text, $links), $blocks);
    }

    /**
     * Text a person typed (a title, a name, a remark) made safe to sit inside Markdown: it can no longer open a
     * link, a tag, a heading, a list, a table or emphasis, and it reads back as the original.
     */
    public static function escape(string $text): string
    {
        $text = str_replace(["\0", "\x01", "\x02", "\x03", "\x04", "\r\n", "\r"], ['', '', '', '', '', "\n", "\n"], $text);
        $text = preg_replace('/[\\\\`*_\[\]~|]/u', '\\\\$0', $text) ?? $text;
        $text = str_replace(['&', '<', '>'], ['&amp;', '&lt;', '&gt;'], $text);
        $text = preg_replace('/^([ \t]*)([#+=-])/mu', '$1\\\\$2', $text) ?? $text;

        return preg_replace('/^([ \t]*)(\d{1,9})([.)])/mu', '$1$2\\\\$3', $text) ?? $text;
    }

    /** A line of model thinking for a plain-text panel: no markup, no links, brackets left as typed. */
    public static function plainLine(string $line): string
    {
        $clean = self::sanitize($line, static fn (): bool => false);

        return preg_replace('/\\\\([\[\]])/u', '$1', $clean) ?? $clean;
    }

    /** One line of plain words for previews and notifications. */
    public static function plainText(string $markdown): string
    {
        $text = str_replace(["\0", "\x05", "\x06", "\r\n", "\r"], ['', '', '', "\n", "\n"], $markdown);
        $text = preg_replace_callback('/\\\\([\\\\`*_\[\]~|#+=.\-])/u', fn (array $m): string => "\x05".bin2hex($m[1])."\x06", $text) ?? $text;
        $text = preg_replace('/<!--.*?(?:-->|\z)/su', '', $text) ?? '';
        $text = preg_replace('/^[ \t]*(?:`{3,}|~{3,})[^\n]*$/mu', '', $text) ?? $text;
        $text = preg_replace('/!?\[([^\]\n]*)\]\([^)\n]*\)/u', '$1', $text) ?? $text;
        $text = preg_replace('/!?\[([^\]\n]*)\]\[[^\]\n]*\]/u', '$1', $text) ?? $text;
        $text = preg_replace('/^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S.*$/mu', '', $text) ?? $text;
        $text = preg_replace('/<\/?[a-zA-Z][^<>]*>/u', ' ', $text) ?? $text;
        $text = preg_replace('/^[ \t]*\|?[ \t]*:?-{2,}:?[ \t]*(?:\|[ \t]*:?-{2,}:?[ \t]*)*\|?[ \t]*$/mu', '', $text) ?? $text;
        $text = preg_replace('/^[ \t]*(?:>[ \t]*)+/mu', '', $text) ?? $text;
        $text = preg_replace('/^[ \t]*#{1,6}[ \t]+/mu', '', $text) ?? $text;
        $text = preg_replace('/^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+/mu', '', $text) ?? $text;
        $text = preg_replace('/^[ \t]*(?:[-*_][ \t]*){3,}$/mu', '', $text) ?? $text;
        $text = preg_replace('/^[ \t]*\|[ \t]*|[ \t]*\|[ \t]*$/mu', '', $text) ?? $text;
        $text = preg_replace('/[ \t]*\|[ \t]*/u', ', ', $text) ?? $text;
        $text = preg_replace('/(\*{1,3}|~~)(?=\S)(.+?)(?<=\S)\1/su', '$2', $text) ?? $text;
        $text = preg_replace('/(?<![\pL\pN])(_{1,3})(?=\S)(.+?)(?<=\S)\1(?![\pL\pN])/su', '$2', $text) ?? $text;
        $text = str_replace('`', '', $text);
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = preg_replace_callback('/\x05([0-9a-f]+)\x06/', fn (array $m): string => (string) hex2bin($m[1]), $text) ?? $text;

        return trim(preg_replace('/\s+/u', ' ', $text) ?? '');
    }

    /**
     * Fenced blocks are kept exactly as written, so they leave the text while it is rewritten.
     *
     * @return array{0: string, 1: array<string, string>}
     */
    private static function liftFences(string $markdown): array
    {
        $out = [];
        $blocks = [];
        $open = null;
        $buffer = [];
        $inHtml = false;

        foreach (explode("\n", $markdown) as $line) {
            if ($open === null) {
                if (trim($line) === '') {
                    $inHtml = false;
                    $out[] = $line;

                    continue;
                }

                // A browser's parser keeps reading an HTML block as HTML until a blank line, fence or not.
                $inHtml = $inHtml || preg_match('/^ {0,3}<[\/!?a-zA-Z]/', $line) === 1;

                // A backtick fence whose info string holds a backtick is not a fence either.
                if (! $inHtml && preg_match('/^ {0,3}(?:(`{3,})[^`]*$|(~{3,}))/', $line, $m)) {
                    $fence = $m[1] !== '' ? $m[1] : $m[2];
                    $open = [$fence[0], strlen($fence)];
                    $buffer = [$line];
                } else {
                    $out[] = $line;
                }

                continue;
            }

            $buffer[] = $line;
            if (preg_match('/^ {0,3}('.preg_quote($open[0], '/').'{'.$open[1].',})\s*$/', $line)) {
                $key = "\0F".count($blocks)."\0";
                $blocks[$key] = implode("\n", $buffer);
                $out[] = $key;
                $open = null;
            }
        }

        if ($open !== null) {
            $key = "\0F".count($blocks)."\0";
            $blocks[$key] = implode("\n", $buffer);
            $out[] = $key;
        }

        return [implode("\n", $out), $blocks];
    }

    private static function rewriteTags(string $text): string
    {
        $text = preg_replace_callback(
            '/<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|\'[^\']*\'|[^\'">])*)>/u',
            function (array $m): string {
                $name = strtolower($m[2]);
                if (! in_array($name, self::TAGS, true)) {
                    return '';
                }
                if ($m[1] === '/') {
                    return in_array($name, self::VOID_TAGS, true) ? '' : "\x01/{$name}\x02";
                }

                return "\x01".$name.self::attributes($name, $m[3])."\x02";
            },
            $text,
        ) ?? '';

        // A "<" that never closed would still read as a tag opener to a lenient renderer.
        $text = preg_replace('/<(?=[a-zA-Z\/!?])/u', '&lt;', $text) ?? $text;

        return str_replace(["\x01", "\x02"], ['<', '>'], $text);
    }

    private static function attributes(string $tag, string $raw): string
    {
        preg_match_all('/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s"\'>]+)))?/u', $raw, $found, PREG_SET_ORDER);

        $kept = [];
        foreach ($found as $match) {
            $attribute = strtolower($match[1]);
            $value = (string) ($match[2] ?? '') !== '' ? $match[2] : ((string) ($match[3] ?? '') !== '' ? $match[3] : (string) ($match[4] ?? ''));

            if ($attribute === 'class' && in_array($tag, ['div', 'span'], true)) {
                $class = trim(preg_replace('/\s+/', ' ', strtolower($value)) ?? '');
                if (in_array($class, self::classes($tag), true)) {
                    $kept['class'] = $class;
                }
            } elseif ($tag === 'progress' && in_array($attribute, ['value', 'max'], true) && preg_match('/^\d{1,9}(?:\.\d{1,4})?$/', $value)) {
                $kept[$attribute] = $value;
            }
        }

        $out = '';
        foreach ($kept as $name => $value) {
            $out .= ' '.$name.'="'.$value.'"';
        }

        return $out;
    }

    /** @return list<string> */
    private static function classes(string $tag): array
    {
        if ($tag === 'div') {
            return [...array_map(fn (string $tone) => "callout callout-{$tone}", self::TONES), 'stat-grid', 'stat'];
        }

        return [...array_map(fn (string $tone) => "badge badge-{$tone}", [...self::TONES, 'neutral']), 'stat-value', 'stat-label'];
    }

    /**
     * A link that passes the check is swapped for a placeholder, so the bracket escaping that follows cannot touch it.
     *
     * @param  callable(string): bool  $linkAllowed
     * @param  array<string, string>  $kept
     */
    private static function rewriteLinks(string $text, callable $linkAllowed, array &$kept): string
    {
        $inline = '/!?\[((?:[^\[\]\n]|\[[^\]\n]*\])*)\]\(\s*(<[^>\n]*>|(?:[^()\s]|\([^)\n]*\))*)(?:\s+(?:"[^"\n]*"|\'[^\'\n]*\'|\([^)\n]*\)))?\s*\)/u';
        $text = preg_replace_callback($inline, function (array $m) use ($linkAllowed, &$kept): string {
            if ($m[0][0] === '!') {
                return $m[1];
            }
            $target = trim($m[2], '<>');
            if (! self::inApp($target) || ! $linkAllowed($target)) {
                return $m[1];
            }

            $key = "\x03L".count($kept)."\x04";
            $kept[$key] = '['.self::escapeBrackets(rtrim($m[1], '\\')).']('.$target.')';

            return $key;
        }, $text) ?? $text;

        return preg_replace('/!?\[((?:[^\[\]\n]|\[[^\]\n]*\])*)\]\[[^\]\n]*\]/u', '$1', $text) ?? $text;
    }

    /** Every bracket that is still in the text becomes a literal one, so no spelling of a link can form. */
    private static function escapeBrackets(string $text): string
    {
        $lines = explode("\n", $text);

        foreach ($lines as $index => $line) {
            $marker = '';
            if (preg_match('/^((?:[ \t]*>)*[ \t]*[-*+] \[[ xX]\] )(.*)$/su', $line, $m)) {
                [$marker, $line] = [$m[1], $m[2]];
            }
            $lines[$index] = $marker.(preg_replace('/(?<!\\\\)((?:\\\\\\\\)*)([\[\]])/u', '$1\\\\$2', $line) ?? $line);
        }

        return implode("\n", $lines);
    }

    private static function inApp(string $target): bool
    {
        if (! preg_match('#^/dashboard(?:[/?\#]|$)#', $target)) {
            return false;
        }

        return ! preg_match('/[\\\\\s\x00-\x1f()<>]|&#|&[a-z]+;|%(?:2f|5c|0)/i', $target) && ! str_contains($target, '//') && ! str_contains($target, '..');
    }
}
