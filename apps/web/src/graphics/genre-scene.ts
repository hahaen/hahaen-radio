import {
  AdditiveBlending,
  Color,
  BufferGeometry,
  Float32BufferAttribute,
  OrthographicCamera,
  Points,
  ShaderMaterial,
  Scene,
  WebGLRenderer,
} from 'three';
export interface GenreCloud {
  id: string;
  count: number;
  label: HTMLElement;
}
export function createGenreScene(host: HTMLElement, clouds: GenreCloud[], powerSave: boolean) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !powerSave,
    powerPreference: 'low-power',
  });
  const scene = new Scene(),
    camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  camera.position.z = 500;
  const largest = Math.max(1, ...clouds.map((cloud) => cloud.count));
  const objects = clouds.map((cloud, index) => {
    const positions: number[] = [],
      strengths: number[] = [];
    const count = Math.min(powerSave ? 280 : 4200, cloud.count);
    for (let i = 0; i < count; i++) {
      // Stable arms and a sparse halo give each category a distinct silhouette.
      const seed = ((Math.imul(i + 1, 2654435761) >>> 0) % 65536) / 65536,
        noise = Math.sin(i * 127.1 + index * 31.7),
        radius = Math.pow((i + 0.5) / count, 0.85),
        arms = 2 + (index % 3),
        halo = i % 7 === 0,
        angle = halo
          ? i * 2.3999632297
          : ((i % arms) * Math.PI * 2) / arms + radius * (3.8 + (index % 4) * 0.5) + noise * 0.65;
      const spread = halo ? 0 : Math.sin(i * 93.7) * (0.03 + radius * 0.16);
      positions.push(
        Math.cos(angle) * radius + spread,
        (Math.sin(angle) * radius + Math.cos(i * 73.3) * radius * 0.12) *
          (0.48 + (index % 3) * 0.09),
        Math.sin(i * 7.13) * radius * 0.1,
      );
      strengths.push(0.38 + seed * 0.62);
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setAttribute('strength', new Float32BufferAttribute(strengths, 1));
    const material = new ShaderMaterial({
      uniforms: {
        tint: {
          value: new Color(
            getComputedStyle(cloud.label).getPropertyValue('--genre-color').trim() || '#91aaa0',
          ),
        },
        pointSize: { value: 1 },
        emphasis: { value: 0 },
        densityLight: { value: 1 },
      },
      vertexShader: `uniform float pointSize; attribute float strength; varying float vStrength; varying float vRadius;
        void main(){vStrength=strength;vRadius=length(position.xy);
          gl_PointSize=pointSize*(0.75+strength*0.65);
          gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `uniform vec3 tint; uniform float emphasis; uniform float densityLight; varying float vStrength; varying float vRadius;
        void main(){float d=length(gl_PointCoord-0.5);if(d>0.5)discard;
          float core=1.0-smoothstep(0.08,0.32,d);
          float halo=exp(-d*d*18.0)*0.28;
          vec3 color=mix(tint,vec3(0.94,0.93,0.85),(1.0-smoothstep(0.0,0.5,vRadius))*0.55);
          gl_FragColor=vec4(color,(core*0.7+halo)*vStrength*(0.52+emphasis*0.22)*densityLight);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      blending: AdditiveBlending,
      depthTest: false,
      depthWrite: false,
    });
    const points = new Points(geometry, material);
    points.rotation.z = [0.24, -0.32, 0.15, -0.18][index % 4]!;
    scene.add(points);
    return {
      points,
      label: cloud.label,
      art: cloud.label.querySelector<HTMLElement>('[data-genre-art]')!,
      count,
      scale: 0.63 + Math.sqrt(cloud.count / largest) * 0.37,
    };
  });
  let frame = 0,
    disposed = false,
    lost = false;
  const draw = () => {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    const bounds = host.getBoundingClientRect();
    for (const { points, label, art, scale, count } of objects) {
      const box = art.getBoundingClientRect();
      points.position.set(
        box.x + box.width / 2 - bounds.x - bounds.width / 2,
        bounds.height / 2 - (box.y + box.height / 2 - bounds.y),
        0,
      );
      const radius = Math.min(box.width * 0.41, box.height * 0.82) * scale;
      points.scale.setScalar(radius);
      points.material.uniforms.densityLight!.value = Math.sqrt(
        Math.min(1, (radius * radius) / Math.max(150, count * 1.3)),
      );
      points.visible = box.bottom > bounds.top && box.top < bounds.bottom;
      points.material.uniforms.emphasis!.value =
        label.matches(':hover, :focus-visible') || label.getAttribute('aria-current') === 'true'
          ? 1
          : 0;
    }
    renderer.render(scene, camera);
  };
  const invalidate = () => {
    if (!frame && !disposed && !lost && !document.hidden) frame = requestAnimationFrame(draw);
  };
  const resize = () => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    camera.left = -width / 2;
    camera.right = width / 2;
    camera.top = height / 2;
    camera.bottom = -height / 2;
    camera.updateProjectionMatrix();
    const ratio = powerSave ? 1 : Math.min(devicePixelRatio || 1, 1.5);
    renderer.setPixelRatio(ratio);
    for (const object of objects)
      object.points.material.uniforms.pointSize!.value = (width < 500 ? 2.1 : 2.8) * ratio;
    renderer.setSize(width, height, false);
    invalidate();
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    host.dataset.rendered = 'false';
  };
  const restored = () => {
    lost = false;
    host.dataset.rendered = 'true';
    resize();
  };
  const visibility = () => {
    if (document.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else invalidate();
  };
  const events = ['pointerover', 'pointerout', 'focusin', 'focusout', 'scroll'] as const;
  for (const event of events) host.addEventListener(event, invalidate, true);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);
  const observer = new ResizeObserver(resize);
  host.prepend(canvas);
  host.dataset.rendered = 'true';
  observer.observe(host);
  for (const { art } of objects) observer.observe(art);
  const selectionObserver = new MutationObserver(invalidate);
  selectionObserver.observe(host, {
    subtree: true,
    attributes: true,
    attributeFilter: ['aria-current'],
  });
  resize();
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    selectionObserver.disconnect();
    for (const event of events) host.removeEventListener(event, invalidate, true);
    canvas.removeEventListener('webglcontextlost', contextLost);
    canvas.removeEventListener('webglcontextrestored', restored);
    document.removeEventListener('visibilitychange', visibility);
    for (const { points } of objects) {
      points.geometry.dispose();
      points.material.dispose();
    }
    scene.clear();
    renderer.dispose();
    renderer.forceContextLoss();
    canvas.remove();
    delete host.dataset.rendered;
  };
}
