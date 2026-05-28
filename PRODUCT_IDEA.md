# 360 Inmobiliario

## Vision

Crear una aplicacion que reciba un video de una vivienda y lo convierta en un tour 3D publicable para venta o alquiler. El valor diferencial esta en reducir el trabajo manual: grabar con movil, subir, revisar, editar y publicar.

## MVP actual

1. Subida de video de una estancia.
2. Extraccion configurable de keyframes en navegador: 10, 48, 96 o hasta 120 frames.
3. Analisis visual basico: color dominante, luminosidad, movimiento, densidad de bordes y cobertura.
4. Primera version de tour 3D foto-real ligero: usa frames reales como textura visual, crea nodos navegables y vista de plano.
5. Brief automatico para IA generativa/cloud, listo para enviar a un pipeline de reconstruccion o texturizado.
6. Backend cloud conectado: Supabase guarda video, jobs, frames y manifiestos.
7. Worker RunPod Flash v0.3: descarga el video privado con URL firmada, extrae frames con FFmpeg en GPU cloud, sube frames al bucket `frames`, ejecuta COLMAP sparse reconstruction y crea un manifiesto en `reconstructions`.
8. Worker RunPod Splatfacto preparado: imagen Docker propia para RunPod `ADA_24`/RTX 4090, con `torch`, `nerfstudio` y `gsplat` fijados y `gsplat` compilado durante el build.

## Arquitectura recomendada

- Frontend: visor web ligero, subida de video, timeline de frames y editor de escena. En PCs sin GPU, el visor debe servir para revisar y publicar, no para reconstruir.
- Backend fase 1: almacenamiento de videos, cola de procesamiento y resultados por inmueble.
- Procesamiento fase 2: FFmpeg para frames, Depth Anything / ZoeDepth para mapas de profundidad, COLMAP o SLAM para camara, y Gaussian Splatting o NeRF para reconstruccion.
- IA generativa: GPT para clasificar estancias, describir materiales, detectar inconsistencias y proponer prompts de recreacion.
- Exportacion: enlace web, iframe para inmobiliarias, capturas, video renderizado y posiblemente GLB/USDZ.

## Estrategia para PC sin grafica

El PC local no deberia ejecutar modelos pesados. La mejor opcion coste/calidad es un sistema hibrido:

1. Analisis local barato: previsualizacion, extraccion ligera de frames, validacion de calidad del video y generacion de brief.
2. Procesamiento cloud bajo demanda: solo se paga cuando el usuario confirma que quiere generar el tour.
3. Cola asincrona: el usuario sube video, la app muestra estado y recibe el resultado cuando termina.
4. Cache por inmueble: no recalcular si se cambia solo el texto, portada o puntos de navegacion.

Opciones de coste:

- MVP economico: usar APIs de vision para clasificar frames y generar un modelo procedural aproximado. Coste bajo, calidad suficiente para validar negocio.
- Calidad media: depth estimation + camara + nube de puntos en GPU cloud puntual. Mejor resultado, coste controlado por minutos de GPU.
- Calidad alta: Gaussian Splatting/NeRF en servicio especializado. Mayor coste, pero tour mas realista.

## Riesgos tecnicos

- Un unico video puede no cubrir toda la vivienda.
- Los reflejos, pasillos estrechos y cambios bruscos de luz reducen calidad.
- La reconstruccion precisa necesita estimacion de camara y profundidad, no solo analisis de frames.
- Para uso comercial habra que ofrecer revision humana o herramientas de correccion.

## Siguiente salto

El siguiente hito ya no es la subida, extraccion de frames ni COLMAP sparse; eso queda dentro del worker v0.3. El salto pendiente para hiperrealismo es desplegar el worker Docker Splatfacto en RunPod y probar con un video real de habitacion:

1. Publicar `runpod-splat-worker` en Docker Hub o GHCR con tag `rtx4090`.
2. Crear endpoint Serverless en RunPod con GPU pool `ADA_24`.
3. Activar `RUNPOD_SPLAT_ENDPOINT_ID` y `RUNPOD_USE_SPLAT_WORKER=true`.
4. Entrenar Gaussian Splatting con Nerfstudio Splatfacto.
5. Exportar `.splat` o `.ply` al bucket `reconstructions`.
6. Cargar el asset final en el visor web y permitir moverse libremente.
7. Anadir herramientas de limpieza: borrar artefactos, elegir portada, puntos de interes y recorrido publico.

## Nota de calidad

La version local actual prioriza velocidad y coste cero en un PC sin GPU. Es util para validar UX, carga, seleccion de frames, navegacion y briefing. Para hiperrealismo comercial hay que mover reconstruccion, profundidad y splatting a cloud GPU o a una API especializada.
