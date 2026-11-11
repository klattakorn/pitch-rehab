/**
 * A low-poly football for the Home hero: turning slowly, and flicked into a
 * spin by a drag or a tap. Decoration with a job -- it says "football" at a
 * glance without a photo -- so it is cheap: 80 flat faces, one light rig, and
 * nothing at all when the tab is hidden or the screen is left.
 *
 * The ball is an icosahedron split once. The five faces around each of the 12
 * original corners are coloured dark, which reads as the pentagon patches of a
 * real ball; the rest are white, and the edges are traced in volt.
 */
import {
  AmbientLight,
  BufferAttribute,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";

const PATCH = new Color("#12161d");
const PANEL = new Color("#eef2f5");
const VOLT = new Color("#d8ff3e");

export function mountBall3D(host: HTMLElement): () => void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return () => {}; // No WebGL: the hero stands on its own without the ball.
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.className = "ball3d-canvas";
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0, 5.2);

  scene.add(new AmbientLight(0xffffff, 0.55));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const rim = new DirectionalLight(VOLT, 0.9);
  rim.position.set(4, -2, -3);
  scene.add(rim);

  // ---- the ball --------------------------------------------------------
  const corners = new IcosahedronGeometry(1, 0);
  const pos0 = corners.getAttribute("position");
  const tips: Vector3[] = [];
  for (let i = 0; i < pos0.count; i++) {
    const v = new Vector3().fromBufferAttribute(pos0, i).normalize();
    if (!tips.some((t) => t.distanceTo(v) < 1e-3)) tips.push(v);
  }
  corners.dispose();

  const geo = new IcosahedronGeometry(1, 1).toNonIndexed();
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let f = 0; f < pos.count; f += 3) {
    a.fromBufferAttribute(pos, f);
    b.fromBufferAttribute(pos, f + 1);
    c.fromBufferAttribute(pos, f + 2);
    const centre = a.clone().add(b).add(c).divideScalar(3).normalize();
    // A face touching one of the 12 corners belongs to that corner's patch.
    const patch = tips.some((t) => t.distanceTo(centre) < 0.42);
    const col = patch ? PATCH : PANEL;
    for (let k = 0; k < 3; k++) colors.set([col.r, col.g, col.b], (f + k) * 3);
  }
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const ball = new Group();
  const body = new Mesh(
    geo,
    new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.55, metalness: 0.05 }),
  );
  const edges = new LineSegments(
    new EdgesGeometry(geo, 1),
    new LineBasicMaterial({ color: VOLT, transparent: true, opacity: 0.55 }),
  );
  edges.scale.setScalar(1.002);
  ball.add(body, edges);
  ball.rotation.set(0.4, 0.6, 0);
  scene.add(ball);

  // ---- size --------------------------------------------------------------
  const resize = (): void => {
    const w = host.clientWidth || 120;
    const h = host.clientHeight || 120;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  // ---- spin: slow on its own, faster when flicked, settling back ---------
  let spinX = 0.12;
  let spinY = 0.35;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  const onDown = (e: PointerEvent): void => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    // A tap with no drag still gets a kick.
    spinY += 3;
  };
  const onMove = (e: PointerEvent): void => {
    if (!dragging) return;
    spinY = (e.clientX - lastX) * 0.4;
    spinX = (e.clientY - lastY) * 0.4;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = (): void => {
    dragging = false;
  };
  renderer.domElement.addEventListener("pointerdown", onDown);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);

  let last = performance.now();
  let frame = 0;
  const draw = (): void => renderer.render(scene, camera);
  const tick = (now: number): void => {
    if (!host.isConnected) return dispose();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!document.hidden) {
      ball.rotation.y += spinY * dt;
      ball.rotation.x += spinX * dt;
      if (!dragging) {
        // Ease back toward the idle turn.
        spinY += (0.35 - spinY) * Math.min(1, dt * 1.6);
        spinX += (0.12 - spinX) * Math.min(1, dt * 1.6);
      }
      // A gentle bob, like a ball sitting on a pitch that is not quite still.
      ball.position.y = Math.sin(now / 900) * 0.05;
      draw();
    }
    frame = requestAnimationFrame(tick);
  };

  if (reduce) {
    draw();
  } else {
    frame = requestAnimationFrame(tick);
  }

  // Leaving the screen removes the host; reduced motion has no loop to notice.
  const watch = reduce
    ? window.setInterval(() => {
        if (!host.isConnected) dispose();
      }, 1000)
    : 0;

  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    if (watch) clearInterval(watch);
    observer.disconnect();
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    geo.dispose();
    edges.geometry.dispose();
    (body.material as MeshStandardMaterial).dispose();
    (edges.material as LineBasicMaterial).dispose();
    renderer.dispose();
    renderer.domElement.remove();
  }
  return dispose;
}
