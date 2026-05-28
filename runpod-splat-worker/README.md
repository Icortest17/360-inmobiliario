# RunPod Splatfacto Worker

Worker final para reconstruccion hiperrealista con Nerfstudio/Splatfacto.

Base RTX 4090 / RunPod `ADA_24`:

- `nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04`
- `torch==2.4.1` / `torchvision==0.19.1` con `cu121`
- `nerfstudio==1.1.5`
- `gsplat==1.4.0` compilado en build con `TORCH_CUDA_ARCH_LIST=8.9`
- `ns-process-data video`
- `ns-train splatfacto`
- `ns-export gaussian-splat`

## Build

```powershell
docker buildx build --platform linux/amd64 --load -t icortest17/tour3d-splat-worker:rtx4090 .\runpod-splat-worker
```

## Endpoint

Publica la imagen en Docker Hub o GHCR y crea un endpoint Serverless en RunPod.

Recomendacion para la prueba de una habitacion:

- GPU pool: `ADA_24`.
- Workers min: `0`
- Workers max: `1`
- Idle timeout: `60`
- Scaler queue delay: `1`
- Container disk: al menos `40 GB`

Start command recomendado si RunPod no usa el `CMD` de la imagen:

```bash
bash -lc "nvidia-smi && python -c \"import torch, gsplat; from gsplat.cuda import _wrapper as w; print('TORCH', torch.__version__); print('CUDA', torch.version.cuda); print('GPU', torch.cuda.get_device_name(0)); print('CAP', torch.cuda.get_device_capability(0)); print('GSPLAT', gsplat.__version__); assert w._C is not None; assert hasattr(w._C, 'CameraModelType'); print('GSPLAT_OK')\" && python -u /app/handler.py"
```

El log debe mostrar `GSPLAT_OK` antes de aceptar trabajos reales.

Variables en `.env.local` del proyecto:

```env
RUNPOD_SPLAT_ENDPOINT_ID=
RUNPOD_USE_SPLAT_WORKER=true
```

## Captura recomendada

- Video horizontal 4K o 1080p, 30-90 segundos.
- Movimiento lento.
- Mucho solape entre zonas.
- Evitar espejos, pantallas y ventanas quemadas.
- Grabar rodeando la habitacion y mirando a esquinas, muebles y techo/suelo.
