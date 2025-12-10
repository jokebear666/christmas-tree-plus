import { useState, useMemo, useRef, useEffect, Suspense } from 'react';
import './App.css';
import { Canvas, useFrame, extend, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  Environment,
  PerspectiveCamera,
  shaderMaterial,
  Float,
  Stars,
  Sparkles,
  useTexture
} from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MathUtils } from 'three';
import * as random from 'maath/random';
// 移除手势识别依赖与相关逻辑

// --- 动态生成照片列表（从 src/assets/photos 扫描，支持任意文件名） ---
// 说明：使用 Vite 的 import.meta.glob 在构建期收集图片 URL，数量随目录内容变化
const photoModules = import.meta.glob('./assets/photos/*.{jpg,jpeg,png,webp}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

// 将 top.*（如果存在）排到最前，其余按字母序稳定排序
const bodyPhotoPaths = Object.values(photoModules).sort((a, b) => {
  // 处理构建后带哈希的文件名，如 /assets/top.abc123.png
  const isTopA = /\/top\./i.test(a);
  const isTopB = /\/top\./i.test(b);
  if (isTopA && !isTopB) return -1;
  if (!isTopA && isTopB) return 1;
  return a.localeCompare(b);
});

// --- 视觉配置 ---
const IS_MOBILE = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const IS_QQ = /QQBrowser|MQQBrowser/i.test(navigator.userAgent);
const CONFIG = {
  colors: {
    emerald: '#004225', // 纯正祖母绿
    gold: '#FFD700',
    silver: '#ECEFF1',
    red: '#D32F2F',
    green: '#2E7D32',
    white: '#FFFFFF',   // 纯白色
    warmLight: '#FFD54F',
    lights: ['#FF0000', '#00FF00', '#0000FF', '#FFFF00'], // 彩灯
    ornaments: ['#D32F2F', '#FFD700', '#B0BEC5', '#1976D2'], // 红 金 银 蓝
    // 拍立得边框颜色池 (复古柔和色系)
    borders: ['#FFFAF0', '#F0E68C', '#E6E6FA', '#FFB6C1', '#98FB98', '#87CEFA', '#FFDAB9'],
    // 圣诞元素颜色
    giftColors: ['#D32F2F', '#FFD700', '#1976D2', '#2E7D32'],
    candyColors: ['#FF0000', '#FFFFFF']
  },
  counts: {
    foliage: 15000,
    ornaments: 300,   // 拍立得照片数量
    elements: 200,    // 圣诞元素数量
    lights: 400,      // 彩灯数量
    gallery: { photos: 20, scale: 2.5, radius: 14, moveSpeed: 20.0 }, // 照片墙参数（moveSpeed：散开→照片墙迁移速度）
    camera: { distance: 40 } // 默认视角距离（越小越近）
  },
  tree: { height: 22, radius: 9 }, // 树体尺寸
  photos: {
    // top 属性不再需要，因为已经移入 body
    body: bodyPhotoPaths
  }
};

// --- Shader Material (Foliage) ---
const FoliageMaterial = shaderMaterial(
  { uTime: 0, uColor: new THREE.Color(CONFIG.colors.emerald), uProgress: 0, uPointScale: 60 },
  `precision mediump float; precision mediump int;
  uniform float uTime; uniform float uProgress; uniform float uPointScale; attribute vec3 aTargetPos; attribute float aRandom;
  varying vec2 vUv; varying float vMix;
  float cubicInOut(float t) { return t < 0.5 ? 4.0 * t * t * t : 0.5 * pow(2.0 * t - 2.0, 3.0) + 1.0; }
  void main() {
    vUv = uv;
    vec3 noise = vec3(sin(uTime * 1.5 + position.x), cos(uTime + position.y), sin(uTime * 1.5 + position.z)) * 0.15;
    float t = cubicInOut(uProgress);
    vec3 finalPos = mix(position, aTargetPos + noise, t);
    vec4 mvPosition = modelViewMatrix * vec4(finalPos, 1.0);
    gl_PointSize = (uPointScale * (1.0 + aRandom)) / -mvPosition.z;
    gl_Position = projectionMatrix * mvPosition;
    vMix = t;
  }`,
  `precision mediump float; precision mediump int;
  uniform vec3 uColor; varying float vMix;
  void main() {
    float r = distance(gl_PointCoord, vec2(0.5)); if (r > 0.5) discard;
    vec3 finalColor = mix(uColor * 0.3, uColor * 1.2, vMix);
    gl_FragColor = vec4(finalColor, 1.0);
  }`
);
extend({ FoliageMaterial });

// --- Helper: Tree Shape ---
const getTreePosition = () => {
  const h = CONFIG.tree.height; const rBase = CONFIG.tree.radius;
  const y = (Math.random() * h) - (h / 2); const normalizedY = (y + (h/2)) / h;
  const currentRadius = rBase * (1 - normalizedY); const theta = Math.random() * Math.PI * 2;
  const r = Math.random() * currentRadius;
  return [r * Math.cos(theta), y, r * Math.sin(theta)];
};

// --- Component: Foliage ---
const Foliage = ({ state, count }: { state: 'CHAOS' | 'FORMED', count: number }) => {
  const materialRef = useRef<any>(null);
  const { positions, targetPositions, randoms } = useMemo(() => {
    const positions = new Float32Array(count * 3); const targetPositions = new Float32Array(count * 3); const randoms = new Float32Array(count);
    const spherePoints = random.inSphere(new Float32Array(count * 3), { radius: 25 }) as Float32Array;
    for (let i = 0; i < count; i++) {
      positions[i*3] = spherePoints[i*3]; positions[i*3+1] = spherePoints[i*3+1]; positions[i*3+2] = spherePoints[i*3+2];
      const [tx, ty, tz] = getTreePosition();
      targetPositions[i*3] = tx; targetPositions[i*3+1] = ty; targetPositions[i*3+2] = tz;
      randoms[i] = Math.random();
    }
    return { positions, targetPositions, randoms };
  }, [count]);
  useFrame((rootState, delta) => {
    if (materialRef.current) {
      materialRef.current.uTime = rootState.clock.elapsedTime;
      const targetProgress = state === 'FORMED' ? 1 : 0;
      materialRef.current.uProgress = MathUtils.damp(materialRef.current.uProgress, targetProgress, 1.5, delta);
      materialRef.current.uPointScale = IS_MOBILE ? 36 : 60;
    }
  });
  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aTargetPos" args={[targetPositions, 3]} />
        <bufferAttribute attach="attributes-aRandom" args={[randoms, 1]} />
      </bufferGeometry>
      {/* @ts-ignore */}
      <foliageMaterial ref={materialRef} transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
};

// --- Component: Photo Ornaments (Double-Sided Polaroid) ---
const PhotoOrnaments = ({ state, photoUrls, count, transitionProgress = 0, ringRadius = 14, isGallery = false, gallerySpeed = 1.0, focusScale = 2.0 }: { state: 'CHAOS' | 'FORMED', photoUrls: string[], count: number, transitionProgress?: number, ringRadius?: number, isGallery?: boolean, gallerySpeed?: number, focusScale?: number }) => {
  const effectiveUrls = useMemo(() => photoUrls.slice(0, Math.min(photoUrls.length, count)), [photoUrls, count]);
  const loadedTextures = useTexture(effectiveUrls);
  const fallbackTexture = useMemo(() => {
    const data = new Uint8Array([255, 255, 255, 255]);
    const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    tex.needsUpdate = true;
    return tex as unknown as THREE.Texture;
  }, []);
  const textures = loadedTextures.length > 0 ? loadedTextures : [fallbackTexture];
  const groupRef = useRef<THREE.Group>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  useEffect(() => {
    if (IS_MOBILE) {
      textures.forEach(tex => {
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
      });
    }
  }, [textures]);

  const borderGeometry = useMemo(() => new THREE.PlaneGeometry(1.2, 1.5), []);
  const photoGeometry = useMemo(() => new THREE.PlaneGeometry(1, 1), []);

  const data = useMemo(() => {
    const step = (Math.PI * 2) / Math.max(1, textures.length);
    return new Array(count).fill(0).map((_, i) => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*70, (Math.random()-0.5)*70, (Math.random()-0.5)*70);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.5;
      const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      // 环形照片墙目标位置（索引均匀分布）
      const ringAngle = (i % textures.length) * step;
      const ringPos = new THREE.Vector3(Math.sin(ringAngle) * ringRadius, Math.sin(ringAngle * 2) * 0.6, Math.cos(ringAngle) * ringRadius);

      const isBig = Math.random() < 0.2;
      const baseScale = isBig ? 2.2 : 0.8 + Math.random() * 0.6;
      const weight = 0.8 + Math.random() * 1.2;
      const borderColor = CONFIG.colors.borders[Math.floor(Math.random() * CONFIG.colors.borders.length)];

      const rotationSpeed = {
        x: (Math.random() - 0.5) * 1.0,
        y: (Math.random() - 0.5) * 1.0,
        z: (Math.random() - 0.5) * 1.0
      };
      const chaosRotation = new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);

      return {
        chaosPos, targetPos, ringPos, scale: baseScale, weight,
        textureIndex: i % textures.length,
        borderColor,
        currentPos: chaosPos.clone(),
        chaosRotation,
        rotationSpeed,
        wobbleOffset: Math.random() * 10,
        wobbleSpeed: 0.5 + Math.random() * 0.5
      };
    });
  }, [textures, count, ringRadius]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;

    groupRef.current.children.forEach((group, i) => {
      const objData = data[i];
      // GALLERY 场景：从散开直接向环形迁移（chaos → ring）
      const galleryTarget = objData.chaosPos.clone().lerp(objData.ringPos, transitionProgress);
      // 非 GALLERY：从环形回归树目标（ring → target）
      const formedTarget = objData.targetPos.clone().lerp(objData.ringPos, transitionProgress);
      let target = isGallery ? galleryTarget : (isFormed ? formedTarget : objData.chaosPos);
      // 点击选中照片→移到屏幕中间并放大
      if (isGallery && selectedIndex === i) {
        // 动态计算屏幕中心在当前相机视角下的局部坐标
        const cam = stateObj.camera as THREE.PerspectiveCamera;
        const dir = new THREE.Vector3(); cam.getWorldDirection(dir);
        const groupWorldPos = new THREE.Vector3(); groupRef.current!.getWorldPosition(groupWorldPos);
        const focusDepth = Math.max(8, cam.position.distanceTo(groupWorldPos) - ringRadius);
        const centerWorld = cam.position.clone().add(dir.multiplyScalar(focusDepth));
        const centerLocal = centerWorld.clone(); groupRef.current!.worldToLocal(centerLocal);
        target = target.clone().lerp(centerLocal, 0.6);
      }

      const moveFactor = isGallery ? gallerySpeed : (isFormed ? 0.8 * objData.weight : 0.5);
      objData.currentPos.lerp(target, delta * moveFactor);
      group.position.copy(objData.currentPos);

      if (isFormed || isGallery) {
         const cam = stateObj.camera as THREE.PerspectiveCamera;
         if (isGallery) {
           group.lookAt(cam.position);
         } else {
           const targetLookPos = new THREE.Vector3(group.position.x * 2, group.position.y + 0.5, group.position.z * 2);
           group.lookAt(targetLookPos);
         }

         const wobbleX = Math.sin(time * objData.wobbleSpeed + objData.wobbleOffset) * 0.05;
         const wobbleZ = Math.cos(time * objData.wobbleSpeed * 0.8 + objData.wobbleOffset) * 0.05;
         group.rotation.x += wobbleX;
         group.rotation.z += wobbleZ;

         // 选中照片时逐渐放大（仅在照片墙状态）
         const targetScale = isGallery && selectedIndex === i ? objData.scale * focusScale : objData.scale;
         const s = (group.scale as any);
         if (s && s.lerp) s.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);

      } else {
         group.rotation.x += delta * objData.rotationSpeed.x;
         group.rotation.y += delta * objData.rotationSpeed.y;
         group.rotation.z += delta * objData.rotationSpeed.z;
      }
    });
  });

  return (
    <group ref={groupRef}
      onPointerDown={(e) => { if (isGallery) e.stopPropagation(); }}
      onPointerMove={(e) => { if (isGallery) e.stopPropagation(); }}
      onPointerUp={(e) => { if (isGallery) e.stopPropagation(); }}
      onClick={(e) => { if (isGallery) e.stopPropagation(); }}
    >
      {data.map((obj, i) => (
        <group key={i} scale={[obj.scale, obj.scale, obj.scale]} rotation={state === 'CHAOS' ? obj.chaosRotation : [0,0,0]}
          onClick={(e) => { if (isGallery) { e.stopPropagation(); setSelectedIndex(si => si === i ? null : i); } }}
        >
          {/* 正面 */}
          <group position={[0, 0, 0.015]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
          {/* 背面 */}
          <group position={[0, 0, -0.015]} rotation={[0, Math.PI, 0]}>
            <mesh geometry={photoGeometry}>
              <meshStandardMaterial
                map={textures[obj.textureIndex]}
                roughness={0.5} metalness={0}
                emissive={CONFIG.colors.white} emissiveMap={textures[obj.textureIndex]} emissiveIntensity={1.0}
                side={THREE.FrontSide}
              />
            </mesh>
            <mesh geometry={borderGeometry} position={[0, -0.15, -0.01]}>
              <meshStandardMaterial color={obj.borderColor} roughness={0.9} metalness={0} side={THREE.FrontSide} />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
};

// --- Component: Christmas Elements ---
const ChristmasElements = ({ state, count }: { state: 'CHAOS' | 'FORMED', count: number }) => {
  const groupRef = useRef<THREE.Group>(null);

  const boxGeometry = useMemo(() => new THREE.BoxGeometry(0.8, 0.8, 0.8), []);
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(0.5, 16, 16), []);
  const caneGeometry = useMemo(() => new THREE.CylinderGeometry(0.15, 0.15, 1.2, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height;
      const y = (Math.random() * h) - (h / 2);
      const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) * 0.95;
      const theta = Math.random() * Math.PI * 2;

      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));

      const type = Math.floor(Math.random() * 3);
      let color; let scale = 1;
      if (type === 0) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.8 + Math.random() * 0.4; }
      else if (type === 1) { color = CONFIG.colors.giftColors[Math.floor(Math.random() * CONFIG.colors.giftColors.length)]; scale = 0.6 + Math.random() * 0.4; }
      else { color = Math.random() > 0.5 ? CONFIG.colors.red : CONFIG.colors.white; scale = 0.7 + Math.random() * 0.3; }

      const rotationSpeed = { x: (Math.random()-0.5)*2.0, y: (Math.random()-0.5)*2.0, z: (Math.random()-0.5)*2.0 };
      return { type, chaosPos, targetPos, color, scale, currentPos: chaosPos.clone(), chaosRotation: new THREE.Euler(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI), rotationSpeed };
    });
  }, [boxGeometry, sphereGeometry, caneGeometry, count]);

  useFrame((_, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    groupRef.current.children.forEach((child, i) => {
      const mesh = child as THREE.Mesh;
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 1.5);
      mesh.position.copy(objData.currentPos);
      mesh.rotation.x += delta * objData.rotationSpeed.x; mesh.rotation.y += delta * objData.rotationSpeed.y; mesh.rotation.z += delta * objData.rotationSpeed.z;
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => {
        let geometry; if (obj.type === 0) geometry = boxGeometry; else if (obj.type === 1) geometry = sphereGeometry; else geometry = caneGeometry;
        return ( <mesh key={i} scale={[obj.scale, obj.scale, obj.scale]} geometry={geometry} rotation={obj.chaosRotation}>
          <meshStandardMaterial color={obj.color} roughness={0.3} metalness={0.4} emissive={obj.color} emissiveIntensity={0.2} />
        </mesh> )})}
    </group>
  );
};

// --- Component: Fairy Lights ---
const FairyLights = ({ state, count }: { state: 'CHAOS' | 'FORMED', count: number }) => {
  const groupRef = useRef<THREE.Group>(null);
  const geometry = useMemo(() => new THREE.SphereGeometry(0.8, 8, 8), []);

  const data = useMemo(() => {
    return new Array(count).fill(0).map(() => {
      const chaosPos = new THREE.Vector3((Math.random()-0.5)*60, (Math.random()-0.5)*60, (Math.random()-0.5)*60);
      const h = CONFIG.tree.height; const y = (Math.random() * h) - (h / 2); const rBase = CONFIG.tree.radius;
      const currentRadius = (rBase * (1 - (y + (h/2)) / h)) + 0.3; const theta = Math.random() * Math.PI * 2;
      const targetPos = new THREE.Vector3(currentRadius * Math.cos(theta), y, currentRadius * Math.sin(theta));
      const color = CONFIG.colors.lights[Math.floor(Math.random() * CONFIG.colors.lights.length)];
      const speed = 2 + Math.random() * 3;
      return { chaosPos, targetPos, color, speed, currentPos: chaosPos.clone(), timeOffset: Math.random() * 100 };
    });
  }, [count]);

  useFrame((stateObj, delta) => {
    if (!groupRef.current) return;
    const isFormed = state === 'FORMED';
    const time = stateObj.clock.elapsedTime;
    groupRef.current.children.forEach((child, i) => {
      const objData = data[i];
      const target = isFormed ? objData.targetPos : objData.chaosPos;
      objData.currentPos.lerp(target, delta * 2.0);
      const mesh = child as THREE.Mesh;
      mesh.position.copy(objData.currentPos);
      const intensity = (Math.sin(time * objData.speed + objData.timeOffset) + 1) / 2;
      if (mesh.material) { (mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = isFormed ? 3 + intensity * 4 : 0; }
    });
  });

  return (
    <group ref={groupRef}>
      {data.map((obj, i) => ( <mesh key={i} scale={[0.15, 0.15, 0.15]} geometry={geometry}>
          <meshStandardMaterial color={obj.color} emissive={obj.color} emissiveIntensity={0} toneMapped={false} />
        </mesh> ))}
    </group>
  );
};

// --- Component: Top Star (No Photo, Pure Gold 3D Star) ---
const TopStar = ({ state }: { state: 'CHAOS' | 'FORMED' }) => {
  const groupRef = useRef<THREE.Group>(null);

  const starShape = useMemo(() => {
    const shape = new THREE.Shape();
    const outerRadius = 1.3; const innerRadius = 0.7; const points = 5;
    for (let i = 0; i < points * 2; i++) {
      const radius = i % 2 === 0 ? outerRadius : innerRadius;
      const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      i === 0 ? shape.moveTo(radius*Math.cos(angle), radius*Math.sin(angle)) : shape.lineTo(radius*Math.cos(angle), radius*Math.sin(angle));
    }
    shape.closePath();
    return shape;
  }, []);

  const starGeometry = useMemo(() => {
    return new THREE.ExtrudeGeometry(starShape, {
      depth: 0.4, // 增加一点厚度
      bevelEnabled: true, bevelThickness: 0.1, bevelSize: 0.1, bevelSegments: 3,
    });
  }, [starShape]);

  // 纯金材质
  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({
    color: CONFIG.colors.gold,
    emissive: CONFIG.colors.gold,
    emissiveIntensity: 1.5, // 适中亮度，既发光又有质感
    roughness: 0.1,
    metalness: 1.0,
  }), []);

  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.5;
      const targetScale = state === 'FORMED' ? 1 : 0;
      groupRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta * 3);
    }
  });

  return (
    <group ref={groupRef} position={[0, CONFIG.tree.height / 2 + 1.8, 0]}>
      <Float speed={2} rotationIntensity={0.2} floatIntensity={0.2}>
        <mesh geometry={starGeometry} material={goldMaterial} />
      </Float>
    </group>
  );
};

// --- Main Scene Experience ---
const Experience = ({ sceneState, rotationSpeed, photoUrls, counts, transitionProgress = 0, ringRadius = 14, isGallery = false, gallerySpeed = 1.0 }: { sceneState: 'CHAOS' | 'FORMED', rotationSpeed: number, photoUrls: string[], counts: { foliage: number; ornaments: number; elements: number; lights: number; gallery: { photos: number; scale: number; radius: number; moveSpeed: number }; camera: { distance: number } }, transitionProgress?: number, ringRadius?: number, isGallery?: boolean, gallerySpeed?: number }) => {
  const controlsRef = useRef<any>(null);
  const { gl } = useThree();
  const supportsPost = !!(gl && (gl as any).capabilities && (gl as any).capabilities.isWebGL2) && !IS_MOBILE;
  const effCounts = IS_MOBILE ? {
    foliage: Math.min(counts.foliage, 8000),
    ornaments: Math.min(counts.ornaments, 160),
    elements: Math.min(counts.elements, 120),
    lights: Math.min(counts.lights, 180)
  } : counts;
  useFrame(() => {
    if (controlsRef.current) {
      controlsRef.current.setAzimuthalAngle(controlsRef.current.getAzimuthalAngle() + rotationSpeed);
      controlsRef.current.update();
    }
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[0, 8, counts.camera.distance]} fov={45} />
      <OrbitControls ref={controlsRef} enablePan={false} enableZoom={true} minDistance={30} maxDistance={120} autoRotate={rotationSpeed === 0 && sceneState === 'FORMED'} autoRotateSpeed={0.3} maxPolarAngle={Math.PI / 1.7} />

      <color attach="background" args={['#000300']} />
      <Stars radius={100} depth={50} count={IS_QQ ? 1000 : (IS_MOBILE ? 2000 : 5000)} factor={4} saturation={0} fade speed={1} />
      {!IS_MOBILE && <Environment preset="night" background={false} />}

      <ambientLight intensity={0.4} color="#003311" />
      <pointLight position={[30, 30, 30]} intensity={100} color={CONFIG.colors.warmLight} />
      <pointLight position={[-30, 10, -30]} intensity={50} color={CONFIG.colors.gold} />
      <pointLight position={[0, -20, 10]} intensity={30} color="#ffffff" />

      <group position={[0, -6, 0]}>
        <Foliage state={sceneState} count={effCounts.foliage} />
        <Suspense fallback={null}>
           <PhotoOrnaments state={sceneState} photoUrls={photoUrls} count={effCounts.ornaments} transitionProgress={transitionProgress} ringRadius={ringRadius} isGallery={isGallery} gallerySpeed={gallerySpeed} focusScale={counts.gallery.scale} />
           <ChristmasElements state={sceneState} count={effCounts.elements} />
           <FairyLights state={sceneState} count={effCounts.lights} />
           <TopStar state={sceneState} />
        </Suspense>
        <Sparkles count={IS_MOBILE ? 200 : 600} scale={50} size={8} speed={0.4} opacity={0.4} color={CONFIG.colors.silver} />
      </group>

      {supportsPost && (
        <EffectComposer>
          <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.1} intensity={1.5} radius={0.5} mipmapBlur />
          <Vignette eskil={false} offset={0.1} darkness={1.2} />
        </EffectComposer>
      )}
    </>
  );
};

// --- 3D 照片墙场景（GALLERY） ---



/* Removed unused GalleryExperience component */

// --- 已移除 GestureController ---

// --- App Entry ---
export default function GrandTreeApp() {
  const [sceneState, setSceneState] = useState<'CHAOS' | 'FORMED' | 'GALLERY'>('FORMED');
  const [rotationSpeed] = useState(0);
  // 已移除 AI 状态与调试模式
  // 动态照片列表（默认使用构建期扫描的资源，可追加用户上传）
  const [photoUrls, setPhotoUrls] = useState<string[]>(bodyPhotoPaths);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // 参数设置（可视化可调）
  const [counts, setCounts] = useState(CONFIG.counts);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const handlePickFiles = () => fileInputRef.current?.click();
  const handleFilesSelected: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const topRegex = /^top\.(jpg|jpeg|png|webp)$/i;
    const selected = Array.from(files).map(f => ({ url: URL.createObjectURL(f), name: f.name || '' }));
    selected.sort((a, b) => {
      const aTop = topRegex.test(a.name);
      const bTop = topRegex.test(b.name);
      if (aTop && !bTop) return -1;
      if (!aTop && bTop) return 1;
      return a.name.localeCompare(b.name);
    });
    const newUrls = selected.map(s => s.url);
    // 仅使用用户上传的照片来组成圣诞树
    setPhotoUrls(newUrls);
    // 清空 input 值，便于重复选择同一文件
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleToggleByClick = () => setSceneState(s => (
    s === 'GALLERY' ? s : (s === 'FORMED' ? 'CHAOS' : s === 'CHAOS' ? 'GALLERY' : 'FORMED')
  ));

  return (
    <div onClick={(e) => {
      const el = e.target as HTMLElement;
      if (el.closest('.ui-buttons') || el.closest('.settings-panel') || el.closest('.help-panel') || el.closest('.top-right-buttons')) return;
      handleToggleByClick();
    }} style={{ width: '100vw', height: '100vh', backgroundColor: '#000', position: 'relative', overflow: 'hidden' }}>
      {/* 顶部固定文案（不随视角/缩放/状态变化） */}
      <div className="top-banner">
        <div className="title">Merry Christmax</div>
        <div className="subtitle">点击任意处开始</div>
      </div>
      <div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0, zIndex: 1 }}>
        <Canvas dpr={IS_MOBILE ? 1 : [1, 2]} gl={{ toneMapping: THREE.ReinhardToneMapping, antialias: !IS_MOBILE, powerPreference: 'high-performance' }} shadows={!IS_MOBILE}>
          <SceneRoot sceneState={sceneState} rotationSpeed={rotationSpeed} photoUrls={photoUrls} counts={counts} />
        </Canvas>
      </div>

      {/* UI - Stats */}
      <div style={{ position: 'absolute', bottom: '30px', left: '40px', color: '#888', zIndex: 10, fontFamily: 'sans-serif', userSelect: 'none' }}>
        <div style={{ marginBottom: '15px' }}>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>回忆</p>
          <p style={{ fontSize: '24px', color: '#FFD700', fontWeight: 'bold', margin: 0 }}>
            {counts.ornaments.toLocaleString()} <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>照片数量</span>
          </p>
        </div>
        <div>
          <p style={{ fontSize: '10px', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: '4px' }}>叶子</p>
          <p style={{ fontSize: '24px', color: '#004225', fontWeight: 'bold', margin: 0 }}>
            {(counts.foliage / 1000).toFixed(0)}K <span style={{ fontSize: '10px', color: '#555', fontWeight: 'normal' }}>叶子数量</span>
          </p>
        </div>
      </div>

      {/* UI - Buttons */}
      <div className="ui-buttons" style={{ position: 'absolute', bottom: '30px', right: '40px', zIndex: 10, display: 'flex', gap: '10px' }}>
        {/* 上传照片（支持多选） */}
        <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFilesSelected} style={{ display: 'none' }} />
        <button onClick={handlePickFiles} style={{ padding: '12px 15px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
           上传照片
        </button>
        {sceneState === 'GALLERY' ? (
          <button onClick={() => setSceneState('FORMED')} style={{ padding: '12px 24px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
            返回树
          </button>
        ) : (
          <>
            <button onClick={() => setSceneState(s => s === 'CHAOS' ? 'FORMED' : 'CHAOS')} style={{ padding: '12px 30px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255, 215, 0, 0.5)', color: '#FFD700', fontFamily: 'serif', fontSize: '14px', fontWeight: 'bold', letterSpacing: '3px', textTransform: 'uppercase', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
              {sceneState === 'CHAOS' ? '聚合树' : '散开树'}
            </button>
            <button onClick={() => setSceneState('GALLERY')} style={{ padding: '12px 18px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: '#FFD700', fontFamily: 'sans-serif', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
              照片墙
            </button>
          </>
        )}
      </div>

      {/* UI - Top Right Buttons */}
      <div className="top-right-buttons" style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 12, display: 'flex', gap: '8px' }}>
        <button onClick={() => setShowSettings(true)} style={{ padding: '8px 12px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: '#FFD700', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
          参数设置
        </button>
        <button onClick={() => setShowHelp(true)} style={{ padding: '8px 12px', backgroundColor: 'rgba(0,0,0,0.5)', border: '1px solid #FFD700', color: '#FFD700', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', backdropFilter: 'blur(4px)' }}>
          说明
        </button>
      </div>

      {/* 参数面板 */}
      {showSettings && (
        <div className="settings-panel" style={{ position: 'absolute', top: '60px', right: '20px', zIndex: 13, width: '320px', background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,215,0,0.5)', color: '#FFD700', padding: '12px', borderRadius: '8px', backdropFilter: 'blur(6px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontWeight: 'bold' }}>参数设置</span>
            <button onClick={() => setShowSettings(false)} style={{ background: 'transparent', border: 'none', color: '#FFD700', cursor: 'pointer' }}>✕</button>
          </div>
          <div className="settings-grid">
            <label>树叶粒子数量（越大越密，性能压力增）</label>
            <input type="number" min={1000} max={80000} value={counts.foliage} onChange={(e) => setCounts(c => ({ ...c, foliage: Math.max(1000, Math.min(80000, Number(e.target.value) || 0)) }))} inputMode="numeric" />

            <label>拍立得照片数量（可超过照片数，循环使用）</label>
            <input type="number" min={10} max={1000} value={counts.ornaments} onChange={(e) => setCounts(c => ({ ...c, ornaments: Math.max(1, Math.min(2000, Number(e.target.value) || 0)) }))} inputMode="numeric" />

            <label>圣诞元素数量（礼物盒、球、拐杖糖）</label>
            <input type="number" min={10} max={1000} value={counts.elements} onChange={(e) => setCounts(c => ({ ...c, elements: Math.max(0, Math.min(2000, Number(e.target.value) || 0)) }))} inputMode="numeric" />

            <label>彩灯数量（闪烁灯泡数）</label>
            <input type="number" min={10} max={1000} value={counts.lights} onChange={(e) => setCounts(c => ({ ...c, lights: Math.max(0, Math.min(2000, Number(e.target.value) || 0)) }))} inputMode="numeric" />

            <label>默认视角距离（越小越近）</label>
            <input type="number" min={25} max={120} value={counts.camera.distance} onChange={(e) => setCounts(c => ({ ...c, camera: { distance: Math.max(25, Math.min(120, Number(e.target.value) || 0)) }, gallery: c.gallery }))} inputMode="numeric" />

            <label>照片墙：照片数量</label>
            <input type="number" min={3} max={100} value={counts.gallery.photos} onChange={(e) => setCounts(c => ({ ...c, gallery: { ...c.gallery, photos: Math.max(3, Math.min(100, Number(e.target.value) || 0)) } }))} inputMode="numeric" />

            <label>照片墙：照片大小（缩放）</label>
            <input type="number" min={0.5} max={2.5} value={counts.gallery.scale} onChange={(e) => setCounts(c => ({ ...c, gallery: { ...c.gallery, scale: Math.max(0.5, Math.min(2.5, Number(e.target.value) || 0)) } }))} inputMode="numeric" />

            <label>照片墙：环形半径（密度）</label>
            <input type="number" min={8} max={30} value={counts.gallery.radius} onChange={(e) => setCounts(c => ({ ...c, gallery: { ...c.gallery, radius: Math.max(8, Math.min(30, Number(e.target.value) || 0)) } }))} inputMode="numeric" />

            <label>照片墙：迁移速度（散开→照片墙）</label>
            <input type="number" min={0.2} max={20} value={counts.gallery.moveSpeed} onChange={(e) => setCounts(c => ({ ...c, gallery: { ...c.gallery, moveSpeed: Math.max(0.2, Math.min(20, Number(e.target.value) || 0)) } }))} inputMode="numeric" />
            <hr style={{ borderColor: 'rgba(255,215,0,0.2)' }} />
          </div>
          <p className="hint">提示：数值越大视觉越华丽，但在手机端可能卡顿。建议逐步调试找到合适的平衡。</p>
        </div>
      )}

      {/* 说明面板 */}
      {showHelp && (
        <div className="help-panel" style={{ position: 'absolute', top: '60px', right: '20px', zIndex: 13, width: '360px', background: 'rgba(0,0,0,0.7)', border: '1px solid rgba(255,215,0,0.5)', color: '#FFD700', padding: '12px', borderRadius: '8px', backdropFilter: 'blur(6px)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontWeight: 'bold' }}>使用说明</span>
            <button onClick={() => setShowHelp(false)} style={{ background: 'transparent', border: 'none', color: '#FFD700', cursor: 'pointer' }}>✕</button>
          </div>
          <div style={{ color: '#eee', fontSize: '12px', lineHeight: 1.6 }}>
            <p>🖱 点击屏幕任意处 → 在 Disperse（散开）与 Assemble（聚合）两种状态间切换。</p>
            <hr style={{ borderColor: 'rgba(255,215,0,0.3)' }} />
            <p>📸 上传照片：点击右下角“上传照片”，从电脑或手机选择多张图片。上传后将仅使用你上传的照片来组成圣诞树（若文件名为 top.jpg/png/webp，将优先显示）。支持 jpg/jpeg/png/webp。</p>
            <p>⚙️ 参数说明：
              树叶粒子数量=树身密度；拍立得照片数量=挂件数量（不足时循环纹理）；圣诞元素数量=礼物盒/球/拐杖糖的总数；彩灯数量=闪烁灯泡数。数值越大，视觉更华丽，但对性能的影响也更明显，尤其在移动端。</p>
            <p>🎄 圣诞快乐！</p>
          </div>
        </div>
      )}
    </div>
  );
}
// --- Root Scene: 控制树与照片墙的可见度过渡 ---
const SceneRoot = ({ sceneState, rotationSpeed, photoUrls, counts }: { sceneState: 'CHAOS' | 'FORMED' | 'GALLERY', rotationSpeed: number, photoUrls: string[], counts: { foliage: number; ornaments: number; elements: number; lights: number; gallery: { photos: number; scale: number; radius: number; moveSpeed: number }; camera: { distance: number } } }) => {
  const [galleryVis, setGalleryVis] = useState(0);
  const prevRef = useRef<'CHAOS' | 'FORMED' | 'GALLERY'>(sceneState);
  const originRef = useRef<'CHAOS' | 'FORMED'>('FORMED');
  useEffect(() => {
    if (sceneState === 'GALLERY' && prevRef.current !== 'GALLERY') {
      originRef.current = (prevRef.current === 'CHAOS' ? 'CHAOS' : 'FORMED');
    }
    prevRef.current = sceneState;
  }, [sceneState]);
  useFrame((_, delta) => {
    const target = sceneState === 'GALLERY' ? 1 : 0;
    setGalleryVis(v => MathUtils.damp(v, target, 2.5, delta));
  });
  // GALLERY 期间保持树为散开（背景沿用散开场景），同时让照片挂件向环形迁移
  const treeState: 'CHAOS' | 'FORMED' = sceneState === 'GALLERY' ? 'CHAOS' : (sceneState as 'CHAOS' | 'FORMED');
  return (
    <>
      {/* 单一场景：保留散开状态的背景，仅对照片挂件进行环形插值重组 */}
      <Experience sceneState={treeState} rotationSpeed={rotationSpeed} photoUrls={photoUrls} counts={counts} transitionProgress={galleryVis} ringRadius={counts.gallery.radius} isGallery={sceneState === 'GALLERY'} gallerySpeed={counts.gallery.moveSpeed} />
    </>
  );
};
