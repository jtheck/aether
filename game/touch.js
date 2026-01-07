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
      doubleTapDelayMs: 400, // Time window between taps for double-tap (was 1500, way too long)
      doubleTapMaxDistPx: 40, // Max distance between taps for double-tap (tighter than single tap threshold)
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
      rotateDeadzone: 0.15, // Ignore rotation smaller than this (~9 degrees) - lowered for easier triggering
      gestureStabilityFrames: 2, // Require N consecutive clean frames before allowing gesture engagement
      debugGestures: false, // Set to true to see gesture engagement in console
      gestureSmoothingFactor: 0.3, // Lerp factor for smooth gesture interpolation (0=no smoothing, 1=instant)
      dragStartThresholdPx: 15,
      suppressSingleTapAfterTwoFingerMs: 300,
      initialPinchMinSpanPx: 20, // Require fingers to be spread apart to start gesture
      // Building placement UX
      buildPlaceMinHoldMs: 150, // Reduced from 200ms for snappier placement
      // NEW: Zone-based camera control (edge = rot/zoom, center = pan)
      edgeZoneWidthPx: 60, // Fixed pixel width for edge zone (consistent across screen sizes)
      zoneZoomSensitivity: 0.015, // Zoom speed in edge zones (up/down drag)
      zoneRotateSensitivity: 0.018, // Rotate speed in edge zones (left/right drag)
      zonePanSensitivity: 8.0, // Pan sensitivity for center zone drags
      cameraFingerDragThreshold: 8 // Pixels before drag starts camera/action movement
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
    // Track tap DOWN time for fast double-tap detection (finger 2 down before finger 1 up)
    let lastTapDownTime = 0;
    let lastTapDownPos = null;

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
    
    // ACTION POPUP: Shows on tap-hold or two-finger tap, shows abilities/rally options
    let actionPopupElement = null;
    let actionPopupPosition = { x: 0, y: 0 };
    let actionPopupTimeout = null;
    const ACTION_POPUP_DURATION = 4000; // Auto-dismiss after 4 seconds
    
    // Tap-hold detection for action menu
    let holdTimer = null;
    let holdPointerId = null;
    let holdPosition = { x: 0, y: 0 };
    const HOLD_DELAY_MS = 350; // How long to hold before menu appears
    const HOLD_MAX_MOVE_PX = 12; // Max movement allowed during hold
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
    const doubleTapMaxDistPxSq = config.doubleTapMaxDistPx * config.doubleTapMaxDistPx;

    function makePointerState(e) {
      // Determine if touch started in edge zone (for rot/zoom) or center (for pan/action)
      const rect = canvasRect();
      const localX = e.clientX - rect.left;
      const localY = e.clientY - rect.top;
      const edgeWidth = config.edgeZoneWidthPx;
      const startedInEdge = localX < edgeWidth || localX > (rect.width - edgeWidth) || 
                            localY < edgeWidth || localY > (rect.height - edgeWidth);
      
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
        syntheticDownEmitted: false,
        isDoubleTapStart: false, // True if this finger started as second tap of double-tap
        startedInEdge: startedInEdge, // True if touch started in edge zone (rot/zoom)
        isEdgeFinger: false, // Set to true once edge gesture starts
        isCenterFinger: false, // Set to true once center gesture (pan or action) starts
        isPanning: false, // Set to true if this finger committed to panning (sticks even if action mode activates)
        isActioning: false // Set to true if this finger committed to action/lasso
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

    // NEW: Calculate edge proximity factors (0 = center, 1 = at edge)
    function getEdgeProximity(clientX, clientY) {
      const rect = canvasRect();
      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      
      const edgeWidth = config.edgeZoneWidthPx;
      
      // Calculate proximity to each edge (0 = not in zone, 1 = at edge)
      // Using fixed pixel width for consistent feel across screen sizes
      const leftProx = Math.max(0, (edgeWidth - localX) / edgeWidth);
      const rightProx = Math.max(0, (localX - (rect.width - edgeWidth)) / edgeWidth);
      const topProx = Math.max(0, (edgeWidth - localY) / edgeWidth);
      const bottomProx = Math.max(0, (localY - (rect.height - edgeWidth)) / edgeWidth);
      
      return {
        left: leftProx,
        right: rightProx,
        top: topProx,
        bottom: bottomProx,
        // Combined factors for zoom (left/right) and rotate (top/bottom)
        zoomFactor: Math.max(leftProx, rightProx),
        rotateFactor: Math.max(topProx, bottomProx)
      };
    }

    // NEW: Single-finger camera control with zone blending
    // Returns true if camera was moved (to prevent tap detection)
    let cameraFingerActive = false;
    let cameraFingerLastX = 0;
    let cameraFingerLastY = 0;
    
    function applySingleFingerCamera(ps) {
      if (!window.gfx || !window.gfx.camera || !window.gfx.cameraTarget) return false;
      if (window.buildingSystem && window.buildingSystem.isPlacing) return false;
      
      const cam = window.gfx.camera;
      const target = window.gfx.cameraTarget.position;
      
      // Calculate delta from last position
      const dx = ps.x - ps.lastX;
      const dy = ps.y - ps.lastY;
      
      // CRITICAL: Consume the delta by updating lastX/lastY
      // This prevents the same delta from being applied multiple times
      ps.lastX = ps.x;
      ps.lastY = ps.y;
      
      // Skip if no movement
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return false;
      
      // Get edge proximity for zone blending
      const edge = getEdgeProximity(ps.x, ps.y);
      
      // Calculate world-space pan
      const rect = canvasRect();
      const pixelsToWorld = (2 * cam.radius * Math.tan((cam.fov || 0.8) / 2)) / Math.max(1, rect.height);
      
      // Get camera-aligned axes for panning
      const camPos = cam.position.clone();
      const targetPos = target.clone ? target.clone() : new BABYLON.Vector3(target.x, target.y, target.z);
      const toTarget = targetPos.subtract(camPos).normalize();
      const groundForward = new BABYLON.Vector3(toTarget.x, 0, toTarget.z);
      
      if (groundForward.lengthSquared() < 1e-6) return false;
      groundForward.normalize();
      const groundRight = new BABYLON.Vector3(-groundForward.z, 0, groundForward.x);
      
      // === PAN (reduced heavily or disabled when in edge zones for zoom/rotate) ===
      const edgeActivity = Math.max(edge.zoomFactor, edge.rotateFactor);
      const panStrength = edgeActivity > 0.1 ? 0.2 : 1.0; // Almost no pan when zooming/rotating
      const panSens = config.zonePanSensitivity * panStrength;
      const wx = (groundRight.x * dx + groundForward.x * dy) * pixelsToWorld * panSens;
      const wz = (groundRight.z * dx + groundForward.z * dy) * pixelsToWorld * panSens;
      
      if (Number.isFinite(wx) && Number.isFinite(wz)) {
        const tileSize = (window.TILE_SIZE || 4);
        const w = (window.liveField && window.liveField.width) ? window.liveField.width * tileSize : 256;
        const h = (window.liveField && window.liveField.height) ? window.liveField.height * tileSize : 256;
        const margin = 2 * tileSize;
        
        target.x = Math.max(margin, Math.min(w - margin, target.x + wx));
        target.z = Math.max(margin, Math.min(h - margin, target.z + wz));
        
        // Update terrain chunks
        if (window.liveField && typeof window.liveField.updateVisibleChunks === 'function') {
          window.liveField.updateVisibleChunks(target.x, target.z);
        }
      }
      
      // === ZOOM (when near left/right edges, Y movement = zoom) ===
      if (edge.zoomFactor > 0.1) {
        const zoomAmount = -dy * edge.zoomFactor * config.zoneZoomSensitivity * cam.radius; // Drag up = zoom in
        cam.radius = Math.max(10, Math.min(200, cam.radius + zoomAmount));
      }
      
      // === ROTATE (when near top/bottom edges, X movement = rotate) ===
      if (edge.rotateFactor > 0.1) {
        const rotateAmount = -dx * edge.rotateFactor * config.zoneRotateSensitivity; // Flipped direction
        cam.alpha += rotateAmount;
      }
      
      // Store velocity for momentum
      gestureVelocity.pan.x = wx || 0;
      gestureVelocity.pan.z = wz || 0;
      gestureVelocity.rotate = edge.rotateFactor > 0.1 ? -dx * edge.rotateFactor * config.zoneRotateSensitivity : 0;
      gestureVelocity.pinch = edge.zoomFactor > 0.1 ? -dy * edge.zoomFactor * config.zoneZoomSensitivity * cam.radius : 0;
      
      return true;
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

    // === ACTION POPUP UI ===
    // Shows on double-tap with special ability button, auto-dismisses
    function showActionPopup(clientX, clientY) {
      // Dismiss existing popup if any
      hideActionPopup();
      
      // Offset towards center of screen so it's not hidden under finger
      const rect = canvasRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const offsetRadius = 60;
      
      const dx = centerX - clientX;
      const dy = centerY - clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      let finalX = clientX;
      let finalY = clientY;
      if (dist > 1) {
        finalX = clientX + (dx / dist) * offsetRadius;
        finalY = clientY + (dy / dist) * offsetRadius;
      }
      
      actionPopupPosition = { x: finalX, y: finalY };
      
      // Create popup container
      actionPopupElement = document.createElement('div');
      actionPopupElement.id = 'touch-action-popup';
      actionPopupElement.style.cssText = `
        position: fixed;
        left: ${finalX}px;
        top: ${finalY}px;
        transform: translate(-50%, -50%);
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 8px;
        max-width: 200px;
        z-index: 10000;
        pointer-events: auto;
        animation: actionPopupAppear 0.2s ease-out;
      `;
      
      // Add animations if not exists
      if (!document.getElementById('action-popup-style')) {
        const style = document.createElement('style');
        style.id = 'action-popup-style';
        style.textContent = `
          @keyframes actionPopupAppear {
            0% { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
            100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          }
          @keyframes actionPopupFade {
            0% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
            100% { transform: translate(-50%, -50%) scale(0.8); opacity: 0; }
          }
          .action-popup-btn {
            width: 52px;
            height: 52px;
            border-radius: 50%;
            border: 3px solid rgba(255,255,255,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 22px;
            color: #fff;
            text-shadow: 0 2px 4px rgba(0,0,0,0.5);
            cursor: pointer;
            user-select: none;
            -webkit-user-select: none;
            touch-action: none;
            transition: transform 0.1s ease;
          }
          .action-popup-btn:active {
            transform: scale(0.9);
          }
        `;
        document.head.appendChild(style);
      }
      
      // Collect available actions based on selection
      const actions = [];
      const hasSelection = window.player && window.player.selectedUnits && window.player.selectedUnits.length > 0;
      
      if (hasSelection) {
        // Always add Move and Attack Move for selected units
        actions.push({
          icon: '🚶',
          label: 'Move',
          color: 'rgba(80,180,80,0.95)',
          shadow: 'rgba(80,180,80,0.6)',
          action: () => executeCommand('move', clientX, clientY)
        });
        actions.push({
          icon: '⚔️',
          label: 'Attack Move',
          color: 'rgba(220,80,80,0.95)',
          shadow: 'rgba(220,80,80,0.6)',
          action: () => executeCommand('attackMove', clientX, clientY)
        });
        
        // Collect unique abilities from selected units
        const seenAbilities = new Set();
        for (const unit of window.player.selectedUnits) {
          if (unit.abilities) {
            for (const ability of unit.abilities) {
              if (!seenAbilities.has(ability.name)) {
                seenAbilities.add(ability.name);
                actions.push({
                  icon: ability.icon || '⚡',
                  label: ability.name,
                  color: ability.color || 'rgba(150,100,255,0.95)',
                  shadow: ability.shadowColor || 'rgba(150,100,255,0.6)',
                  action: () => executeAbility(ability.name, clientX, clientY)
                });
              }
            }
          }
          // Fallback: check for special ability function
          if (!seenAbilities.has('special') && (unit.specialAbility || unit.doSpecialAction)) {
            seenAbilities.add('special');
            actions.push({
              icon: '⚡',
              label: 'Special',
              color: 'rgba(150,100,255,0.95)',
              shadow: 'rgba(150,100,255,0.6)',
              action: () => triggerSpecialAbility(clientX, clientY)
            });
          }
        }
      } else {
        // No units selected - show rally/global options
        actions.push({
          icon: '🚩',
          label: 'Rally Point',
          color: 'rgba(255,180,50,0.95)',
          shadow: 'rgba(255,180,50,0.6)',
          action: () => setRallyPoint(clientX, clientY)
        });
        actions.push({
          icon: '📍',
          label: 'Ping',
          color: 'rgba(100,180,255,0.95)',
          shadow: 'rgba(100,180,255,0.6)',
          action: () => pingLocation(clientX, clientY)
        });
      }
      
      // Create buttons for each action
      for (const act of actions) {
        const btn = document.createElement('div');
        btn.className = 'action-popup-btn';
        btn.innerHTML = act.icon;
        btn.style.background = `radial-gradient(circle, ${act.color} 0%, ${act.color.replace('0.95', '0.7')} 100%)`;
        btn.style.boxShadow = `0 4px 15px ${act.shadow}, 0 0 20px ${act.shadow.replace('0.6', '0.3')}`;
        btn.title = act.label;
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          act.action();
          hideActionPopup();
        }, { passive: false });
        actionPopupElement.appendChild(btn);
      }
      
      document.body.appendChild(actionPopupElement);
      
      // Auto-dismiss after delay
      actionPopupTimeout = setTimeout(() => {
        hideActionPopup();
      }, ACTION_POPUP_DURATION);
    }
    
    function executeCommand(command, clientX, clientY) {
      const worldPos = screenToWorld(clientX, clientY);
      if (!worldPos || !window.player || !window.player.selectedUnits) return;
      
      for (const unit of window.player.selectedUnits) {
        if (command === 'move' && unit.moveTo) {
          unit.moveTo(worldPos.x, worldPos.z);
        } else if (command === 'attackMove' && unit.attackMoveTo) {
          unit.attackMoveTo(worldPos.x, worldPos.z);
        } else if (command === 'attackMove' && unit.moveTo) {
          // Fallback: just move if no attackMove
          unit.moveTo(worldPos.x, worldPos.z);
        }
      }
    }
    
    function executeAbility(abilityName, clientX, clientY) {
      const worldPos = screenToWorld(clientX, clientY);
      if (!worldPos || !window.player || !window.player.selectedUnits) return;
      
      for (const unit of window.player.selectedUnits) {
        if (unit.abilities) {
          const ability = unit.abilities.find(a => a.name === abilityName);
          if (ability && ability.execute) {
            ability.execute(worldPos);
          }
        }
      }
    }
    
    function setRallyPoint(clientX, clientY) {
      const worldPos = screenToWorld(clientX, clientY);
      if (!worldPos) return;
      // Set rally point for player's buildings/spawn
      if (window.player && window.player.setRallyPoint) {
        window.player.setRallyPoint(worldPos.x, worldPos.z);
      }
      console.log('Rally point set at', worldPos.x, worldPos.z);
    }
    
    function pingLocation(clientX, clientY) {
      const worldPos = screenToWorld(clientX, clientY);
      if (!worldPos) return;
      // Create a visual ping at location
      if (window.ui && window.ui.showPing) {
        window.ui.showPing(worldPos.x, worldPos.z);
      }
      console.log('Ping at', worldPos.x, worldPos.z);
    }
    
    // === TAP-HOLD DETECTION ===
    function startHoldTimer(pointerId, clientX, clientY) {
      cancelHoldTimer();
      holdPointerId = pointerId;
      holdPosition = { x: clientX, y: clientY };
      holdTimer = setTimeout(() => {
        // Hold triggered - show action menu
        showActionPopup(clientX, clientY);
        holdTimer = null;
        
        // Mark the pointer so it doesn't trigger other actions
        const ps = activePointers.get(pointerId);
        if (ps) {
          ps.holdTriggered = true;
        }
      }, HOLD_DELAY_MS);
    }
    
    function cancelHoldTimer() {
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      holdPointerId = null;
    }
    
    function checkHoldMovement(clientX, clientY) {
      if (!holdPointerId) return;
      const dx = clientX - holdPosition.x;
      const dy = clientY - holdPosition.y;
      if (dx * dx + dy * dy > HOLD_MAX_MOVE_PX * HOLD_MAX_MOVE_PX) {
        cancelHoldTimer();
      }
    }
    
    function hideActionPopup() {
      if (actionPopupTimeout) {
        clearTimeout(actionPopupTimeout);
        actionPopupTimeout = null;
      }
      if (actionPopupElement) {
        actionPopupElement.style.animation = 'actionPopupFade 0.15s ease-out forwards';
        const el = actionPopupElement;
        setTimeout(() => {
          if (el.parentNode) el.remove();
        }, 150);
        actionPopupElement = null;
      }
    }
    
    function triggerSpecialAbility(clientX, clientY) {
      // Trigger selected units' special ability at the tap location
      if (window.player && window.player.selectedUnits && window.player.selectedUnits.length > 0) {
        const worldPos = screenToWorld(clientX, clientY);
        if (worldPos) {
          // Trigger special ability for each selected unit
          for (const unit of window.player.selectedUnits) {
            if (unit.specialAbility && typeof unit.specialAbility === 'function') {
              unit.specialAbility(worldPos);
            } else if (unit.doSpecialAction && typeof unit.doSpecialAction === 'function') {
              unit.doSpecialAction(worldPos);
            }
          }
        }
      }
    }
    
    // Check if a point is inside the action popup (for tap detection)
    function isInsideActionPopup(clientX, clientY) {
      if (!actionPopupElement) return false;
      const popupRadius = 40;
      const dx = clientX - actionPopupPosition.x;
      const dy = clientY - actionPopupPosition.y;
      return (dx * dx + dy * dy) <= (popupRadius * popupRadius);
    }
    
    // === EDGE ZONE CAMERA CONTROL ===
    // For touches that start in edge zone: left/right = rotate, up/down = zoom
    function applyEdgeZoneCamera(ps) {
      if (!window.gfx || !window.gfx.camera) return false;
      
      // Cancel any existing momentum when gesture starts
      momentumActive = false;
      
      const cam = window.gfx.camera;
      const dx = ps.x - ps.lastX;
      const dy = ps.y - ps.lastY;
      
      // Consume the delta
      ps.lastX = ps.x;
      ps.lastY = ps.y;
      
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return false;
      
      // Left/right = rotate (inverted)
      const rotateAmount = dx * config.zoneRotateSensitivity;
      cam.alpha += rotateAmount;
      
      // Up/down = zoom (inverted: drag up = zoom out, drag down = zoom in)
      const zoomAmount = dy * config.zoneZoomSensitivity * cam.radius;
      cam.radius = Math.max(10, Math.min(200, cam.radius + zoomAmount));
      
      // Store velocity for NEW momentum (replaces old)
      gestureVelocity = { pan: { x: 0, z: 0 }, rotate: rotateAmount, pinch: zoomAmount };
      
      return true;
    }
    
    // === CENTER ZONE CAMERA CONTROL (PAN) ===
    function applyCenterPan(ps) {
      if (!window.gfx || !window.gfx.camera || !window.gfx.cameraTarget) return false;
      if (window.buildingSystem && window.buildingSystem.isPlacing) return false;
      
      // Cancel any existing momentum when gesture starts
      momentumActive = false;
      
      const cam = window.gfx.camera;
      const target = window.gfx.cameraTarget.position;
      
      const dx = ps.x - ps.lastX;
      const dy = ps.y - ps.lastY;
      
      // Consume the delta
      ps.lastX = ps.x;
      ps.lastY = ps.y;
      
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return false;
      
      const rect = canvasRect();
      const pixelsToWorld = (2 * cam.radius * Math.tan((cam.fov || 0.8) / 2)) / Math.max(1, rect.height);
      
      // Reduce sensitivity when zoomed out (radius > 50) to prevent too-fast panning
      const zoomDamping = Math.min(1.0, 50 / cam.radius);
      
      const camPos = cam.position.clone();
      const targetPos = target.clone ? target.clone() : new BABYLON.Vector3(target.x, target.y, target.z);
      const toTarget = targetPos.subtract(camPos).normalize();
      const groundForward = new BABYLON.Vector3(toTarget.x, 0, toTarget.z);
      
      if (groundForward.lengthSquared() < 1e-6) return false;
      groundForward.normalize();
      const groundRight = new BABYLON.Vector3(-groundForward.z, 0, groundForward.x);
      
      const panSens = config.zonePanSensitivity * zoomDamping;
      const wx = (groundRight.x * dx + groundForward.x * dy) * pixelsToWorld * panSens;
      const wz = (groundRight.z * dx + groundForward.z * dy) * pixelsToWorld * panSens;
      
      if (Number.isFinite(wx) && Number.isFinite(wz)) {
        const tileSize = (window.TILE_SIZE || 4);
        const w = (window.liveField && window.liveField.width) ? window.liveField.width * tileSize : 256;
        const h = (window.liveField && window.liveField.height) ? window.liveField.height * tileSize : 256;
        const margin = 2 * tileSize;
        
        target.x = Math.max(margin, Math.min(w - margin, target.x + wx));
        target.z = Math.max(margin, Math.min(h - margin, target.z + wz));
        
        if (window.liveField && typeof window.liveField.updateVisibleChunks === 'function') {
          window.liveField.updateVisibleChunks(target.x, target.z);
        }
      }
      
      // Store velocity for NEW momentum (replaces old, cancels rot/zoom momentum)
      gestureVelocity = { pan: { x: wx || 0, z: wz || 0 }, rotate: 0, pinch: 0 };
      
      return true;
    }

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
      // Mobile browsers batch events aggressively - use LOOSER thresholds to tolerate chunkier deltas
      const maxReasonableCentroidMove = isMobileBrowser ? 150 : 100;
      const maxReasonableAngle = isMobileBrowser ? 0.4 : 0.3;
      const maxReasonableDistChange = isMobileBrowser ? 80 : 50;
      
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
      // Mobile browsers: SMALLER deadzones - batched events already have bigger deltas
      const pinchDeadzone = isMobileBrowser ? 30.0 : (config.pinchDeadzone || 50.0);
      const rotateDeadzone = isMobileBrowser ? 0.10 : (config.rotateDeadzone || 0.15); // ~6° for mobile, ~9° for desktop
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
      // Mobile: more lenient since batched events cause larger centroid jumps
      const centroidStabilityThreshold = isMobileBrowser ? 150 : (config.pinchCentroidStability || 80);
      
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
      
      // 2. ROTATE - only if exceeds deadzone (reversed direction)
      if (applyRotate && Math.abs(smoothedAngleDelta) > 0.001) {
        const rotateVel = smoothedAngleDelta * config.rotateSensitivity;
        cam.alpha += rotateVel; // Reversed: changed from -= to +=
        gestureVelocity.rotate = rotateVel; // Store velocity for momentum (reversed sign)
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
              const newX = target.x + wx;
              const newZ = target.z + wz;
              
              // Clamp to bounds before applying
              const tileSize = (window.TILE_SIZE || 4);
              const w = (window.liveField && window.liveField.width) ? window.liveField.width * tileSize : 256;
              const h = (window.liveField && window.liveField.height) ? window.liveField.height * tileSize : 256;
              const margin = 2 * tileSize;
              const minX = margin;
              const minZ = margin;
              const maxX = Math.max(minX, w - margin);
              const maxZ = Math.max(minZ, h - margin);
              
              // Only apply if within bounds, otherwise clamp and stop velocity
              let xInBounds = (newX >= minX && newX <= maxX);
              let zInBounds = (newZ >= minZ && newZ <= maxZ);
              
              if (xInBounds) {
                target.x = newX;
                gestureVelocity.pan.x = wx; // Store velocity for momentum
              } else {
                target.x = Math.max(minX, Math.min(maxX, newX));
                gestureVelocity.pan.x = 0; // Stop velocity if hitting bounds
              }
              
              if (zInBounds) {
                target.z = newZ;
                gestureVelocity.pan.z = wz; // Store velocity for momentum
              } else {
                target.z = Math.max(minZ, Math.min(maxZ, newZ));
                gestureVelocity.pan.z = 0; // Stop velocity if hitting bounds
              }
              
              // Force terrain chunk update to fix LOD when returning to bounds
              if (window.liveField && typeof window.liveField.updateVisibleChunks === 'function') {
                window.liveField.updateVisibleChunks(target.x, target.z);
              }
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
      
      // Pan momentum with bounds checking
      if (Math.abs(gestureVelocity.pan.x) > velocityThreshold || Math.abs(gestureVelocity.pan.z) > velocityThreshold) {
        const newX = target.x + gestureVelocity.pan.x;
        const newZ = target.z + gestureVelocity.pan.z;
        
        // Clamp to bounds
        const tileSize = (window.TILE_SIZE || 4);
        const w = (window.liveField && window.liveField.width) ? window.liveField.width * tileSize : 256;
        const h = (window.liveField && window.liveField.height) ? window.liveField.height * tileSize : 256;
        const margin = 2 * tileSize;
        const minX = margin;
        const minZ = margin;
        const maxX = Math.max(minX, w - margin);
        const maxZ = Math.max(minZ, h - margin);
        
        // Only apply if within bounds, otherwise clamp and stop velocity
        if (newX >= minX && newX <= maxX) {
          target.x = newX;
          gestureVelocity.pan.x *= momentumDecay;
        } else {
          target.x = Math.max(minX, Math.min(maxX, newX));
          gestureVelocity.pan.x = 0; // Stop velocity if hitting bounds
        }
        
        if (newZ >= minZ && newZ <= maxZ) {
          target.z = newZ;
          gestureVelocity.pan.z *= momentumDecay;
        } else {
          target.z = Math.max(minZ, Math.min(maxZ, newZ));
          gestureVelocity.pan.z = 0; // Stop velocity if hitting bounds
        }
        
        // Force terrain chunk update to fix LOD when returning to bounds
        if (window.liveField && typeof window.liveField.updateVisibleChunks === 'function') {
          window.liveField.updateVisibleChunks(target.x, target.z);
        }
        
        anyVelocity = true;
      }
      
      // Rotate momentum (reversed direction)
      if (Math.abs(gestureVelocity.rotate) > velocityThreshold) {
        cam.alpha += gestureVelocity.rotate; // Continue in same direction as gesture
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
      
      // Check if tapping on the action popup - let it handle its own events
      if (isInsideActionPopup(e.clientX, e.clientY)) {
        return; // Let popup buttons handle the event
      }
      
      e.preventDefault();
      e.stopPropagation();
      
      invalidateTime();

      // Track pointer
      if (!activePointers.has(e.pointerId)) {
        const ps = makePointerState(e);
        activePointers.set(e.pointerId, ps);
        pointerOrder.push(e.pointerId);
        
        // Stop any active momentum when finger goes down
        if (momentumActive) {
          momentumActive = false;
          gestureVelocity = { pan: { x: 0, z: 0 }, rotate: 0, pinch: 0 };
        }
        
        // Check if there's already a pan finger OR edge finger active
        // If so, don't create another pan from double-tap (let it be action/lasso)
        let hasPanOrEdgeFinger = false;
        for (const [id, p] of activePointers) {
          if (id !== e.pointerId && (p.isPanning || p.isEdgeFinger || p.startedInEdge)) {
            hasPanOrEdgeFinger = true;
            break;
          }
        }
        
        const currentTime = now();
        
        // Check both tap-up time (normal) AND tap-down time (fast overlapping taps)
        const timeSinceUp = currentTime - lastSingleTapTime;
        const timeSinceDown = currentTime - lastTapDownTime;
        const distFromUpSq = lastSingleTapPos ? distanceSq(e.clientX, e.clientY, lastSingleTapPos.x, lastSingleTapPos.y) : Infinity;
        const distFromDownSq = lastTapDownPos ? distanceSq(e.clientX, e.clientY, lastTapDownPos.x, lastTapDownPos.y) : Infinity;
        
        // Double-tap: check against tap-up (normal case) OR tap-down (fast overlapping case)
        // BUT don't create a pan finger if one is already active
        const isDoubleTapFromUp = lastSingleTapPos && timeSinceUp < config.doubleTapDelayMs && distFromUpSq < doubleTapMaxDistPxSq;
        const isDoubleTapFromDown = lastTapDownPos && timeSinceDown < config.doubleTapDelayMs && distFromDownSq < doubleTapMaxDistPxSq;
        
        if ((isDoubleTapFromUp || isDoubleTapFromDown) && !hasPanOrEdgeFinger) {
          // Double-tap detected - this finger will pan on drag
          ps.isDoubleTapStart = true;
          // Reset tap tracking
          lastSingleTapTime = 0;
          lastSingleTapPos = null;
          lastTapDownTime = 0;
          lastTapDownPos = null;
        } else {
          // Record this tap-down for potential fast double-tap detection
          lastTapDownTime = currentTime;
          lastTapDownPos = { x: e.clientX, y: e.clientY };
          
          // Start hold timer for tap-hold action menu (only for center touches)
          if (!ps.startedInEdge) {
            startHoldTimer(e.pointerId, e.clientX, e.clientY);
          }
        }
      }

      // OLD: beginGestureIfNeeded() - disabled for new touch scheme
      // The old two-finger gesture system is no longer used
      // beginGestureIfNeeded();

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
      
      // === NEW TOUCH CONTROL SCHEME ===
      // Edge zone: rot/zoom (left/right = rotate, up/down = zoom)
      // Center zone: depends on action mode
      //   - Camera mode (default): pan
      //   - Action mode: lasso/select/commands
      
      if (activePointers.size === 1) {
        invalidateTime();
        
        // Building placement mode uses single finger for preview positioning
        if (window.buildingSystem && window.buildingSystem.isPlacing && window.buildingSystem.previewMesh) {
          handleBuildingPlacementPreview();
          return;
        }
        
        // Get the single pointer
        const ps = activePointers.values().next().value;
        if (!ps) return;
        
        // Check movement for drag threshold
        const dx = ps.x - ps.startX;
        const dy = ps.y - ps.startY;
        const movedSq = dx * dx + dy * dy;
        const dragThresholdSq = config.cameraFingerDragThreshold * config.cameraFingerDragThreshold;
        
        // Check hold movement (cancel if moved too much)
        if (holdPointerId === ps.id) {
          checkHoldMovement(ps.x, ps.y);
        }
        
        if (movedSq >= dragThresholdSq) {
          // Cancel hold timer when drag starts
          if (holdPointerId === ps.id) {
            cancelHoldTimer();
          }
          
          // === TOUCH STARTED IN EDGE ZONE: Rot/Zoom ===
          if (ps.startedInEdge || ps.isEdgeFinger) {
            ps.isEdgeFinger = true;
            applyEdgeZoneCamera(ps);
            momentumActive = false;
          }
          // === DOUBLE-TAP START: Pan mode ===
          else if (ps.isDoubleTapStart) {
            ps.isCenterFinger = true;
            ps.isPanning = true;
            applyCenterPan(ps);
            momentumActive = false;
          }
          // === HOLD TRIGGERED: Don't start lasso, menu is showing ===
          else if (ps.holdTriggered) {
            // Do nothing - let the action menu handle it
          }
          // === DEFAULT CENTER: Action/lasso ===
          else {
            ps.isCenterFinger = true;
            ps.isActioning = true;
            
            if (!ps.syntheticDownEmitted && now() >= suppressSingleTapUntil) {
              sendSyntheticPointer('pointerdown', ps.startX, ps.startY, 0, { suppressTerrainClick: true });
              ps.syntheticDownEmitted = true;
              // Clear tap tracking when lasso starts - prevents next tap from being double-tap
              lastSingleTapTime = 0;
              lastSingleTapPos = null;
              lastTapDownTime = 0;
              lastTapDownPos = null;
            }
            
            if (ps.syntheticDownEmitted) {
              sendSyntheticPointer('pointermove', ps.x, ps.y, 0, { suppressTerrainClick: true });
            }
          }
        }
        
      } else if (activePointers.size >= 2) {
        // TWO+ FINGERS - each finger follows same rules as single finger
        invalidateTime();
        
        const movedPointerId = e.pointerId;
        const movedPs = activePointers.get(movedPointerId);
        if (!movedPs || movedPs.wasInGesture) return;
        
        const dx = movedPs.x - movedPs.startX;
        const dy = movedPs.y - movedPs.startY;
        const movedSq = dx * dx + dy * dy;
        const dragThresholdSq = config.cameraFingerDragThreshold * config.cameraFingerDragThreshold;
        
        if (movedSq >= dragThresholdSq) {
          // Edge finger: rot/zoom
          if (movedPs.startedInEdge || movedPs.isEdgeFinger) {
            movedPs.isEdgeFinger = true;
            applyEdgeZoneCamera(movedPs);
          }
          // Finger already committed to panning: keep panning
          else if (movedPs.isPanning) {
            movedPs.isCenterFinger = true;
            applyCenterPan(movedPs);
          }
          // Finger already committed to action: keep actioning
          else if (movedPs.isActioning) {
            movedPs.isCenterFinger = true;
            if (movedPs.syntheticDownEmitted) {
              sendSyntheticPointer('pointermove', movedPs.x, movedPs.y, 0, { suppressTerrainClick: true });
            }
          }
          // Double-tap start: pan mode
          else if (movedPs.isDoubleTapStart) {
            movedPs.isCenterFinger = true;
            movedPs.isPanning = true;
            applyCenterPan(movedPs);
          }
          // Hold triggered: menu is showing, don't start lasso
          else if (movedPs.holdTriggered) {
            // Do nothing
          }
          // Default center: action/lasso
          else {
            movedPs.isCenterFinger = true;
            movedPs.isActioning = true;
            
            if (!movedPs.syntheticDownEmitted && movedSq >= dragStartThresholdPxSq) {
              if (now() >= suppressSingleTapUntil) {
                sendSyntheticPointer('pointerdown', movedPs.startX, movedPs.startY, 0, { suppressTerrainClick: true });
                movedPs.syntheticDownEmitted = true;
                // Clear tap tracking when lasso starts - prevents next tap from being double-tap
                lastSingleTapTime = 0;
                lastSingleTapPos = null;
                lastTapDownTime = 0;
                lastTapDownPos = null;
              }
            }
            
            if (movedPs.syntheticDownEmitted) {
              sendSyntheticPointer('pointermove', movedPs.x, movedPs.y, 0, { suppressTerrainClick: true });
            }
          }
        }
      }
    }
    
    // Helper function for building placement preview
    function handleBuildingPlacementPreview() {
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
        
        const previewMesh = window.buildingSystem.previewMesh;
        if (previewMesh && (previewMesh.position.x !== gridXWorld || previewMesh.position.z !== gridZWorld)) {
          previewMesh.position.x = gridXWorld;
          previewMesh.position.z = gridZWorld;
          const terrainY = window.getTerrainHeightAtPosition ? window.getTerrainHeightAtPosition(gridXWorld, gridZWorld) : 0;
          previewMesh.position.y = terrainY + 0.75;
        }
        if (previewMesh) {
          previewMesh.rotation.y = window.buildingSystem.placementRotation || 0;
        }
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
      
      // Cancel hold timer if this pointer was being tracked
      if (holdPointerId === e.pointerId) {
        cancelHoldTimer();
      }

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
            // Single 2-tap: show action menu (same as tap-hold)
            lastTwoTapTime = now();
            lastTwoTapPos = { x: cx, y: cy };
            suppressSingleTapUntil = now() + Math.max(150, config.twoFingerTapMaxTimeMs || 300);
            skipNextSingleTap = true;
            recentQuickUps.length = 0;
            
            // Show action menu at the tap center
            showActionPopup(cx, cy);
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
        // No other pointers active - ALWAYS clean up any pending lasso/drag first
        if (ps.syntheticDownEmitted) {
          sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: true });
          ps.syntheticDownEmitted = false;
        }
        
        // If this was an edge finger (rot/zoom) or pan finger, activate momentum
        // BUT only if there's actual velocity (prevents drift on clean lift)
        if (ps.isEdgeFinger || ps.isPanning) {
          const minVelocity = 0.5; // Minimum velocity to activate momentum
          const hasVelocity = Math.abs(gestureVelocity.pan.x) > minVelocity || 
                              Math.abs(gestureVelocity.pan.z) > minVelocity ||
                              Math.abs(gestureVelocity.rotate) > 0.005 ||
                              Math.abs(gestureVelocity.pinch) > 0.1;
          if (hasVelocity) {
            momentumActive = true;
          }
          return;
        }
        
        // If this finger was part of a gesture, don't treat it as a tap/click
        if (ps.wasInGesture) {
          const minVelocity = 0.5;
          const hasVelocity = Math.abs(gestureVelocity.pan.x) > minVelocity || 
                              Math.abs(gestureVelocity.pan.z) > minVelocity ||
                              Math.abs(gestureVelocity.rotate) > 0.005 ||
                              Math.abs(gestureVelocity.pinch) > 0.1;
          if (hasVelocity) {
            momentumActive = true;
          }
          return;
        }
        
        // If this was a double-tap that triggered pan mode, don't treat as tap
        if (ps.isDoubleTapStart) {
          return;
        }
        
        // If hold triggered action menu, don't treat as tap
        if (ps.holdTriggered) {
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
            
            // Check if we're in cooldown period after a recent double-tap action popup
            if (currentTime < doubleTapCooldownUntil) {
              // In cooldown - don't register tap
              return;
            }
            
            // Single tap: synthesize a click and record for potential double-tap action popup
            sendSyntheticPointer('pointerdown', clientX, clientY, 0, { suppressTerrainClick: false });
            sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: false });
            // Update last tap for double-tap detection
            lastSingleTapTime = currentTime;
            lastSingleTapPos = { x: clientX, y: clientY };
          }
        } else {
          // End of drag if one was started
          if (ps.syntheticDownEmitted) {
            sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: true });
            ps.syntheticDownEmitted = false;
          }
        }
      } else if (activePointers.size >= 1) {
        // Pointer up while other fingers remain
        
        // If this was an edge finger or pan finger, activate momentum (if velocity)
        if (ps.isEdgeFinger || ps.isPanning) {
          const minVelocity = 0.5;
          const hasVelocity = Math.abs(gestureVelocity.pan.x) > minVelocity || 
                              Math.abs(gestureVelocity.pan.z) > minVelocity ||
                              Math.abs(gestureVelocity.rotate) > 0.005 ||
                              Math.abs(gestureVelocity.pinch) > 0.1;
          if (hasVelocity) {
            momentumActive = true;
          }
          return;
        }
        
        // If this was a gesture finger, don't treat it as a tap/action
        if (ps.wasInGesture) {
          return;
        }
        
        // Close any lasso/drag that was started by this finger
        if (ps.syntheticDownEmitted) {
          sendSyntheticPointer('pointerup', clientX, clientY, 0, { suppressTerrainClick: true });
          ps.syntheticDownEmitted = false;
          return; // Was dragging, not a tap
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
          
          // Track this tap for double-tap detection (even while other fingers are down)
          // This allows double-tap to enter action mode while panning
          if (!ps.startedInEdge) {
            lastSingleTapTime = now();
            lastSingleTapPos = { x: clientX, y: clientY };
          }
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
      
      const ps = activePointers.get(e.pointerId);
      
      // Clean up any pending lasso/drag for this pointer
      if (ps && ps.syntheticDownEmitted) {
        sendSyntheticPointer('pointerup', ps.x, ps.y, 0, { suppressTerrainClick: true });
        ps.syntheticDownEmitted = false;
      }
      
      if (activePointers.has(e.pointerId)) {
        activePointers.delete(e.pointerId);
        const idx = pointerOrder.indexOf(e.pointerId);
        if (idx !== -1) pointerOrder.splice(idx, 1);
      }
      endGestureIfNeeded();
      
      // Activate momentum if all fingers gone (and has velocity)
      if (activePointers.size === 0) {
        const minVelocity = 0.5;
        const hasVelocity = Math.abs(gestureVelocity.pan.x) > minVelocity || 
                            Math.abs(gestureVelocity.pan.z) > minVelocity ||
                            Math.abs(gestureVelocity.rotate) > 0.005 ||
                            Math.abs(gestureVelocity.pinch) > 0.1;
        if (hasVelocity) {
          momentumActive = true;
        }
      }
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


