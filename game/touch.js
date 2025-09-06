(function(touch) {
  'use strict';

  // Public API
  touch.init = function initTouchManager(canvas, options) {
    if (!canvas || touch._initialized) {
      console.log('📱 Touch init skipped - canvas:', !!canvas, 'initialized:', touch._initialized);
      return;
    }
    console.log('📱 Touch system initializing...');

    const config = Object.assign({
      tapMaxTimeMs: 250,
      tapMaxMovePx: 12,
      doubleTapDelayMs: 500, // Increased from 300ms to 500ms for better mobile detection
      twoFingerTapMaxTimeMs: 300,
      twoFingerTapMaxMovePx: 16,
      twoFingerDoubleTapCenterMaxMovePx: 80,
      rotateSensitivity: 0.4,
      pinchSensitivity: 0.85,
      panSensitivity: 5,
      dragStartThresholdPx: 14,
      suppressSingleTapAfterTwoFingerMs: 300,
      // Gesture unification
      dominantOnly: false,
      dampSecondary: 0.6,
      // Enable/disable individual gesture types for testing
      enablePinch: true,
      enableRotate: true,
      enablePan: true,
      // Minimum movement thresholds to treat 2-finger motion as gesture (prevents accidental zoom/rotate on 2-tap)
      pinchMinDeltaPx: 1.0,
      rotateMinDeltaRad: 0.008,
      panMinDeltaPx: 0.4,
      panBias: 1.2,
      primaryOverrideFactor: 1.6,
      initialPinchMinSpanPx: 10,
      maxRadiusStepPerFrame: 4,
      gestureEngageTimeMs: 20,
      gestureForceCommitMs: 150,
      // Building placement UX
      buildPlaceMinHoldMs: 200
    }, options || {});

    // Expose runtime toggles for testing one gesture at a time
    touch._config = config;
    window.touchConfig = config;
    touch.setModes = function(modes){
      if (!modes) return;
      if (typeof modes.pinch === 'boolean') config.enablePinch = modes.pinch;
      if (typeof modes.rotate === 'boolean') config.enableRotate = modes.rotate;
      if (typeof modes.pan === 'boolean') config.enablePan = modes.pan;
    };
    touch.enableOnly = function(name){
      const n = (name||'').toLowerCase();
      config.enablePinch = (n === 'pinch');
      config.enableRotate = (n === 'rotate');
      config.enablePan = (n === 'pan');
    };
    touch.getConfig = function(){ return config; };
    touch.setConfig = function(p){ Object.assign(config, p||{}); };

    const activePointers = new Map(); // pointerId -> PointerState
    const pointerOrder = []; // Track order of active pointers

    const canvasRect = () => canvas.getBoundingClientRect();

    // Single tap/double tap tracking
    let lastSingleTapTime = 0;
    let lastSingleTapPos = null; // Use null to indicate no previous tap

    // Two-finger tap/double-tap tracking
    let lastTwoTapTime = 0;
    let lastTwoTapPos = { x: 0, y: 0 };
    // Guard to prevent single-tap actions when a 2-finger tap/double-tap is recognized
    let skipNextSingleTap = false;
    let suppressSingleTapUntil = 0;

    // Gesture state when 2+ pointers
    let gestureActive = false;
    let gestureCommitted = false; // Only apply camera changes after commit
    let gestureInitial = null; // { centroid, distance, angle, radius, cameraAlpha, cameraBeta, startTime }
    // Coalesce touch move handling to one frame
    let moveRafScheduled = false;
    let lastTouchClientX = 0, lastTouchClientY = 0;

    // Building placement session flags
    let placingTouchId = null;
    let placingPreviewMoved = false;
    let placingLastTileX = null;
    let placingLastTileZ = null;

    function now() { return performance.now(); }

    function makePointerState(e) {
      return {
        id: e.pointerId,
        type: e.pointerType,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        x: e.clientX,
        y: e.clientY,
        startTime: now(),
        lastTime: now(),
        isDown: true,
        syntheticDownEmitted: false
      };
    }

    function updatePointerState(ps, e) {
      ps.lastX = ps.x;
      ps.lastY = ps.y;
      ps.x = e.clientX;
      ps.y = e.clientY;
      ps.lastTime = now();
    }

    function distanceSq(ax, ay, bx, by) {
      const dx = ax - bx; const dy = ay - by; return dx*dx + dy*dy;
    }

    function centroidOfPointers() {
      let sx = 0, sy = 0, n = 0;
      for (const ps of activePointers.values()) { sx += ps.x; sy += ps.y; n++; }
      if (n === 0) return { x: 0, y: 0 };
      return { x: sx / n, y: sy / n };
    }

    function getTwoPrimaryPointers() {
      // Ensure pointerOrder entries are still active
      for (let i = pointerOrder.length - 1; i >= 0; i--) {
        if (!activePointers.has(pointerOrder[i])) pointerOrder.splice(i, 1);
      }
      if (pointerOrder.length < 2) return null;
      const a = activePointers.get(pointerOrder[0]);
      const b = activePointers.get(pointerOrder[1]);
      if (!a || !b) return null;
      return [a, b];
    }

    function computeDistanceAndAngle(a, b) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);
      return { dist, ang };
    }

    function screenToWorld(screenX, screenY) {
      if (!window.ui || !window.ui.getWorldPositionFromScreen) {
        console.log('📱 screenToWorld failed - ui:', !!window.ui, 'getWorldPositionFromScreen:', !!window.ui?.getWorldPositionFromScreen);
        return null;
      }
      const worldPos = window.ui.getWorldPositionFromScreen(screenX, screenY);
      console.log('📱 screenToWorld result:', worldPos, 'for screen coords:', screenX, screenY);
      return worldPos;
    }

    function sendSyntheticPointer(type, clientX, clientY, button, options) {
      // Synthesize a minimal PointerEvent-like object for ui.handlePointer
      if (!window.ui || !window.ui.handlePointer) return;
      const synthetic = {
        type: type,
        clientX: clientX,
        clientY: clientY,
        button: button,
        pointerType: 'touch',
        suppressTerrainClick: !!(options && options.suppressTerrainClick),
        preventDefault: function() {},
        stopPropagation: function() {}
      };
      window.ui.handlePointer(synthetic);
    }

    // Removed direct moveSelectedUnitsToScreen flow; defer to ui.handlePointer via synthetic events

    // Removed: showMoveOptionsUIAt (single-finger double-tap now triggers special ability)

    function fireTwoFingerTap(x, y) {
      // Simulate a right-click tap (down + up)
      sendSyntheticPointer('pointerdown', x, y, 2);
      sendSyntheticPointer('pointerup', x, y, 2);
    }

    function beginGestureIfNeeded() {
      if (activePointers.size >= 2 && !gestureActive) {
        const pair = getTwoPrimaryPointers();
        if (!pair) return;
        const [a, b] = pair;
        const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const d = computeDistanceAndAngle(a, b);
        // Require a minimum initial span to avoid explosive scales
        if (d.dist < config.initialPinchMinSpanPx) {
          return; // ignore until fingers are spread enough
        }
        gestureActive = true;
        gestureCommitted = false;
        window.gestureInProgress = true;
        window._gesturePrimary = null; // lock the first detected dominant gesture
        gestureInitial = {
          centroid: c,
          distance: Math.max(1, d.dist),
          angle: d.ang,
          radius: window.gfx && window.gfx.camera ? window.gfx.camera.radius : 100,
          cameraAlpha: window.gfx && window.gfx.camera ? window.gfx.camera.alpha : 0,
          cameraBeta: window.gfx && window.gfx.camera ? window.gfx.camera.beta : 0,
          worldAtCentroid: screenToWorld(c.x, c.y),
          startTime: now()
        };
        // Temporarily disable camera auto-follow while gesturing
        if (typeof window.cameraAutoFollowEnabled !== 'undefined') {
          window._prevCameraAutoFollow = window.cameraAutoFollowEnabled;
        }
        window.cameraAutoFollowEnabled = false;
        // Save a safe camera snapshot
        if (window.gfx && window.gfx.camera && window.gfx.cameraTarget) {
          window._lastSafeCamera = {
            alpha: window.gfx.camera.alpha,
            beta: window.gfx.camera.beta,
            radius: window.gfx.camera.radius,
            tx: window.gfx.cameraTarget.position.x,
            tz: window.gfx.cameraTarget.position.z
          };
        }
      }
    }

    function endGestureIfNeeded() {
      if (activePointers.size < 2 && gestureActive) {
        gestureActive = false;
        gestureCommitted = false;
        gestureInitial = null;
        window.gestureInProgress = false;
        window._gesturePrimary = null;
        // Restore camera auto-follow state after gesture ends
        if (typeof window._prevCameraAutoFollow !== 'undefined') {
          window.cameraAutoFollowEnabled = window._prevCameraAutoFollow;
          delete window._prevCameraAutoFollow;
        }
      }
    }

    function applyTwoFingerGesture() {
      // During building placement, ignore two-finger gestures (single finger drags preview, tap places)
      if (window.buildingSystem && window.buildingSystem.isPlacing) return;
      if (!gestureActive || activePointers.size < 2) return;
      const pair = getTwoPrimaryPointers();
      if (!pair) return;
      const [a, b] = pair;
      const cNow = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const da = computeDistanceAndAngle(a, b);
      
      // If both fingers look like a quick tap (low move, short time), suppress gesture to avoid interfering with 2-tap or double 2-tap
      const aMoveSq = distanceSq(a.startX, a.startY, a.x, a.y);
      const bMoveSq = distanceSq(b.startX, b.startY, b.x, b.y);
      const aDt = now() - a.startTime;
      const bDt = now() - b.startTime;
      const tapMoveSq = (window.touchConfig ? window.touchConfig.twoFingerTapMaxMovePx : 32) ** 2; // relaxed
      const tapTimeMs = (window.touchConfig ? window.touchConfig.twoFingerTapMaxTimeMs : 350); // slightly relaxed
      const bothTapLike = (aMoveSq <= tapMoveSq && bMoveSq <= tapMoveSq && aDt <= tapTimeMs && bDt <= tapTimeMs);
      if (bothTapLike) {
        // Do not allow commit or any camera nudge; wait for pointerup to evaluate 2-finger tap/double-tap
        return;
      }
      
      // Movement thresholds
      const pinchDelta = Math.abs(da.dist - gestureInitial.distance);
      const rawAngleDelta = da.ang - gestureInitial.angle;
      const angleDelta = Math.abs(((rawAngleDelta + Math.PI) % (2*Math.PI)) - Math.PI);
      const panDeltaPx = Math.hypot(cNow.x - gestureInitial.centroid.x, cNow.y - gestureInitial.centroid.y);

      // Guard: do not apply any camera change until gesture is committed
      const heldMs = now() - (gestureInitial.startTime || now());
      if (!gestureCommitted) {
        const exceedThreshold = (config.enablePinch && pinchDelta >= config.pinchMinDeltaPx) || (config.enableRotate && angleDelta >= config.rotateMinDeltaRad) || (config.enablePan && panDeltaPx >= config.panMinDeltaPx);
        if ((exceedThreshold && heldMs >= config.gestureEngageTimeMs) || (heldMs >= config.gestureForceCommitMs)) {
          gestureCommitted = true;
        } else {
          return;
        }
      }

      // Determine dominant gesture this frame to avoid fighting
      const pinchRatio = config.enablePinch ? (pinchDelta / Math.max(1e-6, config.pinchMinDeltaPx)) : -1;
      const rotateRatio = config.enableRotate ? (angleDelta / Math.max(1e-6, config.rotateMinDeltaRad)) : -1;
      const panRatio = config.enablePan ? (panDeltaPx / Math.max(1e-6, config.panMinDeltaPx)) : -1;
      // Bias pan so it becomes dominant more readily
      const pinchEff = pinchRatio;
      const rotateEff = rotateRatio;
      const panEff = panRatio * (config.panBias || 1.0);
      let primary = window._gesturePrimary || 'none';
      if (!window._gesturePrimary) {
        let maxVal = 1.0;
        if (pinchEff > maxVal) { primary = 'pinch'; maxVal = pinchEff; }
        if (rotateEff > maxVal) { primary = 'rotate'; maxVal = rotateEff; }
        if (panEff > maxVal) { primary = 'pan'; maxVal = panEff; }
        if (primary !== 'none') window._gesturePrimary = primary; // lock it until gesture ends
      } else {
        // Allow a strong override if another gesture is much stronger than current primary
        const overrideK = (config.primaryOverrideFactor || 1.6);
        if (window._gesturePrimary === 'pan' && (pinchEff > panEff * overrideK || rotateEff > panEff * overrideK)) {
          window._gesturePrimary = pinchEff > rotateEff ? 'pinch' : 'rotate';
          primary = window._gesturePrimary;
        } else if (window._gesturePrimary === 'pinch' && (panEff > pinchEff * overrideK || rotateEff > pinchEff * overrideK)) {
          window._gesturePrimary = panEff > rotateEff ? 'pan' : 'rotate';
          primary = window._gesturePrimary;
        } else if (window._gesturePrimary === 'rotate' && (panEff > rotateEff * overrideK || pinchEff > rotateEff * overrideK)) {
          window._gesturePrimary = panEff > pinchEff ? 'pan' : 'pinch';
          primary = window._gesturePrimary;
        }
      }

      // Integrated mode: allow all gestures that cross threshold; scale secondaries by dampSecondary
      const allowPinch = config.enablePinch && (pinchDelta >= config.pinchMinDeltaPx);
      const allowRotate = config.enableRotate && (angleDelta >= config.rotateMinDeltaRad);
      const allowPan = config.enablePan && (panDeltaPx >= config.panMinDeltaPx);
      const damp = (g) => (config.dominantOnly ? (primary === g ? 1 : 0) : (primary === g ? 1 : config.dampSecondary));

      // Pinch (zoom) if meaningful change - match wheel momentum path via ui.nudgeZoom
      if (allowPinch && pinchDelta >= config.pinchMinDeltaPx) {
        const scale = Math.max(0.01, da.dist / gestureInitial.distance);
        if (window.gfx && window.gfx.camera && Number.isFinite(window.gfx.camera.radius)) {
          // Mix pure pinch zoom with a small pan component toward the pinch center
          const desired = gestureInitial.radius / Math.pow(scale, config.pinchSensitivity);
          const curr = window.gfx.camera.radius;
          const delta = desired - curr;
          const maxStep = config.maxRadiusStepPerFrame;
          let step = Math.max(-maxStep, Math.min(maxStep, delta));
          step *= (primary === 'pinch' ? 1 : config.dampSecondary);
          if (window.ui && window.ui.nudgeZoom) window.ui.nudgeZoom(step);
          // (Recenter removed due to pan drift)
        }
      }

      // Rotate (around vertical axis) if meaningful change - match scrollwheel rotation feel
      if (allowRotate && angleDelta >= config.rotateMinDeltaRad) {
        if (window.ui && window.gfx && window.gfx.camera) {
          const deltaAngle = rawAngleDelta;
          // Normalize to [-PI, PI]
          const normalized = ((deltaAngle + Math.PI) % (2*Math.PI)) - Math.PI;
          const deltaAlpha = -normalized * config.rotateSensitivity;
          const maxAlphaStep = 1.25;
          let step = Math.max(-maxAlphaStep, Math.min(maxAlphaStep, deltaAlpha));
          step *= (primary === 'rotate' ? 1 : config.dampSecondary);
          if (window.ui && window.ui.nudgeRotation) window.ui.nudgeRotation(step);
        }
      }

      // Pan if meaningful change: keep world point under centroid stable
      if (allowPan) {
        if (window.gfx && window.gfx.cameraTarget && gestureInitial.worldAtCentroid) {
          const worldNow = screenToWorld(cNow.x, cNow.y);
          if (worldNow) {
            let dx = (gestureInitial.worldAtCentroid.x - worldNow.x) * config.panSensitivity;
            let dz = (gestureInitial.worldAtCentroid.z - worldNow.z) * config.panSensitivity;
            if (!Number.isFinite(dx)) dx = 0;
            if (!Number.isFinite(dz)) dz = 0;
            // Fallback: if world delta is negligible, approximate from screen delta
            if (Math.abs(dx) + Math.abs(dz) < 1e-6 && window.gfx && window.gfx.camera && window.gfx.canvas && window.gfx.cameraTarget) {
              const cam = window.gfx.camera;
              const rect = window.gfx.canvas.getBoundingClientRect();
              const pixelsToWorld = (2 * (cam.radius || 60) * Math.tan((cam.fov || 0.8)/2)) / Math.max(1, rect.height);
              const screenDx = (cNow.x - gestureInitial.centroid.x);
              const screenDy = (cNow.y - gestureInitial.centroid.y);
              // Build ground-aligned camera axes
              const toTarget = window.gfx.cameraTarget.position.subtract(cam.position).normalize();
              const groundForward = new BABYLON.Vector3(toTarget.x, 0, toTarget.z);
              if (groundForward.lengthSquared() > 1e-6) {
                groundForward.normalize();
                const groundRight = new BABYLON.Vector3(-groundForward.z, 0, groundForward.x);
                // Map screen movement: right += x, forward += y
                const wx = groundRight.x * screenDx * pixelsToWorld + groundForward.x * screenDy * pixelsToWorld;
                const wz = groundRight.z * screenDx * pixelsToWorld + groundForward.z * screenDy * pixelsToWorld;
                dx = wx * config.panSensitivity;
                dz = wz * config.panSensitivity;
              }
            }
            const k = (primary === 'pan' ? 1 : config.dampSecondary);
            dx *= k; dz *= k;
            // Apply to anchor; camera target will lerp toward anchor
            if (!window.cameraAnchor && window.gfx && window.gfx.cameraTarget) {
              window.cameraAnchor = window.gfx.cameraTarget.position.clone();
            }
            if (window.cameraAnchor) {
              const tileSize = (window.TILE_SIZE || 4);
              const w = (window.liveField && window.liveField.width) ? window.liveField.width * tileSize : 256;
              const h = (window.liveField && window.liveField.height) ? window.liveField.height * tileSize : 256;
              const margin = 2 * tileSize;
              const minX = margin, minZ = margin;
              const maxX = Math.max(minX, w - margin);
              const maxZ = Math.max(minZ, h - margin);
              let nx = window.cameraAnchor.x + dx;
              let nz = window.cameraAnchor.z + dz;
              // Clamp anchor within field
              nx = Math.max(minX, Math.min(maxX, nx));
              nz = Math.max(minZ, Math.min(maxZ, nz));
              if (Number.isFinite(nx)) window.cameraAnchor.x = nx;
              if (Number.isFinite(nz)) window.cameraAnchor.z = nz;
              if (window.debugPan) {
                try {
                  console.log('[PAN]', {
                    dx: +dx.toFixed(3), dz: +dz.toFixed(3),
                    anchor: { x: +window.cameraAnchor.x.toFixed(3), z: +window.cameraAnchor.z.toFixed(3) },
                    target: window.gfx && window.gfx.cameraTarget ? { x: +window.gfx.cameraTarget.position.x.toFixed(3), z: +window.gfx.cameraTarget.position.z.toFixed(3) } : null,
                    cam: window.gfx && window.gfx.camera ? { alpha: +window.gfx.camera.alpha.toFixed(3), beta: +window.gfx.camera.beta.toFixed(3), radius: +window.gfx.camera.radius.toFixed(3) } : null
                  });
                } catch (e) {}
              }
            }
          }
        }
      }

      // Update reference points for incremental gesture processing
      gestureInitial.distance = da.dist;
      gestureInitial.angle = da.ang;
      gestureInitial.centroid = cNow;
      gestureInitial.radius = window.gfx && window.gfx.camera ? window.gfx.camera.radius : gestureInitial.radius;
      gestureInitial.worldAtCentroid = screenToWorld(cNow.x, cNow.y) || gestureInitial.worldAtCentroid;

      // Failsafe: ensure camera numbers are finite; otherwise revert
      if (window.gfx && window.gfx.camera && window._lastSafeCamera) {
        const cam = window.gfx.camera;
        const target = window.gfx.cameraTarget && window.gfx.cameraTarget.position;
        const ok = Number.isFinite(cam.alpha) && Number.isFinite(cam.beta) && Number.isFinite(cam.radius) && (!target || (Number.isFinite(target.x) && Number.isFinite(target.z)));
        if (!ok) {
          cam.alpha = window._lastSafeCamera.alpha;
          cam.beta = window._lastSafeCamera.beta;
          cam.radius = window._lastSafeCamera.radius;
          if (target) {
            target.x = window._lastSafeCamera.tx;
            target.z = window._lastSafeCamera.tz;
          }
          gestureActive = false;
          gestureCommitted = false;
          // Also reset gestureInitial to avoid reusing bad refs
          gestureInitial = null;
        } else {
          // refresh safe snapshot
          window._lastSafeCamera = {
            alpha: cam.alpha,
            beta: cam.beta,
            radius: cam.radius,
            tx: target ? target.x : 0,
            tz: target ? target.z : 0
          };
        }
      }
    }

    function isTouchLike(e) {
      return e.pointerType && e.pointerType !== 'mouse';
    }

    function onPointerDown(e) {
      if (!isTouchLike(e)) return; // leave mouse to existing system
      e.preventDefault();
      e.stopPropagation();

      // Track pointer
      if (!activePointers.has(e.pointerId)) {
        const ps = makePointerState(e);
        activePointers.set(e.pointerId, ps);
        pointerOrder.push(e.pointerId);
      }

      // If we were doing a single-finger drag and a second finger comes down, end the drag ONLY if we had emitted synthetic down
      if (activePointers.size === 2) {
        if (pointerOrder.length > 0) {
          const primary = activePointers.get(pointerOrder[0]);
          if (primary && primary.syntheticDownEmitted) {
            sendSyntheticPointer('pointerup', primary.x, primary.y, 0, { suppressTerrainClick: true });
            primary.syntheticDownEmitted = false;
          }
        }
      }

      beginGestureIfNeeded();

      // If only one finger, defer synthetic left button down until drag threshold is crossed
      // Also initialize building placement session tracking
      if (window.buildingSystem && window.buildingSystem.isPlacing) {
        placingTouchId = e.pointerId;
        placingPreviewMoved = false;
        placingLastTileX = null;
        placingLastTileZ = null;
      }
    }

    function onPointerMove(e) {
      if (!isTouchLike(e)) return;
      e.preventDefault();
      e.stopPropagation();

      const ps = activePointers.get(e.pointerId);
      if (ps) updatePointerState(ps, e);
      lastTouchClientX = e.clientX;
      lastTouchClientY = e.clientY;
      if (!moveRafScheduled) {
        moveRafScheduled = true;
        requestAnimationFrame(() => {
          moveRafScheduled = false;
          // Building placement preview tracking should run regardless of pointer tracking state
          if (window.buildingSystem && window.buildingSystem.isPlacing && window.buildingSystem.previewMesh) {
            let worldPos = screenToWorld(lastTouchClientX, lastTouchClientY);
            // Fallback to scene.pick with canvas-local coordinates if needed
            if ((!worldPos || !Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.z)) && window.gfx && window.gfx.scene && window.gfx.canvas) {
              const rect2 = window.gfx.canvas.getBoundingClientRect();
              const lx = lastTouchClientX - rect2.left;
              const ly = lastTouchClientY - rect2.top;
              const pr = window.gfx.scene.pick(lx, ly);
              if (pr && pr.hit && pr.pickedPoint) {
                worldPos = pr.pickedPoint;
              }
            }
            if (worldPos && Number.isFinite(worldPos.x) && Number.isFinite(worldPos.z)) {
              const tile = (window.TILE_SIZE || 4);
              const gridXWorld = Math.round(worldPos.x / tile) * tile;
              const gridZWorld = Math.round(worldPos.z / tile) * tile;
              window.buildingSystem.previewMesh.position.x = gridXWorld;
              window.buildingSystem.previewMesh.position.z = gridZWorld;
              window.buildingSystem.previewMesh.position.y = 0.25;
              window.buildingSystem.previewMesh.rotation.y = window.buildingSystem.placementRotation || 0;
              // Update placement moved flag based on tile changes
              if (placingTouchId !== null) {
                const gx = Math.round(worldPos.x / tile);
                const gz = Math.round(worldPos.z / tile);
                if (placingLastTileX === null || placingLastTileZ === null) {
                  placingLastTileX = gx; placingLastTileZ = gz;
                } else if (gx !== placingLastTileX || gz !== placingLastTileZ) {
                  placingPreviewMoved = true;
                  placingLastTileX = gx; placingLastTileZ = gz;
                }
              }
              if (window.buildingSystem.selectedBuildingType === 'camp' && window.buildingSystem.updateRadiusVisualization) {
                window.buildingSystem.updateRadiusVisualization(window.buildingSystem.previewMesh.position);
              }
              if (window.buildingSystem.updatePreviewValidity) {
                const gx = Math.round(worldPos.x / tile);
                const gz = Math.round(worldPos.z / tile);
                window.buildingSystem.updatePreviewValidity(gx, gz);
                if (window.buildingSystem.detectResourcesForCamp && window.buildingSystem.selectedBuildingType === 'camp') {
                  window.buildingSystem.detectResourcesForCamp(gx, gz);
                }
              }
            }
          }

          if (activePointers.size >= 2) {
            beginGestureIfNeeded();
            applyTwoFingerGesture();
            // Auxiliary during gesture
            const primary = getTwoPrimaryPointers();
            if (primary) {
              const primaryIds = new Set([primary[0].id, primary[1].id]);
              for (const aps of activePointers.values()) {
                if (!primaryIds.has(aps.id)) {
                  if (!(window.buildingSystem && window.buildingSystem.isPlacing)) {
                    const dx = aps.x - aps.startX;
                    const dy = aps.y - aps.startY;
                    const movedSq = dx*dx + dy*dy;
                    const thresh = config.dragStartThresholdPx;
                    if (!aps.syntheticDownEmitted && movedSq >= thresh*thresh && now() >= suppressSingleTapUntil) {
                      sendSyntheticPointer('pointerdown', aps.startX, aps.startY, 0, { suppressTerrainClick: true });
                      aps.syntheticDownEmitted = true;
                    }
                    if (aps.syntheticDownEmitted) {
                      sendSyntheticPointer('pointermove', aps.x, aps.y, 0, { suppressTerrainClick: true });
                    }
                  }
                }
              }
            }
          } else if (activePointers.size === 1) {
            if (window.buildingSystem && window.buildingSystem.isPlacing) return;
            for (const only of activePointers.values()) {
              const dx = only.x - only.startX;
              const dy = only.y - only.startY;
              const movedSq = dx*dx + dy*dy;
              const thresh = config.dragStartThresholdPx;
              if (!only.syntheticDownEmitted && movedSq >= thresh*thresh) {
                if (now() >= suppressSingleTapUntil) {
                  sendSyntheticPointer('pointerdown', only.startX, only.startY, 0, { suppressTerrainClick: true });
                  only.syntheticDownEmitted = true;
                }
              }
              if (only.syntheticDownEmitted) {
                sendSyntheticPointer('pointermove', only.x, only.y, 0, { suppressTerrainClick: true });
              }
            }
          }
        });
      }
    }

    function onPointerUp(e) {
      if (!isTouchLike(e)) return;
      e.preventDefault();
      e.stopPropagation();

      const ps = activePointers.get(e.pointerId);
      if (!ps) return;
      updatePointerState(ps, e);
      ps.isDown = false;

      const wasGesture = gestureActive && activePointers.size >= 2;
      // Determine if this pointer was one of the two gesture primaries
      let isPrimaryGesturePointer = false;
      if (gestureActive) {
        const pairUp = getTwoPrimaryPointers();
        if (pairUp) {
          isPrimaryGesturePointer = (ps.id === pairUp[0].id || ps.id === pairUp[1].id);
        }
      }

      // Remove pointer first
      activePointers.delete(e.pointerId);
      const idx = pointerOrder.indexOf(e.pointerId);
      if (idx !== -1) pointerOrder.splice(idx, 1);

      // End gesture if needed
      endGestureIfNeeded();

      // Determine tap types
      const dt = now() - ps.startTime;
      const moveSq = distanceSq(ps.startX, ps.startY, ps.x, ps.y);
      const rect = canvasRect();
      const clientX = ps.x;
      const clientY = ps.y;

      if (isPrimaryGesturePointer) {
        // Primary gesture finger lifted; don't treat as tap
        if (activePointers.size === 0) {
          // Reset initial to avoid jump on next gesture
          gestureInitial = null;
        }
        return;
      }

      if (activePointers.size === 0) {
        // Single finger scenario (no other pointers active)
        if (skipNextSingleTap || now() < suppressSingleTapUntil) {
          // Consume the skip and avoid triggering any single-tap actions
          skipNextSingleTap = false;
          return;
        }
        if (dt <= config.tapMaxTimeMs && moveSq <= (config.tapMaxMovePx * config.tapMaxMovePx)) {
          // If building placement mode, tap places the building
          if (window.buildingSystem && window.buildingSystem.isPlacing) {
            // Require that the preview actually moved or the touch held long enough before allowing a tap place
            const heldLongEnough = (now() - ps.startTime) >= (config.buildPlaceMinHoldMs || 200);
            if (placingPreviewMoved || heldLongEnough) {
              const worldPos = screenToWorld(clientX, clientY);
              if (worldPos && window.buildingSystem.placeBuildingAt) {
                const tile = (window.TILE_SIZE || 4);
                const gx = Math.round(worldPos.x / tile);
                const gz = Math.round(worldPos.z / tile);
                window.buildingSystem.placeBuildingAt(gx, gz);
                // Reset placement session state
                placingTouchId = null;
                placingPreviewMoved = false;
                placingLastTileX = null;
                placingLastTileZ = null;
                return;
              }
            }
          }
          // If we emitted a synthetic drag, close it and skip tap logic
          if (ps.syntheticDownEmitted) {
            sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: true });
            ps.syntheticDownEmitted = false;
          } else {
            const timeSinceLast = now() - lastSingleTapTime;
            const distSinceLastSq = lastSingleTapPos ? distanceSq(clientX, clientY, lastSingleTapPos.x, lastSingleTapPos.y) : Infinity;
            console.log('📱 Tap detection - current:', {x: clientX, y: clientY}, 'last:', lastSingleTapPos, 'timeSinceLast:', timeSinceLast, 'doubleTapDelayMs:', config.doubleTapDelayMs, 'distSinceLastSq:', distSinceLastSq, 'tapMaxMovePx^2:', config.tapMaxMovePx * config.tapMaxMovePx);
            if (lastSingleTapPos && timeSinceLast < config.doubleTapDelayMs && distSinceLastSq < (config.tapMaxMovePx * config.tapMaxMovePx)) {
              // Double tap: trigger special ability at world position
              console.log('📱 Mobile double tap detected - triggering special abilities');
              const worldPos = screenToWorld(clientX, clientY);
              if (worldPos && window.ui && window.ui.triggerSpecialAbilityAt) {
                console.log('📱 Calling triggerSpecialAbilityAt with worldPos:', worldPos);
                window.ui.triggerSpecialAbilityAt(worldPos);
              } else {
                console.log('📱 Failed to trigger special ability - worldPos:', worldPos, 'ui:', !!window.ui, 'triggerSpecialAbilityAt:', !!window.ui?.triggerSpecialAbilityAt);
              }
              // Reset double-tap tracking so a third tap doesn't chain
              lastSingleTapTime = 0;
              lastSingleTapPos = null;
            } else {
              // Single tap: synthesize a click
              sendSyntheticPointer('pointerdown', clientX, clientY, 0, { suppressTerrainClick: false });
              sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: false });
              // Update last tap for double-tap detection
              lastSingleTapTime = now();
              lastSingleTapPos = { x: clientX, y: clientY };
              console.log('📱 Single tap recorded at:', lastSingleTapPos, 'time:', lastSingleTapTime);
            }
          }
        } else {
          // End of drag if one was started
          if (ps.syntheticDownEmitted) {
            sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: true });
            ps.syntheticDownEmitted = false;
          }
        }
      } else if (activePointers.size >= 1) {
        // Auxiliary pointer up while other gesture fingers remain
        if (ps.syntheticDownEmitted) {
          sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: true });
          ps.syntheticDownEmitted = false;
          return;
        }
        // Tap behavior for auxiliary pointer
        if (skipNextSingleTap || now() < suppressSingleTapUntil) {
          skipNextSingleTap = false;
          return;
        }
        if (dt <= config.tapMaxTimeMs && moveSq <= (config.tapMaxMovePx * config.tapMaxMovePx)) {
          // Building placement tap during gesture
          if (window.buildingSystem && window.buildingSystem.isPlacing) {
            const worldPos = screenToWorld(clientX, clientY);
            if (worldPos && window.buildingSystem.placeBuildingAt) {
              const tile = (window.TILE_SIZE || 4);
              const gx = Math.round(worldPos.x / tile);
              const gz = Math.round(worldPos.z / tile);
              window.buildingSystem.placeBuildingAt(gx, gz);
              return;
            }
          }
          // Otherwise synthesize a click to issue action
          sendSyntheticPointer('pointerdown', clientX, clientY, 0, { suppressTerrainClick: false });
          sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: false });
        }
      }
    }

    // To detect two-finger tap, we watch for two pointers that both lifted quickly with minimal move
    // We keep a small rolling window of recent quick-up pointers
    const recentQuickUps = [];
    function recordQuickUp(x, y, dt, moveSq) {
      if (dt <= config.twoFingerTapMaxTimeMs && moveSq <= (config.twoFingerTapMaxMovePx * config.twoFingerTapMaxMovePx)) {
        recentQuickUps.push({ t: now(), x, y });
        // Prune
        const threshold = config.doubleTapDelayMs;
        const tnow = now();
        for (let i = recentQuickUps.length - 1; i >= 0; i--) {
          if (tnow - recentQuickUps[i].t > threshold) recentQuickUps.splice(i, 1);
        }
      }
    }

    // Patch pointerup to also track quick-ups for two-finger tap
    const _onPointerUpOriginal = onPointerUp;
    onPointerUp = function(e) {
      if (!isTouchLike(e)) return;
      const ps = activePointers.get(e.pointerId);
      if (ps) {
        const dt = now() - ps.startTime;
        const moveSq = distanceSq(ps.startX, ps.startY, ps.x, ps.y);
        recordQuickUp(ps.x, ps.y, dt, moveSq);
      }

      // Pre-emptively detect two-finger tap/double-tap BEFORE original handler (so we can suppress single-tap moves)
      if (recentQuickUps.length >= 2) {
        const a = recentQuickUps[recentQuickUps.length - 1];
        const b = recentQuickUps[recentQuickUps.length - 2];
        const timeDiff = Math.abs(a.t - b.t);
        if (timeDiff < config.twoFingerTapMaxTimeMs) {
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2;
          const timeSinceLastTwo = now() - lastTwoTapTime;
          const distTwoSq = distanceSq(cx, cy, lastTwoTapPos.x, lastTwoTapPos.y);
          const centerThresh = (config.twoFingerDoubleTapCenterMaxMovePx || 80);
          if (timeSinceLastTwo < config.doubleTapDelayMs && distTwoSq < (centerThresh * centerThresh)) {
            // Double 2-tap: clear active selection immediately
            if (window.player && window.player.clearSelection) {
              window.player.clearSelection();
            }
            // Suppress any ensuing single-tap/lasso start
            skipNextSingleTap = true;
            suppressSingleTapUntil = now() + (config.suppressSingleTapAfterTwoFingerMs || 300);
            lastTwoTapTime = 0;
            lastTwoTapPos = { x: 0, y: 0 };
          } else {
            // Single 2-tap: record center and suppress single-tap briefly so it remains a no-op
            lastTwoTapTime = now();
            lastTwoTapPos = { x: cx, y: cy };
            suppressSingleTapUntil = now() + Math.max(150, config.twoFingerTapMaxTimeMs || 300);
            skipNextSingleTap = true;
          }
          // Consume the quick-ups so we don't double-handle after original
          recentQuickUps.length = 0;
        }
      }

      _onPointerUpOriginal(e);
    };

    function onPointerCancel(e) {
      if (!isTouchLike(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (activePointers.has(e.pointerId)) {
        activePointers.delete(e.pointerId);
        const idx = pointerOrder.indexOf(e.pointerId);
        if (idx !== -1) pointerOrder.splice(idx, 1);
      }
      endGestureIfNeeded();
    }

    // Attach listeners (non-passive to allow preventDefault)
    canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
    canvas.addEventListener('pointermove', onPointerMove, { passive: false });
    canvas.addEventListener('pointerup', onPointerUp, { passive: false });
    canvas.addEventListener('pointercancel', onPointerCancel, { passive: false });
    console.log('📱 Touch event listeners registered');

    touch._initialized = true;
  };

}(window.touch = window.touch || {}));


