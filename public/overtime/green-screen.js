(function(root) {
  function keyPixels(data) {
    for(let i=0;i<data.length;i+=4) {
      const difference = data[i+1]-Math.max(data[i],data[i+2]);
      const t = Math.max(0,Math.min(1,(difference-18)/28)), opacity = 1-t*t*(3-2*t);
      data[i+1] = Math.round(data[i+1]+(Math.min(data[i+1],Math.max(data[i],data[i+2]))-data[i+1])*(1-opacity)*0.8);
      data[i+3] = Math.round(data[i+3]*opacity);
    }
    return data;
  }
  function createKeyer(canvas) {
    const gl = canvas.getContext('webgl',{alpha:true,premultipliedAlpha:true,preserveDrawingBuffer:true});
    if(!gl) {
      const ctx = canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx) throw new Error('此电脑暂时无法抠绿');
      return video => {
        // shortcut: 无WebGL时最高1280像素宽抠绿，低配置设备需要更高清时再升级渲染方式。
        canvas.width = Math.min(1280,video.videoWidth); canvas.height = Math.round(video.videoHeight*canvas.width/video.videoWidth);
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        const frame = ctx.getImageData(0,0,canvas.width,canvas.height); keyPixels(frame.data); ctx.putImageData(frame,0,0);
      };
    }
    const shader = (type,source) => {
      const item = gl.createShader(type); gl.shaderSource(item,source); gl.compileShader(item);
      if(!gl.getShaderParameter(item,gl.COMPILE_STATUS)) throw new Error('显卡无法处理绿幕视频');
      return item;
    };
    const program = gl.createProgram();
    gl.attachShader(program,shader(gl.VERTEX_SHADER,'attribute vec2 position;varying vec2 uv;void main(){uv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}'));
    gl.attachShader(program,shader(gl.FRAGMENT_SHADER,'precision mediump float;uniform sampler2D frame;varying vec2 uv;void main(){vec4 c=texture2D(frame,uv);float opacity=(1.0-smoothstep(18.0/255.0,46.0/255.0,c.g-max(c.r,c.b)))*c.a;c.g=mix(c.g,min(c.g,max(c.r,c.b)),(1.0-opacity)*0.8);gl_FragColor=vec4(c.rgb*opacity,opacity);}'));
    gl.linkProgram(program); if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw new Error('显卡无法处理绿幕视频');
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program,'position'); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.bindTexture(gl.TEXTURE_2D,gl.createTexture()); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);
    return video => {
      if(canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {canvas.width = video.videoWidth;canvas.height = video.videoHeight;}
      gl.viewport(0,0,canvas.width,canvas.height); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video); gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
    };
  }
  const api = {keyPixels,createKeyer};
  if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.GreenScreen = api;
})(globalThis);
