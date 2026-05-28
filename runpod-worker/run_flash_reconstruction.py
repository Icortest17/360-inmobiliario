import asyncio
import contextlib
import json
import os
import sys
from pathlib import Path


def load_root_env() -> None:
    env_path = Path(__file__).resolve().parent.parent / ".env.local"
    if not env_path.exists():
        return

    for line in env_path.read_text(encoding="utf-8").splitlines():
        trimmed = line.strip()
        if not trimmed or trimmed.startswith("#") or "=" not in trimmed:
            continue
        key, value = trimmed.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


async def main() -> None:
    load_root_env()
    raw = sys.stdin.read()
    job_input = json.loads(raw or "{}")

    from flash_reconstruction_worker import reconstruct_tour

    # The Flash SDK prints progress logs while the remote job runs. Keep stdout
    # reserved for the final machine-readable JSON line consumed by server.js.
    with contextlib.redirect_stdout(sys.stderr):
        result = reconstruct_tour(job_input)
        if asyncio.iscoroutine(result):
            result = await result

    print(json.dumps({"ok": True, "result": result}, ensure_ascii=True))


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as error:
        print(json.dumps({"ok": False, "message": str(error)}, ensure_ascii=True))
        sys.exit(1)
