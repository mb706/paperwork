import { chromium } from '/home/mewse/.local/lib/node_modules/playwright/index.mjs';
const js = `
(async () => {
const W=1280,H=720; const c=document.createElement('canvas'); c.width=W; c.height=H; document.body.appendChild(c);
const gl=c.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:true});
const ren=gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
const vs=\`#version 300 es
layout(location=0) in vec2 pos; layout(location=1) in vec3 uvl; uniform vec2 screen; out vec3 vuv;
void main(){ gl_Position=vec4(pos/screen*2.0-1.0,0,1); gl_Position.y=-gl_Position.y; vuv=uvl; }\`;
const fs=\`#version 300 es
precision mediump float; precision mediump sampler2DArray; uniform sampler2DArray tex; in vec3 vuv; out vec4 o;
void main(){ vec4 t=texture(tex,vuv); if(t.a<0.01) discard; o=t; }\`;
function sh(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw gl.getShaderInfoLog(x);return x;}
const pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,vs));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(pr);gl.useProgram(pr);
gl.uniform2f(gl.getUniformLocation(pr,'screen'),W,H);
const tx=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D_ARRAY,tx);gl.texStorage3D(gl.TEXTURE_2D_ARRAY,1,gl.RGBA8,256,256,4);
const px=new Uint8Array(256*256*4); for(let i=0;i<px.length;i+=4){px[i]=(i>>3)&255;px[i+1]=(i>>11)&255;px[i+2]=128;px[i+3]=((i>>2)%7)?255:0;}
for(let l=0;l<4;l++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,l,256,256,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
const vao=gl.createVertexArray();gl.bindVertexArray(vao);
const vb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,vb);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,20,0);
gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,3,gl.FLOAT,false,20,8);
const ibuf=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ibuf);
const MAXQ=150000; const idx=new Uint32Array(MAXQ*6); for(let q=0;q<MAXQ;q++){const v=q*4,o=q*6;idx[o]=v;idx[o+1]=v+1;idx[o+2]=v+2;idx[o+3]=v+2;idx[o+4]=v+1;idx[o+5]=v+3;}
gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx,gl.STATIC_DRAW);
gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
const res={renderer:ren};
for (const [N,size] of [[5000,32],[20000,32],[20000,8],[150000,8]]) {
  const v=new Float32Array(N*4*5);
  for(let i=0;i<N;i++){const x=(i*37)%W,y=(i*91)%H,l=i%4; const cs=[[0,0],[1,0],[0,1],[1,1]]; for(let k=0;k<4;k++){const o=(i*4+k)*5; v[o]=x+cs[k][0]*size; v[o+1]=y+cs[k][1]*size; v[o+2]=cs[k][0]*0.25; v[o+3]=cs[k][1]*0.25; v[o+4]=l;}}
  gl.bufferData(gl.ARRAY_BUFFER,v,gl.DYNAMIC_DRAW);
  const frames=5; const t0=performance.now();
  for(let f=0;f<frames;f++){ gl.clearColor(0.1,0.2,0.1,1);gl.clear(gl.COLOR_BUFFER_BIT); gl.bufferSubData(gl.ARRAY_BUFFER,0,v); gl.drawElements(gl.TRIANGLES,N*6,gl.UNSIGNED_INT,0); const p=new Uint8Array(4); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p); }
  res['expanded '+N+'x'+size+'px']=((performance.now()-t0)/frames).toFixed(1)+' ms/frame';
}
document.title=JSON.stringify(res);
})();`;
for (const args of [[], ['--use-angle=swiftshader'], ['--use-gl=angle','--use-angle=swiftshader-webgl']]) {
  const b = await chromium.launch({ executablePath: '/home/mewse/.local/opt/chrome-current/chrome', args });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  await p.setContent('<html><body style="margin:0"></body></html>');
  try { await p.evaluate(js); await p.waitForFunction(() => document.title.startsWith('{'), null, { timeout: 120000 }); console.log(JSON.stringify(args), await p.title()); }
  catch (e) { console.log(JSON.stringify(args), 'ERR', String(e).slice(0,200)); }
  await b.close();
}
