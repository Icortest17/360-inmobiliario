const state = {
  videoFile: null,
  analysis: null,
  keyframes: [],
  mode: "dollhouse",
  currentNode: 0,
  rotation: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  lastFrameAt: 0,
  lastNodeMoveAt: 0
};

const elements = {
  input: document.querySelector("#videoInput"),
  uploadZone: document.querySelector("#uploadZone"),
  uploadStatus: document.querySelector("#uploadStatus"),
  chooseVideoButton: document.querySelector("#chooseVideoButton"),
  frameTarget: document.querySelector("#frameTarget"),
  frameTargetValue: document.querySelector("#frameTargetValue"),
  presetButtons: Array.from(document.querySelectorAll(".preset-button")),
  analysisSize: document.querySelector("#analysisSize"),
  analyzeButton: document.querySelector("#analyzeButton"),
  demoButton: document.querySelector("#demoButton"),
  exportButton: document.querySelector("#exportButton"),
  bootstrapButton: document.querySelector("#bootstrapButton"),
  schemaCheckButton: document.querySelector("#schemaCheckButton"),
  cloudUploadButton: document.querySelector("#cloudUploadButton"),
  cloudStatus: document.querySelector("#cloudStatus"),
  globalCloudBadge: document.querySelector("#globalCloudBadge"),
  cloudChecklist: Array.from(document.querySelectorAll("#cloudChecklist li")),
  workflowSteps: Array.from(document.querySelectorAll("[data-workflow-step]")),
  cloudProgress: document.querySelector("#cloudProgress"),
  aiAnalyzeButton: document.querySelector("#aiAnalyzeButton"),
  gpuJobButton: document.querySelector("#gpuJobButton"),
  aiStatus: document.querySelector("#aiStatus"),
  aiResult: document.querySelector("#aiResult"),
  gpuStage: document.querySelector("#gpuStage"),
  gpuFrames: document.querySelector("#gpuFrames"),
  gpuManifest: document.querySelector("#gpuManifest"),
  gpuNext: document.querySelector("#gpuNext"),
  resetButton: document.querySelector("#resetButton"),
  prevNodeButton: document.querySelector("#prevNodeButton"),
  nextNodeButton: document.querySelector("#nextNodeButton"),
  nodeLabel: document.querySelector("#nodeLabel"),
  video: document.querySelector("#videoProbe"),
  analysisCanvas: document.querySelector("#analysisCanvas"),
  frameStrip: document.querySelector("#frameStrip"),
  framesMetric: document.querySelector("#framesMetric"),
  coverageMetric: document.querySelector("#coverageMetric"),
  confidenceMetric: document.querySelector("#confidenceMetric"),
  nodesMetric: document.querySelector("#nodesMetric"),
  pipelineItems: Array.from(document.querySelectorAll("#pipelineList li")),
  aiPrompt: document.querySelector("#aiPrompt"),
  sceneTitle: document.querySelector("#sceneTitle"),
  sceneSubtitle: document.querySelector("#sceneSubtitle"),
  modeButtons: Array.from(document.querySelectorAll("[data-mode]")),
  canvas: document.querySelector("#tourCanvas")
};

const ctx = elements.canvas.getContext("2d");
let latestCloudUpload = null;
let latestAiAnalysis = null;
let latestRunpodPoll = null;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function finiteOr(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function safeChannel(value, fallback = 128) {
  return Math.round(clamp(finiteOr(value, fallback), 0, 255));
}

function updatePipeline(doneSteps) {
  elements.pipelineItems.forEach((item) => {
    item.classList.toggle("done", doneSteps.includes(item.dataset.step));
  });
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function setStatus(message, isError = false) {
  elements.uploadStatus.textContent = message;
  elements.uploadStatus.style.color = isError ? "#ffb3a7" : "";
}

function setCloudStatus(message, isError = false) {
  elements.cloudStatus.textContent = message;
  elements.cloudStatus.style.color = isError ? "#ffb3a7" : "";
}

function setAiStatus(message, isError = false) {
  elements.aiStatus.textContent = message;
  elements.aiStatus.style.color = isError ? "#ffb3a7" : "";
}

function setCloudBadge(message, isReady = false) {
  elements.globalCloudBadge.textContent = message;
  elements.globalCloudBadge.style.background = isReady ? "#55b29a" : "#e5c36a";
}

function updateCloudChecklist(doneSteps, warnSteps = []) {
  elements.cloudChecklist.forEach((item) => {
    item.classList.toggle("done", doneSteps.includes(item.dataset.cloudStep));
    item.classList.toggle("warn", warnSteps.includes(item.dataset.cloudStep));
  });
}

function updateWorkflow(doneSteps = [], activeStep = "") {
  elements.workflowSteps.forEach((item) => {
    const step = item.dataset.workflowStep;
    item.classList.toggle("done", doneSteps.includes(step));
    item.classList.toggle("active", activeStep === step);
  });
}

function setGpuConsole({ stage = "Pendiente", frames = "0", manifest = "Sin generar", next = "COLMAP + Splatfacto" } = {}) {
  elements.gpuStage.textContent = stage;
  elements.gpuFrames.textContent = String(frames);
  elements.gpuManifest.textContent = manifest;
  elements.gpuManifest.title = manifest;
  elements.gpuNext.textContent = next;
  elements.gpuNext.title = next;
}

function isVideoFile(file) {
  return file && (file.type.startsWith("video/") || /\.(mp4|mov|m4v|webm|avi)$/i.test(file.name));
}

function updateFrameTarget(value) {
  const next = String(value);
  elements.frameTarget.value = next;
  elements.frameTargetValue.value = next;
  elements.presetButtons.forEach((button) => button.classList.toggle("active", button.dataset.frames === next));
}

function resizeCanvas() {
  const rect = elements.canvas.getBoundingClientRect();
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.floor(rect.width * ratio));
  const height = Math.max(1, Math.floor(rect.height * ratio));

  if (state.canvasWidth !== width || state.canvasHeight !== height) {
    elements.canvas.width = width;
    elements.canvas.height = height;
    state.canvasWidth = width;
    state.canvasHeight = height;
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function defaultAnalysis() {
  return {
    frameCount: 0,
    nodeCount: 0,
    coverage: 0,
    confidence: 0,
    brightness: 0.48,
    horizontalMotion: 0.45,
    verticalMotion: 0.3,
    edgeDensity: 0.38,
    averageColor: "#8a8b77",
    label: "modelo base"
  };
}

function hexToRgb(hex) {
  if (typeof hex === "string" && hex.startsWith("rgb(")) {
    const channels = hex.match(/\d+(\.\d+)?/g)?.map(Number) || [];
    return {
      r: safeChannel(channels[0]),
      g: safeChannel(channels[1]),
      b: safeChannel(channels[2])
    };
  }

  const value = typeof hex === "string" ? hex.replace("#", "") : "";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return {
    r: safeChannel(r),
    g: safeChannel(g),
    b: safeChannel(b)
  };
}

function adjustColor(hex, amount) {
  const { r, g, b } = hexToRgb(hex);
  const next = [r, g, b].map((channel) => clamp(Math.round(channel + amount), 0, 255));
  return `rgb(${next[0]}, ${next[1]}, ${next[2]})`;
}

function drawPolygon(points, fill, stroke = "rgba(245, 241, 232, 0.18)") {
  ctx.beginPath();
  points.forEach(([x, y], index) => {
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawScene() {
  try {
    resizeCanvas();
    const rect = elements.canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    if (state.keyframes.length > 0) {
      drawPhotoTour(rect);
    } else {
      drawEmptyRoom(rect);
    }

    updateNodeUI();
  } catch (error) {
    console.error(error);
    setStatus("He detectado un frame invalido y lo estoy ignorando. Vuelve a crear el tour.", true);
  }
}

function drawPhotoTour(rect) {
  const analysis = sanitizeAnalysis(state.analysis || defaultAnalysis());
  const current = state.keyframes[state.currentNode] || state.keyframes[0];
  const previous = state.keyframes[Math.max(0, state.currentNode - 1)] || current;
  const next = state.keyframes[Math.min(state.keyframes.length - 1, state.currentNode + 1)] || current;

  if (state.mode === "plan") {
    drawPlan(rect, analysis);
    return;
  }

  const gradient = ctx.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, adjustColor(analysis.averageColor, -82));
  gradient.addColorStop(1, "#101311");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, rect.width, rect.height);

  if (state.mode === "walk") {
    drawImmersiveFrame(current.canvas, rect, state.currentNode);
  } else {
    drawPhotoRoom(previous.canvas, current.canvas, next.canvas, rect, analysis);
  }

  drawTourOverlay(rect, analysis);
}

function drawImmersiveFrame(image, rect, nodeIndex) {
  const pan = ((nodeIndex % 9) - 4) * 0.015;
  const crop = coverCrop(image.width, image.height, rect.width, rect.height, pan);
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, rect.width, rect.height);

  const vignette = ctx.createRadialGradient(rect.width / 2, rect.height / 2, rect.width * 0.15, rect.width / 2, rect.height / 2, rect.width * 0.72);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.42)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, rect.width, rect.height);
}

function drawPhotoRoom(leftImage, centerImage, rightImage, rect, analysis) {
  const horizon = rect.height * 0.34;
  const floorTop = rect.height * 0.63;
  const wallColor = adjustColor(analysis.averageColor, 14);
  const floorColor = adjustColor(analysis.averageColor, -48);

  drawPolygon(
    [
      [rect.width * 0.16, horizon],
      [rect.width * 0.5, rect.height * 0.2],
      [rect.width * 0.5, floorTop],
      [rect.width * 0.16, rect.height * 0.9]
    ],
    adjustColor(wallColor, -12)
  );
  drawSideFrame(leftImage, rect, "left");

  drawPolygon(
    [
      [rect.width * 0.84, horizon],
      [rect.width * 0.5, rect.height * 0.2],
      [rect.width * 0.5, floorTop],
      [rect.width * 0.84, rect.height * 0.9]
    ],
    adjustColor(wallColor, -24)
  );
  drawSideFrame(rightImage, rect, "right");

  const floorGradient = ctx.createLinearGradient(0, floorTop, 0, rect.height);
  floorGradient.addColorStop(0, adjustColor(floorColor, 18));
  floorGradient.addColorStop(1, floorColor);
  drawPolygon(
    [
      [rect.width * 0.16, rect.height * 0.9],
      [rect.width * 0.5, floorTop],
      [rect.width * 0.84, rect.height * 0.9],
      [rect.width * 0.62, rect.height],
      [rect.width * 0.38, rect.height]
    ],
    floorGradient,
    "rgba(245, 241, 232, 0.08)"
  );

  const frameWidth = rect.width * 0.52;
  const frameHeight = frameWidth * 0.56;
  const frameX = (rect.width - frameWidth) / 2;
  const frameY = rect.height * 0.18;
  const crop = coverCrop(centerImage.width, centerImage.height, frameWidth, frameHeight, 0);
  ctx.drawImage(centerImage, crop.x, crop.y, crop.width, crop.height, frameX, frameY, frameWidth, frameHeight);

  ctx.strokeStyle = "rgba(245, 241, 232, 0.42)";
  ctx.lineWidth = 2;
  ctx.strokeRect(frameX, frameY, frameWidth, frameHeight);

  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(frameX, frameY + frameHeight - 34, frameWidth, 34);
  ctx.fillStyle = "#f5f1e8";
  ctx.font = "700 13px Inter, system-ui, sans-serif";
  ctx.fillText(`Nodo ${state.currentNode + 1}`, frameX + 14, frameY + frameHeight - 13);
}

function drawSideFrame(image, rect, side) {
  const width = rect.width * 0.22;
  const height = rect.height * 0.36;
  const x = side === "left" ? rect.width * 0.12 : rect.width * 0.66;
  const y = rect.height * 0.28;
  const crop = coverCrop(image.width, image.height, width, height, side === "left" ? -0.12 : 0.12);
  ctx.save();
  ctx.globalAlpha = 0.34;
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, x, y, width, height);
  ctx.restore();
}

function drawPlan(rect, analysis) {
  ctx.fillStyle = "#121612";
  ctx.fillRect(0, 0, rect.width, rect.height);

  const centerX = rect.width / 2;
  const centerY = rect.height / 2;
  const radiusX = Math.min(rect.width * 0.34, 360);
  const radiusY = Math.min(rect.height * 0.28, 220);
  ctx.strokeStyle = "rgba(245, 241, 232, 0.2)";
  ctx.lineWidth = 2;
  ctx.strokeRect(centerX - radiusX - 32, centerY - radiusY - 32, radiusX * 2 + 64, radiusY * 2 + 64);

  ctx.beginPath();
  state.keyframes.forEach((frame, index) => {
    const progress = state.keyframes.length <= 1 ? 0 : index / (state.keyframes.length - 1);
    const x = centerX - radiusX + radiusX * 2 * progress;
    const y = centerY + Math.sin(progress * Math.PI * 2) * radiusY * 0.32;
    frame.planX = x;
    frame.planY = y;
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#e5c36a";
  ctx.lineWidth = 3;
  ctx.stroke();

  state.keyframes.forEach((frame, index) => {
    const active = index === state.currentNode;
    ctx.beginPath();
    ctx.arc(frame.planX, frame.planY, active ? 8 : 5, 0, Math.PI * 2);
    ctx.fillStyle = active ? "#f5f1e8" : "#55b29a";
    ctx.fill();
  });

  ctx.fillStyle = "#f5f1e8";
  ctx.font = "800 16px Inter, system-ui, sans-serif";
  ctx.fillText(`Ruta estimada: ${state.keyframes.length} nodos`, 24, 34);
  ctx.fillStyle = "#aeb7ae";
  ctx.font = "600 13px Inter, system-ui, sans-serif";
  ctx.fillText(`Cobertura ${Math.round(analysis.coverage * 100)}% - confianza ${Math.round(analysis.confidence * 100)}%`, 24, 56);
}

function drawTourOverlay(rect, analysis) {
  ctx.fillStyle = "rgba(13, 15, 14, 0.58)";
  ctx.fillRect(16, 16, 238, 72);
  ctx.fillStyle = "#f5f1e8";
  ctx.font = "800 15px Inter, system-ui, sans-serif";
  ctx.fillText(`${analysis.label}`, 30, 42);
  ctx.fillStyle = "#c9d1c7";
  ctx.font = "600 13px Inter, system-ui, sans-serif";
  ctx.fillText(`${state.keyframes.length} keyframes - nodo ${state.currentNode + 1}`, 30, 66);
}

function drawEmptyRoom(rect) {
  const analysis = defaultAnalysis();
  const gradient = ctx.createLinearGradient(0, 0, rect.width, rect.height);
  gradient.addColorStop(0, "#151916");
  gradient.addColorStop(1, "#20241f");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, rect.width, rect.height);

  const floor = adjustColor(analysis.averageColor, -42);
  drawPolygon(
    [
      [rect.width * 0.2, rect.height * 0.78],
      [rect.width * 0.5, rect.height * 0.5],
      [rect.width * 0.8, rect.height * 0.78],
      [rect.width * 0.6, rect.height * 0.92],
      [rect.width * 0.4, rect.height * 0.92]
    ],
    floor
  );

  ctx.strokeStyle = "rgba(245, 241, 232, 0.18)";
  ctx.strokeRect(rect.width * 0.2, rect.height * 0.22, rect.width * 0.6, rect.height * 0.56);
  ctx.fillStyle = "#f5f1e8";
  ctx.font = "800 18px Inter, system-ui, sans-serif";
  ctx.fillText("Sube un video o prueba la demo", 28, 42);
}

function coverCrop(imageWidth, imageHeight, targetWidth, targetHeight, pan = 0) {
  if (imageWidth <= 0 || imageHeight <= 0 || targetWidth <= 0 || targetHeight <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 };
  }

  const sourceRatio = imageWidth / imageHeight;
  const targetRatio = targetWidth / targetHeight;
  let width = imageWidth;
  let height = imageHeight;
  let x = 0;
  let y = 0;

  if (sourceRatio > targetRatio) {
    width = imageHeight * targetRatio;
    x = (imageWidth - width) / 2 + imageWidth * pan;
  } else {
    height = imageWidth / targetRatio;
    y = (imageHeight - height) / 2;
  }

  return {
    x: clamp(x, 0, imageWidth - width),
    y: clamp(y, 0, imageHeight - height),
    width,
    height
  };
}

function sanitizeAnalysis(analysis) {
  const fallback = defaultAnalysis();
  return {
    ...fallback,
    ...analysis,
    frameCount: Math.max(0, Math.round(finiteOr(analysis.frameCount, fallback.frameCount))),
    nodeCount: Math.max(0, Math.round(finiteOr(analysis.nodeCount, fallback.nodeCount))),
    coverage: clamp(finiteOr(analysis.coverage, fallback.coverage), 0, 1),
    confidence: clamp(finiteOr(analysis.confidence, fallback.confidence), 0, 1),
    brightness: clamp(finiteOr(analysis.brightness, fallback.brightness), 0, 1),
    horizontalMotion: clamp(finiteOr(analysis.horizontalMotion, fallback.horizontalMotion), 0, 1),
    verticalMotion: clamp(finiteOr(analysis.verticalMotion, fallback.verticalMotion), 0, 1),
    edgeDensity: clamp(finiteOr(analysis.edgeDensity, fallback.edgeDensity), 0, 1),
    averageColor: normalizeColor(analysis.averageColor || fallback.averageColor),
    label: analysis.label || fallback.label
  };
}

function normalizeColor(color) {
  const { r, g, b } = hexToRgb(color);
  return rgbToHex(r, g, b);
}

function loadVideoFile(file) {
  if (!isVideoFile(file)) {
    setStatus("El archivo no parece ser un video compatible.", true);
    return;
  }

  if (file.size > 750 * 1024 * 1024) {
    setStatus("Video demasiado grande para el MVP local. Prueba con menos de 750 MB.", true);
    return;
  }

  if (elements.video.src) URL.revokeObjectURL(elements.video.src);
  resetTourState(false);
  state.videoFile = file;
  elements.video.src = URL.createObjectURL(file);
  elements.analyzeButton.disabled = true;
  elements.exportButton.disabled = true;
  elements.cloudUploadButton.disabled = true;
  elements.sceneTitle.textContent = "Video cargado";
  elements.sceneSubtitle.textContent = "Leyendo metadatos";
  setStatus(`Cargando: ${file.name} (${formatBytes(file.size)})`);

  elements.video.onloadedmetadata = () => {
    elements.analyzeButton.disabled = false;
    elements.cloudUploadButton.disabled = false;
    const seconds = Math.round(getVideoDuration(elements.video));
    elements.sceneSubtitle.textContent = `${file.name} - ${seconds}s`;
    setStatus(`${file.name} listo - ${seconds}s - ${formatBytes(file.size)}`);
    updatePipeline(["load"]);
    updateWorkflow(["capture"], "local");
  };

  elements.video.onerror = () => {
    setStatus("No he podido leer este video. Prueba con MP4, MOV o WebM.", true);
    elements.analyzeButton.disabled = true;
  };
}

async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.message || `Error HTTP ${response.status}`);
  }
  return data;
}

async function refreshCloudHealth() {
  try {
    const health = await apiRequest("/api/health");
    if (health.supabaseConfigured) {
      const extras = [
        health.openaiConfigured ? "OpenAI listo" : "OpenAI pendiente",
        health.runpodSplatEndpointConfigured && health.runpodUseSplatWorker ? "Splatfacto listo" : health.runpodEndpointConfigured ? "RunPod endpoint listo" : health.runpodConfigured ? "RunPod key lista" : "RunPod pendiente"
      ].join(" · ");
      setCloudStatus(`Supabase conectado · ${extras}`);
      setCloudBadge("Cloud conectado", true);
      updateCloudChecklist(["backend"]);
      elements.bootstrapButton.disabled = false;
    } else {
      setCloudStatus("Faltan variables de entorno en backend (.env.local).", true);
      setCloudBadge("Config pendiente", false);
      updateCloudChecklist([], ["backend"]);
      elements.bootstrapButton.disabled = true;
      elements.cloudUploadButton.disabled = true;
    }
  } catch (error) {
    setCloudStatus(`No se pudo comprobar cloud: ${error.message}`, true);
    setCloudBadge("Backend offline", false);
    updateCloudChecklist([], ["backend"]);
  }
}

async function bootstrapSupabase() {
  elements.bootstrapButton.disabled = true;
  setCloudStatus("Preparando buckets en Supabase...");

  try {
    const result = await apiRequest("/api/bootstrap", { method: "POST", body: JSON.stringify({}) });
    const bucketSummary = result.buckets.map((bucket) => `${bucket.bucket}: ${bucket.status}`).join(" · ");
    setCloudStatus(`Buckets listos. Ejecuta ${result.schemaFile} si las tablas aun no existen. ${bucketSummary}`);
    updateCloudChecklist(["backend", "buckets"], ["schema"]);
  } catch (error) {
    setCloudStatus(`No se pudo preparar Supabase: ${error.message}`, true);
  } finally {
    elements.bootstrapButton.disabled = false;
  }
}

async function checkSchema() {
  elements.schemaCheckButton.disabled = true;
  setCloudStatus("Validando tablas SQL...");

  try {
    const result = await apiRequest("/api/schema-check");
    if (result.ok) {
      setCloudStatus("Tablas SQL listas. Ya puedes subir video y crear jobs.");
      updateCloudChecklist(["backend", "buckets", "schema"]);
    } else {
      const missing = result.checks.filter((check) => !check.ok).map((check) => check.table).join(", ");
      setCloudStatus(`Faltan tablas o permisos: ${missing}. Revisa supabase_schema.sql.`, true);
      updateCloudChecklist(["backend", "buckets"], ["schema"]);
    }
  } catch (error) {
    setCloudStatus(`No se pudo validar el esquema: ${error.message}`, true);
    updateCloudChecklist(["backend", "buckets"], ["schema"]);
  } finally {
    elements.schemaCheckButton.disabled = false;
  }
}

async function uploadVideoToCloud() {
  if (!state.videoFile) {
    setCloudStatus("Sube un video antes de enviarlo a Supabase.", true);
    return;
  }

  elements.cloudUploadButton.disabled = true;
  elements.cloudProgress.value = 0;
  setCloudStatus("Solicitando URL firmada...");

  try {
    const upload = await apiRequest("/api/upload-url", {
      method: "POST",
      body: JSON.stringify({
        fileName: state.videoFile.name,
        contentType: state.videoFile.type || "video/mp4",
        size: state.videoFile.size,
        requestedFrames: Number(elements.frameTarget.value)
      })
    });

    elements.cloudProgress.value = 10;
    updateCloudChecklist(["backend", "buckets", "schema"], ["upload"]);
    setCloudStatus("Subiendo video a Supabase Storage...");
    await uploadToSupabaseSignedUrl(upload, state.videoFile);
    elements.cloudProgress.value = 82;

    setCloudStatus("Registrando proyecto y job...");
    const finalized = await apiRequest("/api/finalize-upload", {
      method: "POST",
      body: JSON.stringify({
        projectId: upload.projectId,
        uploadId: upload.uploadId,
        bucket: upload.bucket,
        path: upload.path,
        fileName: state.videoFile.name,
        contentType: state.videoFile.type || "video/mp4",
        size: state.videoFile.size,
        requestedFrames: Number(elements.frameTarget.value),
        metadata: state.analysis || {}
      })
    });

    elements.cloudProgress.value = 100;
    if (finalized.databaseReady) {
      latestCloudUpload = {
        projectId: finalized.projectId,
        bucket: upload.bucket,
        path: upload.path,
        jobId: finalized.job.row?.id
      };
      setCloudStatus(`Video subido y job en cola: ${finalized.job.row?.id || "creado"}`);
      updateCloudChecklist(["backend", "buckets", "schema", "upload"]);
      updateWorkflow(["capture", "local", "cloud"], "ai");
    } else {
      setCloudStatus("Video subido. Ejecuta supabase_schema.sql para activar tablas/jobs.", true);
      updateCloudChecklist(["backend", "buckets", "upload"], ["schema"]);
      updateWorkflow(["capture", "local"], "cloud");
    }
  } catch (error) {
    setCloudStatus(`Fallo en subida cloud: ${error.message}`, true);
  } finally {
    elements.cloudUploadButton.disabled = false;
  }
}

async function uploadToSupabaseSignedUrl(upload, file) {
  const signedUrl = upload.signedUrl || upload.raw?.signedURL || upload.raw?.url || upload.raw?.signedUrl;
  if (!signedUrl) throw new Error("Supabase no devolvio una URL firmada valida.");

  const absoluteUrl = signedUrl.startsWith("http") ? signedUrl : `${location.origin}${signedUrl}`;
  const methods = ["PUT", "POST"];
  let lastError = null;

  for (const method of methods) {
    const response = await fetch(absoluteUrl, {
      method,
      headers: {
        "Content-Type": file.type || upload.contentType || "video/mp4",
        "cache-control": "3600"
      },
      body: file
    });

    if (response.ok) return;
    lastError = await response.text().catch(() => `HTTP ${response.status}`);
  }

  throw new Error(lastError || "No se pudo subir a la URL firmada.");
}

function seekVideo(video, time) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("No se pudo leer el frame a tiempo.")), 8000);
    const handleSeek = () => {
      window.clearTimeout(timer);
      video.removeEventListener("seeked", handleSeek);
      resolve();
    };
    video.addEventListener("seeked", handleSeek);
    video.currentTime = Math.min(time, Math.max(video.duration - 0.05, 0));
  });
}

async function analyzeVideo() {
  if (!state.videoFile) return;

  elements.analyzeButton.disabled = true;
  elements.exportButton.disabled = true;
  elements.analyzeButton.textContent = "Creando tour...";
  setStatus("Extrayendo keyframes del video...");
  updatePipeline(["load"]);
  elements.frameStrip.innerHTML = "";
  state.keyframes = [];
  state.currentNode = 0;

  const video = elements.video;
  const canvas = elements.analysisCanvas;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const targetFrames = Number(elements.frameTarget.value);
  const duration = getVideoDuration(video);
  const frameCount = Math.min(targetFrames, Math.max(10, Math.floor(duration * 4)));
  const width = Number(elements.analysisSize.value);
  const height = Math.round(width * 9 / 16);
  const samples = [];

  canvas.width = width;
  canvas.height = height;

  try {
    for (let index = 0; index < frameCount; index += 1) {
      await seekVideo(video, (duration / (frameCount + 1)) * (index + 1));
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const sample = readFrameSignals(imageData);
      if (!isValidSample(sample)) {
        setStatus(`Frame ${index + 1} descartado por datos invalidos...`);
        continue;
      }
      const frame = createKeyframe(canvas, sample, index, frameCount, video.currentTime);
      samples.push(sample);
      state.keyframes.push(frame);
      appendFramePreview(frame);
      elements.framesMetric.textContent = String(index + 1);
      elements.nodesMetric.textContent = String(state.keyframes.length);
      setStatus(`Creando tour: frame ${index + 1} de ${frameCount}...`);

      if (index % 3 === 0) {
        applyPartialAnalysis(samples);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      }
    }

    if (samples.length === 0) {
      throw new Error("No se pudieron leer frames validos del video. Prueba exportarlo como MP4 H.264.");
    }

    applyAnalysis(summarizeSamples(samples), `${samples.length} keyframes reales`);
    setStatus("Primera version 3D creada. Navega por nodos o cambia de vista.");
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.analyzeButton.textContent = "Crear tour 3D";
    elements.analyzeButton.disabled = false;
  }
}

function getVideoDuration(video) {
  const duration = Number(video.duration);
  if (Number.isFinite(duration) && duration > 0) return duration;
  return 10;
}

function createKeyframe(sourceCanvas, sample, index, total, time) {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  canvas.getContext("2d").drawImage(sourceCanvas, 0, 0);
  return {
    canvas,
    sample,
    index,
    time,
    progress: total <= 1 ? 0 : index / (total - 1)
  };
}

function readFrameSignals(imageData) {
  const { data, width, height } = imageData;
  let r = 0;
  let g = 0;
  let b = 0;
  let brightness = 0;
  let edges = 0;

  for (let y = 0; y < height; y += 3) {
    for (let x = 0; x < width; x += 3) {
      const index = (y * width + x) * 4;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      r += red;
      g += green;
      b += blue;
      brightness += (red + green + blue) / 765;

      if (x > 0 && y > 0) {
        const previous = ((y - 1) * width + x - 1) * 4;
        const delta = Math.abs(red - data[previous]) + Math.abs(green - data[previous + 1]) + Math.abs(blue - data[previous + 2]);
        if (delta > 90) edges += 1;
      }
    }
  }

  const total = Math.max(1, Math.ceil(width / 3) * Math.ceil(height / 3));
  return {
    r: safeChannel(r / total),
    g: safeChannel(g / total),
    b: safeChannel(b / total),
    brightness: clamp(brightness / total, 0, 1),
    edgeDensity: clamp(edges / total, 0, 1)
  };
}

function summarizeSamples(samples) {
  const validSamples = samples.filter(isValidSample);
  if (validSamples.length === 0) return defaultAnalysis();

  const totals = validSamples.reduce(
    (accumulator, sample, index) => {
      accumulator.r += sample.r;
      accumulator.g += sample.g;
      accumulator.b += sample.b;
      accumulator.brightness += sample.brightness;
      accumulator.edgeDensity += sample.edgeDensity;

      if (index > 0) {
        accumulator.motion += Math.abs(sample.r - validSamples[index - 1].r) + Math.abs(sample.g - validSamples[index - 1].g) + Math.abs(sample.b - validSamples[index - 1].b);
      }
      return accumulator;
    },
    { r: 0, g: 0, b: 0, brightness: 0, edgeDensity: 0, motion: 0 }
  );

  const count = Math.max(validSamples.length, 1);
  const averageColor = rgbToHex(totals.r / count, totals.g / count, totals.b / count);
  const normalizedMotion = clamp(totals.motion / Math.max(count - 1, 1) / 120, 0.08, 1);
  const edgeDensity = clamp(totals.edgeDensity / count, 0.05, 0.85);
  const brightness = clamp(totals.brightness / count, 0.08, 0.95);
  const densityBonus = clamp(count / 80, 0.12, 1);
  const confidence = clamp(0.24 + edgeDensity * 0.36 + normalizedMotion * 0.2 + densityBonus * 0.2, 0.18, 0.95);
  const coverage = clamp(0.28 + normalizedMotion * 0.38 + densityBonus * 0.34, 0.2, 0.98);

  return {
    frameCount: count,
    nodeCount: state.keyframes.length,
    coverage,
    confidence,
    brightness,
    horizontalMotion: normalizedMotion,
    verticalMotion: edgeDensity,
    edgeDensity,
    averageColor,
    label: brightness > 0.62 ? "estancia luminosa" : "estancia de luz controlada"
  };
}

function isValidSample(sample) {
  return Boolean(sample)
    && Number.isFinite(sample.r)
    && Number.isFinite(sample.g)
    && Number.isFinite(sample.b)
    && Number.isFinite(sample.brightness)
    && Number.isFinite(sample.edgeDensity);
}

function applyPartialAnalysis(samples) {
  const analysis = summarizeSamples(samples);
  state.analysis = analysis;
  elements.coverageMetric.textContent = `${Math.round(analysis.coverage * 100)}%`;
  elements.confidenceMetric.textContent = `${Math.round(analysis.confidence * 100)}%`;
  drawScene();
}

function applyAnalysis(analysis, subtitle) {
  state.analysis = analysis;
  elements.framesMetric.textContent = String(analysis.frameCount);
  elements.coverageMetric.textContent = `${Math.round(analysis.coverage * 100)}%`;
  elements.confidenceMetric.textContent = `${Math.round(analysis.confidence * 100)}%`;
  elements.nodesMetric.textContent = String(state.keyframes.length);
  elements.sceneTitle.textContent = "Tour 3D foto-real generado";
  elements.sceneSubtitle.textContent = `${analysis.label} - ${subtitle}`;
  elements.aiPrompt.value = buildAIPrompt(analysis);
  elements.exportButton.disabled = false;
  elements.aiAnalyzeButton.disabled = false;
  updatePipeline(["load", "frames", "layout", "scene"]);
  updateWorkflow(["capture", "local"], latestCloudUpload ? "ai" : "cloud");
  updateNodeUI();
  syncActivePreview();
  drawScene();
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => safeChannel(value).toString(16).padStart(2, "0")).join("")}`;
}

function appendFramePreview(frame) {
  const preview = document.createElement("canvas");
  preview.width = 192;
  preview.height = 108;
  preview.getContext("2d").drawImage(frame.canvas, 0, 0, preview.width, preview.height);
  preview.title = `Nodo ${frame.index + 1}`;
  preview.addEventListener("click", () => {
    state.currentNode = frame.index;
    drawScene();
    syncActivePreview();
  });
  elements.frameStrip.append(preview);
  updateNodeUI();
  syncActivePreview();
}

function syncActivePreview() {
  Array.from(elements.frameStrip.querySelectorAll("canvas")).forEach((canvas, index) => {
    canvas.classList.toggle("active", index === state.currentNode);
  });
}

function buildAIPrompt(analysis) {
  return [
    "Reconstruir una vivienda desde video para tour 3D hiperrealista.",
    `Frames/keyframes locales usados: ${analysis.frameCount}.`,
    `Color base detectado: ${analysis.averageColor}.`,
    `Luminosidad: ${Math.round(analysis.brightness * 100)}%.`,
    `Cobertura estimada del recorrido: ${Math.round(analysis.coverage * 100)}%.`,
    `Confianza local antes de cloud: ${Math.round(analysis.confidence * 100)}%.`,
    "Objetivo visual: mantener textura, luz y materiales reales del video.",
    "Pipeline cloud recomendado: extraer frames densos con FFmpeg, estimar profundidad por frame, resolver trayectoria de camara, generar Gaussian Splatting o NeRF, limpiar artefactos y publicar visor web."
  ].join("\n");
}

function selectFramesForAI() {
  if (state.keyframes.length === 0) return [];
  const maxFrames = Math.min(8, state.keyframes.length);
  const frames = [];

  for (let index = 0; index < maxFrames; index += 1) {
    const sourceIndex = Math.round((index / Math.max(maxFrames - 1, 1)) * (state.keyframes.length - 1));
    const frame = state.keyframes[sourceIndex];
    frames.push({
      index: frame.index,
      time: frame.time,
      image: frame.canvas.toDataURL("image/jpeg", 0.62)
    });
  }

  return frames;
}

async function analyzeTourWithAI() {
  if (state.keyframes.length === 0) {
    setAiStatus("Crea primero el tour local para extraer keyframes.", true);
    return;
  }

  elements.aiAnalyzeButton.disabled = true;
  elements.gpuJobButton.disabled = true;
  setAiStatus("Enviando keyframes reales a OpenAI Vision...");
  elements.aiResult.innerHTML = "<strong>Analizando frames...</strong><span>La IA esta evaluando materiales, estancia y riesgos de reconstruccion.</span>";

  try {
    const result = await apiRequest("/api/ai-analyze", {
      method: "POST",
      body: JSON.stringify({
        frames: selectFramesForAI(),
        localAnalysis: state.analysis,
        projectContext: {
          target: "hyperrealistic real estate 3D tour",
          reconstruction: "gaussian_splat"
        }
      })
    });

    latestAiAnalysis = result.analysis;
    renderAiResult(result.analysis);
    elements.gpuJobButton.disabled = false;
    updateWorkflow(["capture", "local", ...(latestCloudUpload ? ["cloud"] : []), "ai"], "gpu");
    setAiStatus(`Analisis IA completado con ${result.model}. Listo para job GPU.`);
  } catch (error) {
    setAiStatus(`Fallo en IA: ${error.message}`, true);
    elements.aiResult.innerHTML = `<strong>No se pudo completar la IA</strong><span>${escapeHtml(error.message)}</span>`;
  } finally {
    elements.aiAnalyzeButton.disabled = false;
  }
}

function renderAiResult(analysis) {
  const risks = (analysis.quality?.risks || []).slice(0, 4).map((risk) => `<li>${escapeHtml(risk)}</li>`).join("");
  const steps = (analysis.reconstruction?.steps || []).slice(0, 5).map((step) => `<li>${escapeHtml(step)}</li>`).join("");
  const qualityScore = Number(analysis.quality?.score || 0);
  const qualityPercent = Math.round((qualityScore > 1 ? qualityScore / 10 : qualityScore) * 100);
  elements.aiResult.innerHTML = [
    `<strong>${escapeHtml(analysis.summary || "Analisis IA completado")}</strong>`,
    `<span><b>Estancias:</b> ${escapeHtml((analysis.rooms || []).join(", ") || "sin clasificar")}</span>`,
    `<span><b>Materiales:</b> ${escapeHtml((analysis.materials || []).join(", ") || "pendiente")}</span>`,
    `<span><b>Calidad:</b> ${qualityPercent}% - ${escapeHtml(analysis.quality?.lighting || "")}</span>`,
    risks ? `<span><b>Riesgos:</b></span><ul>${risks}</ul>` : "",
    steps ? `<span><b>Pipeline GPU:</b></span><ul>${steps}</ul>` : "",
    `<span><b>Salida esperada:</b> ${escapeHtml(analysis.reconstruction?.expectedOutput || "Gaussian Splat navegable")}</span>`
  ].filter(Boolean).join("");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;"
  })[character]);
}

async function createGpuJob() {
  if (!latestAiAnalysis) {
    setAiStatus("Ejecuta primero el analisis con IA.", true);
    return;
  }

  elements.gpuJobButton.disabled = true;
  setAiStatus("Creando job de reconstruccion GPU...");
  setGpuConsole({
    stage: "Procesando",
    frames: Number(elements.frameTarget.value),
    manifest: latestCloudUpload ? "Esperando worker" : "Sube el video para manifest real",
    next: "FFmpeg + COLMAP"
  });

  try {
    const result = await apiRequest("/api/start-reconstruction", {
      method: "POST",
      body: JSON.stringify({
        projectId: latestCloudUpload?.projectId,
        source: latestCloudUpload ? {
          bucket: latestCloudUpload.bucket,
          path: latestCloudUpload.path
        } : {
          localOnly: true,
          note: "Video not uploaded yet; upload to Supabase before worker execution."
        },
        requestedFrames: Number(elements.frameTarget.value),
        qualityProfile: "room_fast",
        maxIterations: 700,
        aiAnalysis: latestAiAnalysis
      })
    });

    if (result.runpod?.started) {
      const runpodId = result.runpod.runpod?.id || "running";
      const appJobId = result.job?.row?.id || "";
      const output = result.runpod.runpod?.output || {};
      const stage = output.stage ? ` - ${output.stage}` : "";
      const extracted = output.extractedFrames ? ` - ${output.extractedFrames} frames` : "";

      if (result.runpod.completed) {
        setAiStatus("Worker GPU completado. Primera salida cloud recibida.");
        setGpuConsole({
          stage: output.stage || "COMPLETED",
          frames: output.uploadedFrames || output.extractedFrames || 0,
          manifest: output.manifestPath || "Sin manifest",
          next: output.colmap?.ok
            ? `COLMAP: ${output.colmap.registeredImages} imgs / ${output.colmap.sparsePoints} pts`
            : output.colmap?.stage || output.nextPipeline?.[0] || "COLMAP + Splatfacto"
        });
        updateWorkflow(["capture", "local", ...(latestCloudUpload ? ["cloud"] : []), "ai", "gpu"], "splat");
        elements.aiResult.innerHTML += [
          `<span><b>RunPod job:</b> ${escapeHtml(runpodId)}</span>`,
          `<span id="runpodStatusLine"><b>Estado:</b> COMPLETED${escapeHtml(stage + extracted)}</span>`,
          output.uploadedFrames ? `<span><b>Frames en Supabase:</b> ${escapeHtml(output.uploadedFrames)}</span>` : "",
          output.colmap?.ok ? `<span><b>COLMAP:</b> ${escapeHtml(`${output.colmap.registeredImages} imagenes registradas, ${output.colmap.sparsePoints} puntos sparse`)}</span>` : "",
          output.colmap && !output.colmap.ok ? `<span><b>COLMAP:</b> ${escapeHtml(output.colmap.message || output.colmap.stage)}</span>` : "",
          output.manifestPath ? `<span><b>Manifest:</b> ${escapeHtml(output.manifestPath)}</span>` : "",
          output.message ? `<span><b>Worker:</b> ${escapeHtml(output.message)}</span>` : "",
          output.nextPipeline?.length ? `<span><b>Siguiente:</b> ${escapeHtml(output.nextPipeline[0])}</span>` : ""
        ].filter(Boolean).join("");
      } else {
        setAiStatus(`Job GPU iniciado en RunPod: ${runpodId}`);
        setGpuConsole({ stage: "IN_QUEUE", frames: Number(elements.frameTarget.value), manifest: "Pendiente", next: "Worker RunPod" });
        elements.aiResult.innerHTML += `<span><b>RunPod job:</b> ${escapeHtml(runpodId)}</span><span id="runpodStatusLine"><b>Estado:</b> IN_QUEUE</span>`;
        pollRunpodStatus(runpodId, appJobId, 0, result.runpod.provider === "runpod_splatfacto" ? "splat" : "default");
      }
    } else {
      setAiStatus("Job GPU creado en Supabase. Falta configurar RUNPOD_ENDPOINT_ID para ejecutarlo automaticamente.");
    }
  } catch (error) {
    setAiStatus(`No se pudo crear job GPU: ${error.message}`, true);
  } finally {
    elements.gpuJobButton.disabled = false;
  }
}

async function pollRunpodStatus(runpodJobId, appJobId, attempt, endpointKind = "default") {
  if (!runpodJobId || runpodJobId === "running") return;
  if (latestRunpodPoll) window.clearTimeout(latestRunpodPoll);

  latestRunpodPoll = window.setTimeout(async () => {
    try {
      const query = new URLSearchParams({
        runpodJobId,
        endpoint: endpointKind,
        ...(appJobId ? { jobId: appJobId } : {})
      });
      const result = await apiRequest(`/api/runpod-status?${query.toString()}`);
      const line = document.querySelector("#runpodStatusLine");
      const statusText = result.status || "UNKNOWN";
      const stage = result.runpod?.output?.stage ? ` - ${result.runpod.output.stage}` : "";
      const extracted = result.runpod?.output?.extractedFrames ? ` - ${result.runpod.output.extractedFrames} frames` : "";
      const uploaded = result.runpod?.output?.uploadedFrames ? ` - ${result.runpod.output.uploadedFrames} subidos` : "";

      if (line) line.innerHTML = `<b>Estado:</b> ${escapeHtml(statusText + stage + extracted + uploaded)}`;
      setGpuConsole({
        stage: result.runpod?.output?.stage || statusText,
        frames: result.runpod?.output?.uploadedFrames || result.runpod?.output?.extractedFrames || elements.frameTarget.value,
        manifest: result.runpod?.output?.manifestPath || "Pendiente",
        next: result.runpod?.output?.colmap?.ok
          ? `COLMAP: ${result.runpod.output.colmap.registeredImages} imgs / ${result.runpod.output.colmap.sparsePoints} pts`
          : result.runpod?.output?.colmap?.stage || result.runpod?.output?.nextPipeline?.[0] || "Worker RunPod"
      });

      if (statusText === "COMPLETED") {
        updateWorkflow(["capture", "local", ...(latestCloudUpload ? ["cloud"] : []), "ai", "gpu"], "splat");
        setAiStatus("Worker GPU completado. Ya tenemos la primera salida real del pipeline.");
        return;
      }

      if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(statusText)) {
        const message = result.runpod?.error || result.runpod?.output?.message || "RunPod no pudo completar el job.";
        setAiStatus(`Worker GPU detenido: ${message}`, true);
        return;
      }

      if (attempt < 240) pollRunpodStatus(runpodJobId, appJobId, attempt + 1, endpointKind);
    } catch (error) {
      if (attempt < 4) {
        pollRunpodStatus(runpodJobId, appJobId, attempt + 1, endpointKind);
      } else {
        setAiStatus(`No pude consultar RunPod: ${error.message}`, true);
      }
    }
  }, attempt === 0 ? 2500 : 5000);
}

function runDemoAnalysis() {
  resetTourState(false);
  state.currentNode = 0;
  const samples = [];
  const total = Number(elements.frameTarget.value);
  const width = Number(elements.analysisSize.value);
  const height = Math.round(width * 9 / 16);

  for (let index = 0; index < total; index += 1) {
    const sample = {
      r: Math.round(150 + Math.sin(index * 0.27) * 34),
      g: Math.round(154 + Math.cos(index * 0.18) * 28),
      b: Math.round(135 + Math.sin(index * 0.12) * 22),
      brightness: clamp(0.58 + Math.sin(index * 0.2) * 0.14, 0.28, 0.9),
      edgeDensity: clamp(0.35 + Math.cos(index * 0.19) * 0.18, 0.08, 0.78)
    };
    const canvas = createDemoCanvas(width, height, sample, index);
    const frame = {
      canvas,
      sample,
      index,
      time: index,
      progress: total <= 1 ? 0 : index / (total - 1)
    };
    samples.push(sample);
    state.keyframes.push(frame);
    appendFramePreview(frame);
  }

  applyAnalysis(summarizeSamples(samples), "simulacion local con textura");
  setStatus("Demo generado. Para un resultado real, sube un video de la vivienda.");
}

function createDemoCanvas(width, height, sample, index) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, rgbToHex(sample.r, sample.g, sample.b));
  gradient.addColorStop(1, adjustColor(rgbToHex(sample.r, sample.g, sample.b), -46));
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  context.fillStyle = "rgba(255,255,255,0.18)";
  context.fillRect(width * 0.12 + index % 8, height * 0.12, width * 0.32, height * 0.42);
  context.fillStyle = "rgba(0,0,0,0.22)";
  context.fillRect(width * 0.48, height * 0.46 - (index % 6), width * 0.32, height * 0.26);
  context.fillStyle = "rgba(229,195,106,0.34)";
  context.fillRect(width * 0.2, height * 0.74, width * 0.58, height * 0.09);
  return canvas;
}

function exportBriefing() {
  const analysis = state.analysis || defaultAnalysis();
  const payload = {
    project: "360 Inmobiliario",
    createdAt: new Date().toISOString(),
    source: state.videoFile ? state.videoFile.name : "demo-local",
    analysis,
    keyframes: state.keyframes.map((frame) => ({
      index: frame.index,
      time: Number(frame.time.toFixed ? frame.time.toFixed(2) : frame.time),
      progress: Number(frame.progress.toFixed(3)),
      brightness: Number(frame.sample.brightness.toFixed(3)),
      edgeDensity: Number(frame.sample.edgeDensity.toFixed(3))
    })),
    aiPrompt: elements.aiPrompt.value,
    recommendedPipeline: [
      "Subida segura del video",
      "Extraccion densa de frames con FFmpeg",
      "Estimacion de profundidad en cloud",
      "Reconstruccion con Gaussian Splatting o NeRF",
      "Revision manual, limpieza de artefactos y publicacion"
    ]
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "briefing-tour-3d.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

function moveNode(delta) {
  if (state.keyframes.length === 0) return;
  state.currentNode = clamp(state.currentNode + delta, 0, state.keyframes.length - 1);
  syncActivePreview();
  drawScene();
}

function requestNodeMove(delta) {
  const now = Date.now();
  if (now - state.lastNodeMoveAt < 120) return;
  state.lastNodeMoveAt = now;
  moveNode(delta);
}

window.tourMoveNode = requestNodeMove;
window.tourSetNode = (index) => {
  if (state.keyframes.length === 0) return;
  state.currentNode = clamp(index, 0, state.keyframes.length - 1);
  syncActivePreview();
  drawScene();
};

function updateNodeUI() {
  const total = state.keyframes.length;
  elements.nodeLabel.textContent = total > 0 ? `Nodo ${state.currentNode + 1}/${total}` : "Nodo 0/0";
  elements.prevNodeButton.disabled = total === 0 || state.currentNode === 0;
  elements.nextNodeButton.disabled = total === 0 || state.currentNode === total - 1;
}

function setMode(mode) {
  state.mode = mode;
  elements.modeButtons.forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  drawScene();
}

function resetTourState(clearVideo = true) {
  state.analysis = null;
  state.keyframes = [];
  state.currentNode = 0;
  if (clearVideo) {
    state.videoFile = null;
    elements.input.value = "";
    if (elements.video.src) URL.revokeObjectURL(elements.video.src);
    elements.video.removeAttribute("src");
  }
  elements.frameStrip.innerHTML = "";
  elements.framesMetric.textContent = "0";
  elements.coverageMetric.textContent = "0%";
  elements.confidenceMetric.textContent = "0%";
  elements.nodesMetric.textContent = "0";
  elements.exportButton.disabled = true;
  elements.cloudUploadButton.disabled = clearVideo || !state.videoFile;
  elements.aiAnalyzeButton.disabled = true;
  elements.gpuJobButton.disabled = true;
  latestAiAnalysis = null;
  if (latestRunpodPoll) window.clearTimeout(latestRunpodPoll);
  latestRunpodPoll = null;
  if (clearVideo) latestCloudUpload = null;
  elements.aiResult.innerHTML = "<strong>Esperando analisis visual</strong><span>OpenAI evaluara estancia, materiales, calidad y pipeline recomendado.</span>";
  setAiStatus("Crea primero un tour local para enviar keyframes a IA.");
  elements.cloudProgress.value = 0;
  elements.sceneTitle.textContent = "Vista 3D foto-real";
  elements.sceneSubtitle.textContent = "Esperando video";
  elements.aiPrompt.value = "";
  setGpuConsole();
  updateWorkflow([], "capture");
  updatePipeline([]);
  drawScene();
}

function animate(timestamp = 0) {
  requestAnimationFrame(animate);
  if (timestamp - state.lastFrameAt < 50) return;
  state.lastFrameAt = timestamp;
  if (state.keyframes.length === 0 && state.mode === "dollhouse") {
    state.rotation += 0.006;
    drawScene();
  }
}

elements.frameTarget.addEventListener("input", () => updateFrameTarget(elements.frameTarget.value));
elements.presetButtons.forEach((button) => {
  button.addEventListener("click", () => updateFrameTarget(button.dataset.frames));
});

elements.chooseVideoButton.addEventListener("click", (event) => {
  event.stopPropagation();
  elements.input.click();
});

elements.uploadZone.addEventListener("click", (event) => {
  if (event.target === elements.input || event.target.closest("button")) return;
  elements.input.click();
});

elements.uploadZone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    elements.input.click();
  }
});

["dragenter", "dragover"].forEach((eventName) => {
  elements.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.add("dragging");
  });
});

["dragleave", "drop"].forEach((eventName) => {
  elements.uploadZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    elements.uploadZone.classList.remove("dragging");
  });
});

elements.uploadZone.addEventListener("drop", (event) => {
  const [file] = event.dataTransfer.files;
  if (file) loadVideoFile(file);
});

elements.input.addEventListener("change", () => {
  const [file] = elements.input.files;
  if (file) loadVideoFile(file);
});

elements.analyzeButton.addEventListener("click", analyzeVideo);
elements.demoButton.addEventListener("click", runDemoAnalysis);
elements.exportButton.addEventListener("click", exportBriefing);
elements.bootstrapButton.addEventListener("click", bootstrapSupabase);
elements.schemaCheckButton.addEventListener("click", checkSchema);
elements.cloudUploadButton.addEventListener("click", uploadVideoToCloud);
elements.aiAnalyzeButton.addEventListener("click", analyzeTourWithAI);
elements.gpuJobButton.addEventListener("click", createGpuJob);
["pointerdown", "mousedown", "click"].forEach((eventName) => {
  elements.prevNodeButton.addEventListener(eventName, () => requestNodeMove(-1));
  elements.nextNodeButton.addEventListener(eventName, () => requestNodeMove(1));
});
elements.prevNodeButton.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") requestNodeMove(-1);
});
elements.nextNodeButton.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") requestNodeMove(1);
});
elements.resetButton.addEventListener("click", () => {
  resetTourState(true);
  elements.analyzeButton.disabled = true;
  setStatus("MP4, MOV o WebM. Ideal: recorrido lento y buena luz.");
});

elements.modeButtons.forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode));
});

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowLeft") requestNodeMove(-1);
  if (event.key === "ArrowRight") requestNodeMove(1);
});

window.addEventListener("resize", drawScene);
updateFrameTarget(elements.frameTarget.value);
updatePipeline([]);
setGpuConsole();
updateWorkflow([], "capture");
setMode("dollhouse");
refreshCloudHealth();
animate();
