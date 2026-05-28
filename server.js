import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const portArgIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portArgIndex + 1]) || Number(process.env.PORT) || 5173;
const buckets = ["raw-videos", "frames", "reconstructions", "exports"];

loadLocalEnv();

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

function loadLocalEnv() {
  const envPath = join(root, ".env.local");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function config() {
  return {
    supabaseUrl: process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "",
    anonKey: process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    runpodConfigured: Boolean(process.env.RUNPOD_API_KEY),
    runpodEndpointConfigured: Boolean(process.env.RUNPOD_ENDPOINT_ID),
    runpodSplatEndpointConfigured: Boolean(process.env.RUNPOD_SPLAT_ENDPOINT_ID),
    runpodUseSplatWorker: process.env.RUNPOD_USE_SPLAT_WORKER === "true"
  };
}

function hasSupabaseAdmin() {
  const current = config();
  return Boolean(current.supabaseUrl && current.serviceRoleKey);
}

function publicConfig() {
  const current = config();
  return {
    supabaseConfigured: hasSupabaseAdmin(),
    supabaseUrl: current.supabaseUrl,
    anonConfigured: Boolean(current.anonKey),
    openaiConfigured: current.openaiConfigured,
    runpodConfigured: current.runpodConfigured,
    runpodEndpointConfigured: current.runpodEndpointConfigured,
    runpodSplatEndpointConfigured: current.runpodSplatEndpointConfigured,
    runpodUseSplatWorker: current.runpodUseSplatWorker
  };
}

function resolveRequestPath(url) {
  const safePath = normalize(decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(root, safePath === "/" ? "index.html" : safePath);
  if (!candidate.startsWith(root)) return null;
  if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  return join(root, "index.html");
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 18 * 1024 * 1024) {
        reject(new Error("Request too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function safeName(value) {
  return String(value || "video").replace(/[^a-z0-9._-]+/gi, "-").replace(/-+/g, "-").slice(0, 96);
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function encodeStoragePath(path) {
  return String(path).split("/").map((part) => encodeURIComponent(part)).join("/");
}

async function supabaseFetch(area, path, options = {}) {
  const current = config();
  if (!hasSupabaseAdmin()) throw new Error("Supabase admin credentials are not configured.");

  const base = area === "storage" ? `${current.supabaseUrl}/storage/v1` : `${current.supabaseUrl}/rest/v1`;
  const headers = {
    apikey: current.serviceRoleKey,
    Authorization: `Bearer ${current.serviceRoleKey}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {})
  };
  const result = await fetch(`${base}${path}`, { ...options, headers });
  const text = await result.text();
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!result.ok) {
    const message = typeof data === "object" && data?.message ? data.message : `Supabase request failed: ${result.status}`;
    const error = new Error(message);
    error.status = result.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function ensureBuckets() {
  const results = [];
  for (const bucket of buckets) {
    try {
      await supabaseFetch("storage", `/bucket/${encodeURIComponent(bucket)}`);
      results.push({ bucket, status: "exists" });
      continue;
    } catch {
      // Missing buckets are created below.
    }

    try {
      await supabaseFetch("storage", "/bucket", {
        method: "POST",
        body: JSON.stringify({
          id: bucket,
          name: bucket,
          public: false
        })
      });
      results.push({ bucket, status: "created" });
    } catch (error) {
      results.push({ bucket, status: "error", message: error.message, detail: error.data || null });
    }
  }
  return results;
}

async function createSignedDownloadUrl(bucket, path, expiresIn = 7200) {
  const signed = await supabaseFetch("storage", `/object/sign/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`, {
    method: "POST",
    body: JSON.stringify({ expiresIn })
  });
  const rawSignedUrl = signed?.signedURL || signed?.signedUrl || signed?.url || null;
  if (!rawSignedUrl) return null;
  return rawSignedUrl.startsWith("/")
    ? `${config().supabaseUrl}/storage/v1${rawSignedUrl}`
    : rawSignedUrl;
}

async function createSignedUploadUrl(bucket, path, expiresIn = 7200) {
  const signed = await supabaseFetch("storage", `/object/upload/sign/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}`, {
    method: "POST",
    body: JSON.stringify({ expiresIn })
  });
  const rawSignedUrl = signed?.signedURL || signed?.signedUrl || signed?.url || null;
  if (rawSignedUrl) {
    return rawSignedUrl.startsWith("/")
      ? `${config().supabaseUrl}/storage/v1${rawSignedUrl}`
      : rawSignedUrl;
  }
  if (signed?.token) {
    return `${config().supabaseUrl}/storage/v1/object/upload/sign/${encodeURIComponent(bucket)}/${encodeStoragePath(path)}?token=${encodeURIComponent(signed.token)}`;
  }
  return null;
}

async function createFrameUploadTargets(projectId, requestedFrames, reconstructionId) {
  const frameTargets = [];
  const frameCount = Math.max(1, Math.min(Number(requestedFrames) || 48, 160));
  const basePath = `${projectId}/${reconstructionId}`;

  for (let index = 1; index <= frameCount; index += 1) {
    const frameName = `frame_${String(index).padStart(5, "0")}.jpg`;
    const path = `${basePath}/frames/${frameName}`;
    frameTargets.push({
      path,
      signedUrl: await createSignedUploadUrl("frames", path)
    });
  }

  const manifestPath = `${basePath}/reconstruction_manifest.json`;
  const colmapFiles = ["database.db", "cameras.txt", "images.txt", "points3D.txt", "colmap_summary.json"];
  const splatFiles = ["scene.ply", "scene.splat", "scene.ksplat"];
  return {
    reconstructionId,
    frames: frameTargets,
    manifest: {
      path: manifestPath,
      signedUrl: await createSignedUploadUrl("reconstructions", manifestPath)
    },
    colmap: await Promise.all(colmapFiles.map(async (fileName) => ({
      name: fileName,
      path: `${basePath}/colmap/${fileName}`,
      signedUrl: await createSignedUploadUrl("reconstructions", `${basePath}/colmap/${fileName}`)
    }))),
    splat: await Promise.all(splatFiles.map(async (fileName) => ({
      name: fileName,
      path: `${basePath}/splat/${fileName}`,
      signedUrl: await createSignedUploadUrl("reconstructions", `${basePath}/splat/${fileName}`)
    }))),
    splatSummary: {
      path: `${basePath}/splat/splat_summary.json`,
      signedUrl: await createSignedUploadUrl("reconstructions", `${basePath}/splat/splat_summary.json`)
    }
  };
}

function redactGpuInput(input) {
  return {
    ...input,
    source: {
      ...(input.source || {}),
      signedVideoUrl: input.source?.signedVideoUrl ? "[signed-url-redacted]" : null
    },
    uploadTargets: input.uploadTargets
      ? {
          reconstructionId: input.uploadTargets.reconstructionId || null,
          frames: (input.uploadTargets.frames || []).map((target) => ({ path: target.path })),
          manifest: input.uploadTargets.manifest ? { path: input.uploadTargets.manifest.path } : null,
          colmap: (input.uploadTargets.colmap || []).map((target) => ({ name: target.name, path: target.path })),
          splat: (input.uploadTargets.splat || []).map((target) => ({ name: target.name, path: target.path })),
          splatSummary: input.uploadTargets.splatSummary ? { path: input.uploadTargets.splatSummary.path } : null
        }
      : null
  };
}

async function tryInsert(table, payload) {
  try {
    const result = await supabaseFetch("rest", `/${table}`, {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(payload)
    });
    return { ok: true, row: Array.isArray(result) ? result[0] : result };
  } catch (error) {
    return { ok: false, message: error.message, status: error.status, data: error.data };
  }
}

function extractOutputText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const texts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) texts.push(content.text);
    }
  }
  return texts.join("\n");
}

function parseJsonText(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("OpenAI did not return valid JSON.");
    return JSON.parse(match[0]);
  }
}

async function analyzeWithOpenAI(payload) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured.");

  const frames = Array.isArray(payload.frames) ? payload.frames.slice(0, 8) : [];
  if (frames.length === 0) throw new Error("No frames were provided for AI analysis.");

  const content = [
    {
      type: "input_text",
      text: [
        "Analiza estos keyframes de un video inmobiliario para preparar una reconstruccion 3D hiperrealista.",
        "Devuelve SOLO JSON valido. No uses markdown.",
        "Evalua calidad visual, estancia, materiales, geometria probable, riesgos de reconstruccion y pasos cloud necesarios.",
        `Analisis local previo: ${JSON.stringify(payload.localAnalysis || {})}`
      ].join("\n")
    },
    ...frames.map((frame) => ({
      type: "input_image",
      image_url: frame.image,
      detail: "low"
    }))
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "tour_ai_analysis",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary", "rooms", "materials", "quality", "reconstruction", "captureAdvice", "commercialDescription"],
            properties: {
              summary: { type: "string" },
              rooms: {
                type: "array",
                items: { type: "string" }
              },
              materials: {
                type: "array",
                items: { type: "string" }
              },
              quality: {
                type: "object",
                additionalProperties: false,
                required: ["score", "lighting", "sharpness", "coverage", "risks"],
                properties: {
                  score: { type: "number" },
                  lighting: { type: "string" },
                  sharpness: { type: "string" },
                  coverage: { type: "string" },
                  risks: {
                    type: "array",
                    items: { type: "string" }
                  }
                }
              },
              reconstruction: {
                type: "object",
                additionalProperties: false,
                required: ["recommendedMethod", "estimatedGpuClass", "steps", "expectedOutput"],
                properties: {
                  recommendedMethod: { type: "string" },
                  estimatedGpuClass: { type: "string" },
                  steps: {
                    type: "array",
                    items: { type: "string" }
                  },
                  expectedOutput: { type: "string" }
                }
              },
              captureAdvice: {
                type: "array",
                items: { type: "string" }
              },
              commercialDescription: { type: "string" }
            }
          }
        }
      }
    })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI request failed: ${response.status}`);
  }

  return parseJsonText(extractOutputText(data));
}

async function startRunPodJob(input) {
  if (!process.env.RUNPOD_API_KEY) {
    return {
      started: false,
      reason: "RUNPOD_API_KEY is not configured yet.",
      provider: "runpod"
    };
  }

  if (process.env.RUNPOD_USE_SPLAT_WORKER === "true" && process.env.RUNPOD_SPLAT_ENDPOINT_ID) {
    return startRunPodEndpointJob(input, process.env.RUNPOD_SPLAT_ENDPOINT_ID, "runpod_splatfacto");
  }

  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  if (!endpointId) {
    return {
      started: false,
      reason: "RUNPOD_ENDPOINT_ID is not configured yet.",
      provider: "runpod"
    };
  }

  if (process.env.RUNPOD_FLASH_LIVE !== "false") {
    return startFlashLiveJob(input);
  }

  return startRunPodEndpointJob(input, endpointId, "runpod");
}

async function startRunPodEndpointJob(input, endpointId, provider) {
  const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/run`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ input })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || `RunPod request failed: ${response.status}`);
  return { started: true, provider, endpointId, runpod: data };
}

function startFlashLiveJob(input) {
  return new Promise((resolve, reject) => {
    const workerDir = join(root, "runpod-worker");
    const helperPath = join(workerDir, "run_flash_reconstruction.py");
    const child = spawn("python", [helperPath], {
      cwd: workerDir,
      env: {
        ...process.env,
        PYTHONPATH: join(workerDir, ".deps")
      },
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      const jsonLine = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
      let parsed = null;
      try {
        parsed = jsonLine ? JSON.parse(jsonLine) : null;
      } catch {
        // Parsed below as a regular error.
      }

      if (code !== 0 || !parsed?.ok) {
        reject(new Error(parsed?.message || stderr.trim() || `Flash worker failed with exit code ${code}`));
        return;
      }

      resolve({
        started: true,
        completed: true,
        provider: "runpod_flash_live",
        runpod: {
          id: "flash-live-sync",
          status: "COMPLETED",
          output: parsed.result,
          logs: compactWorkerLogs(stderr)
        }
      });
    });

    child.stdin.end(JSON.stringify(input));
  });
}

function compactWorkerLogs(logs) {
  const lines = String(logs || "").split(/\r?\n/).filter(Boolean);
  return lines.slice(-12);
}

async function getRunPodStatus(runpodJobId, endpointKind = "default") {
  const endpointId = endpointKind === "splat" ? process.env.RUNPOD_SPLAT_ENDPOINT_ID : process.env.RUNPOD_ENDPOINT_ID;
  if (!process.env.RUNPOD_API_KEY || !endpointId) {
    return {
      ok: false,
      reason: "RUNPOD_ENDPOINT_ID is not configured yet.",
      provider: "runpod"
    };
  }

  if (!runpodJobId) {
    return {
      ok: false,
      reason: "Missing RunPod job id.",
      provider: "runpod"
    };
  }

  const response = await fetch(`https://api.runpod.ai/v2/${endpointId}/status/${encodeURIComponent(runpodJobId)}`, {
    headers: {
      Authorization: `Bearer ${process.env.RUNPOD_API_KEY}`
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || `RunPod status failed: ${response.status}`);
  return { ok: true, provider: "runpod", runpod: data };
}

async function tryUpdateJob(jobId, patch) {
  if (!jobId) return { ok: false, message: "Missing job id" };

  try {
    const result = await supabaseFetch("rest", `/jobs?id=eq.${encodeURIComponent(jobId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        ...patch,
        updated_at: new Date().toISOString()
      })
    });
    return { ok: true, row: Array.isArray(result) ? result[0] : result };
  } catch (error) {
    return { ok: false, message: error.message, status: error.status, data: error.data };
  }
}

async function handleApi(request, response, pathname) {
  try {
    if (pathname === "/api/health" && request.method === "GET") {
      sendJson(response, 200, publicConfig());
      return true;
    }

    if (pathname === "/api/bootstrap" && request.method === "POST") {
      if (!hasSupabaseAdmin()) {
        sendJson(response, 400, { ok: false, message: "Supabase admin credentials are not configured." });
        return true;
      }

      const bucketResults = await ensureBuckets();
      sendJson(response, 200, {
        ok: true,
        buckets: bucketResults,
        schemaRequired: true,
        schemaFile: "supabase_schema.sql"
      });
      return true;
    }

    if (pathname === "/api/schema-check" && request.method === "GET") {
      const tables = ["projects", "assets", "jobs", "job_events", "tour_nodes"];
      const checks = [];

      for (const table of tables) {
        try {
          await supabaseFetch("rest", `/${table}?select=*&limit=1`);
          checks.push({ table, ok: true });
        } catch (error) {
          checks.push({ table, ok: false, message: error.message, status: error.status });
        }
      }

      sendJson(response, 200, {
        ok: checks.every((check) => check.ok),
        checks
      });
      return true;
    }

    if (pathname === "/api/ai-analyze" && request.method === "POST") {
      const payload = await readJson(request);
      const analysis = await analyzeWithOpenAI(payload);
      sendJson(response, 200, {
        ok: true,
        analysis,
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini"
      });
      return true;
    }

    if (pathname === "/api/upload-url" && request.method === "POST") {
      const payload = await readJson(request);
      const projectId = payload.projectId || makeId("project");
      const uploadId = makeId("upload");
      const fileName = safeName(payload.fileName);
      const contentType = payload.contentType || "video/mp4";
      const objectPath = `${projectId}/${uploadId}-${fileName}`;
      const signed = await supabaseFetch("storage", `/object/upload/sign/raw-videos/${encodeStoragePath(objectPath)}`, {
        method: "POST",
        body: JSON.stringify({ expiresIn: 7200 })
      });
      const rawSignedUrl = signed?.signedURL || signed?.url || signed?.signedUrl || null;
      const signedUrl = rawSignedUrl
        ? rawSignedUrl.startsWith("/")
          ? `${config().supabaseUrl}/storage/v1${rawSignedUrl}`
          : rawSignedUrl
        : signed?.token
          ? `${config().supabaseUrl}/storage/v1/object/upload/sign/raw-videos/${encodeStoragePath(objectPath)}?token=${encodeURIComponent(signed.token)}`
          : null;

      sendJson(response, 200, {
        ok: true,
        projectId,
        uploadId,
        bucket: "raw-videos",
        path: objectPath,
        contentType,
        signedUrl,
        token: signed?.token || null,
        raw: signed
      });
      return true;
    }

    if (pathname === "/api/finalize-upload" && request.method === "POST") {
      const payload = await readJson(request);
      const projectId = payload.projectId || makeId("project");
      const now = new Date().toISOString();

      const project = await tryInsert("projects", {
        id: projectId,
        name: payload.projectName || payload.fileName || "Vivienda sin titulo",
        status: "uploaded",
        created_at: now,
        updated_at: now
      });
      const asset = await tryInsert("assets", {
        id: payload.uploadId || makeId("asset"),
        project_id: projectId,
        kind: "raw_video",
        bucket: payload.bucket || "raw-videos",
        path: payload.path,
        content_type: payload.contentType || "video/mp4",
        size_bytes: payload.size || 0,
        metadata: payload.metadata || {},
        created_at: now
      });
      const job = await tryInsert("jobs", {
        id: makeId("job"),
        project_id: projectId,
        type: "reconstruct_tour",
        status: "queued",
        input: {
          bucket: payload.bucket || "raw-videos",
          path: payload.path,
          requestedFrames: payload.requestedFrames || 48,
          target: "gaussian_splat"
        },
        output: {},
        created_at: now,
        updated_at: now
      });

      sendJson(response, 200, {
        ok: true,
        projectId,
        databaseReady: project.ok && asset.ok && job.ok,
        project,
        asset,
        job,
        nextStep: "worker_gpu"
      });
      return true;
    }

    if (pathname === "/api/start-reconstruction" && request.method === "POST") {
      const payload = await readJson(request);
      const now = new Date().toISOString();
      const projectId = payload.projectId || makeId("project");
      const requestedFrames = payload.requestedFrames || 96;
      const reconstructionId = makeId("recon");
      let signedVideoUrl = null;
      if (payload.source?.bucket && payload.source?.path) {
        signedVideoUrl = await createSignedDownloadUrl(payload.source.bucket, payload.source.path);
      }
      const uploadTargets = signedVideoUrl ? await createFrameUploadTargets(projectId, requestedFrames, reconstructionId) : null;
      await tryInsert("projects", {
        id: projectId,
        name: payload.projectName || "Reconstruccion IA sin titulo",
        status: "gpu_requested",
        metadata: {
          source: payload.source || {},
          createdFrom: "ai_reconstruction_panel"
        },
        created_at: now,
        updated_at: now
      });
      const gpuInput = {
        projectId,
        reconstructionId,
        source: {
          ...(payload.source || {}),
          signedVideoUrl
        },
        aiAnalysis: payload.aiAnalysis || null,
        requestedFrames,
        qualityProfile: payload.qualityProfile || "room_fast",
        maxIterations: payload.maxIterations || 700,
        target: "gaussian_splat",
        outputBuckets: {
          frames: "frames",
          reconstructions: "reconstructions",
          exports: "exports"
        },
        uploadTargets
      };
      const runpod = await startRunPodJob(gpuInput);
      const workerOutput = runpod.runpod?.output || {};
      const jobStatus = runpod.completed
        ? workerOutput.ok === false
          ? "completed_with_warning"
          : "completed"
        : runpod.started
          ? "running"
          : "queued_worker_pending";
      const job = await tryInsert("jobs", {
        id: makeId("job"),
        project_id: projectId,
        type: "gpu_reconstruct_gaussian_splat",
        status: jobStatus,
        input: redactGpuInput(gpuInput),
        output: runpod,
        created_at: now,
        updated_at: now
      });

      sendJson(response, 200, {
        ok: true,
        projectId,
        job,
        runpod
      });
      return true;
    }

    if (pathname === "/api/runpod-status" && request.method === "GET") {
      const url = new URL(request.url, `http://localhost:${port}`);
      const runpodJobId = url.searchParams.get("runpodJobId");
      const appJobId = url.searchParams.get("jobId");
      const endpointKind = url.searchParams.get("endpoint") || "default";
      const status = await getRunPodStatus(runpodJobId, endpointKind);
      const runpodStatus = status.runpod?.status || "UNKNOWN";
      let appStatus = "running";

      if (["COMPLETED"].includes(runpodStatus)) appStatus = "completed";
      if (["FAILED", "CANCELLED", "TIMED_OUT"].includes(runpodStatus)) appStatus = "failed";

      const update = appJobId
        ? await tryUpdateJob(appJobId, {
            status: appStatus,
            output: status
          })
        : null;

      sendJson(response, 200, {
        ok: true,
        status: runpodStatus,
        appStatus,
        runpod: status.runpod,
        job: update
      });
      return true;
    }

    if (pathname.startsWith("/api/")) {
      sendJson(response, 404, { ok: false, message: "API route not found." });
      return true;
    }
  } catch (error) {
    sendJson(response, error.status || 500, { ok: false, message: error.message, data: error.data || null });
    return true;
  }

  return false;
}

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${port}`);
  if (await handleApi(request, response, url.pathname)) return;

  const filePath = resolveRequestPath(request.url);

  if (!filePath || !existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath)] || "application/octet-stream",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cache-Control": "no-store"
  });
  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`Tour 3D app running at http://localhost:${port}`);
});
