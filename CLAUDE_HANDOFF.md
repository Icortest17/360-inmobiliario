# Handoff para continuar en Claude - Tour 3D Inmobiliario

## Prompt inicial recomendado para Claude

Estoy trabajando en una app llamada `360 Inmobiliario`. Quiero convertir un video de una habitacion/vivienda en un tour 3D hiperrealista navegable usando Gaussian Splatting/Nerfstudio. El PC local no tiene GPU potente, asi que la reconstruccion debe correr en cloud GPU con RunPod y la app local solo debe servir para subir video, previsualizar, lanzar jobs y visualizar resultados.

Necesito que continues desde el estado actual del proyecto, sin volver a empezar. Revisa especialmente `server.js`, `src/main.js`, `runpod-splat-worker/handler.py`, `runpod-splat-worker/Dockerfile`, `runpod-splat-worker/README.md`, `PRODUCT_IDEA.md` y este documento. El objetivo inmediato es terminar de desplegar un worker RunPod estable para `ADA_24`/RTX 4090 que ejecute:

1. `ns-process-data video`
2. `ns-train splatfacto`
3. `ns-export gaussian-splat`
4. subida del resultado `.ply`/`.splat` a Supabase
5. carga del resultado en el visor web

No pierdas tiempo reconstruyendo funcionalidades ya hechas. El backend y frontend ya lanzan jobs RunPod; el bloqueo actual esta en construir/publicar una imagen Docker estable con `gsplat` precompilado para RTX 4090.

## Proyecto local

Ruta Windows:

```text
C:\Users\icort\Desktop\Isaac\Apps Antigravity-Claude\360 Inmobiliario
```

App local:

```text
http://127.0.0.1:5173/
```

Scripts:

```powershell
npm run dev
npm run build
```

El servidor local es `server.js`. El frontend principal esta en `src/main.js` y los estilos en `src/styles.css`.

## Variables y servicios

Las claves reales estan en `.env.local`. No las dupliques en documentos ni prompts publicos. El usuario puede copiarlas desde ahi cuando haga falta.

Variables importantes:

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
OPENAI_API_KEY=
RUNPOD_API_KEY=
RUNPOD_ENDPOINT_ID=
RUNPOD_SPLAT_ENDPOINT_ID=
RUNPOD_USE_SPLAT_WORKER=true
RUNPOD_FLASH_LIVE=true
```

URLs/IDs no secretos usados durante el desarrollo:

```text
Supabase URL:
https://vgkkzhtqstigsexrhalj.supabase.co

RunPod Splat endpoint:
i4cawqgxmwut7j

RunPod endpoint name:
commercial_magenta_anaconda

RunPod Flash/lightweight endpoint anterior:
g5ngqavsmsppuu

Gist usado temporalmente para descargar handler.py:
https://gist.github.com/Icortest17/7534ee5c5382ab7259ad2bce2ceda958
https://gist.githubusercontent.com/Icortest17/7534ee5c5382ab7259ad2bce2ceda958/raw/handler.py
```

Nota de seguridad: las claves que se pegaron en el chat original deben rotarse cuando el proyecto vaya a algo real.

## Estado funcional de la app

Ya existe:

- Subida de video desde frontend.
- Extraccion local de keyframes.
- Preview 3D local aproximado con nodos y frames reales.
- Backend Supabase conectado.
- Buckets/paths para videos, frames, manifest y reconstrucciones.
- Creacion de jobs RunPod desde `server.js`.
- Polling de estado RunPod desde frontend.
- Worker ligero Flash/FFmpeg/COLMAP sparse ya probado previamente.
- Worker Splatfacto preparado en `runpod-splat-worker`.

El objetivo ya no es hacer una demo visual aproximada, sino conseguir el primer Gaussian Splat real.

## RunPod endpoint actual

El endpoint `i4cawqgxmwut7j` fue actualizado por el asistente de RunPod:

```text
GPU pool: ADA_24
Workers min: 0
Workers max: 1
Idle timeout: 60s
Scaler type: REQUEST_COUNT
Scaler value: 1
Container disk: 80GB
Imagen actual en RunPod todavia puede estar en:
ghcr.io/nerfstudio-project/nerfstudio:latest
```

La imagen `ghcr.io/nerfstudio-project/nerfstudio:latest` NO debe ser la solucion final. Dio problemas de compatibilidad CUDA/gsplat.

## Errores ya encontrados y conclusiones

### 1. Docker Hub push fallaba con la imagen antigua

Se intento publicar:

```text
icortest17/tour3d-splat-worker:latest
```

La build local antigua llego a crearse, pero el push fallo repetidamente por problemas de red/proxy/Docker Desktop:

```text
write tcp ... http.docker.internal:3128: broken pipe
400 Bad request
lookup registry-1.docker.io: no such host
```

Conclusion: no asumir que Docker Hub push grande funcionara a la primera. Si vuelve a fallar, considerar GHCR o build remoto.

### 2. RunPod con Nerfstudio latest fallo por CUDA kernel

Con imagen:

```text
ghcr.io/nerfstudio-project/nerfstudio:latest
```

Error:

```text
RuntimeError: CUDA error: no kernel image is available for execution on the device
```

Conclusion: imagen/torch/extension no compatible con la GPU asignada.

### 3. Upgrade runtime a torch cu128 avanzo pero rompio gsplat

Se cambio el start command para instalar `torch` CUDA 12.8 en arranque. El error cambio a:

```text
AttributeError: 'NoneType' object has no attribute 'CameraModelType'
```

En:

```text
gsplat/cuda/_wrapper.py
```

Conclusion: `torch` ya ejecutaba CUDA, pero `gsplat` no cargaba su extension CUDA `_C`.

### 4. Intentar compilar gsplat en runtime es mala idea

Compilar `gsplat` en cada cold start de Serverless es lento, fragil y puede dejar workers en bucle:

```text
job queued -> worker starts -> pip/compile fails -> worker crashes -> job queued
```

Conclusion: hay que usar imagen Docker propia con `gsplat` compilado durante `docker build`.

### 5. Build nueva fallo por dependencia GLM

Se creo/actualizo `runpod-splat-worker/Dockerfile` para RTX 4090. La primera build fallo compilando `gsplat==1.4.0`:

```text
fatal error: glm/glm.hpp: No such file or directory
```

Se corrigio el Dockerfile anadiendo:

```text
libglm-dev
```

El build debe relanzarse.

### 6. Docker Desktop quedo atascado

Despues de una build larga, Docker Desktop quedo en mal estado:

```text
docker info -> 500 Internal Server Error
docker desktop status -> starting
Docker Desktop Service -> Stopped
wsl -l -v -> Access denied
```

Se intento reiniciar Docker/WSL desde Codex, pero Windows no permitio arrancar el servicio desde la sesion.

Conclusion: antes de seguir con la build, reiniciar Docker Desktop manualmente como administrador o reiniciar Windows si sigue en `starting`.

## Worker Docker actual

Archivo:

```text
runpod-splat-worker/Dockerfile
```

Estado esperado del Dockerfile:

- Base: `nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04`
- `torch==2.4.1`
- `torchvision==0.19.1`
- CUDA wheel index: `cu121`
- `nerfstudio==1.1.5`
- `gsplat==1.4.0`
- `TORCH_CUDA_ARCH_LIST=8.9`
- `TCNN_CUDA_ARCHITECTURES=89`
- Dependencias apt: incluye `libglm-dev`

El `CMD` verifica:

```text
nvidia-smi
TORCH
CUDA
GPU
CAP
GSPLAT
GSPLAT_OK
python -u /app/handler.py
```

Si el log no muestra `GSPLAT_OK`, no probar aun desde la app.

## Comandos siguientes

Primero recuperar Docker Desktop:

1. Cerrar Docker Desktop.
2. Abrir Docker Desktop como administrador.
3. Esperar a que este en Running.
4. Verificar:

```powershell
docker info
docker buildx ls
```

Luego relanzar build:

```powershell
cd "C:\Users\icort\Desktop\Isaac\Apps Antigravity-Claude\360 Inmobiliario"
docker buildx build --platform linux/amd64 --load -t icortest17/tour3d-splat-worker:rtx4090 .\runpod-splat-worker
```

Si la build termina:

```powershell
docker push icortest17/tour3d-splat-worker:rtx4090
```

Si el push falla otra vez por Docker Hub/red, pasar a una de estas opciones:

1. Publicar en GHCR.
2. Usar build remoto/GitHub Actions.
3. Crear un repo GitHub con `runpod-splat-worker` y que el registry construya la imagen.

## Configuracion final en RunPod

Cuando la imagen este publicada, cambiar el endpoint `i4cawqgxmwut7j`:

```text
Container image:
icortest17/tour3d-splat-worker:rtx4090

GPU pool:
ADA_24

Workers:
0 - 1

Idle timeout:
60s

Scaler:
REQUEST_COUNT / scalerValue 1
```

Start command:

Preferible dejarlo vacio si RunPod respeta el `CMD` de la imagen.

Si hace falta start command explicito:

```bash
bash -lc "nvidia-smi && python -c \"import torch, gsplat; from gsplat.cuda import _wrapper as w; print('TORCH', torch.__version__); print('CUDA', torch.version.cuda); print('GPU', torch.cuda.get_device_name(0)); print('CAP', torch.cuda.get_device_capability(0)); print('GSPLAT', gsplat.__version__); assert w._C is not None; assert hasattr(w._C, 'CameraModelType'); print('GSPLAT_OK')\" && python -u /app/handler.py"
```

## Como probar desde la app

1. Abrir:

```text
http://127.0.0.1:5173/
```

2. Subir video real de habitacion.
3. Crear preview/local.
4. Subir a Supabase.
5. Ejecutar analisis IA si procede.
6. Pulsar `Crear job GPU`.
7. En RunPod logs, esperar:

```text
GSPLAT_OK
ns-process-data
ns-train splatfacto
ns-export gaussian-splat
```

8. Resultado esperado:

```text
stage: splat_exported
uploadedArtifacts: [...]
```

9. Siguiente tarea de frontend: cargar `.ply`/`.splat` final en WebGL viewer y permitir navegacion libre.

## Handler RunPod

Archivo:

```text
runpod-splat-worker/handler.py
```

Hace:

- Lee `job.input`.
- Descarga `signedVideoUrl`.
- Ejecuta `ns-process-data video`.
- Ejecuta `ns-train splatfacto`.
- Busca `config.yml`.
- Ejecuta `ns-export gaussian-splat`.
- Sube artefactos al destino firmado de Supabase.
- Devuelve `stage: splat_exported`.

Perfiles:

```text
room_fast: 700 iterations
room_balanced: 2500 iterations
room_quality: 7000 iterations
```

Para primera prueba real de habitacion usar `room_fast`.

## Puntos importantes para no retroceder

- No volver a depender de `ghcr.io/nerfstudio-project/nerfstudio:latest` como solucion final.
- No compilar `gsplat` en runtime salvo diagnostico temporal.
- Mantener GPU pool estable: `ADA_24`.
- Mantener `TORCH_CUDA_ARCH_LIST=8.9`.
- Verificar siempre `GSPLAT_OK`.
- No lanzar varios jobs a la vez durante depuracion.
- Si Docker Hub vuelve a fallar, cambiar estrategia a GHCR/GitHub Actions en vez de repetir pushes enormes.

## Siguiente objetivo tecnico

Terminar esta cadena:

```text
Video movil -> Supabase Storage -> RunPod ADA_24 -> Nerfstudio Splatfacto -> .ply/.splat -> Supabase reconstructions -> visor web navegable
```

Cuando eso funcione una vez con una habitacion real, las siguientes mejoras son:

- Viewer real para gaussian splat en frontend.
- Limpieza de artefactos/flotantes.
- Controles WASD/mouse o orbit/fly.
- Puntos de interes inmobiliarios.
- Export/share link.
- Optimizacion de costes y tiempos.

