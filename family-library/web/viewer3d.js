import * as THREE from 'three';
import {OrbitControls} from './vendor/three/OrbitControls.js';

export function createFamilyViewer(container, modelUrl, onError) {
  const abort = new AbortController();
  let disposed = false;
  let animation;
  let renderer;
  let controls;
  let resizeObserver;
  let scene;
  let camera;
  let defaultDistance = 1;
  let bounds;
  const geometries = [];
  const materials = [];
  const status = document.createElement('output');
  status.className = 'viewer-zoom';
  const loading = document.createElement('div');
  loading.className = 'viewer-loading';
  loading.textContent = '正在載入真實 3D 幾何…';
  container.replaceChildren(loading);

  function fit(front = false) {
    if (!bounds || !camera || !controls) return;
    const size = bounds.getSize(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.01);
    const aspect = Math.max(camera.aspect, 0.1);
    const angle = THREE.MathUtils.degToRad(camera.fov / 2);
    const center = bounds.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    const direction = front ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(1.6, -2.6, 1.4).normalize();
    const right = new THREE.Vector3().crossVectors(camera.up, direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    let distance = radius * 0.1;
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          const depth = corner.dot(direction);
          distance = Math.max(distance,
            Math.abs(corner.dot(right)) / (Math.tan(angle) * aspect) + depth,
            Math.abs(corner.dot(up)) / Math.tan(angle) + depth);
        }
      }
    }
    distance *= 1.15;
    camera.position.copy(center).addScaledVector(direction, distance);
    camera.near = Math.max(radius / 1000, 0.00001);
    camera.far = Math.max(distance + radius * 100, 100);
    camera.updateProjectionMatrix();
    controls.minDistance = radius * 0.08;
    controls.maxDistance = radius * 30;
    defaultDistance = distance;
    controls.update();
  }

  function zoom(factor) {
    if (!controls || !camera) return;
    const offset = camera.position.clone().sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance));
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  function dispose() {
    disposed = true;
    abort.abort();
    cancelAnimationFrame(animation);
    resizeObserver?.disconnect();
    controls?.dispose();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    container.replaceChildren();
  }

  async function load() {
    try {
      const response = await fetch(modelUrl, {signal:abort.signal, cache:'no-cache'});
      if (!response.ok) throw new Error('模型檔無法載入（HTTP ' + response.status + '）');
      const data = await response.json();
      if (disposed) return;
      if (data.schema !== 1 || data.units !== 'meters') throw new Error('不支援的模型格式');
      renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.setClearColor(0xf5f7f2);
      renderer.domElement.tabIndex = 0;
      renderer.domElement.dataset.modelUrl=modelUrl;
      renderer.domElement.dataset.modelType=data.familyType || '未命名類型';
      renderer.domElement.setAttribute('role','img');
      renderer.domElement.setAttribute('aria-label','可旋轉縮放的 Revit 3D 元件。拖曳旋轉、滾輪縮放、右鍵平移；加減鍵縮放，R 鍵重設。');
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(40, 1, 0.001, 1000);
      camera.up.set(0, 0, 1);
      const hemisphere = new THREE.HemisphereLight(0xffffff, 0xa3aca0, 2.4);
      hemisphere.position.set(0, 0, 10);
      scene.add(hemisphere);
      const key = new THREE.DirectionalLight(0xffffff, 2.5);
      key.position.set(4, -6, 8);
      scene.add(key);
      const fill = new THREE.DirectionalLight(0xffffff, 1.1);
      fill.position.set(-5, 3, 4);
      scene.add(fill);
      const group = new THREE.Group();
      for (const part of data.meshes || []) {
        if (!part.positions?.length || !part.indices?.length) continue;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(part.positions, 3));
        geometry.setIndex(part.indices);
        geometry.computeVertexNormals();
        const color = new THREE.Color().setRGB(...part.color, THREE.SRGBColorSpace);
        const material = new THREE.MeshStandardMaterial({
          color, roughness:0.72, metalness:0.05, side:THREE.DoubleSide,
          transparent:part.opacity < 0.99, opacity:part.opacity,
          depthWrite:part.opacity >= 0.99,
        });
        geometries.push(geometry);
        materials.push(material);
        group.add(new THREE.Mesh(geometry, material));
        const edges = new THREE.EdgesGeometry(geometry, 30);
        const edgeMaterial = new THREE.LineBasicMaterial({color:0x4c5b50, transparent:true, opacity:0.55});
        geometries.push(edges);
        materials.push(edgeMaterial);
        group.add(new THREE.LineSegments(edges, edgeMaterial));
      }
      if (data.lines?.length) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.lines, 3));
        const material = new THREE.LineBasicMaterial({color:0x496854});
        geometries.push(geometry);
        materials.push(material);
        group.add(new THREE.LineSegments(geometry, material));
      }
      if (!group.children.length) throw new Error('這個元件沒有可顯示的 3D 幾何');
      scene.add(group);
      bounds = new THREE.Box3().setFromObject(group);
      if (bounds.isEmpty()) throw new Error('模型範圍為空');
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.screenSpacePanning = true;
      controls.addEventListener('change', () => {
        const ratio = defaultDistance / camera.position.distanceTo(controls.target);
        status.textContent = '縮放 ' + Math.round(ratio * 100) + '%';
        renderer.domElement.setAttribute('data-view-angle', Math.round(controls.getAzimuthalAngle() * 180 / Math.PI));
      });
      renderer.domElement.addEventListener('keydown', event => {
        if (['+','=','-','r','R'].includes(event.key)) event.preventDefault();
        if (event.key === '+' || event.key === '=') zoom(0.85);
        if (event.key === '-') zoom(1.18);
        if (event.key.toLowerCase() === 'r') fit();
      });
      container.replaceChildren(renderer.domElement, status);
      let hasSize=false;
      function resize() {
        const width = container.clientWidth;
        const height = container.clientHeight;
        if (!width || !height) return;
        renderer.setSize(width, height);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        if(!hasSize) {hasSize=true;fit();}
      }
      resizeObserver = new ResizeObserver(resize);
      resizeObserver.observe(container);
      resize();
      fit();
      function render() {
        if (disposed) return;
        controls.update();
        if (container.getClientRects().length) renderer.render(scene, camera);
        animation = requestAnimationFrame(render);
      }
      render();
    } catch (error) {
      if (disposed || error.name === 'AbortError') return;
      container.replaceChildren();
      const message = document.createElement('p');
      message.className = 'viewer-loading';
      message.textContent = '3D 載入失敗，可切換圖片預覽。' + error.message;
      container.append(message);
      onError?.(error);
    }
  }
  load();
  return {dispose, reset:() => fit(), front:() => fit(true), zoomIn:() => zoom(0.85), zoomOut:() => zoom(1.18)};
}
