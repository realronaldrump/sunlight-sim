import * as THREE from 'three/webgpu';

/** Three's normal fallback handles rejected GPU requests; also handle requests that never settle. */
export async function initializeRenderer(antialias: boolean, forceWebGL: boolean) {
  const renderer = new THREE.WebGPURenderer({ antialias, forceWebGL });
  const initialization = renderer.init();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([initialization, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Graphics initialization timed out')), 5000);
    })]);
    return renderer;
  } catch (error) {
    if (forceWebGL) throw error;
    // The original request cannot be cancelled. Dispose it if the browser eventually completes it.
    void initialization.then(() => renderer.dispose()).catch(() => {});
    const fallback = new THREE.WebGPURenderer({ antialias, forceWebGL: true });
    await fallback.init();
    return fallback;
  } finally { clearTimeout(timer); }
}
