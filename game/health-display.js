// Five flat quads + shared soft radial alpha (DynamicTexture) — reads as soft circles, one row billboard.
(function() {
  'use strict';

  const HEALTH_DOT_COUNT = 5;
  /** Bump when geometry/material pipeline changes so old meshes are disposed. */
  const HEALTH_DOTS_IMPL_VERSION = 10;
  const HEALTH_DOTS_RENDERING_GROUP = 2;
  const DOT_DIAMETER_TILE_MUL = 0.22;
  const DOT_SPACING_MUL = 1.06;
  const Y_BELOW_UNIT_MUL = -0.58;
  const Y_BELOW_BUILDING_MUL = -0.72;
  const Y_BELOW_AGORA_MUL = -0.66;

  const _chipColor = new BABYLON.Color3();
  const _healthDotsLocalBelow = new BABYLON.Vector3();
  const _capRgb = { r: 0, g: 0, b: 0 };

  function hexToRgb01(hex) {
    if (!hex || typeof hex !== 'string') return { r: 0.55, g: 0.55, b: 0.55 };
    const clean = hex.replace('#', '').trim();
    if (clean.length !== 6) return { r: 0.55, g: 0.55, b: 0.55 };
    return {
      r: parseInt(clean.slice(0, 2), 16) / 255,
      g: parseInt(clean.slice(2, 4), 16) / 255,
      b: parseInt(clean.slice(4, 6), 16) / 255
    };
  }

  function lerpRgb3(a, b, t) {
    t = Math.max(0, Math.min(1, t));
    return {
      r: a.r + (b.r - a.r) * t,
      g: a.g + (b.g - a.g) * t,
      b: a.b + (b.b - a.b) * t
    };
  }

  function boostChromaRgb(rgb, satMul) {
    const lum = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
    const s = satMul;
    return {
      r: Math.min(1, Math.max(0, lum + (rgb.r - lum) * s)),
      g: Math.min(1, Math.max(0, lum + (rgb.g - lum) * s)),
      b: Math.min(1, Math.max(0, lum + (rgb.b - lum) * s))
    };
  }

  function resolveAgoraAttackerRgb01(agora) {
    const neutral = { r: 0.38, g: 0.4, b: 0.46 };
    const capBy = agora.contestedBy;
    if (capBy && capBy !== 'defenders' && capBy !== 'multiple') {
      const hex = window.getTeamColorForOwner ? window.getTeamColorForOwner(capBy) : null;
      return hexToRgb01(hex || '#8A8A8A');
    }
    const m = window.currentMatch;
    if (m && m.players && agora.owner && typeof m.areOwnersHostile === 'function') {
      for (let pi = 0; pi < m.players.length; pi++) {
        const p = m.players[pi];
        const pid = p && (p.id || p);
        if (!pid || (m.eliminatedPlayers && m.eliminatedPlayers.has(pid))) continue;
        if (m.areOwnersHostile(pid, agora.owner)) {
          const hex = window.getTeamColorForOwner ? window.getTeamColorForOwner(pid) : null;
          return hexToRgb01(hex || '#CC5555');
        }
      }
    }
    return neutral;
  }

  function paintAgoraCaptureHealthDots(entity) {
    const p = Math.max(0, Math.min(1, (entity.captureProgress || 0) / 100));
    let def = hexToRgb01(
      window.getTeamColorForOwner ? window.getTeamColorForOwner(entity.owner) : '#8A8A8A'
    );
    def = boostChromaRgb(def, 1.42);
    const neu = { r: 0.38, g: 0.4, b: 0.46 };
    let att = resolveAgoraAttackerRgb01(entity);
    att = boostChromaRgb(att, 1.42);
    const contested = !!entity.contested;
    const tPulse = contested ? 0.55 + 0.45 * Math.sin(Date.now() * 0.004) : 1;

    for (let i = 0; i < HEALTH_DOT_COUNT; i++) {
      const mat = entity.healthDots[i].material;
      let rgb;
      if (p <= 0.5) {
        const phase = p * 2;
        const v = phase * HEALTH_DOT_COUNT - i;
        if (v <= 0) rgb = def;
        else if (v >= 1) rgb = neu;
        else rgb = lerpRgb3(def, neu, v);
      } else {
        const phase = (p - 0.5) * 2;
        const v = phase * HEALTH_DOT_COUNT - i;
        if (v <= 0) rgb = neu;
        else if (v >= 1) rgb = att;
        else rgb = lerpRgb3(neu, att, v);
      }
      if (contested) {
        rgb = {
          r: Math.min(1, rgb.r + 0.22 * tPulse),
          g: Math.min(1, rgb.g + 0.14 * tPulse),
          b: rgb.b * 0.88
        };
      }
      _capRgb.r = rgb.r;
      _capRgb.g = rgb.g;
      _capRgb.b = rgb.b;
      // Unlit chips: full-white emissive blows out tint; drive hue from diffuse + modest matching emissive.
      mat.diffuseColor.copyFromFloats(_capRgb.r, _capRgb.g, _capRgb.b);
      mat.emissiveColor.copyFromFloats(
        _capRgb.r * 0.52,
        _capRgb.g * 0.52,
        _capRgb.b * 0.52
      );
      mat.alpha = contested ? 0.78 + 0.22 * tPulse : 1;
    }
  }

  function getHealthDotsBelowRootOffsetY(entity) {
    const TILE = window.TILE_SIZE || 4;
    const isAgora = entity.type === 'agora';
    const isBuilding = entity.gridX !== undefined || (entity.mesh && entity.mesh.isBuilding);
    const yMul = isAgora ? Y_BELOW_AGORA_MUL : (isBuilding ? Y_BELOW_BUILDING_MUL : Y_BELOW_UNIT_MUL);
    return TILE * yMul;
  }

  /** World-space anchor so chips stay visible when unit.mesh is LOD-disabled (billboard swap). */
  function syncHealthDotsWorldPosition(entity) {
    const c = entity.healthDotsContainer;
    const mesh = entity.mesh;
    if (!c || !mesh) return;
    if (typeof c.isDisposed === 'function' && c.isDisposed()) return;
    if (typeof mesh.isDisposed === 'function' && mesh.isDisposed()) return;
    try {
      mesh.computeWorldMatrix(true);
      const wm = mesh.getWorldMatrix();
      const yOff = getHealthDotsBelowRootOffsetY(entity);
      _healthDotsLocalBelow.copyFromFloats(0, yOff, 0);
      BABYLON.Vector3.TransformCoordinatesToRef(_healthDotsLocalBelow, wm, c.position);
    } catch (_) { /* mesh mid-dispose */ }
  }

  let _softCircleTex = null;
  let _softCircleTexScene = null;
  /** Bump when only the radial alpha profile changes (invalidates shared DynamicTexture). */
  const SOFT_CIRCLE_GRADIENT_VERSION = 3;
  let _softCircleTexGradientVer = -1;

  function softCircleTexStillUsable(tex) {
    if (!tex) return false;
    if (typeof tex.isDisposed === 'function') return !tex.isDisposed();
    if (typeof tex.isDisposed === 'boolean') return !tex.isDisposed;
    return true;
  }

  /** One texture per scene: white RGB, alpha = solid disk with a short edge-only feather (shared). */
  function getSharedHealthChipSoftCircleMap(scene) {
    if (
      _softCircleTex &&
      _softCircleTexScene === scene &&
      softCircleTexStillUsable(_softCircleTex) &&
      _softCircleTexGradientVer === SOFT_CIRCLE_GRADIENT_VERSION
    ) {
      return _softCircleTex;
    }
    const size = 128;
    const tex = new BABYLON.DynamicTexture('healthChipSoftCircle', { width: size, height: size }, scene, false);
    const ctx = tex.getContext();
    const cx = size * 0.5;
    const cy = size * 0.5;
    const r = size * 0.48;
    ctx.clearRect(0, 0, size, size);
    const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    // Flat core at 84% alpha; feather in the outer ~21% (prior ~17% + 4%).
    grd.addColorStop(0, 'rgba(255,255,255,0.84)');
    grd.addColorStop(0.79, 'rgba(255,255,255,0.84)');
    grd.addColorStop(0.89, 'rgba(255,255,255,0.38)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, size, size);
    tex.update();
    tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    _softCircleTex = tex;
    _softCircleTexScene = scene;
    _softCircleTexGradientVer = SOFT_CIRCLE_GRADIENT_VERSION;
    return tex;
  }

  /** Same idea as gfx getHudAtlasMaterial: flat, constant appearance in all lighting. */
  function applyUnlitBillboardChipMaterial(mat) {
    mat.disableLighting = true;
    mat.specularColor.copyFromFloats(0, 0, 0);
    mat.specularPower = 0;
    mat.ambientColor.copyFromFloats(0, 0, 0);
    mat.emissiveTexture = null;
    mat.reflectionTexture = null;
    mat.refractionTexture = null;
    mat.bumpTexture = null;
    mat.lightmapTexture = null;
    mat.opacityTexture = null;
    mat.backFaceCulling = false;
    mat.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
  }

  window.createHealthDots = function(entity) {
    if (!entity.mesh || !window.gfx || !window.gfx.scene) return;

    const alreadyCurrent =
      entity.healthDotsContainer &&
      entity.healthDots &&
      entity.healthDots.length === HEALTH_DOT_COUNT &&
      entity.healthDotsImplVersion === HEALTH_DOTS_IMPL_VERSION;

    if (alreadyCurrent) return;

    if (entity.healthDotsContainer || (entity.healthDots && entity.healthDots.length)) {
      window.disposeHealthDots(entity);
    }

    const scene = window.gfx.scene;
    const TILE = window.TILE_SIZE || 4;
    const isBuilding = entity.gridX !== undefined || (entity.mesh && entity.mesh.isBuilding);

    const dotSize = TILE * DOT_DIAMETER_TILE_MUL;
    const dotSpacing = dotSize * DOT_SPACING_MUL;
    const totalWidth = (HEALTH_DOT_COUNT - 1) * dotSpacing;

    const container = new BABYLON.TransformNode('healthDotsAnchor', scene);
    container.metadata = { ...(container.metadata || {}), skipAgoraLodEnableWhenNear: true };
    // Not parented to entity.mesh: mesh is setEnabled(false) at billboard LOD, which would hide the chips.
    container.parent = null;

    entity.healthDots = [];
    entity.healthDotsContainer = container;

    const rowRoot = BABYLON.MeshBuilder.CreateBox('healthRowBillboard', { size: 0.001 }, scene);
    rowRoot.isVisible = false;
    rowRoot.isPickable = false;
    rowRoot.parent = container;
    rowRoot.position.set(0, 0, 0);
    rowRoot.billboardMode = BABYLON.Mesh.BILLBOARDMODE_Y;
    rowRoot.renderingGroupId = HEALTH_DOTS_RENDERING_GROUP;
    rowRoot.metadata = { ...(rowRoot.metadata || {}), excludeFromDirectionalShadows: true };
    if (window.gfx && window.gfx.markMeshExcludeDirectionalShadows) {
      window.gfx.markMeshExcludeDirectionalShadows(rowRoot);
    }

    for (let i = 0; i < HEALTH_DOT_COUNT; i++) {
      const dot = BABYLON.MeshBuilder.CreatePlane(`healthChip_${i}`, {
        width: dotSize,
        height: dotSize
      }, scene);

      const xPos = (i * dotSpacing) - (totalWidth / 2);
      dot.position.x = xPos;
      dot.position.y = 0;
      dot.position.z = 0;
      dot.parent = rowRoot;
      dot.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;

      const dotMat = new BABYLON.StandardMaterial(`healthDotMat_${i}`, scene);
      applyUnlitBillboardChipMaterial(dotMat);
      const softMap = getSharedHealthChipSoftCircleMap(scene);
      dotMat.diffuseTexture = softMap;
      dotMat.diffuseTexture.hasAlpha = true;
      dotMat.useAlphaFromDiffuseTexture = true;
      dotMat.diffuseColor.copyFromFloats(1, 1, 1);
      // Same as gfx getHudAtlasMaterial: unlit path needs emissive white so diffuseTexture × diffuseColor reads correctly.
      dotMat.emissiveColor.copyFromFloats(1, 1, 1);
      dotMat.alpha = 1;
      dot.material = dotMat;
      dot.isPickable = false;
      dot.receiveShadows = false;
      dot.renderingGroupId = HEALTH_DOTS_RENDERING_GROUP;
      dot.metadata = { ...(dot.metadata || {}), excludeFromDirectionalShadows: true };

      entity.healthDots.push(dot);
    }

    updateHealthDots(entity);

    entity.healthDotsImplVersion = HEALTH_DOTS_IMPL_VERSION;

    if (!isBuilding) {
      container.setEnabled(false);
    }
  };

  window.showHealthDots = function(entity) {
    if (entity.healthDotsContainer) {
      entity.healthDotsContainer.setEnabled(true);
      syncHealthDotsWorldPosition(entity);
    }
  };

  window.hideHealthDots = function(entity) {
    if (entity.healthDotsContainer) {
      entity.healthDotsContainer.setEnabled(false);
    }
  };

  window.updateHealthDots = function(entity) {
    if (!entity.healthDots || entity.healthDots.length !== HEALTH_DOT_COUNT) return;

    syncHealthDotsWorldPosition(entity);

    if (
      entity.type === 'agora' &&
      ((entity.captureProgress || 0) > 0 || entity.contested)
    ) {
      paintAgoraCaptureHealthDots(entity);
      return;
    }

    const maxHealth = entity.maxHealth || 100;
    const currentHealth = Math.max(0, entity.health || 0);
    const healthPercent = maxHealth > 0 ? currentHealth / maxHealth : 0;

    const filledDots = Math.min(
      HEALTH_DOT_COUNT,
      Math.ceil(healthPercent * HEALTH_DOT_COUNT - 1e-6)
    );

    let fillR;
    let fillG;
    let fillB;
    if (healthPercent > 0.66) {
      fillR = 0.12;
      fillG = 0.92;
      fillB = 0.2;
    } else if (healthPercent > 0.33) {
      fillR = 0.95;
      fillG = 0.78;
      fillB = 0.12;
    } else {
      fillR = 0.92;
      fillG = 0.18;
      fillB = 0.12;
    }

    entity.healthDots.forEach((dot, index) => {
      const isFilled = index < filledDots;
      const mat = dot.material;

      if (isFilled) {
        _chipColor.copyFromFloats(fillR, fillG, fillB);
        mat.diffuseColor.copyFrom(_chipColor);
        mat.emissiveColor.copyFromFloats(1, 1, 1);
        mat.alpha = 1.0;
      } else {
        _chipColor.copyFromFloats(0.14, 0.14, 0.14);
        mat.diffuseColor.copyFrom(_chipColor);
        mat.emissiveColor.copyFromFloats(1, 1, 1);
        mat.alpha = 0.5;
      }
    });
  };

  window.disposeHealthDots = function(entity) {
    if (entity.healthDots) {
      entity.healthDots.forEach(dot => {
        const mat = dot.material;
        if (mat) {
          if (mat.diffuseTexture && _softCircleTex && mat.diffuseTexture === _softCircleTex) {
            mat.diffuseTexture = null;
          }
          mat.dispose();
        }
        dot.dispose();
      });
      entity.healthDots = [];
    }
    if (entity.healthDotsContainer) {
      entity.healthDotsContainer.dispose();
      entity.healthDotsContainer = null;
    }
    delete entity.healthDotsImplVersion;
  };

})();
