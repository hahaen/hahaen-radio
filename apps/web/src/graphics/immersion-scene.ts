import {
  Color,
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
  const theme = getComputedStyle(host);
  const themeColor = (name: string) => new Color(theme.getPropertyValue(name).trim());
  const uniforms = {
    ink: { value: themeColor('--color-bg') },
    terrain: { value: themeColor('--color-surface').multiplyScalar(1.65) },
    mistColor: { value: themeColor('--color-secondary') },
    starlight: { value: themeColor('--color-text') },
    resolution: { value: new Vector2(1, 1) },
    time: { value: 9 },
    waveActivity: { value: initial.playing ? 1 : 0 },
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
      uniform vec2 resolution; uniform float time; uniform float waveActivity; uniform int mode; uniform int previousMode; uniform float blend;
      uniform vec3 ink; uniform vec3 terrain; uniform vec3 mistColor; uniform vec3 starlight;
      varying vec2 uvScene;
      float square(float x){return x*x;}
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      float mist(vec2 p){float n=0.0,a=0.5;for(int i=0;i<4;i++){n+=a*noise(p);p=p*2.03+vec2(17.3,9.1);a*=0.5;}return n;}
      vec3 sky(vec2 p){
        float glow=exp(-length((p-vec2(0.2,0.08))*vec2(0.7,1.8))*2.4);
        vec3 col=mix(ink*0.72,terrain*0.40,glow);
        vec2 cells=p*vec2(140.0,140.0);vec2 id=floor(cells);vec2 star=fract(cells)-0.5;
        float seed=hash(id);float dotLight=exp(-dot(star,star)*160.0)*step(0.995,seed);
        col+=starlight*dotLight*(0.34+0.07*sin(time*0.2+seed*30.0))*smoothstep(-0.12,0.25,p.y);
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
          vec3 tint=mix(terrain,mistColor*0.58,f/3.0);
          col+=tint*(ribbon*0.28+veil*0.20)*envelope;
        }
        float horizon=exp(-square((p.y+0.12)*25.0));
        col+=mistColor*0.12*horizon*exp(-p.x*p.x*0.7)*0.25;
        float water=max(0.0,-p.y-0.12);
        float reflected=pow(max(0.0,sin(water*220.0+sin(p.x*23.0+time*0.12)*2.0)),18.0);
        col+=terrain*reflected*exp(-water*9.0)*smoothstep(0.0,0.04,water)*0.22;
        return col;
      }
      bool portraitScene(){return resolution.x<768.0 && resolution.y>=500.0;}
      vec3 moonlitSky(vec2 uv){
        vec2 p=(uv-0.5)*vec2(resolution.x/resolution.y,1.0);
        vec3 col=sky(p)*0.85;
        float haze=exp(-square((uv.y-0.64)*8.0))*exp(-square((uv.x-0.65)*1.3));
        col+=mistColor*haze*0.075;
        vec2 moon=(uv-vec2(0.72,0.77))*vec2(resolution.x/resolution.y,1.0);
        float radius=0.010;
        float edge=1.2/resolution.y;
        float disk=1.0-smoothstep(radius-edge,radius+edge,length(moon));
        float halo=exp(-length(moon)*48.0);
        col+=mix(mistColor,starlight,0.55)*(disk*0.60+halo*0.035);
        return col;
      }
      vec3 portraitOcean(vec2 uv){
        vec3 col=moonlitSky(uv);
        float depth=0.61-uv.y;
        float horizon=exp(-square((uv.y-0.61)*180.0));
        col+=mistColor*horizon*0.065;
        if(depth>0.0){
          float perspective=1.0/(depth+0.10);
          vec2 sea=vec2((uv.x-0.5)*perspective,perspective);
          float drift=time*1.10;
          float swell=sin(sea.y*12.0+drift+sin(sea.x*2.2+time*0.24)*0.7);
          float detail=noise(vec2(sea.x*28.0+time*0.65,sea.y*18.0+drift*0.8));
          float crest=pow(max(0.0,swell),12.0);
          float reflectedMoon=0.72+0.016*sin(time*0.45)+0.008*sin(time*1.05);
          float reflection=exp(-square((uv.x-reflectedMoon)/(0.028+depth*0.70)));
          float glints=smoothstep(0.48,0.82,detail)*crest;
          float fade=exp(-depth*6.0)*smoothstep(0.0,0.018,depth);
          col=mix(terrain*0.42,ink*0.72,smoothstep(0.0,0.48,depth));
          float shimmer=0.86+0.14*sin(sea.y*2.4+time*1.2);
          col+=mistColor*(crest*0.016+glints*(0.030+reflection*0.34)*shimmer)*fade;
          col+=mistColor*reflection*fade*0.016;
        }
        return col;
      }
      vec3 portraitMountains(vec2 uv){
        vec3 col=moonlitSky(uv);
        for(int i=0;i<5;i++){
          float f=float(i);
          float x=uv.x*2.8+f*3.7;
          float profile=0.045*sin(x*2.1+f)+0.020*sin(x*4.8+f*1.4)
            +0.032*noise(vec2(x*2.5,f*11.0))
            +0.014*noise(vec2(x*7.0,f*5.0))
            +0.006*noise(vec2(x*19.0,f*3.0));
          float ridge=0.68-f*0.056+profile;
          float below=ridge-uv.y;
          float edge=1.5/resolution.y;
          vec3 tint=mix(mix(terrain,mistColor,0.12),ink*0.82,f/4.0);
          float wind=uv.x*4.0-time*(0.10+f*0.015)+f*1.7;
          float billow=0.010*sin(uv.x*6.0-time*0.32+f);
          float valley=exp(-square((below-0.045-billow)*23.0));
          float vapor=noise(vec2(wind,uv.y*9.0+f*2.3));
          float wisps=noise(vec2(wind*2.1+time*0.04,uv.y*26.0+f));
          float mistDrift=smoothstep(0.18,0.82,vapor*0.72+wisps*0.28);
          tint+=mistColor*valley*(0.12+mistDrift*0.88)*(0.105-f*0.018);
          col=mix(col,tint,smoothstep(-edge,edge,below));
        }
        return col;
      }
      vec3 ocean(vec2 p){
        if(portraitScene())return portraitOcean(uvScene);
        vec3 col=sky(p)*0.85;
        float horizonY=resolution.y<500.0?0.30:0.13;
        float distance=-p.y+horizonY;
        float horizon=exp(-square((p.y-horizonY)*14.0))*exp(-p.x*p.x*0.6);
        col+=mix(terrain*2.0,mistColor,0.55)*horizon*0.16;
        if(distance>0.0){
          vec2 sea=vec2(p.x/(distance+0.14),1.0/(distance+0.14));
          float wav=sin(sea.y*11.0-time*0.42+sin(sea.x*3.0+time*0.10)*1.4);
          float sheen=pow(max(0.0,wav),18.0);
          float grain=0.4+0.6*noise(vec2(sea.x*12.0+time*0.08,sea.y*3.0));
          float reflection=exp(-p.x*p.x/(0.035+distance*0.40));
          col=mix(col,ink*0.85,smoothstep(0.0,0.65,distance)*0.8);
          col+=mistColor*0.30*sheen*grain*reflection*exp(-distance*2.8)*smoothstep(0.0,0.06,distance)*0.65;
        }
        return col;
      }
      vec3 dunes(vec2 p){
        if(portraitScene())return portraitMountains(uvScene);
        vec3 col=sky(p);
        col+=mistColor*0.10*exp(-square((p.y-0.10)*3.8))*0.6;
        for(int i=0;i<6;i++){
          float f=float(i);float ridge=0.10-f*0.075+0.075*sin(p.x*(1.5+f*0.35)+f*1.7+time*0.012)+0.06*mist(vec2(p.x*2.5+f*7.0,time*0.008));
          vec3 tint=mix(terrain*0.95,ink*0.80,f/5.0);
          float fog=exp(-abs(p.y-ridge)*32.0);
          col+=mistColor*0.12*fog*0.16;
          col=mix(col,tint,1.0-smoothstep(ridge-0.008,ridge+0.008,p.y));
        }
        return col;
      }
      vec3 environment(int effect,vec2 p){if(effect==1)return ocean(p);if(effect==2)return dunes(p);return aurora(p);}
      vec3 lightRibbons(vec2 uv){
        float x=(uv.x-0.5)*2.0;
        float envelope=exp(-x*x*2.8)*(1.0-smoothstep(0.75,1.0,abs(x)));
        float baseline=resolution.y<500.0?0.80:0.60;
        float heightScale=resolution.y<500.0?0.6:1.0;
        float swell=0.70+0.20*sin(time*1.15)+0.10*sin(time*2.7);
        vec3 light=vec3(0.0);
        for(int i=0;i<5;i++){
          float f=float(i),phase=f*0.48;
          float carrier=sin(x*13.0-time*2.2+phase)
            +0.42*sin(x*24.0+time*3.1-phase)
            +0.18*sin(x*41.0-time*4.0+phase*0.6);
          float curve=carrier*0.033*swell*envelope*heightScale*waveActivity*(0.72+f*0.12);
          float distance=uv.y-baseline-curve-(f-2.0)*0.003;
          float core=exp(-square(distance*resolution.y/1.1));
          float halo=exp(-abs(distance)*150.0)*0.10;
          float emphasis=i==2?0.65:0.19;
          vec3 tint=i==2?mix(mistColor,starlight,0.16):terrain*1.8;
          float glint=pow(max(0.0,cos(x*9.0-time*1.6+phase)),18.0)*waveActivity;
          light+=tint*(core*(1.0+glint*0.65)+halo)*emphasis*envelope;
        }
        return light;
      }
      vec3 tidalRings(vec2 uv){
        float baseline=resolution.y<500.0?0.78:0.56;
        float horizon=resolution.y<500.0?0.80:0.63;
        float waterMask=1.0-smoothstep(horizon-0.01,horizon+0.02,uv.y);
        vec3 light=vec3(0.0);
        for(int i=0;i<5;i++){
          float f=float(i),age=fract(time*0.115+f*0.20);
          vec2 origin=vec2(0.5+0.025*sin(time*0.13+f),baseline);
          float perspective=max(1.0,resolution.y/resolution.x);
          float flatten=resolution.y<500.0?16.0:7.5*perspective;
          vec2 p=(uv-origin)*vec2(2.0,flatten);
          float r=length(p);
          float angle=r>0.0001?atan(p.y,p.x):0.0;
          float wobble=0.006*sin(angle*6.0+time*0.8+f);
          float radius=0.055+age*0.76+wobble;
          float feather=max(fwidth(r),0.001);
          float core=exp(-square((r-radius)/(feather*1.15)));
          float halo=exp(-abs(r-radius)*90.0)*0.08;
          float fading=square(1.0-age)*smoothstep(0.0,0.12,age);
          float reflection=0.55+0.45*noise(p*6.0+vec2(time*0.07,f));
          vec3 tint=mix(terrain*1.5,mistColor,1.0-age);
          light+=tint*(core+halo)*fading*reflection*0.74*waveActivity*waterMask;
        }
        return light;
      }
      vec3 harmonicRidges(vec2 uv){
        float x=(uv.x-0.5)*2.0;
        float baseline=resolution.y<500.0?0.82:0.64;
        float heightScale=resolution.y<500.0?0.45:1.0;
        float spacing=resolution.y<500.0?0.006:0.010;
        float envelope=exp(-x*x*1.7)*(1.0-smoothstep(0.80,1.0,abs(x)));
        float slope=0.035*sin(x*2.6+0.25*sin(time*0.12))+0.012*sin(x*7.0-time*0.13);
        vec3 light=vec3(0.0);
        for(int i=0;i<8;i++){
          float f=float(i),phase=f*0.45;
          float resonance=sin(x*8.0-time*0.8+phase)+0.35*sin(x*19.0+time*1.3-phase);
          float swell=0.75+0.25*sin(time*0.9+x*2.0+phase);
          float curve=(slope+resonance*(0.007+f*0.0014)*swell*envelope*waveActivity)*heightScale;
          float distance=uv.y-baseline+f*spacing-curve;
          float core=exp(-square(distance*resolution.y/0.9));
          float mistLight=exp(-abs(distance)*100.0)*0.045;
          float glint=pow(max(0.0,cos(x*6.0+time*0.55-phase)),16.0)*waveActivity;
          vec3 tint=mix(terrain*1.5,mistColor,f/7.0);
          light+=tint*(core*(0.22+glint*0.28)+mistLight)*envelope;
        }
        return light;
      }
      vec3 soundWaves(int effect,vec2 uv){
        if(portraitScene() && effect!=0)return vec3(0.0);
        if(effect==1)return tidalRings(uv);
        if(effect==2)return harmonicRidges(uv);
        return lightRibbons(uv);
      }
      void main(){
        vec2 p=(uvScene-0.5)*vec2(resolution.x/resolution.y,1.0);
        vec3 col=environment(mode,p)+soundWaves(mode,uvScene);
        if(blend<1.0)col=mix(environment(previousMode,p)+soundWaves(previousMode,uvScene),col,smoothstep(0.0,1.0,blend));
        float vignette=1.0-smoothstep(0.25,1.0,length((uvScene-0.5)*vec2(0.8,0.9)));
        col*=0.75+0.25*vignette;
        gl_FragColor=vec4(col,1.0);
        #include <colorspace_fragment>
        gl_FragColor.rgb+=(hash(gl_FragCoord.xy)-0.5)/255.0;
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
      uniforms.waveActivity.value = next.playing ? 1 : 0;
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
