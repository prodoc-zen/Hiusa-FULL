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

# A keyword from the three urgency lists does not count when one of these words comes
# within two words before it in the same clause ("not an emergency").
NEGATORS = ("not", "no", "hindi", "dili", "walang")

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Safety & Security": CRITICAL_KEYWORDS + ("security", "unsafe", "guard", "theft"),
    "Financial Integrity": ("money", "fund", "funds", "funding", "fraud*", "receipt*", "budget*", "embezzl*", "payment*", "steal*", "stole*", "brib*", "theft"),
    "Facilities & Maintenance": ("broken", "facilit*", "dirty", "aircon", "chair", "chairs", "room", "rooms", "venue", "venues"),
    "Academic / Faculty": ("grade*", "teacher*", "professor*", "exam", "exams", "class", "classes", "schedul*"),
}

DEFAULT_CATEGORY = "General"

_URGENCY_KEYWORDS = frozenset(CRITICAL_KEYWORDS + HIGH_KEYWORDS + MEDIUM_KEYWORDS)
_CLAUSE_BREAK = re.compile(r"[.!?;,:\n]")


def _negated(text: str, start: int) -> bool:
    clause = _CLAUSE_BREAK.split(text[:start])[-1]
    return any(word in NEGATORS for word in re.findall(r"[\w']+", clause)[-2:])


def _found(text: str, keyword: str) -> str | None:
    """The word in the text that the keyword matched, or None. Urgency words that are negated do not match."""
    if keyword.endswith("*"):
        pattern = rf"\b{re.escape(keyword[:-1])}\w*"
    else:
        pattern = rf"\b{re.escape(keyword)}\b"
    for match in re.finditer(pattern, text):
        if keyword in _URGENCY_KEYWORDS and _negated(text, match.start()):
            continue
        return match.group(0)
    return None


def _words(text: str, keywords: tuple[str, ...]) -> list[str]:
    words: list[str] = []
    for keyword in keywords:
        word = _found(text, keyword)
        if word is not None and word not in words:
            words.append(word)
    return words


def _quoted(words: list[str]) -> str:
    items = [f'"{word}"' for word in words[:5]]
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def classify_grievance(request: GrievanceClassificationRequest) -> dict:
    """Deterministically classifies a grievance's urgency and category from keyword heuristics.

    This is intentionally rule-based (no external model call): it must stay
    reproducible so the Laravel-side PHP fallback (HiusaAiService::grievanceClassification
    callers) can mirror it exactly when this service is unreachable.
    """
    text = f"{request.title} {request.description}".lower()

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
        "reasoning": _reasoning(urgency, urgency_words, matched_category, category_words),
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
