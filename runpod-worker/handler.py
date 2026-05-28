import os
import time
from typing import Any, Dict

import runpod


def handler(job: Dict[str, Any]) -> Dict[str, Any]:
    """Minimal RunPod worker used to validate app -> RunPod wiring.

    This does not run reconstruction yet. It confirms the endpoint receives
    project/job input and returns the output shape our app expects.
    """
    job_input = job.get("input", {})
    project_id = job_input.get("projectId")

    return {
        "ok": True,
        "stage": "smoke_test_worker",
        "projectId": project_id,
        "received": job_input,
        "worker": {
            "version": "0.1.0",
            "startedAt": int(time.time()),
            "gpuVisible": bool(os.environ.get("CUDA_VISIBLE_DEVICES")),
        },
        "next": [
            "download raw video from Supabase Storage",
            "extract frames with FFmpeg",
            "run COLMAP / Nerfstudio Splatfacto",
            "upload .splat/.ply to Supabase reconstructions bucket",
            "update Supabase job status",
        ],
    }


runpod.serverless.start({"handler": handler})
