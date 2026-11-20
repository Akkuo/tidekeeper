// 自寫 WebGL 後處理：bloom（亮部擷取 → 半解析度高斯模糊兩次）+ 水線以下波紋折射與焦散。
// 任一步失敗回傳 null，renderer 退回純 2D。
const VS = 'attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*.5+.5,.5-p.y*.5);gl_Position=vec4(p,0.,1.);}';
const BRIGHT = `precision mediump float;varying vec2 v;uniform sampler2D s;
void main(){vec3 c=texture2D(s,v).rgb;float l=max(c.r,max(c.g,c.b));gl_FragColor=vec4(c*smoothstep(.78,1.,l),1.);}`;
const BLUR = `precision mediump float;varying vec2 v;uniform sampler2D s;uniform vec2 d;
void main(){vec2 u=vec2(v.x,1.-v.y);vec3 c=texture2D(s,u).rgb*.227;
c+=(texture2D(s,u+d*1.38).rgb+texture2D(s,u-d*1.38).rgb)*.316;
c+=(texture2D(s,u+d*3.23).rgb+texture2D(s,u-d*3.23).rgb)*.07;gl_FragColor=vec4(c,1.);}`;
const COMP = `precision mediump float;varying vec2 v;uniform sampler2D s;uniform sampler2D bl;uniform float wy;uniform float tm;uniform float amt;uniform float bloom;
void main(){vec2 u=v;float k=clamp((v.y-wy)*10.,0.,1.);
u.x+=sin(v.y*90.+tm*2.6)*.0024*k*amt;u.y+=sin(v.x*70.+tm*2.1)*.0016*k*amt;
vec3 c=texture2D(s,u).rgb;
float ca=pow(max(0.,sin(v.x*38.+tm*1.3+sin(v.y*30.+tm))*sin(v.y*34.-tm*1.7)),6.)*.12*k*amt;c+=vec3(ca*.6,ca,ca);
c+=texture2D(bl,vec2(v.x,1.-v.y)).rgb*bloom;
float vg=smoothstep(1.2,.4,length(v-.5)*1.3);c*=mix(.8,1.,vg);gl_FragColor=vec4(c,1.);}`;

export function createPostFX() {
  try {
    const cv = document.createElement('canvas');
    const gl = cv.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, depth: false });
    if (!gl) return null;
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const prog = fs => {
      const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(p, 0, 'p'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
      return { p, u };
    };
    const P = { bright: prog(BRIGHT), blur: prog(BLUR), comp: prog(COMP) };
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const tex = filter => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    const src = tex(gl.NEAREST);
    const fbs = [0, 1].map(() => { const t = tex(gl.LINEAR); const f = gl.createFramebuffer(); return { t, f }; });
    let bw = 0, bh = 0;
    function size(w, h) {
      if (w === bw && h === bh) return;
      bw = w; bh = h; cv.width = w * 2; cv.height = h * 2;
      for (const fb of fbs) {
        gl.bindTexture(gl.TEXTURE_2D, fb.t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, Math.max(1, w >> 1), Math.max(1, h >> 1), 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb.f);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fb.t, 0);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    const pass = (pr, fb, w, h) => { gl.bindFramebuffer(gl.FRAMEBUFFER, fb ? fb.f : null); gl.viewport(0, 0, w, h); gl.useProgram(pr.p); };
    return {
      canvas: cv,
      // srcCanvas：低解析度遊戲畫面；opt：{ waterUV, time, ripple, bloom }
      run(srcCanvas, opt) {
        if (gl.isContextLost()) return null;
        const w = srcCanvas.width, h = srcCanvas.height; size(w, h);
        const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
        pass(P.bright, fbs[0], hw, hh); gl.uniform1i(P.bright.u.s, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(P.blur, fbs[1], hw, hh); gl.bindTexture(gl.TEXTURE_2D, fbs[0].t); gl.uniform1i(P.blur.u.s, 0); gl.uniform2f(P.blur.u.d, 1 / hw, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(P.blur, fbs[0], hw, hh); gl.bindTexture(gl.TEXTURE_2D, fbs[1].t); gl.uniform2f(P.blur.u.d, 0, 1 / hh); gl.drawArrays(gl.TRIANGLES, 0, 3);
        pass(P.comp, null, cv.width, cv.height);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, fbs[0].t);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, src);
        const u = P.comp.u;
        gl.uniform1i(u.s, 0); gl.uniform1i(u.bl, 1);
        gl.uniform1f(u.wy, opt.waterUV); gl.uniform1f(u.tm, opt.time); gl.uniform1f(u.amt, opt.ripple); gl.uniform1f(u.bloom, opt.bloom);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        return cv;
      },
      destroy() { const ext = gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); },
    };
  } catch (e) {
    console.warn('PostFX 停用，退回純 2D：', e.message);
    return null;
  }
}
