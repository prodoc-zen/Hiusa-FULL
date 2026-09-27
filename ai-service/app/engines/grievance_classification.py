from __future__ import annotations

import re
from app.schemas import GrievanceClassificationRequest, GrievanceClassificationResponse

def classify_grievance(request: GrievanceClassificationRequest) -> dict:
    """
    Deterministically classifies a grievance based on keyword heuristics.
    """
    text = (request.title + " " + request.description).lower()

    # Define keyword sets
    critical_keywords = {"emergency", "danger", "harassment", "assault", "police", "threat", "violence"}
    high_keywords = {"urgent", "fraud", "stolen", "corruption", "embezzlement", "severe", "breach"}
    medium_keywords = {"broken", "delay", "missing", "complaint", "unfair", "issue", "problem"}

    category_keywords = {
        "Safety & Security": critical_keywords.union({"security", "unsafe", "guard", "theft"}),
        "Financial Integrity": {"money", "fund", "fraud", "receipt", "budget", "embezzlement", "payment"},
        "Facilities & Maintenance": {"broken", "facility", "dirty", "aircon", "chair", "room", "venue"},
        "Academic / Faculty": {"grades", "teacher", "professor", "exam", "class", "schedule"},
    }

    # Determine Urgency
    urgency = "Low"
    score = 0.5

    if any(re.search(rf"\b{kw}\b", text) for kw in critical_keywords):
        urgency = "Critical"
        score = 0.95
    elif any(re.search(rf"\b{kw}\b", text) for kw in high_keywords):
        urgency = "High"
        score = 0.85
    elif any(re.search(rf"\b{kw}\b", text) for kw in medium_keywords):
        urgency = "Medium"
        score = 0.75

    # Determine Category
    matched_category = "General"
    max_matches = 0

    for category, keywords in category_keywords.items():
        matches = sum(1 for kw in keywords if re.search(rf"\b{kw}\b", text))
        if matches > max_matches:
            max_matches = matches
            matched_category = category

    reasoning = f"Determined {urgency} urgency based on keyword analysis."
    
    return GrievanceClassificationResponse(
        urgency=urgency,
        category=matched_category,
        confidence_score=score,
        reasoning=reasoning
    ).model_dump()
