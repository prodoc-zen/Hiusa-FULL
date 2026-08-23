from __future__ import annotations

import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parent / ".env")


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


if __name__ == "__main__":
    uvicorn.run(
        "app.main:app",
        host=os.getenv("HIUSA_AI_HOST", "127.0.0.1"),
        port=int(os.getenv("HIUSA_AI_PORT", "8001")),
        reload=env_flag("HIUSA_AI_RELOAD", True),
    )
