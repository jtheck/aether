// Five flat quads + shared soft radial alpha (DynamicTexture) — reads as soft circles, one row billboard.
(function() {
  'use strict';

  const HEALTH_DOT_COUNT = 5;
  /** Bump when geometry/material pipeline changes so old meshes are disposed. */
  const HEALTH_DOTS_IMPL_VERSION = 15;
  const HEALTH_DOTS_RENDERING_GROUP = 2;
  const DOT_DIAMETER_TILE_MUL = 0.22;
  /** Second and fourth dots (0-based indices 1,3) render smaller for a subtle rhythm. */
  const DOT_DIAMETER_ALTERNATE_MUL = 0.4;
  /**
   * Ring quads are sized from the full (large) health-dot diameter so holy armor reads at ~large-dot scale.
   * Holy: ~match large dots + a touch; research armor: outside that, larger than large dots.
   */
  const ALT_HOLY_RING_DIAMETER_VS_NORMAL_DOT = 1.04;
  const ALT_ARMOR_RING_DIAMETER_VS_NORMAL_DOT = 1.26;
  const ALT_RING_Z_BLACK = -0.004;
  const ALT_RING_Z_WHITE = -0.002;
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
    syncHealthDotAlternateRings(entity);
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
      mesh.computeWorldMatrix(false);
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

  let _ringWhiteTex = null;
  let _ringBlackTex = null;
  let _ringTexScene = null;
  const RING_TEX_IMPL_VERSION = 1;
  let _ringTexVer = -1;

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

  function makeRingAlphaTexture(scene, name, rgbFill) {
    const size = 128;
    const tex = new BABYLON.DynamicTexture(name, { width: size, height: size }, scene, false);
    const ctx = tex.getContext();
    const cx = size * 0.5;
    const cy = size * 0.5;
    const ir = size * 0.34;
    const or = size * 0.485;
    ctx.clearRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(cx, cy, or, 0, Math.PI * 2);
    ctx.arc(cx, cy, ir, 0, Math.PI * 2, true);
    ctx.fillStyle = rgbFill;
    ctx.fill('evenodd');
    tex.update();
    tex.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    tex.hasAlpha = true;
    return tex;
  }

  function getSharedAlternateDotRingTextures(scene) {
    if (
      _ringWhiteTex &&
      _ringBlackTex &&
      _ringTexScene === scene &&
      softCircleTexStillUsable(_ringWhiteTex) &&
      softCircleTexStillUsable(_ringBlackTex) &&
      _ringTexVer === RING_TEX_IMPL_VERSION
    ) {
      return { white: _ringWhiteTex, black: _ringBlackTex };
    }
    if (_ringWhiteTex && typeof _ringWhiteTex.dispose === 'function') {
      try { _ringWhiteTex.dispose(); } catch (_) {}
    }
    if (_ringBlackTex && typeof _ringBlackTex.dispose === 'function') {
      try { _ringBlackTex.dispose(); } catch (_) {}
    }
    _ringWhiteTex = makeRingAlphaTexture(scene, 'healthChipRingWhite', 'rgba(255,255,255,0.92)');
    _ringBlackTex = makeRingAlphaTexture(scene, 'healthChipRingBlack', 'rgba(18,18,20,0.94)');
    _ringTexScene = scene;
    _ringTexVer = RING_TEX_IMPL_VERSION;
    return { white: _ringWhiteTex, black: _ringBlackTex };
  }

  function normalizeOwnerIdForResearch(oid) {
    if (oid == null) return null;
    const s = String(oid);
    return s.length > 6 ? s.slice(-6) : s;
  }

  function researchPlayersList() {
    const list = [];
    const seen = new Set();
    const add = p => {
      if (!p || seen.has(p)) return;
      seen.add(p);
      list.push(p);
    };
    if (window.game && Array.isArray(window.game.players)) {
      for (let i = 0; i < window.game.players.length; i++) add(window.game.players[i]);
    }
    add(window.player);
    return list;
  }

  function ownerHasArmorResearch(ownerId) {
    if (ownerId == null) return false;
    const want = normalizeOwnerIdForResearch(ownerId);
    if (!want) return false;
    const players = researchPlayersList();
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const pid = p.id != null ? normalizeOwnerIdForResearch(p.id) : '';
      if (pid && pid === want && Array.isArray(p.research) && p.research.indexOf('armor') !== -1) {
        return true;
      }
    }
    return false;
  }

  function entityHasHolyArmorShield(entity) {
    if (typeof window.cleanupExpiredIncomingDamageState === 'function') {
      try {
        window.cleanupExpiredIncomingDamageState(entity);
      } catch (_) { /* ignore */ }
    }
    const state = entity?._incomingDamageState;
    const shields = state && state.shields;
    if (!shields) return false;
    const keys = Object.keys(shields);
    for (let i = 0; i < keys.length; i++) {
      const s = shields[keys[i]];
      if (!s || s.label !== 'holy_armor') continue;
      const rem = Number.isFinite(s.remaining) ? s.remaining : 0;
      if (rem > 0) return true;
    }
    return false;
  }

  function isUnitEntityForArmorRings(entity) {
    if (!entity || entity.type === 'agora') return false;
    const isBuilding =
      entity.gridX !== undefined || (entity.mesh && entity.mesh.isBuilding);
    return !isBuilding;
  }

  function syncHealthDotAlternateRings(entity) {
    const layers = entity.healthDotRingLayers;
    if (!layers) return;
    const hideForAgoraCapture =
      entity.type === 'agora' &&
      ((entity.captureProgress || 0) > 0 || entity.contested);
    const isUnit = isUnitEntityForArmorRings(entity);
    const showHolyRing =
      !hideForAgoraCapture && isUnit && entityHasHolyArmorShield(entity);
    const showArmorRing =
      !hideForAgoraCapture && isUnit && ownerHasArmorResearch(entity.owner);
    for (let i = 1; i <= 3; i += 2) {
      const L = layers[i];
      if (!L) continue;
      if (L.white && typeof L.white.setEnabled === 'function') L.white.setEnabled(!!showHolyRing);
      if (L.black && typeof L.black.setEnabled === 'function') L.black.setEnabled(!!showArmorRing);
    }
  }

  function buildAlternateDotRingMeshes(scene, rowRoot, xPos, index, normalDotDiameter) {
    const rings = getSharedAlternateDotRingTextures(scene);
    const dW = normalDotDiameter * ALT_HOLY_RING_DIAMETER_VS_NORMAL_DOT;
    const dB = normalDotDiameter * ALT_ARMOR_RING_DIAMETER_VS_NORMAL_DOT;
    const black = BABYLON.MeshBuilder.CreatePlane(`healthChip_${index}_ringBlack`, {
      width: dB,
      height: dB
    }, scene);
    black.position.x = xPos;
    black.position.y = 0;
    black.position.z = ALT_RING_Z_BLACK;
    black.parent = rowRoot;
    black.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    const matB = new BABYLON.StandardMaterial(`healthDotRingBlack_${index}`, scene);
    applyUnlitBillboardChipMaterial(matB);
    matB.diffuseTexture = rings.black;
    matB.diffuseTexture.hasAlpha = true;
    matB.useAlphaFromDiffuseTexture = true;
    matB.diffuseColor.copyFromFloats(1, 1, 1);
    matB.emissiveColor.copyFromFloats(1, 1, 1);
    black.material = matB;
    black.isPickable = false;
    black.receiveShadows = false;
    black.renderingGroupId = HEALTH_DOTS_RENDERING_GROUP;
    black.setEnabled(false);
    black.metadata = { ...(black.metadata || {}), excludeFromDirectionalShadows: true };

    const white = BABYLON.MeshBuilder.CreatePlane(`healthChip_${index}_ringWhite`, {
      width: dW,
      height: dW
    }, scene);
    white.position.x = xPos;
    white.position.y = 0;
    white.position.z = ALT_RING_Z_WHITE;
    white.parent = rowRoot;
    white.billboardMode = BABYLON.Mesh.BILLBOARDMODE_NONE;
    const matW = new BABYLON.StandardMaterial(`healthDotRingWhite_${index}`, scene);
    applyUnlitBillboardChipMaterial(matW);
    matW.diffuseTexture = rings.white;
    matW.diffuseTexture.hasAlpha = true;
    matW.useAlphaFromDiffuseTexture = true;
    matW.diffuseColor.copyFromFloats(1, 1, 1);
    matW.emissiveColor.copyFromFloats(1, 1, 1);
    white.material = matW;
    white.isPickable = false;
    white.receiveShadows = false;
    white.renderingGroupId = HEALTH_DOTS_RENDERING_GROUP;
    white.setEnabled(false);
    white.metadata = { ...(white.metadata || {}), excludeFromDirectionalShadows: true };

    if (window.gfx && window.gfx.markMeshExcludeDirectionalShadows) {
      window.gfx.markMeshExcludeDirectionalShadows(black);
      window.gfx.markMeshExcludeDirectionalShadows(white);
    }
    return { white, black };
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
    entity.healthDotRingLayers = [null, null, null, null, null];
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
      const d =
        i === 1 || i === 3 ? dotSize * DOT_DIAMETER_ALTERNATE_MUL : dotSize;

      const xPos = (i * dotSpacing) - (totalWidth / 2);
      if (i === 1 || i === 3) {
        entity.healthDotRingLayers[i] = buildAlternateDotRingMeshes(scene, rowRoot, xPos, i, dotSize);
      }

      const dot = BABYLON.MeshBuilder.CreatePlane(`healthChip_${i}`, {
        width: d,
        height: d
      }, scene);

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
    delete entity._healthDotsVisualHealth;
    delete entity._healthDotsVisualMax;
    delete entity._healthDotsArmorRingKey;
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
    const armorRingKey = [
      ownerHasArmorResearch(entity.owner) ? 1 : 0,
      entityHasHolyArmorShield(entity) ? 1 : 0
    ].join('');
    if (
      entity._healthDotsVisualHealth === currentHealth &&
      entity._healthDotsVisualMax === maxHealth &&
      entity._healthDotsArmorRingKey === armorRingKey
    ) {
      return;
    }
    entity._healthDotsVisualHealth = currentHealth;
    entity._healthDotsVisualMax = maxHealth;
    entity._healthDotsArmorRingKey = armorRingKey;

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
    syncHealthDotAlternateRings(entity);
  };

  window.disposeHealthDots = function(entity) {
    if (entity.healthDotRingLayers) {
      entity.healthDotRingLayers.forEach(L => {
        if (!L) return;
        ['black', 'white'].forEach(k => {
          const m = L[k];
          if (!m) return;
          const mat = m.material;
          if (mat) {
            if (mat.diffuseTexture && mat.diffuseTexture !== _softCircleTex) {
              mat.diffuseTexture = null;
            }
            mat.dispose();
          }
          m.dispose();
        });
      });
      entity.healthDotRingLayers = null;
    }
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
    delete entity._healthDotsVisualHealth;
    delete entity._healthDotsVisualMax;
    delete entity._healthDotsArmorRingKey;
  };

})();
