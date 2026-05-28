import asyncio

from runpod_flash.endpoint import Endpoint, GpuType


@Endpoint(
    name="tour-3d-smoke-worker",
    gpu=GpuType.NVIDIA_GEFORCE_RTX_4090,
    workers=(0, 1),
    idle_timeout=60,
    dependencies=[
        "requests==2.32.3",
    ],
)
def reconstruct_tour(job_input: dict) -> dict:
    """First Flash endpoint for the 360 Cloud Tour app.

    This endpoint validates app -> RunPod Flash wiring. It does not perform
    Gaussian Splatting yet; the next version will add FFmpeg, COLMAP and
    Nerfstudio/Splatfacto.
    """
    project_id = job_input.get("projectId")
    source = job_input.get("source", {})
    ai_analysis = job_input.get("aiAnalysis", {})

    return {
        "ok": True,
        "stage": "flash_smoke_test",
        "projectId": project_id,
        "source": source,
        "aiSummary": ai_analysis.get("summary"),
        "nextPipeline": [
            "download raw video from Supabase Storage",
            "extract dense frames with FFmpeg",
            "estimate cameras with COLMAP",
            "train Gaussian Splatting with Nerfstudio Splatfacto",
            "export .splat/.ply",
            "upload reconstruction to Supabase",
        ],
    }


if __name__ == "__main__":
    result = asyncio.run(
        reconstruct_tour(
            {
                "projectId": "local-smoke-test",
                "source": {"localOnly": True},
                "aiAnalysis": {"summary": "Smoke test from local Flash script"},
                "requestedFrames": 48,
            }
        )
    )
    print(result)
