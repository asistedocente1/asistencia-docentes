/**
 * Toma una foto en segundo plano: la cámara se abre, se captura un cuadro y se cierra,
 * sin mostrar vista previa al docente. El navegador SIEMPRE pide permiso de cámara
 * (no se puede evitar) y muestra su indicador mientras la cámara está activa.
 * Devuelve null si no hay cámara o si el permiso fue denegado.
 */
export async function capturePhoto(): Promise<Blob | null> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;

  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });

    video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', 'true');
    // Fuera de la vista pero "visible" para el navegador (iOS no reproduce videos ocultos con display:none)
    video.style.cssText =
      'position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    video.srcObject = stream;
    document.body.appendChild(video);
    await video.play();

    // Espera breve para que la cámara ajuste exposición
    await new Promise((r) => setTimeout(r, 800));

    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);

    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.7));
  } catch {
    return null;
  } finally {
    stream?.getTracks().forEach((t) => t.stop());
    video?.remove();
  }
}
