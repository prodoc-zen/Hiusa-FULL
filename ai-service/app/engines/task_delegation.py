from __future__ import annotations

from app.schemas import OfficerCandidate, TaskDelegationRequest


WEIGHTS = {"role": 0.40, "workload": 0.35, "performance": 0.25}


def _score(officer: OfficerCandidate) -> dict:
    role_score = 100.0
    workload_score = float(max(20, 100 - officer.active_tasks * 15))
    historical_tasks = officer.completed_tasks + officer.overdue_tasks
    performance_score = (
        round(officer.completed_tasks / historical_tasks * 100, 2)
        if historical_tasks > 0
        else 70.0
    )
    final_score = round(
        role_score * WEIGHTS["role"]
        + workload_score * WEIGHTS["workload"]
        + performance_score * WEIGHTS["performance"],
        2,
    )

    return {
        "officer_id": officer.officer_id,
        "name": officer.name,
        "role_score": role_score,
        "workload_score": workload_score,
        "performance_score": performance_score,
        "final_score": final_score,
        "explanation": (
            f"{officer.name} scored {final_score:.2f}: role {role_score:.2f}, "
            f"workload {workload_score:.2f}, and past performance {performance_score:.2f}."
        ),
    }


def delegate_task(request: TaskDelegationRequest) -> dict:
    eligible = [
        officer
        for officer in request.officers
        if officer.role == "SBO_OFFICER"
        and officer.account_status == "active"
        and officer.is_available
        and officer.policy_eligible
        and officer.active_tasks < request.max_active_tasks
    ]
    if not eligible:
        raise ValueError("No active SBO Officer is eligible for this task")

    rankings = [_score(officer) for officer in eligible]
    rankings.sort(key=lambda row: (-row["final_score"], row["officer_id"]))

    return {
        "algorithm": "rule_based_weighted_scoring",
        "weights": WEIGHTS,
        "eligibility_rules": [
            "role must be SBO_OFFICER",
            "account status must be active",
            "officer must be marked available",
            "officer must satisfy organization policy",
            f"active task count must be below {request.max_active_tasks}",
        ],
        "recommended_officer_id": rankings[0]["officer_id"],
        "rankings": rankings,
    }
