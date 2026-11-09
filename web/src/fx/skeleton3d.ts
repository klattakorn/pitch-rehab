/**
 * The welcome screen's 3D figure: the 33 points MediaPipe tracks, built into a
 * glowing skeleton that squats on a loop and turns slowly in space.
 *
 * It is the app's headline feature drawn as the first thing anyone sees -- the
 * same landmark numbering and the same bones the camera screen draws, so it is
 * a picture of the real engine rather than decoration. A small readout counts
 * the reps and shows the knee angle the way the live camera does.
 *
 * Loaded on its own (`import()` from main.ts), so three.js never ships with the
 * camera screen. Cleans itself up when its element leaves the page, pauses when
 * the tab is hidden, and holds one still pose when the phone asks for reduced
 * motion.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PerspectiveCamera,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector3,
  WebGLRenderer,
  Mesh,
  DoubleSide,
} from "three";

import { LM, SKELETON } from "../pose/landmarks";

const VOLT = new Color("#c0f917");
const WHITE = new Color("#eef4f8");

type V = [number, number, number];

/**
 * One frame of a squat, `s` from 0 (standing) to 1 (bottom), in metres with
 * y up and the figure facing +z. Simple chain kinematics -- shank tips forward,
 * thigh tips back, torso leans -- so the knee bends to ~100 deg at the bottom,
 * which is what a good rep reads on the real engine.
 */
function squatPose(s: number): V[] {
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = rad(32 * s); // shank forward
  const b = rad(68 * s); // thigh back
  const c = rad(34 * s); // torso lean
  const r = rad(85 * s); // arms reach forward for balance
  const P: V[] = Array.from({ length: 33 }, () => [0, 0, 0] as V);
  const side = (x: number, left: boolean) => (left ? x : -x);

  let hipY = 0;
  let hipZ = 0;
  for (const left of [true, false]) {
    const ankle: V = [side(0.13, left), 0.08, 0];
    const knee: V = [ankle[0], ankle[1] + 0.42 * Math.cos(a), ankle[2] + 0.42 * Math.sin(a)];
    const hip: V = [side(0.11, left), knee[1] + 0.44 * Math.cos(b), knee[2] - 0.44 * Math.sin(b)];
    hipY = hip[1];
    hipZ = hip[2];
    P[left ? LM.LEFT_ANKLE : LM.RIGHT_ANKLE] = ankle;
    P[left ? LM.LEFT_KNEE : LM.RIGHT_KNEE] = knee;
    P[left ? LM.LEFT_HIP : LM.RIGHT_HIP] = hip;
    P[left ? LM.LEFT_HEEL : LM.RIGHT_HEEL] = [ankle[0], 0.03, -0.06];
    P[left ? LM.LEFT_FOOT_INDEX : LM.RIGHT_FOOT_INDEX] = [side(0.15, left), 0.02, 0.15];
  }

  const shY = hipY + 0.5 * Math.cos(c);
  const shZ = hipZ + 0.5 * Math.sin(c);
  for (const left of [true, false]) {
    const shoulder: V = [side(0.19, left), shY, shZ];
    const dir: V = [0, -Math.cos(r), Math.sin(r)];
    const elbow: V = [side(0.21, left), shY + 0.28 * dir[1], shZ + 0.28 * dir[2]];
    const wrist: V = [side(0.2, left), elbow[1] + 0.26 * dir[1], elbow[2] + 0.26 * dir[2]];
    P[left ? LM.LEFT_SHOULDER : LM.RIGHT_SHOULDER] = shoulder;
    P[left ? LM.LEFT_ELBOW : LM.RIGHT_ELBOW] = elbow;
    P[left ? LM.LEFT_WRIST : LM.RIGHT_WRIST] = wrist;
    const hand = (dx: number, dy: number, dz: number): V => [
      wrist[0] + side(dx, left),
      wrist[1] + dy * dir[1],
      wrist[2] + dz + dy * dir[2],
    ];
    P[left ? LM.LEFT_PINKY : LM.RIGHT_PINKY] = hand(0.03, 0.07, 0);
    P[left ? LM.LEFT_INDEX : LM.RIGHT_INDEX] = hand(-0.01, 0.08, 0.01);
    P[left ? LM.LEFT_THUMB : LM.RIGHT_THUMB] = hand(-0.03, 0.05, 0.02);
  }

  // Head rides the torso's lean.
  const up: V = [0, Math.cos(c), Math.sin(c)];
  const head = (x: number, h: number, f: number): V => [x, shY + h * up[1], shZ + h * up[2] + f];
  P[LM.NOSE] = head(0, 0.25, 0.1);
  P[LM.LEFT_EYE_INNER] = head(0.02, 0.28, 0.09);
  P[LM.LEFT_EYE] = head(0.035, 0.28, 0.085);
  P[LM.LEFT_EYE_OUTER] = head(0.05, 0.28, 0.08);
  P[LM.RIGHT_EYE_INNER] = head(-0.02, 0.28, 0.09);
  P[LM.RIGHT_EYE] = head(-0.035, 0.28, 0.085);
  P[LM.RIGHT_EYE_OUTER] = head(-0.05, 0.28, 0.08);
  P[LM.LEFT_EAR] = head(0.08, 0.26, 0);
  P[LM.RIGHT_EAR] = head(-0.08, 0.26, 0);
  P[LM.MOUTH_LEFT] = head(0.025, 0.21, 0.085);
  P[LM.MOUTH_RIGHT] = head(-0.025, 0.21, 0.085);
  return P;
}

/** Knee angle the way the engine reports it: 0 straight, bigger is deeper. */
function kneeFlexion(P: V[]): number {
  const h = P[LM.LEFT_HIP]!;
  const k = P[LM.LEFT_KNEE]!;
  const a = P[LM.LEFT_ANKLE]!;
  const u = new Vector3(h[0] - k[0], h[1] - k[1], h[2] - k[2]).normalize();
  const v = new Vector3(a[0] - k[0], a[1] - k[1], a[2] - k[2]).normalize();
  return 180 - (Math.acos(Math.min(1, Math.max(-1, u.dot(v)))) * 180) / Math.PI;
}

export function mountSkeleton3D(host: HTMLElement): () => void {
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    // No WebGL (old phone, blocked GPU): leave the static artwork in place.
    return () => {};
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x000000, 0);
  host.appendChild(renderer.domElement);
  host.classList.add("has-3d");

  const readout = document.createElement("div");
  readout.className = "sk3d-readout";
  host.appendChild(readout);

  const scene = new Scene();
  const camera = new PerspectiveCamera(32, 1, 0.1, 20);
  camera.position.set(0, 0.95, 3.4);
  camera.lookAt(0, 0.78, 0);

  const figure = new Group();
  scene.add(figure);

  // Joints: a bright core and a soft halo, both instanced -- 66 spheres in
  // two draw calls.
  const coreGeo = new SphereGeometry(1, 16, 12);
  const cores = new InstancedMesh(coreGeo, new MeshBasicMaterial({ color: WHITE }), 33);
  const halos = new InstancedMesh(
    coreGeo,
    new MeshBasicMaterial({
      color: VOLT,
      transparent: true,
      opacity: 0.22,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    33,
  );
  figure.add(cores, halos);

  // Bones: unit cylinders stretched between joints each frame.
  const boneGeo = new CylinderGeometry(1, 1, 1, 10, 1, true);
  boneGeo.translate(0, 0.5, 0);
  // MediaPipe's bone list stops at the shoulders, which leaves the head
  // floating; one extra bone, nose to mid-shoulder, gives it a neck.
  const BONES = SKELETON.length + 1;
  const bones = new InstancedMesh(boneGeo, new MeshBasicMaterial({ color: VOLT }), BONES);
  const boneGlow = new InstancedMesh(
    boneGeo,
    new MeshBasicMaterial({
      color: VOLT,
      transparent: true,
      opacity: 0.18,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
    BONES,
  );
  figure.add(bones, boneGlow);

  // Floor: two rings and a faint disc, so the figure stands on something.
  const floorMat = new MeshBasicMaterial({
    color: VOLT,
    transparent: true,
    opacity: 0.35,
    side: DoubleSide,
    depthWrite: false,
  });
  for (const [inner, outer, opacity] of [
    [0.52, 0.54, 0.45],
    [0.78, 0.79, 0.2],
  ] as const) {
    const ring = new Mesh(new RingGeometry(inner, outer, 64), floorMat.clone());
    (ring.material as MeshBasicMaterial).opacity = opacity;
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);
  }
  const disc = new Mesh(
    new RingGeometry(0, 0.5, 48),
    new MeshBasicMaterial({ color: VOLT, transparent: true, opacity: 0.06, depthWrite: false }),
  );
  disc.rotation.x = -Math.PI / 2;
  scene.add(disc);

  // Drifting specks, like tracked points waiting for a body. A few hundred is
  // nothing for a phone.
  const COUNT = 260;
  const specks = new Float32Array(COUNT * 3);
  for (let i = 0; i < COUNT; i++) {
    const ang = Math.random() * Math.PI * 2;
    const rr = 0.6 + Math.random() * 1.1;
    specks[i * 3] = Math.cos(ang) * rr;
    specks[i * 3 + 1] = Math.random() * 1.9;
    specks[i * 3 + 2] = Math.sin(ang) * rr;
  }
  const speckGeo = new BufferGeometry();
  speckGeo.setAttribute("position", new BufferAttribute(specks, 3));
  const dust = new Points(
    speckGeo,
    new PointsMaterial({
      color: VOLT,
      size: 0.012,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
    }),
  );
  scene.add(dust);

  const m = new Matrix4();
  const q = new Quaternion();
  const UP = new Vector3(0, 1, 0);
  const from = new Vector3();
  const to = new Vector3();
  const dirv = new Vector3();
  const scl = new Vector3();

  function pose(P: V[]): void {
    for (let i = 0; i < 33; i++) {
      const face = i <= 10;
      const r = face ? 0.011 : 0.026;
      m.compose(new Vector3(...P[i]!), q.identity(), scl.set(r, r, r));
      cores.setMatrixAt(i, m);
      const hr = r * (face ? 2.2 : 2.6);
      m.compose(new Vector3(...P[i]!), q.identity(), scl.set(hr, hr, hr));
      halos.setMatrixAt(i, m);
    }
    const ls = P[LM.LEFT_SHOULDER]!;
    const rs = P[LM.RIGHT_SHOULDER]!;
    const neck: V = [(ls[0] + rs[0]) / 2, (ls[1] + rs[1]) / 2, (ls[2] + rs[2]) / 2];
    const pairs: [V, V][] = SKELETON.map(([a, b]) => [P[a]!, P[b]!]);
    pairs.push([neck, P[LM.NOSE]!]);
    pairs.forEach(([pa, pb], i) => {
      from.set(...pa);
      to.set(...pb);
      dirv.subVectors(to, from);
      const len = dirv.length();
      q.setFromUnitVectors(UP, dirv.normalize());
      m.compose(from, q, scl.set(0.009, len, 0.009));
      bones.setMatrixAt(i, m);
      m.compose(from, q, scl.set(0.028, len, 0.028));
      boneGlow.setMatrixAt(i, m);
    });
    cores.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    bones.instanceMatrix.needsUpdate = true;
    boneGlow.instanceMatrix.needsUpdate = true;
  }

  // Drag (mouse or finger) turns the figure; let go and it drifts back to the
  // slow spin, with a little inertia so it does not feel bolted on.
  let spin = 0.35;
  let yaw = -0.5;
  let dragging = false;
  let lastX = 0;
  const onDown = (x: number) => {
    dragging = true;
    lastX = x;
  };
  const onMove = (x: number) => {
    if (!dragging) return;
    spin = (x - lastX) * 0.6;
    yaw += (x - lastX) * 0.012;
    lastX = x;
  };
  const onUp = () => (dragging = false);
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    onDown(e.clientX);
  });
  canvas.addEventListener("pointermove", (e) => onMove(e.clientX));
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);

  function resize(): void {
    const w = host.clientWidth || 300;
    const h = host.clientHeight || 220;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  let reps = 0;
  let raf = 0;
  let last = performance.now();
  const start = last;
  const CYCLE = 2.6; // seconds per rep: down 1.3s, up 1.3s

  function frame(now: number): void {
    if (!host.isConnected) return dispose();
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - start) / 1000;

    // Ease in and out of the bottom, with a short pause at the top, the way a
    // person actually squats.
    const phase = (t % CYCLE) / CYCLE;
    const s = Math.pow(Math.sin(Math.PI * phase), 1.6);
    const P = squatPose(s);
    pose(P);

    const done = Math.floor(t / CYCLE);
    if (done !== reps) {
      reps = done;
      readout.classList.remove("tick");
      void readout.offsetWidth;
      readout.classList.add("tick");
    }
    readout.innerHTML = `<span>REPS <b>${reps}</b></span><span>KNEE <b>${Math.round(kneeFlexion(P))}°</b></span>`;

    if (!dragging) spin += (0.35 - spin) * 0.04;
    yaw += spin * dt;
    figure.rotation.y = yaw;
    dust.rotation.y = -yaw * 0.3;
    // Specks rise slowly and wrap, so the space never looks frozen.
    const arr = speckGeo.getAttribute("position") as BufferAttribute;
    for (let i = 0; i < COUNT; i++) {
      let y = arr.getY(i) + dt * 0.05;
      if (y > 1.9) y = 0;
      arr.setY(i, y);
    }
    arr.needsUpdate = true;
    renderer.render(scene, camera);
  }

  if (reduce) {
    // One honest still frame: mid-squat, slightly turned.
    const P = squatPose(0.7);
    pose(P);
    figure.rotation.y = -0.5;
    readout.innerHTML = `<span>KNEE <b>${Math.round(kneeFlexion(P))}°</b></span>`;
    renderer.render(scene, camera);
  } else {
    raf = requestAnimationFrame(frame);
  }

  let disposed = false;
  function dispose(): void {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    scene.traverse((o) => {
      const mesh = o as Mesh;
      mesh.geometry?.dispose?.();
      const mat = mesh.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    readout.remove();
    host.classList.remove("has-3d");
  }
  return dispose;
}
