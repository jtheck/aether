(function(touch) {
  'use strict';

  // Public API
  touch.init = function initTouchManager(canvas, options) {
    if (!canvas || touch._initialized) {
      return;
    }

    const config = Object.assign({
      tapMaxTimeMs: 400, // Even more time for each individual tap
      tapMaxMovePx: 60, // Even bigger area - very forgiving finger drift
      doubleTapDelayMs: 1500, // 1.5 full seconds - very relaxed timing
      twoFingerTapMaxTimeMs: 300,
      twoFingerTapMaxMovePx: 16,
      twoFingerDoubleTapCenterMaxMovePx: 80,
      rotateSensitivity: 1.8, // Smooth rotation without snapping
      pinchSensitivity: 1.5, // Responsive zoom
      panSensitivity: 6.5, // Responsive pan
      firefoxPanSensitivity: 15.0, // Higher pan sensitivity for Firefox to compensate for glitchy tracking
      pinchDeadzone: 50.0, // Ignore finger spacing changes smaller than this (prevents zoom during pan)
      pinchCentroidStability: 80.0, // Max centroid movement for intentional pinch (px) - higher = more lenient
      pinchCentroidRatioMax: 0.40, // Max ratio of centroid movement to finger spread (0.40 = centroid can move up to 40% of spread)
      rotateDeadzone: 0.35, // Ignore rotation smaller than this (~20 degrees)
      gestureStabilityFrames: 2, // Require N consecutive clean frames before allowing gesture engagement
      debugGestures: false, // Set to true to see gesture engagement in console
      gestureSmoothingFactor: 0.3, // Lerp factor for smooth gesture interpolation (0=no smoothing, 1=instant)
      dragStartThresholdPx: 15,
      suppressSingleTapAfterTwoFingerMs: 300,
      initialPinchMinSpanPx: 20, // Require fingers to be spread apart to start gesture
      // Building placement UX
      buildPlaceMinHoldMs: 150 // Reduced from 200ms for snappier placement
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

    // Cache canvas rect, update on resize
    let cachedCanvasRect = canvas.getBoundingClientRect();
    let rectDirty = false;
    const updateCachedRect = () => {
      cachedCanvasRect = canvas.getBoundingClientRect();
      rectDirty = false;
    };
    const scheduleRectUpdate = () => { 
      if (!rectDirty) {
        rectDirty = true;
        requestAnimationFrame(updateCachedRect);
      }
    };
    window.addEventListener('resize', scheduleRectUpdate, { passive: true });
    const canvasRect = () => cachedCanvasRect;

    // Single tap/double tap tracking
    let lastSingleTapTime = 0;
    let lastSingleTapPos = null; // Use null to indicate no previous tap
    let doubleTapCooldownUntil = 0; // Prevent rapid triple-tap from registering as double-tap

    // Two-finger tap/double-tap tracking
    let lastTwoTapTime = 0;
    let lastTwoTapPos = { x: 0, y: 0 };
    // Guard to prevent single-tap actions when a 2-finger tap/double-tap is recognized
    let skipNextSingleTap = false;
    let suppressSingleTapUntil = 0;

    // Gesture state when 2+ pointers
    let gestureActive = false;
    let gestureLast = null; // Store last frame's gesture state for incremental updates
    let gestureInitial = null; // Store initial gesture state for deadzone checks
    let gesturePrimaryFingerIds = null; // Lock the two finger IDs for the entire gesture
    let gestureEngaged = { pinch: false, rotate: false }; // Track which gestures have engaged
    let gestureStableFrames = 0; // Count consecutive clean frames before allowing engagement
    
    // Momentum/inertia state
    let gestureVelocity = { pan: { x: 0, z: 0 }, rotate: 0, pinch: 0 };
    let momentumActive = false;
    let momentumDecay = 0.92; // How fast momentum decays per frame (0.92 = ~8% loss per frame)
    // Coalesce touch move handling to one frame
    let moveRafScheduled = false;
    let lastTouchClientX = 0, lastTouchClientY = 0;

    // Building placement session flags
    let placingTouchId = null;
    let placingPreviewMoved = false;
    let placingLastTileX = null;
    let placingLastTileZ = null;

    // Performance optimization: cache time within frame
    let cachedTime = performance.now();
    let timeValid = true;
    function now() { 
      if (!timeValid) {
        cachedTime = performance.now();
        timeValid = true;
      }
      return cachedTime;
    }
    function invalidateTime() { timeValid = false; }
    
    // Pre-compute squared thresholds to avoid repeated multiplications
    const tapMaxMovePxSq = config.tapMaxMovePx * config.tapMaxMovePx;
    const twoFingerTapMaxMovePxSq = config.twoFingerTapMaxMovePx * config.twoFingerTapMaxMovePx;
    const dragStartThresholdPxSq = config.dragStartThresholdPx * config.dragStartThresholdPx;
    const twoFingerDoubleTapCenterMaxMovePxSq = config.twoFingerDoubleTapCenterMaxMovePx * config.twoFingerDoubleTapCenterMaxMovePx;

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
      // If gesture is active, use the locked finger IDs
      if (gestureActive && gesturePrimaryFingerIds) {
        const a = activePointers.get(gesturePrimaryFingerIds[0]);
        const b = activePointers.get(gesturePrimaryFingerIds[1]);
        if (!a || !b) return null; // One of the locked fingers was lifted
        
        // CRITICAL: Validate both pointers have recent updates
        // Mobile browsers (Android/iOS) batch touch events aggressively for battery savings
        const isMobileBrowser = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
        
        // Desktop touch (Windows tablets, etc.) works great with strict checks
        // Allow bypass for testing/debugging
        if (!isMobileBrowser && !touch._bypassStaleness) {
          const currentTime = now();
          const maxStaleness = 50; // ms
          const aAge = currentTime - a.lastTime;
          const bAge = currentTime - b.lastTime;
          
          // Reject if either finger is stale or if there's a huge age difference
          const extremelyStale = (aAge > maxStaleness) || (bAge > maxStaleness);
          const hugeDifference = Math.abs(aAge - bAge) > 30; // One finger way behind the other
          
          if (extremelyStale || hugeDifference) {
            return null;
          }
        }
        // Mobile browsers: skip staleness checks, rely on anomaly detection instead
        
        return [a, b];
      }
      
      // Otherwise, use the first two pointers for initializing a new gesture
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
    
    function computeRotationAngle(a, b, centroid) {
      // Calculate angle of finger A relative to centroid
      const angleA = Math.atan2(a.y - centroid.y, a.x - centroid.x);
      return angleA; // Return one finger's angle - consistent reference point
    }

    function screenToWorld(screenX, screenY) {
      if (!window.ui || !window.ui.getWorldPositionFromScreen) {
        return null;
      }
      return window.ui.getWorldPositionFromScreen(screenX, screenY);
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
        const d = computeDistanceAndAngle(a, b);
        // Require a minimum initial span to avoid explosive scales
        if (d.dist < config.initialPinchMinSpanPx) {
          return;
        }
        gestureActive = true;
        window.gestureInProgress = true;
        
        // Stop any momentum when new gesture starts
        momentumActive = false;
        gestureVelocity = { pan: { x: 0, z: 0 }, rotate: 0, pinch: 0 };
        
        // LOCK these two specific finger IDs
        gesturePrimaryFingerIds = [a.id, b.id];
        
        // Store initial and last frame state
        const centroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rotAngle = computeRotationAngle(a, b, centroid);
        
        gestureInitial = {
          centroid: centroid,
          distance: d.dist,
          angle: rotAngle,
          bestRatio: 1.0 // Track best (lowest) ratio seen
        };
        
        gestureLast = {
          centroid: centroid,
          distance: d.dist,
          angle: rotAngle
        };
        
        gestureEngaged = { pinch: false, rotate: false };
        gestureStableFrames = 0;
        
        // Temporarily disable camera auto-follow
        if (typeof window.cameraAutoFollowEnabled !== 'undefined') {
          window._prevCameraAutoFollow = window.cameraAutoFollowEnabled;
        }
        window.cameraAutoFollowEnabled = false;
      }
    }

    function endGestureIfNeeded() {
      if (!gestureActive) return;
      
      // End gesture if we have fewer than 2 pointers, OR if one of the locked gesture fingers is gone
      const shouldEnd = activePointers.size < 2 || 
        (gesturePrimaryFingerIds && (!activePointers.has(gesturePrimaryFingerIds[0]) || !activePointers.has(gesturePrimaryFingerIds[1])));
      
      if (shouldEnd) {
        // Mark remaining gesture fingers to prevent them from starting drag selections
        if (gesturePrimaryFingerIds) {
          for (const id of gesturePrimaryFingerIds) {
            const ps = activePointers.get(id);
            if (ps) {
              ps.wasInGesture = true; // Flag to suppress drag behavior
            }
          }
        }
        
        // Activate momentum with current velocity
        momentumActive = true;
        
        gestureActive = false;
        gestureLast = null;
        gestureInitial = null;
        gesturePrimaryFingerIds = null;
        gestureEngaged = { pinch: false, rotate: false };
        gestureStableFrames = 0;
        window.gestureInProgress = false;
        // Restore camera auto-follow
        if (typeof window._prevCameraAutoFollow !== 'undefined') {
          window.cameraAutoFollowEnabled = window._prevCameraAutoFollow;
          delete window._prevCameraAutoFollow;
        }
      }
    }

    function applyTwoFingerGesture() {
      if (window.buildingSystem && window.buildingSystem.isPlacing) return;
      if (!gestureActive || activePointers.size < 2 || !gestureLast) return;
      
      // Mobile browsers need more lenient gesture detection
      const isMobileBrowser = /android|iphone|ipad|ipod/i.test(navigator.userAgent);
      
      const pair = getTwoPrimaryPointers();
      if (!pair) {
        endGestureIfNeeded();
        return;
      }
      
      const [a, b] = pair;
      const cNow = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const da = computeDistanceAndAngle(a, b);
      
      // Check if this looks like a 2-finger tap (don't move camera)
      const aMoveSq = distanceSq(a.startX, a.startY, a.x, a.y);
      const bMoveSq = distanceSq(b.startX, b.startY, b.x, b.y);
      const aDt = now() - a.startTime;
      const bDt = now() - b.startTime;
      const bothTapLike = (aMoveSq <= twoFingerTapMaxMovePxSq && bMoveSq <= twoFingerTapMaxMovePxSq && aDt <= config.twoFingerTapMaxTimeMs && bDt <= config.twoFingerTapMaxTimeMs);
      if (bothTapLike) return;
      
      if (!window.gfx || !window.gfx.camera || !window.gfx.cameraTarget) return;
      const cam = window.gfx.camera;
      const target = window.gfx.cameraTarget.position;
      
      // INCREMENTAL DELTAS since last frame
      const distDelta = da.dist - gestureLast.distance;
      
      // Calculate rotation using finger angle around centroid (not line angle between fingers)
      const currentRotationAngle = computeRotationAngle(a, b, cNow);
      let angleDelta = currentRotationAngle - gestureLast.angle;
      // Normalize angle delta to handle wrapping (prevent jumps at ±π boundary)
      if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
      if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;
      
      const centroidDx = cNow.x - gestureLast.centroid.x;
      const centroidDy = cNow.y - gestureLast.centroid.y;
      
      // DETECT ANOMALIES: If finger positions jump too much in one frame, reset baseline
      // Mobile browsers need tighter thresholds since we disabled staleness checks for them
      const maxReasonableCentroidMove = isMobileBrowser ? 60 : 100;
      const maxReasonableAngle = isMobileBrowser ? 0.25 : 0.3;
      const maxReasonableDistChange = isMobileBrowser ? 40 : 50;
      
      const centroidMoveSq = centroidDx * centroidDx + centroidDy * centroidDy;
      const isAnomalousFrame = (
        centroidMoveSq > maxReasonableCentroidMove * maxReasonableCentroidMove ||
        Math.abs(angleDelta) > maxReasonableAngle ||
        Math.abs(distDelta) > maxReasonableDistChange
      );
      
      if (isAnomalousFrame) {
        // Finger positions jumped unreasonably - reset baseline to prevent false gesture engagement
        if (config.debugGestures) {
          console.warn(`[GESTURE] ANOMALY - resetting (dist: ${Math.abs(distDelta).toFixed(1)}px, centroid: ${Math.sqrt(centroidMoveSq).toFixed(1)}px, angle: ${Math.abs(angleDelta * 180 / Math.PI).toFixed(1)}°)`);
        }
        gestureInitial = {
          centroid: cNow,
          distance: da.dist,
          angle: currentRotationAngle
        };
        gestureLast = {
          centroid: cNow,
          distance: da.dist,
          angle: currentRotationAngle
        };
        gestureStableFrames = 0; // Reset stability counter
        return; // Skip this frame
      }
      
      // Increment stability counter for clean frames
      gestureStableFrames++;
      
      // SMOOTHING: Lerp deltas for natural inertia
      const smoothFactor = config.gestureSmoothingFactor || 0.3;
      
      const clampedCentroidDx = centroidDx;
      const clampedCentroidDy = centroidDy;
      const clampedAngleDelta = angleDelta;
      const clampedDistDelta = distDelta;
      
      // Check TOTAL delta from gesture start to determine if gesture should engage
      // Mobile browsers need slightly larger deadzones for reliable detection
      const pinchDeadzone = isMobileBrowser ? 60.0 : (config.pinchDeadzone || 50.0);
      const rotateDeadzone = isMobileBrowser ? 0.40 : (config.rotateDeadzone || 0.35); // ~23° for mobile, ~20° for desktop
      const stabilityRequired = isMobileBrowser ? 1 : (config.gestureStabilityFrames || 2);
      
      const totalDistDelta = Math.abs(da.dist - gestureInitial.distance);
      
      // Calculate total centroid movement from gesture start
      const totalCentroidDx = cNow.x - gestureInitial.centroid.x;
      const totalCentroidDy = cNow.y - gestureInitial.centroid.y;
      const totalCentroidMove = Math.sqrt(totalCentroidDx * totalCentroidDx + totalCentroidDy * totalCentroidDy);
      
      // Handle angle wrapping for total rotation
      let totalAngleDelta = currentRotationAngle - gestureInitial.angle;
      if (totalAngleDelta > Math.PI) totalAngleDelta -= 2 * Math.PI;
      if (totalAngleDelta < -Math.PI) totalAngleDelta += 2 * Math.PI;
      totalAngleDelta = Math.abs(totalAngleDelta);
      
      // CRITICAL: Pinch requires BOTH finger spread AND centroid stability
      // If fingers spread during panning, centroid moves proportionally - reject!
      // If fingers intentionally pinch, centroid stays relatively stable - accept!
      const centroidStabilityThreshold = isMobileBrowser ? 100 : (config.pinchCentroidStability || 80);
      
      // Key insight: When panning with drift, centroid/distance ratio is ~0.5
      // When intentionally pinching, ratio improves (gets lower) over time
      const centroidToDistanceRatio = totalDistDelta > 0 ? (totalCentroidMove / totalDistDelta) : 0;
      
      // Update best (lowest) ratio seen during gesture
      if (centroidToDistanceRatio < gestureInitial.bestRatio && totalDistDelta >= 20) {
        gestureInitial.bestRatio = centroidToDistanceRatio;
      }
      
      // SMART DETECTION: If gesture STARTED with good ratio, accept even if it drifts later
      // This handles touchscreen reality: hard to maintain perfect centroid stability
      const maxStaticRatio = config.pinchCentroidRatioMax || 0.40; // Strict threshold for current ratio
      const maxBestRatio = 0.45; // If best ratio ever seen was < 0.45, it's a pinch
      const hadGoodRatio = gestureInitial.bestRatio < maxBestRatio; // Started as pinch
      
      const isPinchIntentional = 
        totalDistDelta >= pinchDeadzone && 
        totalCentroidMove < centroidStabilityThreshold &&
        (centroidToDistanceRatio < maxStaticRatio || hadGoodRatio);
      
      // Require BOTH sufficient delta AND stable tracking before engaging
      if (!gestureEngaged.pinch && isPinchIntentional && gestureStableFrames >= stabilityRequired) {
        gestureEngaged.pinch = true;
        if (config.debugGestures) console.log(`[GESTURE] ✓ PINCH ENGAGED (dist: ${totalDistDelta.toFixed(1)}px, centroid: ${totalCentroidMove.toFixed(1)}px, ratio: ${centroidToDistanceRatio.toFixed(2)}, best: ${gestureInitial.bestRatio.toFixed(2)})`);
      }
      if (!gestureEngaged.rotate && totalAngleDelta >= rotateDeadzone && gestureStableFrames >= stabilityRequired) {
        gestureEngaged.rotate = true;
        if (config.debugGestures) console.log(`[GESTURE] ✓ ROTATE ENGAGED (${(totalAngleDelta * 180 / Math.PI).toFixed(1)}° after ${gestureStableFrames} stable frames)`);
      }
      
      if (config.debugGestures && !gestureEngaged.pinch && !gestureEngaged.rotate) {
        const browserInfo = isMobileBrowser ? ' [Mobile]' : '';
        
        // Show what's blocking pinch engagement
        if (totalDistDelta >= pinchDeadzone) {
          const reasons = [];
          if (totalCentroidMove >= centroidStabilityThreshold) {
            reasons.push(`centroid too far: ${totalCentroidMove.toFixed(1)}/${centroidStabilityThreshold}px`);
          }
          if (!hadGoodRatio && centroidToDistanceRatio >= maxStaticRatio) {
            reasons.push(`ratio: ${centroidToDistanceRatio.toFixed(2)} (current), best: ${gestureInitial.bestRatio.toFixed(2)} (never reached < ${maxBestRatio.toFixed(2)})`);
          }
          if (reasons.length > 0) {
            console.log(`[GESTURE] ❌ Pinch BLOCKED${browserInfo} - ${reasons.join(', ')}`);
          }
        }
        
        console.log(`[GESTURE] Pan (${gestureStableFrames}/${stabilityRequired} stable)${browserInfo} - dist: ${totalDistDelta.toFixed(1)}/${pinchDeadzone}px, centroid: ${totalCentroidMove.toFixed(1)}px (ratio: ${centroidToDistanceRatio.toFixed(2)}), rot: ${(totalAngleDelta * 180 / Math.PI).toFixed(1)}/${(rotateDeadzone * 180 / Math.PI).toFixed(1)}°`);
      }
      
      const applyPinch = gestureEngaged.pinch;
      const applyRotate = gestureEngaged.rotate;
      
      // Apply smoothed deltas (lerp for natural damping)
      const smoothedDistDelta = applyPinch ? (clampedDistDelta * smoothFactor) : 0;
      const smoothedAngleDelta = applyRotate ? (clampedAngleDelta * 0.5) : 0; // Less smoothing for rotation
      const smoothedCentroidDx = clampedCentroidDx * smoothFactor;
      const smoothedCentroidDy = clampedCentroidDy * smoothFactor;
      
      // 1. PINCH TO ZOOM - only if exceeds deadzone
      if (applyPinch && Math.abs(smoothedDistDelta) > 0.1) {
        const pinchVel = smoothedDistDelta * config.pinchSensitivity;
        cam.radius -= pinchVel;
        cam.radius = Math.max(10, Math.min(200, cam.radius)); // Clamp
        gestureVelocity.pinch = -pinchVel; // Store velocity for momentum
      } else {
        gestureVelocity.pinch = 0; // Clear velocity if not pinching
      }
      
      // 2. ROTATE - only if exceeds deadzone
      if (applyRotate && Math.abs(smoothedAngleDelta) > 0.001) {
        const rotateVel = smoothedAngleDelta * config.rotateSensitivity;
        cam.alpha -= rotateVel;
        gestureVelocity.rotate = -rotateVel; // Store velocity for momentum
      } else {
        gestureVelocity.rotate = 0; // Clear velocity if not rotating
      }
      
      // 3. PAN - smoothed pan based on centroid movement
      if (Math.abs(smoothedCentroidDx) > 0.1 || Math.abs(smoothedCentroidDy) > 0.1) {
        if (window.gfx.canvas) {
          const rect = window.gfx.canvas.getBoundingClientRect();
          const pixelsToWorld = (2 * cam.radius * Math.tan((cam.fov || 0.8)/2)) / Math.max(1, rect.height);
          
          // Get camera-aligned axes
          const camPos = cam.position.clone();
          const targetPos = target.clone ? target.clone() : new BABYLON.Vector3(target.x, target.y, target.z);
          const toTarget = targetPos.subtract(camPos).normalize();
          const groundForward = new BABYLON.Vector3(toTarget.x, 0, toTarget.z);
          
          if (groundForward.lengthSquared() > 1e-6) {
            groundForward.normalize();
            const groundRight = new BABYLON.Vector3(-groundForward.z, 0, groundForward.x);
            
            // Apply smoothed incremental pan (positive = fingers drag map in same direction)
            // Use higher sensitivity on mobile to compensate for event batching
            const panSens = isMobileBrowser ? (config.firefoxPanSensitivity || 15.0) : config.panSensitivity;
            const wx = (groundRight.x * smoothedCentroidDx + groundForward.x * smoothedCentroidDy) * pixelsToWorld * panSens;
            const wz = (groundRight.z * smoothedCentroidDx + groundForward.z * smoothedCentroidDy) * pixelsToWorld * panSens;
            
            if (Number.isFinite(wx) && Number.isFinite(wz)) {
              target.x += wx;
              target.z += wz;
              // Store velocity for momentum
              gestureVelocity.pan.x = wx;
              gestureVelocity.pan.z = wz;
            }
          }
        }
      } else {
        // Clear pan velocity if not moving
        gestureVelocity.pan.x = 0;
        gestureVelocity.pan.z = 0;
      }
      
      // Update last frame state
      gestureLast.centroid = cNow;
      gestureLast.distance = da.dist;
      gestureLast.angle = currentRotationAngle; // Store proper rotation angle
    }
    
    function applyMomentum() {
      if (!momentumActive) return;
      if (!window.gfx || !window.gfx.camera || !window.gfx.cameraTarget) return;
      
      const cam = window.gfx.camera;
      const target = window.gfx.cameraTarget.position;
      
      // Apply and decay velocities
      const velocityThreshold = 0.001; // Stop when velocity is tiny
      let anyVelocity = false;
      
      // Pan momentum
      if (Math.abs(gestureVelocity.pan.x) > velocityThreshold || Math.abs(gestureVelocity.pan.z) > velocityThreshold) {
        target.x += gestureVelocity.pan.x;
        target.z += gestureVelocity.pan.z;
        gestureVelocity.pan.x *= momentumDecay;
        gestureVelocity.pan.z *= momentumDecay;
        anyVelocity = true;
      }
      
      // Rotate momentum
      if (Math.abs(gestureVelocity.rotate) > velocityThreshold) {
        cam.alpha += gestureVelocity.rotate;
        gestureVelocity.rotate *= momentumDecay;
        anyVelocity = true;
      }
      
      // Pinch momentum
      if (Math.abs(gestureVelocity.pinch) > velocityThreshold) {
        cam.radius += gestureVelocity.pinch;
        cam.radius = Math.max(10, Math.min(200, cam.radius));
        gestureVelocity.pinch *= momentumDecay;
        anyVelocity = true;
      }
      
      // Stop momentum when all velocities have decayed
      if (!anyVelocity) {
        momentumActive = false;
        gestureVelocity = { pan: { x: 0, z: 0 }, rotate: 0, pinch: 0 };
      }
    }

    function isTouchLike(e) {
      return e.pointerType && e.pointerType !== 'mouse';
    }

    // Cache UI selectors for faster checks
    const UI_SELECTORS = [
      '.lod_slider', '.lod_slider_container', '#lod_slider', '#lod_value',
      '.binary_switch', '.switch_handle', '#hud_switch', '#shadows_switch',
      'input', 'select', 'button'
    ];
    
    function isUIElement(e) {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el) return false;
      // Quick check: if target is canvas, skip expensive queries
      if (el === canvas) return false;
      // Check if any parent matches UI selectors
      for (let i = 0; i < UI_SELECTORS.length; i++) {
        if (el.closest(UI_SELECTORS[i])) return true;
      }
      return false;
    }
    

    function onPointerDown(e) {
      if (!isTouchLike(e)) return; // leave mouse to existing system
      
      // Check if we're interacting with a UI element - if so, allow normal behavior
      if (isUIElement(e)) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      invalidateTime();

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
      
      // Check if we're interacting with a UI element - if so, allow normal behavior
      if (isUIElement(e)) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      const ps = activePointers.get(e.pointerId);

      if (ps) {
        // FIREFOX FIX: Use getCoalescedEvents() to get all intermediate events
        // This helps when Firefox batches/skips pointermove events
        if (e.getCoalescedEvents && typeof e.getCoalescedEvents === 'function') {
          const coalescedEvents = e.getCoalescedEvents();
          if (coalescedEvents.length > 0) {
            // Update with the most recent coalesced event
            updatePointerState(ps, coalescedEvents[coalescedEvents.length - 1]);
          } else {
            updatePointerState(ps, e);
          }
        } else {
          updatePointerState(ps, e);
        }
      }
      lastTouchClientX = e.clientX;
      lastTouchClientY = e.clientY;
      if (!moveRafScheduled) {
        moveRafScheduled = true;
        requestAnimationFrame(() => {
          moveRafScheduled = false;
          invalidateTime();
          // Building placement preview tracking should run regardless of pointer tracking state
          if (window.buildingSystem && window.buildingSystem.isPlacing && window.buildingSystem.previewMesh) {
            let worldPos = screenToWorld(lastTouchClientX, lastTouchClientY);
            // Fallback to scene.pick with canvas-local coordinates if needed
            if ((!worldPos || !Number.isFinite(worldPos.x) || !Number.isFinite(worldPos.z)) && window.gfx && window.gfx.scene) {
              const lx = lastTouchClientX - cachedCanvasRect.left;
              const ly = lastTouchClientY - cachedCanvasRect.top;
              const pr = window.gfx.scene.pick(lx, ly);
              if (pr && pr.hit && pr.pickedPoint) {
                worldPos = pr.pickedPoint;
              }
            }
            if (worldPos && Number.isFinite(worldPos.x) && Number.isFinite(worldPos.z)) {
              const tile = (window.TILE_SIZE || 4);
              const gridXWorld = Math.round(worldPos.x / tile) * tile;
              const gridZWorld = Math.round(worldPos.z / tile) * tile;
              
              // Only update if grid position changed (avoids redundant calculations)
              const previewMesh = window.buildingSystem.previewMesh;
              if (previewMesh && (previewMesh.position.x !== gridXWorld || previewMesh.position.z !== gridZWorld)) {
                previewMesh.position.x = gridXWorld;
                previewMesh.position.z = gridZWorld;
                // Get terrain height using bilinear interpolation
                const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(gridXWorld, gridZWorld) : 0;
                previewMesh.position.y = terrainY + 0.75; // Higher up for better visibility
              }
              if (previewMesh) {
                previewMesh.rotation.y = window.buildingSystem.placementRotation || 0;
              }
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
            
            // Support 3+ finger actions/selections WHILE 2-finger gesture is active
            // This is ROBUST multitouch - you can gesture with 2 fingers and act with a 3rd!
            if (activePointers.size >= 3) {
              // Get the gesture primary fingers
              const gesturePair = getTwoPrimaryPointers();
              const gestureIds = gesturePair ? new Set([gesturePair[0].id, gesturePair[1].id]) : new Set();
              
              // For each additional finger (not part of the 2-finger gesture)
              for (const ps of activePointers.values()) {
                if (gestureIds.has(ps.id)) continue; // Skip gesture fingers
                if (ps.wasInGesture) continue; // Skip if was previously in gesture
                
                const dx = ps.x - ps.startX;
                const dy = ps.y - ps.startY;
                const movedSq = dx*dx + dy*dy;
                
                if (!ps.syntheticDownEmitted && movedSq >= dragStartThresholdPxSq) {
                  if (now() >= suppressSingleTapUntil) {
                    sendSyntheticPointer('pointerdown', ps.startX, ps.startY, 0, { suppressTerrainClick: true });
                    ps.syntheticDownEmitted = true;
                  }
                }
                if (ps.syntheticDownEmitted) {
                  sendSyntheticPointer('pointermove', ps.x, ps.y, 0, { suppressTerrainClick: true });
                }
              }
            }
          } else if (activePointers.size === 1) {
            if (window.buildingSystem && window.buildingSystem.isPlacing) return;
            for (const only of activePointers.values()) {
              // Skip drag selection if this finger was part of a gesture
              if (only.wasInGesture) continue;
              
              const dx = only.x - only.startX;
              const dy = only.y - only.startY;
              const movedSq = dx*dx + dy*dy;
              if (!only.syntheticDownEmitted && movedSq >= dragStartThresholdPxSq) {
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
      
      // Check if we're interacting with a UI element - if so, allow normal behavior
      if (isUIElement(e)) return;
      
      e.preventDefault();
      e.stopPropagation();
      
      invalidateTime();

      const ps = activePointers.get(e.pointerId);
      if (!ps) return;
      updatePointerState(ps, e);
      ps.isDown = false;

      // Calculate timing and movement once for reuse
      const dt = now() - ps.startTime;
      const moveSq = distanceSq(ps.startX, ps.startY, ps.x, ps.y);
      const clientX = ps.x;
      const clientY = ps.y;
      
      // Track quick pointer releases for two-finger tap detection
      recordQuickUp(clientX, clientY, dt, moveSq);

      // Detect two-finger tap/double-tap BEFORE processing other gestures
      if (recentQuickUps.length >= 2) {
        const a = recentQuickUps[recentQuickUps.length - 1];
        const b = recentQuickUps[recentQuickUps.length - 2];
        const timeDiff = Math.abs(a.t - b.t);
        if (timeDiff < config.twoFingerTapMaxTimeMs) {
          const cx = (a.x + b.x) / 2;
          const cy = (a.y + b.y) / 2;
          const timeSinceLastTwo = now() - lastTwoTapTime;
          const distTwoSq = distanceSq(cx, cy, lastTwoTapPos.x, lastTwoTapPos.y);
          if (timeSinceLastTwo < config.doubleTapDelayMs && distTwoSq < twoFingerDoubleTapCenterMaxMovePxSq) {
            // Double 2-tap: exit building placement mode if placing, otherwise clear selection
            if (window.buildingSystem && window.buildingSystem.isPlacing) {
              window.buildingSystem.cancelPlacement();
            } else if (window.player && window.player.clearSelection) {
              window.player.clearSelection();
            }
            skipNextSingleTap = true;
            suppressSingleTapUntil = now() + (config.suppressSingleTapAfterTwoFingerMs || 300);
            lastTwoTapTime = 0;
            lastTwoTapPos = { x: 0, y: 0 };
            recentQuickUps.length = 0;
            
            // Clean up pointers and return
            activePointers.delete(e.pointerId);
            const idx = pointerOrder.indexOf(e.pointerId);
            if (idx !== -1) pointerOrder.splice(idx, 1);
            endGestureIfNeeded();
            return;
          } else {
            // Single 2-tap: record center and suppress single-tap briefly
            lastTwoTapTime = now();
            lastTwoTapPos = { x: cx, y: cy };
            suppressSingleTapUntil = now() + Math.max(150, config.twoFingerTapMaxTimeMs || 300);
            skipNextSingleTap = true;
            recentQuickUps.length = 0;
          }
        }
      }

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
        
        // If this finger was part of a gesture, don't treat it as a tap/click
        if (ps.wasInGesture) {
          return;
        }
        
        if (skipNextSingleTap || now() < suppressSingleTapUntil) {
          // Consume the skip and avoid triggering any single-tap actions
          skipNextSingleTap = false;
          return;
        }
        if (dt <= config.tapMaxTimeMs && moveSq <= tapMaxMovePxSq) {
          // If building placement mode, tap places the building
          if (window.buildingSystem && window.buildingSystem.isPlacing) {
            // Require that the preview actually moved or the touch held long enough before allowing a tap place
            const heldLongEnough = (now() - ps.startTime) >= config.buildPlaceMinHoldMs;
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
            const currentTime = now();
            
            // Check if we're in cooldown period after a recent double-tap
            if (currentTime < doubleTapCooldownUntil) {
              // In cooldown - treat as regular single tap
              sendSyntheticPointer('pointerdown', clientX, clientY, 0, { suppressTerrainClick: false });
              sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: false });
              return;
            }
            
            const timeSinceLast = currentTime - lastSingleTapTime;
            const distSinceLastSq = lastSingleTapPos ? distanceSq(clientX, clientY, lastSingleTapPos.x, lastSingleTapPos.y) : Infinity;
            
            if (lastSingleTapPos && timeSinceLast < config.doubleTapDelayMs && distSinceLastSq < tapMaxMovePxSq) {
              // Double tap: trigger special ability at world position
              
              // Visual feedback - green flash on success
              if (canvas && canvas.style) {
                canvas.style.outline = '5px solid rgba(0, 255, 0, 1)';
                setTimeout(() => {
                  canvas.style.outline = '';
                }, 400);
              }
              
              const worldPos = screenToWorld(clientX, clientY);
              if (worldPos && window.ui && window.ui.triggerSpecialAbilityAt) {
                window.ui.triggerSpecialAbilityAt(worldPos);
              }
              // Reset double-tap tracking and enter cooldown
              lastSingleTapTime = 0;
              lastSingleTapPos = null;
              doubleTapCooldownUntil = currentTime + 1500; // Match double-tap window to prevent triple-tap
              
              // IMPORTANT: Return here to prevent any click/selection processing
              return;
            } else {
              // Single tap: synthesize a click
              sendSyntheticPointer('pointerdown', clientX, clientY, 0, { suppressTerrainClick: false });
              sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: false });
              // Update last tap for double-tap detection
              lastSingleTapTime = currentTime;
              lastSingleTapPos = { x: clientX, y: clientY };
              
              // Show visual feedback - flash canvas border to indicate you're in double-tap window
              if (canvas && canvas.style) {
                const originalOutline = canvas.style.outline;
                canvas.style.outline = '3px solid rgba(255, 255, 0, 0.8)';
                setTimeout(() => {
                  canvas.style.outline = originalOutline;
                }, 500); // Longer flash to match the wider timing window
              }
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
        
        // If this was a gesture finger, don't treat it as a tap/action
        if (ps.wasInGesture) {
          return;
        }
        
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
        if (dt <= config.tapMaxTimeMs && moveSq <= tapMaxMovePxSq) {
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

    // Two-finger tap detection: track recent quick pointer releases
    const recentQuickUps = [];
    function recordQuickUp(x, y, dt, moveSq) {
      if (dt <= config.twoFingerTapMaxTimeMs && moveSq <= twoFingerTapMaxMovePxSq) {
        recentQuickUps.push({ t: now(), x, y });
        // Prune old entries
        const threshold = config.doubleTapDelayMs;
        const tnow = now();
        for (let i = recentQuickUps.length - 1; i >= 0; i--) {
          if (tnow - recentQuickUps[i].t > threshold) recentQuickUps.splice(i, 1);
        }
      }
    }

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
    // console.log('📱 Touch event listeners registered');

    // Start momentum application loop
    function momentumLoop() {
      applyMomentum();
      requestAnimationFrame(momentumLoop);
    }
    momentumLoop();

    touch._initialized = true;
  };

}(window.touch = window.touch || {}));


