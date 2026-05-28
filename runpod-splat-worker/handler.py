import json
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from urllib.parse import urlparse

import requests
import runpod


def handler(job):
    started_at = time.time()
    job_input = job.get("input", {})
    project_id = job_input.get("projectId")
    reconstruction_id = job_input.get("reconstructionId") or f"recon_{int(started_at)}"
    source = job_input.get("source") or {}
    signed_video_url = source.get("signedVideoUrl")
    upload_targets = job_input.get("uploadTargets") or {}
    requested_frames = int(job_input.get("requestedFrames") or 96)
    profile = job_input.get("qualityProfile") or "room_fast"
    max_iterations = int(job_input.get("maxIterations") or profile_iterations(profile))

    if not signed_video_url:
        return {
            "ok": False,
            "stage": "missing_video",
            "projectId": project_id,
            "message": "No signedVideoUrl provided. Upload the video before Splatfacto reconstruction.",
        }

    with tempfile.TemporaryDirectory(prefix="tour3d_") as tmp:
        workdir = Path(tmp)
        video_path = workdir / "input_video"
        dataset_dir = workdir / "dataset"
        outputs_dir = workdir / "outputs"
        exports_dir = workdir / "exports"
        logs = []

        download_file(signed_video_url, video_path)
        assert_cli("ns-process-data")
        assert_cli("ns-train")
        assert_cli("ns-export")

        run_command([
            "ns-process-data",
            "video",
            "--data",
            str(video_path),
            "--output-dir",
            str(dataset_dir),
            "--num-frames-target",
            str(requested_frames),
            "--matching-method",
            "exhaustive",
            "--sfm-tool",
            "colmap",
        ], logs, timeout=3600)

        run_command([
            "ns-train",
            "splatfacto",
            "--data",
            str(dataset_dir),
            "--output-dir",
            str(outputs_dir),
            "--max-num-iterations",
            str(max_iterations),
            "--viewer.quit-on-train-completion",
            "True",
            "--vis",
            "tensorboard",
        ], logs, timeout=7200)

        config_path = find_latest_config(outputs_dir)
        if not config_path:
            return {
                "ok": False,
                "stage": "missing_train_config",
                "projectId": project_id,
                "message": "Splatfacto finished without a config.yml.",
                "logs": logs[-30:],
            }

        run_command([
            "ns-export",
            "gaussian-splat",
            "--load-config",
            str(config_path),
            "--output-dir",
            str(exports_dir),
        ], logs, timeout=1800)

        splat_files = find_splat_outputs(exports_dir)
        summary = {
            "projectId": project_id,
            "reconstructionId": reconstruction_id,
            "stage": "splat_exported",
            "qualityProfile": profile,
            "requestedFrames": requested_frames,
            "maxIterations": max_iterations,
            "durationSeconds": round(time.time() - started_at, 2),
            "configPath": str(config_path),
            "splatFiles": [{"name": path.name, "bytes": path.stat().st_size} for path in splat_files],
            "logs": logs[-40:],
        }

        uploaded = upload_splat_artifacts(splat_files, upload_targets.get("splat") or [])
        summary_path = workdir / "splat_summary.json"
        summary["uploadedArtifacts"] = uploaded
        summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
        summary_target = upload_targets.get("splatSummary")
        summary_upload = upload_file(summary_path, summary_target, "application/json") if summary_target else None

        return {
            "ok": True,
            "stage": "splat_exported",
            "projectId": project_id,
            "reconstructionId": reconstruction_id,
            "durationSeconds": summary["durationSeconds"],
            "qualityProfile": profile,
            "maxIterations": max_iterations,
            "splatFiles": summary["splatFiles"],
            "uploadedArtifacts": uploaded,
            "summaryPath": summary_upload,
            "logs": logs[-20:],
            "nextPipeline": [
                "load gaussian splat in WebGL viewer",
                "add walk navigation controls",
                "clean floaters and bad regions",
                "publish shareable tour link",
            ],
        }


def profile_iterations(profile):
    return {
        "room_fast": 700,
        "room_balanced": 2500,
        "room_quality": 7000,
    }.get(profile, 700)


def assert_cli(name):
    if not shutil.which(name):
        raise RuntimeError(f"{name} is not available in the Nerfstudio image.")


def download_file(url, destination):
    suffix = Path(urlparse(url).path).suffix
    target = destination.with_suffix(suffix) if suffix else destination
    with requests.get(url, stream=True, timeout=180) as response:
        response.raise_for_status()
        with open(target, "wb") as file:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    file.write(chunk)
    if target != destination:
        target.rename(destination)


def run_command(command, logs, timeout):
    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )
    started = time.time()
    captured = []

    assert process.stdout is not None
    for line in process.stdout:
        line = line.rstrip()
        if line:
            print(line, flush=True)
            captured.append(line)
            logs.append(line)
        if time.time() - started > timeout:
            process.kill()
            raise TimeoutError(f"{command[0]} timed out after {timeout}s")

    code = process.wait()
    if code != 0:
        tail = "\n".join(captured[-40:])
        raise RuntimeError(f"{' '.join(command[:2])} failed with exit code {code}: {tail}")


def find_latest_config(outputs_dir):
    configs = sorted(outputs_dir.glob("**/config.yml"), key=lambda path: path.stat().st_mtime, reverse=True)
    return configs[0] if configs else None


def find_splat_outputs(exports_dir):
    outputs = []
    for pattern in ("*.ply", "*.splat", "*.ksplat"):
        outputs.extend(exports_dir.glob(f"**/{pattern}"))
    return sorted(outputs, key=lambda path: path.stat().st_size, reverse=True)


def upload_splat_artifacts(files, targets):
    uploaded = []
    for file_path, target in zip(files, targets):
        content_type = "application/octet-stream"
        if file_path.suffix.lower() == ".ply":
            content_type = "application/octet-stream"
        uploaded_path = upload_file(file_path, target, content_type)
        if uploaded_path:
            uploaded.append({"name": file_path.name, "path": uploaded_path, "bytes": file_path.stat().st_size})
    return uploaded


def upload_file(file_path, target, content_type):
    if not target:
        return None
    signed_url = target.get("signedUrl")
    path = target.get("path")
    if not signed_url or not path:
        return None
    with open(file_path, "rb") as file:
        response = requests.put(signed_url, data=file, headers={"content-type": content_type}, timeout=300)
    response.raise_for_status()
    return path


runpod.serverless.start({"handler": handler})
