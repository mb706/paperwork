// Shader programs: compile, link, and look up every active uniform once (no string lookups per frame).

export interface Program {
  program: WebGLProgram;
  /** Uniform locations by name (array uniforms by their base name, e.g. `uMinLod`). */
  u: Record<string, WebGLUniformLocation>;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string, name: string): WebGLShader {
  const sh = gl.createShader(type);
  if (sh === null) throw new Error(`${name}: createShader failed (context lost?)`);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new Error(`${name} (${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'}): ${log}`);
  }
  return sh;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string, name: string): Program {
  const v = compile(gl, gl.VERTEX_SHADER, vs, name);
  const f = compile(gl, gl.FRAGMENT_SHADER, fs, name);
  const program = gl.createProgram();
  if (program === null) throw new Error(`${name}: createProgram failed (context lost?)`);
  gl.attachShader(program, v);
  gl.attachShader(program, f);
  gl.linkProgram(program);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost())
    throw new Error(`${name}: link failed: ${gl.getProgramInfoLog(program) ?? ''}`);
  const u: Record<string, WebGLUniformLocation> = {};
  const n = (gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number) ?? 0;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    const base = info.name.replace(/\[0\]$/, '');
    const loc = gl.getUniformLocation(program, info.name);
    if (loc !== null) u[base] = loc;
  }
  return { program, u };
}
