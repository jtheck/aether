// MSDF Text Renderer using custom shader
// Crisp text at any scale using multi-channel signed distance fields

const MSDFText = {
  fontData: null,
  fontTexture: null,
  scene: null,
  msdfMaterial: null,

  async init(scene) {
    this.scene = scene;
    
    try {
      // Load font metrics JSON
      const response = await fetch('assets/fonts/roboto-regular.json');
      this.fontData = await response.json();
      
      // Load font atlas texture
      this.fontTexture = new BABYLON.Texture(
        'assets/fonts/roboto-regular.png',
        scene,
        false, // noMipmap
        false, // invertY
        BABYLON.Texture.TRILINEAR_SAMPLINGMODE
      );
      
      // Create MSDF shader material
      this.createMSDFShader();
      
    } catch (error) {
      console.error('Failed to load MSDF font:', error);
    }
  },

  createMSDFShader() {
    // MSDF Vertex Shader
    BABYLON.Effect.ShadersStore["msdfVertexShader"] = `
      precision highp float;
      
      attribute vec3 position;
      attribute vec2 uv;
      
      uniform mat4 worldViewProjection;
      uniform mat4 world;
      
      varying vec2 vUV;
      
      void main() {
        gl_Position = worldViewProjection * vec4(position, 1.0);
        vUV = uv;
      }
    `;
    
    // MSDF Fragment Shader
    BABYLON.Effect.ShadersStore["msdfFragmentShader"] = `
      precision highp float;
      
      varying vec2 vUV;
      
      uniform sampler2D fontAtlas;
      uniform vec3 textColor;
      uniform float textAlpha;
      uniform float pxRange; // Distance field range in pixels
      
      float median(float r, float g, float b) {
        return max(min(r, g), min(max(r, g), b));
      }
      
      void main() {
        // Sample MSDF texture
        vec3 msdf = texture2D(fontAtlas, vUV).rgb;
        
        // Calculate signed distance
        float sd = median(msdf.r, msdf.g, msdf.b);
        
        // Calculate screen-space derivatives for anti-aliasing
        float screenPxDistance = pxRange * (sd - 0.5);
        float alpha = clamp(screenPxDistance + 0.5, 0.0, 1.0);
        
        // Apply text color and alpha
        gl_FragColor = vec4(textColor, alpha * textAlpha);
        
        // Discard fully transparent pixels
        if (gl_FragColor.a < 0.01) discard;
      }
    `;
  },

  createMaterial(color, alpha) {
    const mat = new BABYLON.ShaderMaterial(
      'msdfTextMat',
      this.scene,
      {
        vertex: 'msdf',
        fragment: 'msdf'
      },
      {
        attributes: ['position', 'uv'],
        uniforms: ['worldViewProjection', 'world', 'textColor', 'textAlpha', 'pxRange'],
        samplers: ['fontAtlas']
      }
    );
    
    mat.setTexture('fontAtlas', this.fontTexture);
    mat.setColor3('textColor', color);
    mat.setFloat('textAlpha', alpha);
    mat.setFloat('pxRange', 4.0); // Distance field range
    mat.backFaceCulling = false;
    mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
    mat.needDepthPrePass = false;
    
    return mat;
  },

  async createText(text, options = {}) {
    if (!this.fontData || !this.fontTexture) {
      console.error('MSDF Text not initialized');
      return null;
    }
    
    const opts = {
      fontSize: options.fontSize || 1.0,
      color: options.color || new BABYLON.Color3(1, 1, 1),
      alpha: options.alpha || 1.0,
      ...options
    };
    
    // Create parent transform node
    const textGroup = new BABYLON.TransformNode('msdfText', this.scene);
    textGroup.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
    
    // Calculate text layout
    const chars = this.fontData.chars;
    const atlasWidth = this.fontData.common.scaleW;
    const atlasHeight = this.fontData.common.scaleH;
    const lineHeight = this.fontData.common.lineHeight;
    
    // Scale factor for font size
    const scale = opts.fontSize / lineHeight;
    
    let cursorX = 0;
    const charMeshes = [];
    let minX = Infinity;
    let maxX = -Infinity;
    
    // Create a mesh for each character
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const charCode = char.charCodeAt(0);
      
      // Find character data in font
      const charData = chars.find(c => c.id === charCode);
      if (!charData) {
        console.warn(`Character '${char}' not found in font`);
        continue;
      }
      
      // Create character plane
      const charWidth = charData.width * scale;
      const charHeight = charData.height * scale;
      
      if (charWidth > 0 && charHeight > 0) {
        const plane = BABYLON.MeshBuilder.CreatePlane(
          `char_${char}`,
          { width: charWidth, height: charHeight },
          this.scene
        );
        
        plane.parent = textGroup;
        const charPosX = cursorX + (charWidth / 2) + (charData.xoffset * scale);
        plane.position.x = charPosX;
        
        // Track actual visual bounds
        const charLeft = charPosX - (charWidth / 2);
        const charRight = charPosX + (charWidth / 2);
        minX = Math.min(minX, charLeft);
        maxX = Math.max(maxX, charRight);
        
        // Align all characters to baseline using font's base value
        const baselineY = this.fontData.common.base * scale;
        plane.position.y = baselineY - charData.yoffset * scale - (charHeight / 2);
        plane.isPickable = false;
        
        // Set UV coordinates for this character in the atlas
        const u1 = charData.x / atlasWidth;
        const v1 = charData.y / atlasHeight;
        const u2 = (charData.x + charData.width) / atlasWidth;
        const v2 = (charData.y + charData.height) / atlasHeight;
        
        const uvs = plane.getVerticesData(BABYLON.VertexBuffer.UVKind);
        // Babylon plane vertices: bottom-left, bottom-right, top-right, top-left
        uvs[0] = u1; uvs[1] = v2; // bottom-left
        uvs[2] = u2; uvs[3] = v2; // bottom-right
        uvs[4] = u2; uvs[5] = v1; // top-right
        uvs[6] = u1; uvs[7] = v1; // top-left
        plane.setVerticesData(BABYLON.VertexBuffer.UVKind, uvs);
        
        // Apply MSDF material
        plane.material = this.createMaterial(opts.color, opts.alpha);
        
        charMeshes.push(plane);
      }
      
      // Advance cursor
      cursorX += charData.xadvance * scale;
    }
    
    // Center text horizontally by shifting all character positions
    const visualCenter = (minX + maxX) / 2;
    
    // Shift all characters so the visual center is at x=0
    for (const plane of charMeshes) {
      plane.position.x -= visualCenter;
    }
    
    // Keep textGroup at origin (speech.js will position it at unit location)
    textGroup.position.x = 0;
    
    // Center text vertically - shift down so text sits nicely centered
    const baselineY = this.fontData.common.base * scale;
    textGroup.position.y = -baselineY / 2; // Shift down to visually center
    
    // Store references for cleanup
    textGroup._charMeshes = charMeshes;
    textGroup._msdfAlpha = opts.alpha;
    
    return textGroup;
  },

  setTextAlpha(textGroup, alpha) {
    if (!textGroup || !textGroup._charMeshes) return;
    
    textGroup._msdfAlpha = alpha;
    
    for (const mesh of textGroup._charMeshes) {
      if (mesh.material && mesh.material.setFloat) {
        mesh.material.setFloat('textAlpha', alpha);
      }
    }
  },

  disposeText(textGroup) {
    if (!textGroup) return;
    
    if (textGroup._charMeshes) {
      for (const mesh of textGroup._charMeshes) {
        if (mesh.material) {
          mesh.material.dispose();
        }
        mesh.dispose();
      }
    }
    
    textGroup.dispose();
  }
};

window.MSDFText = MSDFText;
