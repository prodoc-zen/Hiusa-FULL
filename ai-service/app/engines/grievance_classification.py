from __future__ import annotations

import re

from app.schemas import GrievanceClassificationRequest

# A keyword ending in "*" is a stem matched at the start of a word, so "harass*"
# catches "harassed" and "harassment". Any other keyword is a whole word, which
# keeps "danger" from firing on "dangerously". The PHP fallback in
# GrievanceController carries the same lists; AiFallbackParityTest keeps them equal.
CRITICAL_KEYWORDS = (
    "emergency", "danger", "harass*", "assault*", "police", "threat*", "violen*", "abus*",
    "bully", "bullied", "bullying", "banta", "binantaan", "gibantaan", "pagbabanta", "pananakit", "sinaktan",
)
HIGH_KEYWORDS = (
    "urgent", "fraud*", "steal*", "stole*", "theft", "thief", "brib*", "corruption", "corrupt", "embezzl*", "severe", "breach",
    "nakaw*", "ninakaw*", "nagnakaw*", "nanakaw*", "kawat", "gikawat", "gikawatan",
)
MEDIUM_KEYWORDS = ("broken", "delay*", "missing", "complaint*", "unfair", "issue*", "problem*")

# An urgency keyword is dropped only when one of these words directly denies it: the
# negator is the word right before the keyword, or right before "a", "an", "any" or
# "the" and then the keyword ("not an emergency"), in the same clause. Anything between
# them ("not stop bullying", "can not take the bullying") means the word is kept, so
# whenever it is unclear the higher urgency wins.
NEGATORS = ("not", "no", "hindi", "dili", "walang", "wala", "walay", "wala'y", "di")
_ARTICLES = ("a", "an", "any", "the")

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Safety & Security": CRITICAL_KEYWORDS + ("security", "unsafe", "guard", "theft"),
    "Financial Integrity": ("money", "fund", "funds", "funding", "fraud*", "receipt*", "budget*", "embezzl*", "payment*", "steal*", "stole*", "brib*", "theft"),
    "Facilities & Maintenance": ("broken", "facilit*", "dirty", "aircon", "chair", "chairs", "room", "rooms", "venue", "venues"),
    "Academic / Faculty": ("grade*", "teacher*", "professor*", "exam", "exams", "class", "classes", "schedul*"),
}

DEFAULT_CATEGORY = "General"

_URGENCY_KEYWORDS = frozenset(CRITICAL_KEYWORDS + HIGH_KEYWORDS + MEDIUM_KEYWORDS)
_CLAUSE_BREAK = re.compile(r"[.!?;,:\n]")


def _negator(text: str, start: int) -> str | None:
    words = re.findall(r"[\w']+", _CLAUSE_BREAK.split(text[:start])[-1])
    if words and words[-1] in _ARTICLES:
        words.pop()
    return words[-1] if words and words[-1] in NEGATORS else None


def _found(text: str, keyword: str, denied: list[tuple[str, str]] | None = None) -> str | None:
    """The word in the text that the keyword matched, or None. Urgency words that are denied do not match;
    when `denied` is given, a word that matched only after a denial is added to it with its negator."""
    if keyword.endswith("*"):
        pattern = rf"\b{re.escape(keyword[:-1])}\w*"
    else:
        pattern = rf"\b{re.escape(keyword)}\b"
    blocked: tuple[str, str] | None = None
    for match in re.finditer(pattern, text):
        negator = _negator(text, match.start()) if keyword in _URGENCY_KEYWORDS else None
        if negator is not None:
            blocked = blocked or (match.group(0), negator)
            continue
        return match.group(0)
    if blocked is not None and denied is not None and blocked not in denied:
        denied.append(blocked)
    return None


def _words(text: str, keywords: tuple[str, ...]) -> list[str]:
    words: list[str] = []
    for keyword in keywords:
        word = _found(text, keyword)
        if word is not None and word not in words:
            words.append(word)
    return words


def _joined(items: list[str]) -> str:
    items = items[:5]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _quoted(words: list[str]) -> str:
    return _joined([f'"{word}"' for word in words])


def _denial_note(denied: list[tuple[str, str]]) -> str:
    if not denied:
        return ""
    pairs = _joined([f'"{word}" after "{negator}"' for word, negator in denied])
    return f" It also mentions {pairs}, which was not counted as urgent; a reviewer should check it."


def classify_grievance(request: GrievanceClassificationRequest) -> dict:
    """Deterministically classifies a grievance's urgency and category from keyword heuristics.

    This is intentionally rule-based (no external model call): it must stay
    reproducible so the Laravel-side PHP fallback (HiusaAiService::grievanceClassification
    callers) can mirror it exactly when this service is unreachable.
    """
    text = f"{request.title}. {request.description}".lower()

    urgency_words: list[str] = []
    for urgency, keywords, confidence_score in (
        ("Critical", CRITICAL_KEYWORDS, 0.95),
        ("High", HIGH_KEYWORDS, 0.85),
        ("Medium", MEDIUM_KEYWORDS, 0.75),
    ):
        urgency_words = _words(text, keywords)
        if urgency_words:
            break
    else:
        urgency = "Low"
        confidence_score = 0.5

    denied: list[tuple[str, str]] = []
    for keyword in CRITICAL_KEYWORDS + HIGH_KEYWORDS + MEDIUM_KEYWORDS:
        _found(text, keyword, denied)

    matched_category = DEFAULT_CATEGORY
    category_words: list[str] = []
    for category, keywords in CATEGORY_KEYWORDS.items():
        words = _words(text, keywords)
        if len(words) > len(category_words):
            category_words = words
            matched_category = category

    return {
        "urgency": urgency,
        "category": matched_category,
        "confidence_score": confidence_score,
        "reasoning": _reasoning(urgency, urgency_words, matched_category, category_words) + _denial_note(denied),
    }


def _reasoning(urgency: str, urgency_words: list[str], category: str, category_words: list[str]) -> str:
    if not urgency_words and not category_words:
        return f"No urgent or category words were found, so it is {urgency} and {category} until a reviewer looks at it."
    first = (
        f"Marked {urgency} because the text mentions {_quoted(urgency_words)}"
        if urgency_words
        else f"No urgent words were found, so it is {urgency}"
    )
    second = (
        f"filed under {category} because it mentions {_quoted(category_words)}"
        if category_words
        else f"no category words were found, so it is filed under {category}"
    )
    return f"{first}; {second}."
