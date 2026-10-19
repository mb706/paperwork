import { chromium } from '/home/mewse/.local/lib/node_modules/playwright/index.mjs';
const page_js = `
(async () => {
const W=1280,H=720; const c=document.createElement('canvas'); c.width=W; c.height=H; document.body.appendChild(c);
const gl=c.getContext('webgl2',{antialias:false,alpha:false,preserveDrawingBuffer:true});
const ren=gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL);
const vs=\`#version 300 es
layout(location=0) in vec2 corner; layout(location=1) in vec4 rect; layout(location=2) in vec4 uvl; 
uniform vec2 screen; out vec3 vuv;
void main(){ vec2 p=rect.xy+corner*rect.zw; gl_Position=vec4(p/screen*2.0-1.0,0,1); gl_Position.y=-gl_Position.y; vuv=vec3(uvl.xy+corner*0.25, floor(uvl.w)); }\`;
const fs=\`#version 300 es
precision mediump float; precision mediump sampler2DArray; uniform sampler2DArray tex; in vec3 vuv; out vec4 o;
void main(){ vec4 t=texture(tex,vuv); if(t.a<0.01) discard; o=t; }\`;
function sh(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);if(!gl.getShaderParameter(x,gl.COMPILE_STATUS))throw gl.getShaderInfoLog(x);return x;}
const pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,vs));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,fs));gl.linkProgram(pr);gl.useProgram(pr);
gl.uniform2f(gl.getUniformLocation(pr,'screen'),W,H);
// texture array 4 layers 256x256
const tx=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D_ARRAY,tx);gl.texStorage3D(gl.TEXTURE_2D_ARRAY,1,gl.RGBA8,256,256,4);
const px=new Uint8Array(256*256*4); for(let i=0;i<px.length;i+=4){px[i]=(i>>3)&255;px[i+1]=(i>>11)&255;px[i+2]=128;px[i+3]=((i>>2)%7)?255:0;}
for(let l=0;l<4;l++) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY,0,0,0,l,256,256,1,gl.RGBA,gl.UNSIGNED_BYTE,px);
gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D_ARRAY,gl.TEXTURE_MAG_FILTER,gl.NEAREST);
const vao=gl.createVertexArray();gl.bindVertexArray(vao);
const cb=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,cb);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
const ib=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,ib);
gl.enableVertexAttribArray(1);gl.vertexAttribPointer(1,4,gl.FLOAT,false,32,0);gl.vertexAttribDivisor(1,1);
gl.enableVertexAttribArray(2);gl.vertexAttribPointer(2,4,gl.FLOAT,false,32,16);gl.vertexAttribDivisor(2,1);
gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
const res={renderer:ren};
for (const [N,size] of [[5000,32],[20000,32],[60000,16],[150000,8]]) {
  const inst=new Float32Array(N*8);
  for(let i=0;i<N;i++){inst[i*8]=(i*37)%W;inst[i*8+1]=(i*91)%H;inst[i*8+2]=size;inst[i*8+3]=size;inst[i*8+4]=0;inst[i*8+5]=0;inst[i*8+6]=0;inst[i*8+7]=i%4;}
  gl.bufferData(gl.ARRAY_BUFFER,inst,gl.DYNAMIC_DRAW);
  const frames=5; const t0=performance.now();
  for(let f=0;f<frames;f++){ gl.clearColor(0.1,0.2,0.1,1);gl.clear(gl.COLOR_BUFFER_BIT); gl.bufferSubData(gl.ARRAY_BUFFER,0,inst); gl.drawArraysInstanced(gl.TRIANGLE_STRIP,0,4,N); const p=new Uint8Array(4); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p); }
  res[N+'x'+size+'px']=((performance.now()-t0)/frames).toFixed(1)+' ms/frame';
}
// CPU-side: fill 100k instances x 8 floats
{ const N=100000, inst=new Float32Array(N*8); const t0=performance.now(); for(let r=0;r<20;r++) for(let i=0;i<N;i++){const o=i*8; inst[o]=i*1.5; inst[o+1]=i*0.5; inst[o+2]=32; inst[o+3]=32; inst[o+4]=0.1; inst[o+5]=0.2; inst[o+6]=0.3; inst[o+7]=i&3;} res.cpu_fill_100k=((performance.now()-t0)/20).toFixed(2)+' ms'; }
document.title=JSON.stringify(res);
})();`;
const b = await chromium.launch({ executablePath: '/home/mewse/.local/opt/chrome-current/chrome' });
const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
await p.setContent('<html><body style="margin:0"></body></html>');
await p.evaluate(page_js);
await p.waitForFunction(() => document.title.startsWith('{'), null, { timeout: 120000 });
console.log(await p.title());
await b.close();
