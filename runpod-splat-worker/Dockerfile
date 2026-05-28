FROM nvidia/cuda:12.1.1-cudnn8-devel-ubuntu22.04

ARG DEBIAN_FRONTEND=noninteractive
ARG TORCH_VER=2.4.1
ARG TORCHVISION_VER=0.19.1
ARG NERFSTUDIO_VER=1.1.5
ARG GSPLAT_VER=1.4.0

ENV PYTHONUNBUFFERED=1
ENV FORCE_CUDA=1
ENV TORCH_CUDA_ARCH_LIST=8.9
ENV TCNN_CUDA_ARCHITECTURES=89

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    colmap \
    curl \
    ffmpeg \
    git \
    libgl1 \
    libglib2.0-0 \
    libglm-dev \
    ninja-build \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3 /usr/bin/python \
    && python -m pip install --no-cache-dir --upgrade pip setuptools wheel

RUN python -m pip install --no-cache-dir \
    torch==${TORCH_VER} \
    torchvision==${TORCHVISION_VER} \
    --index-url https://download.pytorch.org/whl/cu121

RUN python -m pip install --no-cache-dir \
    ninja \
    packaging \
    nerfstudio==${NERFSTUDIO_VER}

RUN python -m pip uninstall -y gsplat \
    && MAX_JOBS=2 python -m pip install --no-cache-dir --no-build-isolation --no-binary gsplat gsplat==${GSPLAT_VER}

# Verify the gsplat CUDA extension .so was compiled and exists on disk.
# We cannot call CUDA kernels here (no GPU at build time), but we can
# confirm the extension file is present. Runtime checks happen at container
# startup via the CMD verification step.
RUN python -c "\
import importlib.util, gsplat; \
spec = importlib.util.find_spec('gsplat._C'); \
assert spec is not None and spec.origin, 'gsplat._C .so not found — compilation failed'; \
print('BUILD_CHECK gsplat._C at', spec.origin); \
print('BUILD_CHECK gsplat version:', gsplat.__version__)"

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY handler.py .

CMD ["bash", "-lc", "nvidia-smi && python -c \"import torch, gsplat; from gsplat.cuda import _wrapper as w; print('TORCH', torch.__version__); print('CUDA', torch.version.cuda); print('GPU', torch.cuda.get_device_name(0)); print('CAP', torch.cuda.get_device_capability(0)); print('GSPLAT', gsplat.__version__); assert w._C is not None; assert hasattr(w._C, 'CameraModelType'); print('GSPLAT_OK')\" && python -u /app/handler.py"]
