"use client";

import { useEffect, useRef } from "react";
import type { AnimationMixer, Material, Object3D, Scene, WebGLRenderer } from "three";

const MODEL_URL = "/local-assets/minions/minion.glb";
const MODEL_PROBE_URL = "/api/local-assets/minion";
const RUNNER_COUNT = 3;
const FRAME_INTERVAL_MS = 1000 / 30;
const LAP_SECONDS = 52;
const HALF_WIDTH = 7.55;
const HALF_HEIGHT = 3.95;

export type PerimeterRunnerPose = { x: number; y: number; rotationY: number };

// 16:9の配置図外周を時計回りに進む。辺の長さに応じて速度が一定になるよう距離で計算する。
export function perimeterRunnerPose(progress: number): PerimeterRunnerPose {
  const width = HALF_WIDTH * 2;
  const height = HALF_HEIGHT * 2;
  const perimeter = (width + height) * 2;
  let distance = (((progress % 1) + 1) % 1) * perimeter;
  if (distance < width) return { x: -HALF_WIDTH + distance, y: HALF_HEIGHT, rotationY: Math.PI / 2 };
  distance -= width;
  if (distance < height) return { x: HALF_WIDTH, y: HALF_HEIGHT - distance, rotationY: 0 };
  distance -= height;
  if (distance < width) return { x: HALF_WIDTH - distance, y: -HALF_HEIGHT, rotationY: -Math.PI / 2 };
  distance -= width;
  return { x: -HALF_WIDTH, y: -HALF_HEIGHT + distance, rotationY: Math.PI };
}

export function MinionPerimeterRunners({ paused = false }: { paused?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pausedRef = useRef(paused);

  useEffect(() => { pausedRef.current = paused; }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let cancelled = false;
    let animationFrame = 0;
    let idleCallback = 0;
    let renderer: WebGLRenderer | null = null;
    let scene: Scene | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let intersectionObserver: IntersectionObserver | null = null;
    let visible = true;

    const initialize = async () => {
      try {
        const asset = await fetch(MODEL_PROBE_URL, { method: "HEAD", cache: "no-store" });
        if (!asset.ok || asset.headers.get("x-fleetflow-model-available") !== "1" || cancelled) return;
        const contentLength = Number(asset.headers.get("x-fleetflow-model-size") ?? 0);
        // 極端に大きいモデルで共用端末が重くならないよう、25MBを安全上限にする。
        if (contentLength > 25 * 1024 * 1024) return;

        const [THREE, { GLTFLoader }, { clone: cloneSkeleton }] = await Promise.all([
          import("three"),
          import("three/addons/loaders/GLTFLoader.js"),
          import("three/addons/utils/SkeletonUtils.js"),
        ]);
        if (cancelled) return;

        renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.35));
        renderer.setClearColor(0x000000, 0);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x64748b, 2.2));
        const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
        keyLight.position.set(-4, 7, 10);
        scene.add(keyLight);
        const camera = new THREE.OrthographicCamera(-8, 8, 4.42, -4.42, 0.1, 100);
        camera.position.set(0, 0, 20);
        camera.lookAt(0, 0, 0);

        const gltf = await new GLTFLoader().loadAsync(MODEL_URL);
        if (cancelled || !scene || !renderer) return;
        const bounds = new THREE.Box3().setFromObject(gltf.scene);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        if (!Number.isFinite(size.y) || size.y <= 0) return;
        const scale = 0.92 / size.y;
        const runners: Object3D[] = [];
        const mixers: AnimationMixer[] = [];
        const runningClip = gltf.animations.find((clip) => /run|jog|walk/i.test(clip.name)) ?? gltf.animations[0];

        for (let index = 0; index < RUNNER_COUNT; index += 1) {
          const anchor = new THREE.Group();
          const model = cloneSkeleton(gltf.scene);
          model.scale.setScalar(scale);
          model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
          anchor.add(model);
          scene.add(anchor);
          runners.push(anchor);
          if (runningClip) {
            const mixer = new THREE.AnimationMixer(model);
            mixer.clipAction(runningClip).play();
            mixers.push(mixer);
          }
        }

        const resize = () => {
          if (!renderer) return;
          const width = Math.max(1, canvas.clientWidth);
          const height = Math.max(1, canvas.clientHeight);
          renderer.setSize(width, height, false);
        };
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(canvas);
        resize();
        intersectionObserver = new IntersectionObserver(([entry]) => { visible = entry?.isIntersecting ?? false; }, { threshold: 0.01 });
        intersectionObserver.observe(canvas);

        let elapsed = 0;
        let lastFrame = performance.now();
        const draw = (now: number) => {
          animationFrame = requestAnimationFrame(draw);
          if (cancelled || pausedRef.current || document.hidden || !visible || now - lastFrame < FRAME_INTERVAL_MS) return;
          const delta = Math.min((now - lastFrame) / 1000, 0.1);
          lastFrame = now;
          elapsed += delta;
          runners.forEach((runner, index) => {
            const pose = perimeterRunnerPose(elapsed / LAP_SECONDS + index / RUNNER_COUNT);
            runner.position.set(pose.x, pose.y, 0);
            runner.rotation.y = pose.rotationY;
          });
          mixers.forEach((mixer) => mixer.update(delta));
          renderer?.render(scene!, camera);
        };
        animationFrame = requestAnimationFrame(draw);
      } catch {
        // 私有モデルが未配置・非対応でも、本体画面はそのまま利用できる。
      }
    };

    const idleApi = window as unknown as {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    if (idleApi.requestIdleCallback) idleCallback = idleApi.requestIdleCallback(() => { void initialize(); }, { timeout: 2000 });
    else idleCallback = window.setTimeout(() => { void initialize(); }, 800);

    return () => {
      cancelled = true;
      cancelAnimationFrame(animationFrame);
      if (idleApi.cancelIdleCallback) idleApi.cancelIdleCallback(idleCallback);
      else window.clearTimeout(idleCallback);
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      const geometries = new Set<unknown>();
      const materials = new Set<Material>();
      scene?.traverse((object) => {
        const mesh = object as Object3D & { geometry?: { dispose: () => void }; material?: Material | Material[] };
        if (mesh.geometry) geometries.add(mesh.geometry);
        if (Array.isArray(mesh.material)) mesh.material.forEach((material) => materials.add(material));
        else if (mesh.material) materials.add(mesh.material);
      });
      geometries.forEach((geometry) => (geometry as { dispose: () => void }).dispose());
      materials.forEach((material) => material.dispose());
      renderer?.dispose();
      renderer?.forceContextLoss();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 z-[4] size-full" />;
}
