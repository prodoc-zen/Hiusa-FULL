from __future__ import annotations

import re

from app.schemas import OfficerCandidate, TaskDelegationRequest


# Functional areas an SBO task typically falls under. Each area lists the keywords
# used to infer that area from a task's title/task_type, the position(s) with
# primary responsibility for it, and the position(s) with a related but secondary
# responsibility. Position names must match the seeded sbo_positions.title values.
POSITION_RELEVANCE_MAP: dict[str, dict[str, tuple[str, ...]]] = {
    "finance": {
        "keywords": (
            "budget", "financ", "liquidat", "receipt", "audit",
            "funds", "funding", "fundraising",
            "expense", "payment", "treasury", "reimburse", "collection",
        ),
        "primary": ("Treasurer", "Auditor"),
        "secondary": ("President", "Business Manager"),
    },
    "publicity": {
        "keywords": (
            "publicity", "announce", "social media", "poster", "promot",
            "marketing", "campaign", "press release", "media",
        ),
        "primary": ("Public Information Officer", "Public Relations Officer"),
        "secondary": ("Secretary", "Vice President – External", "Vice President"),
    },
    "documentation": {
        "keywords": (
            "document", "minutes", "attendance record", "report", "record",
            "memo", "correspondence", "certificate", "letter",
        ),
        "primary": ("Secretary", "Assistant Secretary"),
        "secondary": ("Auditor", "Vice President – Internal", "Vice President"),
    },
    "logistics": {
        "keywords": (
            "logistic", "venue", "equipment", "setup", "supplies",
            "materials", "booth", "layout", "transport", "inventory",
        ),
        "primary": ("Business Manager", "Vice President – Internal"),
        "secondary": ("Vice President", "President", "Representative"),
    },
    "coordination": {
        "keywords": (
            "coordinat", "overall", "program", "hosting", "host", "emcee",
            "planning", "organize", "oversee", "lead",
        ),
        "primary": ("President", "Vice President – Internal", "Vice President – External", "Vice President"),
        "secondary": ("Business Manager", "Secretary", "Representative"),
    },
}

# Tasks that match no keyword default to "coordination": the President/Vice
# President are the positions expected to own general, unclassified SBO work.
DEFAULT_TASK_AREA = "coordination"

PRIMARY_POSITION_MATCH_SCORE = 100.0
RELATED_POSITION_MATCH_SCORE = 70.0
UNRELATED_POSITION_SCORE = 40.0
# No position on file is neither a match nor a mismatch, so it lands between
# "related" and "unrelated" instead of being punished for missing data.
UNKNOWN_POSITION_SCORE = 55.0

# Officers with no completed/overdue task history get a neutral prior: this
# neither punishes new officers nor lets them outscore officers with a proven
# track record.
NEUTRAL_PERFORMANCE_SCORE = 70.0

_TIER_PHRASE = {
    "primary": "a primary match",
    "secondary": "a related match",
    "unrelated": "not closely related",
    "unknown": "unspecified, so a neutral score was applied",
}


def infer_task_area(task_title: str, task_type: str | None = None) -> str:
    haystack = f"{task_title} {task_type or ''}".lower()

    for area, spec in POSITION_RELEVANCE_MAP.items():
        # Anchored at the START of a word only (never the end): the keyword list
        # deliberately uses stem prefixes ("financ", "promot", "coordinat",
        # "logistic", "document", "publicity") that must still match inflected
        # forms ("financial", "promotional", "coordinating", "documentation").
        # A start anchor alone still lets a real prefix collision through (e.g.
        # "fund" is a genuine word-start prefix of "fundamental"), which is why
        # collision-prone keywords above are spelled out to their least-ambiguous
        # form ("funds"/"funding"/"fundraising" instead of bare "fund").
        if any(re.search(rf"\b{re.escape(keyword)}", haystack) for keyword in spec["keywords"]):
            return area

    return DEFAULT_TASK_AREA


def _position_relevance(position_title: str | None, area: str) -> tuple[float, str]:
    normalized = position_title.strip() if position_title else ""

    if not normalized:
        return UNKNOWN_POSITION_SCORE, "unknown"

    spec = POSITION_RELEVANCE_MAP[area]

    if normalized in spec["primary"]:
        return PRIMARY_POSITION_MATCH_SCORE, "primary"

    if normalized in spec["secondary"]:
        return RELATED_POSITION_MATCH_SCORE, "secondary"

    return UNRELATED_POSITION_SCORE, "unrelated"


def _workload_score(active_tasks: int, max_active_tasks: int) -> float:
    utilization = active_tasks / max_active_tasks
    return round(max(0.0, 100.0 * (1.0 - utilization)), 2)


def _score(officer: OfficerCandidate, area: str, max_active_tasks: int, weights: dict[str, float]) -> dict:
    position_score, tier = _position_relevance(officer.position_title, area)
    workload_score = _workload_score(officer.active_tasks, max_active_tasks)
    historical_tasks = officer.completed_tasks + officer.overdue_tasks

    if historical_tasks > 0:
        performance_score = round(officer.completed_tasks / historical_tasks * 100, 2)
        performance_note = ""
    else:
        performance_score = NEUTRAL_PERFORMANCE_SCORE
        performance_note = f" (no task history yet, so the neutral baseline of {NEUTRAL_PERFORMANCE_SCORE:.0f} was used)"

    final_score = round(
        position_score * weights["position"]
        + workload_score * weights["workload"]
        + performance_score * weights["performance"],
        2,
    )
    position_label = officer.position_title.strip() if officer.position_title and officer.position_title.strip() else "no position on file"

    return {
        "officer_id": officer.officer_id,
        "name": officer.name,
        "position_title": officer.position_title,
        "position_tier": tier,
        "role_score": position_score,
        "workload_score": workload_score,
        "performance_score": performance_score,
        "final_score": final_score,
        "explanation": (
            f"{officer.name} scored {final_score:.2f} for a task inferred as '{area}': "
            f"position '{position_label}' is {_TIER_PHRASE[tier]} for this area ({position_score:.2f} pts), "
            f"workload {workload_score:.2f} ({officer.active_tasks}/{max_active_tasks} active tasks), "
            f"and past performance {performance_score:.2f}{performance_note}."
        ),
    }


def delegate_task(request: TaskDelegationRequest) -> dict:
    def eligibility_result(officer: OfficerCandidate) -> str:
        if officer.role != "SBO_OFFICER":
            return "invalid_role"
        if officer.account_status != "active":
            return "inactive_account"
        if not officer.position_title or not officer.position_title.strip():
            return "missing_position"
        if not officer.policy_eligible:
            return "inactive_position"
        if not officer.is_available or officer.active_tasks >= request.max_active_tasks:
            return "overloaded"
        return "eligible"

    eligibility = [(officer, eligibility_result(officer)) for officer in request.officers]
    eligible = [officer for officer, result in eligibility if result == "eligible"]
    if not eligible:
        raise ValueError("No active SBO Officer is eligible for this task")

    area = infer_task_area(request.task_title, request.task_type)
    rankings = [_score(officer, area, request.max_active_tasks, request.weights) for officer in eligible]
    rankings.sort(key=lambda row: (-row["final_score"], row["officer_id"]))
    for rank, ranking in enumerate(rankings, start=1):
        ranking["rank"] = rank
        ranking["eligibility_result"] = "eligible"
    ineligible = [
        {
            "officer_id": officer.officer_id,
            "name": officer.name,
            "position_title": officer.position_title,
            "position_tier": None,
            "role_score": None,
            "workload_score": None,
            "performance_score": None,
            "final_score": None,
            "rank": None,
            "eligibility_result": result,
        }
        for officer, result in eligibility
        if result != "eligible"
    ]

    return {
        "algorithm": "rule_based_weighted_scoring",
        "weights": request.weights,
        "task_area": area,
        "eligibility_rules": [
            "role must be SBO_OFFICER",
            "account status must be active",
            "an SBO position must be assigned",
            "officer must be marked available",
            "officer must satisfy organization policy",
            f"active task count must be below {request.max_active_tasks}",
        ],
        "recommended_officer_id": rankings[0]["officer_id"],
        "rankings": rankings,
        "evaluations": [*rankings, *ineligible],
    }
