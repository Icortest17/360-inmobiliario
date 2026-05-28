# RunPod Flash Steps

Use this when RunPod shows the Flash SDK guide.

## 1. Open a terminal in this folder

```powershell
cd "C:\Users\icort\Desktop\Isaac\Apps Antigravity-Claude\360 Inmobiliario\runpod-worker"
```

## 2. Create and activate a Python environment

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks activation:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

## 3. Install Flash

```powershell
pip install -r requirements.txt
```

## 4. Authenticate with RunPod

Recommended:

```powershell
flash login
```

Alternative:

```powershell
$env:RUNPOD_API_KEY="YOUR_RUNPOD_API_KEY"
```

## 5. Test the endpoint from local code

```powershell
python flash_endpoint.py
```

The first run can take a few minutes because RunPod initializes the endpoint.

## 6. Deploy

For the smoke-test endpoint:

```powershell
flash deploy flash_endpoint.py
```

For the real v0.3 frame + COLMAP worker:

```powershell
flash deploy flash_reconstruction_worker.py
```

## 7. Get the endpoint ID

After deployment, RunPod will show an endpoint URL like:

```text
https://api.runpod.ai/v2/YOUR_ENDPOINT_ID/
```

Copy only:

```text
YOUR_ENDPOINT_ID
```

Add it to the project root `.env.local`:

```env
RUNPOD_ENDPOINT_ID=YOUR_ENDPOINT_ID
```

Then restart the local app server.

## 8. Test from the app

1. Open `http://127.0.0.1:5173`
2. Click `Probar demo`
3. Click `Analizar con IA`
4. Click `Crear job GPU`

Expected: the app should start a RunPod job instead of saying that `RUNPOD_ENDPOINT_ID` is missing.

## Current integration mode

The local Node backend uses `run_flash_reconstruction.py` to call the Flash Live worker because the direct RunPod `/run` payload for Flash Live requires the SDK serialization protocol.

For the current MVP, keep:

```env
RUNPOD_FLASH_LIVE=true
```

When a stable deployed endpoint accepts plain JSON, set:

```env
RUNPOD_FLASH_LIVE=false
```
