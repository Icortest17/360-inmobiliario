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
    && python -m pip install --no-cache-dir --no-build-isolation --no-binary gsplat gsplat==${GSPLAT_VER}

# Fail the build immediately if gsplat CUDA extension didn't compile correctly.
# This surfaces the error here rather than at RunPod cold-start.
RUN python -c "\
import gsplat; \
from gsplat.cuda import _wrapper as w; \
assert w._C is not None, 'gsplat _C is None — CUDA extension not compiled'; \
assert hasattr(w._C, 'CameraModelType'), 'gsplat missing CameraModelType'; \
print('BUILD_CHECK gsplat OK:', gsplat.__version__)"

WORKDIR /app

COPY requirements.txt .
RUN python -m pip install --no-cache-dir -r requirements.txt

COPY handler.py .

CMD ["bash", "-lc", "nvidia-smi && python -c \"import torch, gsplat; from gsplat.cuda import _wrapper as w; print('TORCH', torch.__version__); print('CUDA', torch.version.cuda); print('GPU', torch.cuda.get_device_name(0)); print('CAP', torch.cuda.get_device_capability(0)); print('GSPLAT', gsplat.__version__); assert w._C is not None; assert hasattr(w._C, 'CameraModelType'); print('GSPLAT_OK')\" && python -u /app/handler.py"]
