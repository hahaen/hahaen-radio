import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from 'three';
import { IMMERSION_EFFECTS, type ImmersionEffect } from '../library/model';

export interface ImmersionOptions {
  mode: ImmersionEffect;
  playing: boolean;
  powerSave: boolean;
}
export function createImmersionScene(host: HTMLElement, initial: ImmersionOptions) {
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'low-power' });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const uniforms = {
    resolution: { value: new Vector2(1, 1) },
    time: { value: 9 },
    mode: { value: IMMERSION_EFFECTS.indexOf(initial.mode) },
    previousMode: { value: IMMERSION_EFFECTS.indexOf(initial.mode) },
    blend: { value: 1 },
  };
  const geometry = new PlaneGeometry(2, 2);
  const material = new ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 uvScene; void main(){uvScene=uv;gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader: `
      uniform vec2 resolution; uniform float time; uniform int mode; uniform int previousMode; uniform float blend;
      varying vec2 uvScene;
      float square(float x){return x*x;}
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float mist(vec2 p){float n=0.0,a=0.5;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+vec2(17.3,9.1);a*=0.5;}return n;}
      vec3 sky(vec2 p){
        float glow=exp(-length((p-vec2(0.2,0.08))*vec2(0.7,1.8))*2.4);
        vec3 col=mix(vec3(0.012,0.031,0.027),vec3(0.035,0.087,0.067),glow);
        vec2 cells=p*vec2(140.0,140.0);vec2 id=floor(cells);vec2 star=fract(cells)-0.5;
        float seed=hash(id);float dotLight=exp(-dot(star,star)*160.0)*step(0.995,seed);
        col+=vec3(0.61,0.72,0.64)*dotLight*(0.34+0.07*sin(time*0.2+seed*30.0))*smoothstep(-0.12,0.25,p.y);
        return col;
      }
      vec3 aurora(vec2 p){
        vec3 col=sky(p);
        float warp=mist(vec2(p.x*1.6,time*0.025));
        for(int i=0;i<4;i++){
          float f=float(i);float path=0.12+0.055*f+0.105*sin(p.x*1.55+time*0.035+f*0.6)+0.026*sin(p.x*5.5-time*0.06+f);
          float h=p.y-path;
          float rays=0.45+0.55*pow(0.5+0.5*sin(p.x*87.0+warp*18.0+f*2.3),2.0);
          float ribbon=exp(-h*h/(0.00035+0.00015*f));
          float veil=exp(-abs(h)*12.0)*smoothstep(-0.025,0.08,h)*rays;
          float envelope=exp(-square((p.x+0.1-f*0.12)*0.65));
          vec3 tint=mix(vec3(0.16,0.46,0.31),vec3(0.44,0.67,0.54),f/3.0);
          col+=tint*(ribbon*0.28+veil*0.20)*envelope;
        }
        float horizon=exp(-square((p.y+0.12)*25.0));
        col+=vec3(0.12,0.21,0.15)*horizon*exp(-p.x*p.x*0.7)*0.25;
        float water=max(0.0,-p.y-0.12);
        float reflected=pow(max(0.0,sin(water*220.0+sin(p.x*23.0+time*0.12)*2.0)),18.0);
        col+=vec3(0.12,0.29,0.20)*reflected*exp(-water*9.0)*smoothstep(0.0,0.04,water)*0.22;
        return col;
      }
      vec3 ocean(vec2 p){
        vec3 col=sky(p)*0.85;
        float distance=-p.y+0.035;
        float horizon=exp(-square((p.y-0.035)*14.0))*exp(-p.x*p.x*0.6);
        col+=vec3(0.16,0.28,0.23)*horizon*0.75;
        if(distance>0.0){
          vec2 sea=vec2(p.x/(distance+0.14),1.0/(distance+0.14));
          float wav=sin(sea.y*11.0-time*0.42+sin(sea.x*3.0+time*0.10)*1.4);
          float sheen=pow(max(0.0,wav),18.0);
          float grain=0.4+0.6*noise(vec2(sea.x*12.0+time*0.08,sea.y*3.0));
          float reflection=exp(-p.x*p.x/(0.035+distance*0.40));
          col=mix(col,vec3(0.009,0.034,0.029),smoothstep(0.0,0.65,distance)*0.8);
          col+=vec3(0.25,0.42,0.34)*sheen*grain*reflection*exp(-distance*2.8)*smoothstep(0.0,0.06,distance)*0.65;
        }
        return col;
      }
      vec3 dunes(vec2 p){
        vec3 col=sky(p);
        col+=vec3(0.13,0.22,0.17)*exp(-square((p.y-0.10)*3.8))*0.6;
        for(int i=0;i<6;i++){
          float f=float(i);float ridge=0.10-f*0.075+0.075*sin(p.x*(1.5+f*0.35)+f*1.7+time*0.012)+0.06*mist(vec2(p.x*2.5+f*7.0,time*0.008));
          vec3 tint=mix(vec3(0.13,0.24,0.18),vec3(0.012,0.037,0.029),f/5.0);
          float fog=exp(-abs(p.y-ridge)*32.0);
          col+=vec3(0.14,0.24,0.17)*fog*0.16;
          col=mix(col,tint,1.0-smoothstep(ridge-0.008,ridge+0.008,p.y));
        }
        return col;
      }
      vec3 environment(int effect,vec2 p){if(effect==1)return ocean(p);if(effect==2)return dunes(p);return aurora(p);}
      void main(){
        vec2 p=(uvScene-0.5)*vec2(resolution.x/resolution.y,1.0);
        vec3 col=environment(mode,p);
        if(blend<1.0)col=mix(environment(previousMode,p),col,smoothstep(0.0,1.0,blend));
        float vignette=1.0-smoothstep(0.25,1.0,length((uvScene-0.5)*vec2(0.8,0.9)));
        col*=0.75+0.25*vignette;
        col+=(hash(gl_FragCoord.xy)-0.5)/360.0;
        gl_FragColor=vec4(col,1.0);
        #include <colorspace_fragment>
      }`,
  });
  scene.add(new Mesh(geometry, material));
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let options = initial;
  let frame = 0,
    disposed = false,
    lost = false,
    lastPaint = 0,
    lastTime = 0;
  let transition = 0;
  let lastWidth = 0,
    lastHeight = 0,
    lastRatio = 0;
  const animated = () => options.playing && !options.powerSave && !motion.matches;
  function invalidate() {
    if (!frame && !disposed && !lost && !document.hidden) frame = requestAnimationFrame(draw);
  }
  function draw(now: number) {
    frame = 0;
    if (disposed || lost || document.hidden) return;
    if (animated() && now - lastPaint < 1000 / 30) {
      invalidate();
      return;
    }
    if (animated() && lastTime) uniforms.time.value += Math.min(0.1, (now - lastTime) / 1000);
    lastTime = now;
    lastPaint = now;
    if (transition) {
      uniforms.blend.value =
        motion.matches || options.powerSave ? 1 : Math.min(1, (now - transition) / 700);
      if (uniforms.blend.value === 1) transition = 0;
    }
    renderer.render(scene, camera);
    if (host.dataset.rendered !== 'true') host.dataset.rendered = 'true';
    if (animated() || transition) invalidate();
  }
  function resize() {
    if (disposed || lost) return;
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    const ceiling = options.powerSave ? 0.65 : width < 768 ? 1 : 1.25;
    const ratio = Math.min(devicePixelRatio || 1, ceiling, Math.sqrt(1600000 / (width * height)));
    if (width === lastWidth && height === lastHeight && ratio === lastRatio) return;
    lastWidth = width;
    lastHeight = height;
    lastRatio = ratio;
    renderer.setPixelRatio(ratio);
    renderer.setSize(width, height, false);
    uniforms.resolution.value.set(width, height);
    invalidate();
  }
  const visibility = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    invalidate();
  };
  const contextLost = (event: Event) => {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    host.dataset.rendered = 'false';
  };
  const restored = () => {
    lost = false;
    resize();
    invalidate();
  };
  const observer = new ResizeObserver(resize);
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', restored);
  document.addEventListener('visibilitychange', visibility);
  motion.addEventListener('change', visibility);
  host.append(canvas);
  host.dataset.rendered = 'false';
  observer.observe(host);
  resize();
  return {
    update(next: ImmersionOptions) {
      if (disposed) return;
      const mode = IMMERSION_EFFECTS.indexOf(next.mode);
      if (mode !== uniforms.mode.value) {
        uniforms.previousMode.value = uniforms.mode.value;
        uniforms.mode.value = mode;
        uniforms.blend.value = 0;
        transition = performance.now();
      }
      const sizing = options.powerSave !== next.powerSave;
      options = next;
      lastTime = 0;
      if (sizing) resize();
      invalidate();
    },
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', restored);
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', visibility);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      host.dataset.rendered = 'false';
    },
  };
}
