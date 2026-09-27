from __future__ import annotations

import re

from app.schemas import GrievanceClassificationRequest

# Keyword sets are deliberately spelled out as whole words (not stems): unlike
# task_delegation's prefix matching, grievance urgency must not fire on a
# partial word (e.g. "assaulted" containing "assault" is fine to catch, but we
# still bound both sides with \b so "grassault" or "assaultive-sounding" noise
# words can't slip in via a bare substring match).
CRITICAL_KEYWORDS = ("emergency", "danger", "harassment", "assault", "police", "threat", "violence")
HIGH_KEYWORDS = ("urgent", "fraud", "stolen", "corruption", "embezzlement", "severe", "breach")
MEDIUM_KEYWORDS = ("broken", "delay", "missing", "complaint", "unfair", "issue", "problem")

CATEGORY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "Safety & Security": CRITICAL_KEYWORDS + ("security", "unsafe", "guard", "theft"),
    "Financial Integrity": ("money", "fund", "fraud", "receipt", "budget", "embezzlement", "payment"),
    "Facilities & Maintenance": ("broken", "facility", "dirty", "aircon", "chair", "room", "venue"),
    "Academic / Faculty": ("grades", "teacher", "professor", "exam", "class", "schedule"),
}

DEFAULT_CATEGORY = "General"


def _matches(text: str, keyword: str) -> bool:
    return re.search(rf"\b{re.escape(keyword)}\b", text) is not None


def classify_grievance(request: GrievanceClassificationRequest) -> dict:
    """Deterministically classifies a grievance's urgency and category from keyword heuristics.

    This is intentionally rule-based (no external model call): it must stay
    reproducible so the Laravel-side PHP fallback (HiusaAiService::grievanceClassification
    callers) can mirror it exactly when this service is unreachable.
    """
    text = f"{request.title} {request.description}".lower()

    if any(_matches(text, keyword) for keyword in CRITICAL_KEYWORDS):
        urgency = "Critical"
        confidence_score = 0.95
    elif any(_matches(text, keyword) for keyword in HIGH_KEYWORDS):
        urgency = "High"
        confidence_score = 0.85
    elif any(_matches(text, keyword) for keyword in MEDIUM_KEYWORDS):
        urgency = "Medium"
        confidence_score = 0.75
    else:
        urgency = "Low"
        confidence_score = 0.5

    matched_category = DEFAULT_CATEGORY
    max_matches = 0
    for category, keywords in CATEGORY_KEYWORDS.items():
        matches = sum(1 for keyword in keywords if _matches(text, keyword))
        if matches > max_matches:
            max_matches = matches
            matched_category = category

    return {
        "urgency": urgency,
        "category": matched_category,
        "confidence_score": confidence_score,
        "reasoning": f"Determined {urgency} urgency and the '{matched_category}' category from keyword analysis.",
    }
