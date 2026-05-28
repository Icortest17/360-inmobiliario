# RunPod Worker

This is the first serverless worker for 360 Cloud Tour.

It is intentionally a smoke-test worker: it validates that the app can create a GPU job and call a RunPod endpoint. The heavy reconstruction pipeline comes next.

## Create the endpoint

1. Push this repository or the `runpod-worker` folder to GitHub, or build/publish the Docker image to Docker Hub/GHCR.
2. In RunPod, go to **Serverless**.
3. Create a new endpoint.
4. Use this worker image/template.
5. Choose a cheap GPU for this smoke test. A small GPU is enough because this worker does not reconstruct yet.
6. Set:
   - Workers min: `0`
   - Workers max: `1`
   - Idle timeout: `5`
7. After creation, copy the endpoint URL:

```text
https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/
```

8. Add only the ID to `.env.local`:

```env
RUNPOD_ENDPOINT_ID=YOUR_ENDPOINT_ID
```

9. Restart the local server.

## Later

Replace `handler.py` with the real pipeline:

1. Download video from Supabase Storage.
2. Extract dense frames with FFmpeg.
3. Run COLMAP/SfM.
4. Run Nerfstudio Splatfacto or another Gaussian Splatting pipeline.
5. Upload output to Supabase `reconstructions`.
6. Update the Supabase job.
