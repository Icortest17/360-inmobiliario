import asyncio
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from urllib.parse import urlparse

import requests
from runpod_flash.endpoint import Endpoint, GpuType


@Endpoint(
    name="tour-3d-reconstruction-worker-v03-colmap",
    gpu=GpuType.NVIDIA_GEFORCE_RTX_4090,
    workers=(0, 1),
    idle_timeout=120,
    dependencies=[
        "requests==2.32.3",
        "pycolmap==3.12.6",
    ],
    system_dependencies=[
        "ffmpeg",
        "colmap",
    ],
)
def reconstruct_tour(job_input: dict) -> dict:
    """RunPod Flash worker v0.3.

    Current real pipeline:
    1. Receive signed Supabase video URL.
    2. Download private video.
    3. Extract frames with FFmpeg.
    4. Upload frames to Supabase.
    5. Run COLMAP sparse reconstruction when possible.
    6. Upload COLMAP artifacts for the Splatfacto stage.
    """
    project_id = job_input.get("projectId")
    source = job_input.get("source", {})
    signed_video_url = source.get("signedVideoUrl")
    requested_frames = int(job_input.get("requestedFrames") or 48)
    upload_targets = job_input.get("uploadTargets") or {}

    if not signed_video_url:
        return {
            "ok": False,
            "stage": "missing_video",
            "projectId": project_id,
            "message": "No signedVideoUrl provided. Upload video to Supabase before GPU reconstruction.",
        }

    ffmpeg_path = shutil.which("ffmpeg")
    if not ffmpeg_path:
        return {
            "ok": False,
            "stage": "missing_ffmpeg",
            "projectId": project_id,
            "message": "FFmpeg is not available in the RunPod image.",
        }

    with tempfile.TemporaryDirectory() as tmp_dir:
        workdir = Path(tmp_dir)
        video_path = workdir / "input_video"
        frames_dir = workdir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)

        download_file(signed_video_url, video_path)
        duration = probe_duration(video_path)
        fps = max(0.2, min(4.0, requested_frames / max(duration, 1.0)))

        pattern = str(frames_dir / "frame_%05d.jpg")
        command = [
            ffmpeg_path,
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(video_path),
            "-vf",
            f"fps={fps},scale=960:-2",
            "-q:v",
            "3",
            pattern,
        ]
        subprocess.run(command, check=True)

        frames = sorted(frames_dir.glob("*.jpg"))
        if len(frames) > requested_frames:
            for frame in frames[requested_frames:]:
                frame.unlink(missing_ok=True)
            frames = frames[:requested_frames]

        uploaded_frames = upload_frames(frames, upload_targets.get("frames") or [])
        colmap_result = run_colmap_pipeline(frames_dir, workdir, upload_targets.get("colmap") or [])
        final_stage = "colmap_sparse_ready" if colmap_result.get("ok") else "frames_extracted"
        manifest = {
            "projectId": project_id,
            "stage": final_stage,
            "durationSeconds": duration,
            "requestedFrames": requested_frames,
            "extractedFrames": len(frames),
            "uploadedFrames": uploaded_frames,
            "colmap": colmap_result,
            "nextPipeline": [
                "run Nerfstudio Splatfacto",
                "export Gaussian Splat",
                "upload .splat/.ply to reconstructions bucket",
            ],
        }
        manifest_path = upload_manifest(manifest, upload_targets.get("manifest"))

        return {
            "ok": True,
            "stage": final_stage,
            "projectId": project_id,
            "durationSeconds": duration,
            "requestedFrames": requested_frames,
            "extractedFrames": len(frames),
            "uploadedFrames": len(uploaded_frames),
            "framePaths": [frame["path"] for frame in uploaded_frames[:12]],
            "manifestPath": manifest_path,
            "colmap": colmap_result,
            "sampleFrames": [frame.name for frame in frames[:8]],
            "nextPipeline": [
                "run Nerfstudio Splatfacto",
                "export Gaussian Splat",
                "upload .splat/.ply to reconstructions bucket",
            ],
        }


def download_file(url: str, destination: Path) -> None:
    response = requests.get(url, stream=True, timeout=120)
    response.raise_for_status()
    suffix = Path(urlparse(url).path).suffix
    if suffix:
        destination = destination.with_suffix(suffix)

    with open(destination, "wb") as file:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if chunk:
                file.write(chunk)

    if destination.suffix:
        destination.rename(destination.with_name("input_video"))


def upload_frames(frames: list[Path], targets: list[dict]) -> list[dict]:
    uploaded = []
    for frame, target in zip(frames, targets):
        signed_url = target.get("signedUrl")
        path = target.get("path")
        if not signed_url or not path:
            continue
        with open(frame, "rb") as file:
            response = requests.put(
                signed_url,
                data=file,
                headers={"content-type": "image/jpeg"},
                timeout=120,
            )
        response.raise_for_status()
        uploaded.append({"path": path, "bytes": frame.stat().st_size})
    return uploaded


def upload_manifest(manifest: dict, target: dict | None) -> str | None:
    if not target:
        return None
    signed_url = target.get("signedUrl")
    path = target.get("path")
    if not signed_url or not path:
        return None
    response = requests.put(
        signed_url,
        data=json.dumps(manifest).encode("utf-8"),
        headers={"content-type": "application/json"},
        timeout=120,
    )
    response.raise_for_status()
    return path


def run_colmap_pipeline(frames_dir: Path, workdir: Path, upload_targets: list[dict]) -> dict:
    colmap_path = shutil.which("colmap")
    if not colmap_path:
        return run_pycolmap_pipeline(frames_dir, workdir, upload_targets)

    database_path = workdir / "database.db"
    sparse_dir = workdir / "sparse"
    sparse_text_dir = workdir / "sparse_text"
    sparse_dir.mkdir(parents=True, exist_ok=True)
    sparse_text_dir.mkdir(parents=True, exist_ok=True)
    logs = []

    try:
        run_command([
            colmap_path,
            "feature_extractor",
            "--database_path",
            str(database_path),
            "--image_path",
            str(frames_dir),
            "--ImageReader.single_camera",
            "1",
            "--SiftExtraction.use_gpu",
            "0",
            "--SiftExtraction.max_num_features",
            "8192",
        ], logs, timeout=900)
        run_command([
            colmap_path,
            "exhaustive_matcher",
            "--database_path",
            str(database_path),
            "--SiftMatching.use_gpu",
            "0",
        ], logs, timeout=900)
        run_command([
            colmap_path,
            "mapper",
            "--database_path",
            str(database_path),
            "--image_path",
            str(frames_dir),
            "--output_path",
            str(sparse_dir),
            "--Mapper.min_num_matches",
            "8",
        ], logs, timeout=1800)

        model_dirs = sorted([path for path in sparse_dir.iterdir() if path.is_dir()])
        if not model_dirs:
            return {
                "ok": False,
                "stage": "colmap_no_model",
                "message": "COLMAP ran but did not create a sparse model. The video may need slower motion or more overlap.",
                "logs": logs[-8:],
            }

        model_dir = model_dirs[0]
        run_command([
            colmap_path,
            "model_converter",
            "--input_path",
            str(model_dir),
            "--output_path",
            str(sparse_text_dir),
            "--output_type",
            "TXT",
        ], logs, timeout=300)

        summary = build_colmap_summary(database_path, sparse_text_dir, logs)
        summary_path = workdir / "colmap_summary.json"
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

        artifacts = {
            "database.db": database_path,
            "cameras.txt": sparse_text_dir / "cameras.txt",
            "images.txt": sparse_text_dir / "images.txt",
            "points3D.txt": sparse_text_dir / "points3D.txt",
            "colmap_summary.json": summary_path,
        }
        uploaded = upload_named_artifacts(artifacts, upload_targets)

        return {
            "ok": True,
            "stage": "colmap_sparse_ready",
            "registeredImages": summary["registeredImages"],
            "sparsePoints": summary["sparsePoints"],
            "uploadedArtifacts": uploaded,
            "logs": logs[-8:],
        }
    except Exception as error:
        return {
            "ok": False,
            "stage": "colmap_failed",
            "message": str(error),
            "logs": logs[-10:],
        }


def run_pycolmap_pipeline(frames_dir: Path, workdir: Path, upload_targets: list[dict]) -> dict:
    try:
        import pycolmap
    except Exception as error:
        return {
            "ok": False,
            "stage": "missing_colmap",
            "message": f"Neither colmap binary nor pycolmap are available: {error}",
        }

    database_path = workdir / "database.db"
    sparse_dir = workdir / "sparse_pycolmap"
    sparse_text_dir = workdir / "sparse_text"
    sparse_dir.mkdir(parents=True, exist_ok=True)
    sparse_text_dir.mkdir(parents=True, exist_ok=True)
    logs = ["pycolmap fallback active"]

    try:
        pycolmap.extract_features(database_path, frames_dir)
        logs.append("features extracted")
        pycolmap.match_exhaustive(database_path)
        logs.append("matches computed")
        maps = pycolmap.incremental_mapping(database_path, frames_dir, sparse_dir)
        reconstructions = list(maps.values()) if hasattr(maps, "values") else list(maps)
        if not reconstructions:
            return {
                "ok": False,
                "stage": "colmap_no_model",
                "message": "PyCOLMAP ran but did not create a sparse model. The video may need slower motion or more overlap.",
                "logs": logs,
            }

        reconstruction = reconstructions[0]
        if hasattr(reconstruction, "write_text"):
            reconstruction.write_text(sparse_text_dir)
        else:
            reconstruction.write(sparse_text_dir)

        summary = build_pycolmap_summary(database_path, reconstruction, sparse_text_dir, logs)
        summary_path = workdir / "colmap_summary.json"
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

        artifacts = {
            "database.db": database_path,
            "cameras.txt": sparse_text_dir / "cameras.txt",
            "images.txt": sparse_text_dir / "images.txt",
            "points3D.txt": sparse_text_dir / "points3D.txt",
            "colmap_summary.json": summary_path,
        }
        uploaded = upload_named_artifacts(artifacts, upload_targets)

        return {
            "ok": True,
            "stage": "colmap_sparse_ready",
            "engine": "pycolmap",
            "registeredImages": summary["registeredImages"],
            "sparsePoints": summary["sparsePoints"],
            "uploadedArtifacts": uploaded,
            "logs": logs[-8:],
        }
    except Exception as error:
        return {
            "ok": False,
            "stage": "pycolmap_failed",
            "message": str(error),
            "logs": logs[-10:],
        }


def build_pycolmap_summary(database_path: Path, reconstruction, sparse_text_dir: Path, logs: list[str]) -> dict:
    try:
        registered_images = int(reconstruction.num_reg_images())
    except Exception:
        registered_images = 0

    try:
        sparse_points = int(reconstruction.num_points3D())
    except Exception:
        sparse_points = 0

    if registered_images == 0 or sparse_points == 0:
        text_summary = build_colmap_summary(database_path, sparse_text_dir, logs)
        registered_images = registered_images or text_summary["registeredImages"]
        sparse_points = sparse_points or text_summary["sparsePoints"]

    return {
        "databaseBytes": database_path.stat().st_size if database_path.exists() else 0,
        "registeredImages": registered_images,
        "sparsePoints": sparse_points,
        "logs": logs[-12:],
    }


def run_command(command: list[str], logs: list[str], timeout: int) -> None:
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    output = "\n".join([result.stdout.strip(), result.stderr.strip()]).strip()
    if output:
        logs.extend(output.splitlines()[-12:])
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(command[:2])} failed with exit code {result.returncode}: {output[-1200:]}")


def build_colmap_summary(database_path: Path, sparse_text_dir: Path, logs: list[str]) -> dict:
    images_path = sparse_text_dir / "images.txt"
    points_path = sparse_text_dir / "points3D.txt"
    registered_images = 0
    sparse_points = 0

    if images_path.exists():
        registered_images = sum(1 for line in images_path.read_text(encoding="utf-8", errors="ignore").splitlines() if ".jpg" in line.lower())
    if points_path.exists():
        sparse_points = sum(1 for line in points_path.read_text(encoding="utf-8", errors="ignore").splitlines() if line.strip() and not line.startswith("#"))

    return {
        "databaseBytes": database_path.stat().st_size if database_path.exists() else 0,
        "registeredImages": registered_images,
        "sparsePoints": sparse_points,
        "logs": logs[-12:],
    }


def upload_named_artifacts(artifacts: dict[str, Path], targets: list[dict]) -> list[dict]:
    target_by_name = {target.get("name"): target for target in targets}
    uploaded = []

    for name, path in artifacts.items():
        target = target_by_name.get(name)
        if not target or not target.get("signedUrl") or not path.exists():
            continue

        content_type = "application/json" if name.endswith(".json") else "text/plain"
        if name.endswith(".db"):
            content_type = "application/octet-stream"

        with open(path, "rb") as file:
            response = requests.put(
                target["signedUrl"],
                data=file,
                headers={"content-type": content_type},
                timeout=180,
            )
        response.raise_for_status()
        uploaded.append({"name": name, "path": target.get("path"), "bytes": path.stat().st_size})

    return uploaded


def probe_duration(video_path: Path) -> float:
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        return 10.0

    command = [
        ffprobe,
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "json",
        str(video_path),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    data = json.loads(result.stdout)
    return float(data.get("format", {}).get("duration") or 10.0)


if __name__ == "__main__":
    result = asyncio.run(
        reconstruct_tour(
            {
                "projectId": "local-smoke-test",
                "source": {"localOnly": True},
                "aiAnalysis": {"summary": "Local smoke test"},
                "requestedFrames": 48,
            }
        )
    )
    print(result)
