/**
 * FTXX Pointer Library v1.3.0
 * Touch + pointer library for unified input handling
 * 
 * USAGE: ftxxPointer.on(element, events, callback)
 * EVENTS: pointerdown, pointerup, pointermove, pointerenter, pointerleave, tap, longpress, transform
 * 
 * INPUT TYPES: The library detects and provides input type information:
 * - mouse: Traditional mouse input (LMB, RMB, etc.)
 * - touch: Touch screen input (finger)
 * - stylus: Pen/stylus input (with pressure sensitivity)
 * 
 * Each event object includes:
 * - inputType: 'mouse' | 'touch' | 'stylus' | 'unknown'
 * - isMouse: boolean flag for mouse input
 * - isTouch: boolean flag for touch input  
 * - isStylus: boolean flag for stylus input
 * 
 * TRANSFORM EVENTS: The 'transform' event combines pan, pinch, and rotate into a unified event:
 * - deltaX, deltaY: Pan movement deltas
 * - deltaScale: Scale change (multiplier)
 * - deltaRotation: Rotation change (radians)
 * - centerX, centerY: Gesture center point
 */

(function() {
    'use strict';

    // Event type constants for efficient comparison
    const EVENT_TYPES = {
        TOUCH_START: 1, TOUCH_END: 2, TOUCH_MOVE: 3, TOUCH_CANCEL: 4,
        POINTER_DOWN: 10, POINTER_UP: 11, POINTER_MOVE: 12, POINTER_ENTER: 13, POINTER_LEAVE: 14,
        GESTURE_START: 18, GESTURE_CHANGE: 19, GESTURE_END: 20
    };

    // Cache for event type lookups to avoid repeated string comparisons
    const eventTypeCache = new Map();
    
    function getEventType(event) {
        const type = event.type;
        if (eventTypeCache.has(type)) return eventTypeCache.get(type);
        
        let eventType;
        switch (type) {
            case 'touchstart': eventType = EVENT_TYPES.TOUCH_START; break;
            case 'touchend': eventType = EVENT_TYPES.TOUCH_END; break;
            case 'touchmove': eventType = EVENT_TYPES.TOUCH_MOVE; break;
            case 'touchcancel': eventType = EVENT_TYPES.TOUCH_CANCEL; break;
            case 'pointerdown': eventType = EVENT_TYPES.POINTER_DOWN; break;
            case 'pointerup': eventType = EVENT_TYPES.POINTER_UP; break;
            case 'pointermove': eventType = EVENT_TYPES.POINTER_MOVE; break;
            case 'pointerenter': eventType = EVENT_TYPES.POINTER_ENTER; break;
            case 'pointerleave': eventType = EVENT_TYPES.POINTER_LEAVE; break;
            case 'gesturestart': eventType = EVENT_TYPES.GESTURE_START; break;
            case 'gesturechange': eventType = EVENT_TYPES.GESTURE_CHANGE; break;
            case 'gestureend': eventType = EVENT_TYPES.GESTURE_END; break;
            default: eventType = 0; break;
        }
        
        eventTypeCache.set(type, eventType);
        return eventType;
    }

    // Helper functions to categorize event types
    function isTouchEvent(eventType) { return eventType >= EVENT_TYPES.TOUCH_START && eventType <= EVENT_TYPES.TOUCH_CANCEL; }
    function isPointerEvent(eventType) { return eventType >= EVENT_TYPES.POINTER_DOWN && eventType <= EVENT_TYPES.POINTER_LEAVE; }

    // Object pooling for better performance and memory management
    class ObjectPool {
        constructor(createFn, resetFn, initialSize = 10) {
            this.createFn = createFn;
            this.resetFn = resetFn;
            this.pool = [];
            this.activeCount = 0;
            for (let i = 0; i < initialSize; i++) this.pool.push(createFn());
        }
        acquire() {
            if (this.pool.length > 0) { this.activeCount++; return this.pool.pop(); }
            this.activeCount++; return this.createFn();
        }
        release(obj) {
            if (obj && this.resetFn) this.resetFn(obj);
            this.pool.push(obj); this.activeCount--;
        }
    }

    // Pool for pointer data objects to reduce garbage collection
    const pointerDataPool = new ObjectPool(
        () => ({ id: 0, x: 0, y: 0, pressure: 1, type: '', button: '', inputType: 'unknown' }),
        (obj) => { obj.id = 0; obj.x = 0; obj.y = 0; obj.pressure = 1; obj.type = ''; obj.button = ''; obj.inputType = 'unknown'; },
        20
    );

    // Pool for event objects to reduce garbage collection
    const eventObjectPool = new ObjectPool(
        () => ({ type: '', pointers: [], originalEvent: null, target: null, currentTarget: null, timestamp: 0, preventDefault: () => {}, stopPropagation: () => {}, inputType: 'unknown', isMouse: false, isTouch: false, isStylus: false }),
        (obj) => { obj.type = ''; obj.pointers = []; obj.originalEvent = null; obj.target = null; obj.currentTarget = null; obj.timestamp = 0; obj.inputType = 'unknown'; obj.isMouse = false; obj.isTouch = false; obj.isStylus = false; },
        10
    );

    // Math utilities for gesture calculations
    const MathUtils = {
        distance: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
        distanceSquared: (x1, y1, x2, y2) => { const dx = x2 - x1; const dy = y2 - y1; return dx * dx + dy * dy; },
        angle: (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1),
        sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max, round: Math.round
    };

    // Pointer ID management utilities
    const PointerIdManager = {
        // Get next available pointer ID (0-9)
        getNextId: function() {
            const state = window.ftxxPointer._state;
            let id = 0;
            while (state.usedPointerIds.has(id) && id < 10) {
                id++;
            }
            if (id >= 10) {
                // All IDs in use, find the lowest available
                for (let i = 0; i < 10; i++) {
                    if (!state.usedPointerIds.has(i)) {
                        id = i;
                        break;
                    }
                }
            }
            return id;
        },

        // Allocate a pointer ID for a browser pointer
        allocateId: function(browserPointerId) {
            const state = window.ftxxPointer._state;
            const normalizedId = this.getNextId();
            state.usedPointerIds.add(normalizedId);
            state.pointerIdMap.set(browserPointerId.toString(), normalizedId);
            return normalizedId;
        },

        // Get normalized ID for a browser pointer
        getNormalizedId: function(browserPointerId) {
            const state = window.ftxxPointer._state;
            return state.pointerIdMap.get(browserPointerId.toString());
        },

        // Release a pointer ID
        releaseId: function(browserPointerId) {
            const state = window.ftxxPointer._state;
            const normalizedId = state.pointerIdMap.get(browserPointerId.toString());
            if (normalizedId !== undefined) {
                state.usedPointerIds.delete(normalizedId);
                state.pointerIdMap.delete(browserPointerId.toString());
            }
        }
    };



    let viewportScalingEnabled = true;
    let contextMenuDisabled = true;
    
    // Setup viewport scaling to prevent zoom on double-tap and other mobile behaviors
    function setupViewportScaling() {
        if (!viewportScalingEnabled) return;
        
        let viewportMeta = document.querySelector('meta[name="viewport"]');
        if (!viewportMeta) {
            viewportMeta = document.createElement('meta');
            viewportMeta.name = 'viewport';
            document.head.appendChild(viewportMeta);
        }
        
        viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover';
        
        // Add CSS to prevent text selection and tap highlights
        const style = document.createElement('style');
        style.textContent = `html,body{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;text-size-adjust:100%;touch-action:manipulation;-webkit-touch-callout:none;-webkit-user-select:none;-khtml-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none}*{-webkit-tap-highlight-color:transparent}`;
        document.head.appendChild(style);
        
        // Prevent gesture events from causing zoom
        ['gesturestart', 'gesturechange', 'gestureend'].forEach(event => {
            document.addEventListener(event, e => e.preventDefault(), { passive: false });
        });
        
        // Prevent double-tap zoom
        let lastTouchEnd = 0;
        document.addEventListener('touchend', event => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) event.preventDefault();
            lastTouchEnd = now;
        }, { passive: false });
        
        // Prevent pinch zoom
        document.addEventListener('touchmove', event => {
            if (event.scale !== 1) event.preventDefault();
        }, { passive: false });
    }
    
    // Disable context menu by default
    document.addEventListener('contextmenu', event => {
        if (contextMenuDisabled) event.preventDefault();
    }, { passive: false });
    
    // Global controls for viewport and context menu behavior
    window.ftxxContextMenuControl = {
        disable: () => { contextMenuDisabled = true; },
        enable: () => { contextMenuDisabled = false; },
        isDisabled: () => contextMenuDisabled
    };
    
    window.ftxxViewportControl = {
        enable: () => { viewportScalingEnabled = true; setupViewportScaling(); },
        disable: () => { viewportScalingEnabled = false; },
        isEnabled: () => viewportScalingEnabled
    };
    
    setupViewportScaling();

    // Main library object
    window.ftxxPointer = {
        version: '1.2.0',
        name: 'FTXX Pointer',
        
        // Configuration options
        config: {
            preventDefault: true,
            passive: false,
            disableContextMenu: true,
            preventViewportScaling: true,
            skipMouseEvents: false, // Skip mouse events to prevent interference
            gestureThresholds: { pan: 1.0, rotation: 1.0, zoom: 1.0 },
            gestureSensitivity: { pan: 1.0, rotation: 1.0, zoom: 1.0 }, // Multipliers for output deltas
            tap: { threshold: 10, timeout: 300 },
            longpress: { timeout: 500 },
            debug: false // Added debug mode
        },

        // Internal tuning constants (adjust these to tune the library behavior)
        _tuning: {
            // Base thresholds that get multiplied by config values
            baseThresholds: { pan: 0.2, rotation: 0.001, zoom: 1.2 },
            // Base sensitivity multipliers that get multiplied by config values  
            baseSensitivity: { pan: 0.8, rotation: 1.1, zoom: 0.8 },
            // Dampening factors for secondary gestures when one is dominant
            gestureDampening: { pan: 0.9, rotation: 0.8, zoom: 0.7 }, // 0.1 = 90% dampening
            // Smoothing factors (0.0 = no smoothing, 1.0 = maximum smoothing)
            smoothing: { pan: 0.8, rotation: 0.5, zoom: 0.5 },
            // Internal thresholds for gesture validation
            tapMovement: 100,      // Max movement for tap detection
            panMovement: 10000,    // Max movement before gesture rejection
            rotationMax: 0.5,      // Max rotation before gesture rejection
            scaleMin: 0.5,         // Min scale before gesture rejection
            scaleMax: 2.0,         // Max scale before gesture rejection
            gestureFrames: 3       // Frames to wait before gesture detection
        },

        // Internal state management
        _state: {
            pointers: {}, // Active pointer tracking
            listeners: new Map(), // Event listener registry
            isInitialized: false,
            gestureGroups: new Map(), // Multiple gesture groups: groupId -> gestureState
            gestureDetected: false,
            tapStart: null, // Tap detection state
            longpressTimers: new Map(), // Longpress timer management
            activeEventObjects: new Set(), // Prevent premature cleanup
            activePointerData: new Set(), // Prevent premature cleanup
            recentEvents: null, // Duplicate event filtering
            eventCleanupCounter: 0,
            nextGestureGroupId: 1, // Unique ID for each gesture group
            gestureStartCallback: null, // Callback for gesture start validation
            // Pointer ID management for 0-9 range
            nextPointerId: 0, // Next available pointer ID (0-9)
            usedPointerIds: new Set(), // Currently used pointer IDs
            pointerIdMap: new Map() // Maps browser pointer ID to normalized ID
        },

        // Initialize the library with custom options
        init: function(options = {}) {
            if (this._state.isInitialized) return this;
            this._deepMerge(this.config, options);
            this._state.isInitialized = true;
            return this;
        },

        // Register event listeners for specified events
        on: function(element, events, callback) {
            if (!this._state.isInitialized) this.init();
            if (typeof events === 'string') events = [events];
            
            events.forEach(event => {
                const listener = this._createListener(event, callback);
                const key = `${element}_${event}`;
                this._state.listeners.set(key, { element, event, callback, listener });
                this._addEventListeners(element, event, listener);
            });
            return this;
        },

        // Set callback for gesture start validation
        onGestureStart: function(callback) {
            this._state.gestureStartCallback = callback;
            return this;
        },

        // Remove event listeners
        off: function(element, events) {
            if (typeof events === 'string') events = [events];
            events.forEach(event => {
                const key = `${element}_${event}`;
                const listenerData = this._state.listeners.get(key);
                if (listenerData) {
                    this._removeEventListeners(element, event, listenerData.listener);
                    this._state.listeners.delete(key);
                }
            });
            return this;
        },

        // Create event listener with duplicate filtering and gesture detection
        _createListener: function(eventType, callback) {
            return (e) => {
                // Prevent processing touchstart events when we already have pointerdown
                // This prevents duplicate pointer tracking
                if (e.type === 'touchstart' && eventType === 'pointerdown') {
                    // Skip touchstart events for pointerdown - let pointerdown handle it
                    if (this.config.debug) {
                        console.log(`FTXX: Skipping touchstart -> pointerdown to prevent duplicate tracking`);
                    }
                    return;
                }
                
                // Prevent processing touchend events when we already have pointerup
                // This prevents duplicate pointer up events that cause ID incrementing
                if (e.type === 'touchend' && eventType === 'pointerup') {
                    // Skip touchend events for pointerup - let pointerup handle it
                    if (this.config.debug) {
                        console.log(`FTXX: Skipping touchend -> pointerup to prevent duplicate pointer up`);
                    }
                    return;
                }
                
                // Debug logging for event processing
                if (this.config.debug) {
                    console.log(`FTXX: Processing ${e.type} -> ${eventType}`, {
                        eventType: e.type,
                        targetEventType: eventType,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        button: e.button,
                        pointerId: e.pointerId
                    });
                }
                

                
                // Skip tap events if gesture was detected
                if (eventType === 'tap' && this._state.gestureDetected) {
                    this._state.gestureDetected = false;
                    if (this.config.debug) console.log('FTXX: Skipping tap due to gesture detection');
                    return;
                }
                
                // Only filter duplicate pointer MOVE events, not up/down events
                const eventTypeNum = getEventType(e);
                if (isPointerEvent(eventTypeNum) && e.type === 'pointermove') {
                    const now = Date.now();
                    const key = (MathUtils.round(e.clientX) & 0xFFFF) | ((MathUtils.round(e.clientY) & 0xFFFF) << 16) | ((eventTypeNum & 0xFF) << 32);
                    
                    if (!this._state.recentEvents) this._state.recentEvents = new Map();
                    
                    const lastTime = this._state.recentEvents.get(key);
                    if (lastTime && (now - lastTime) < 16) {
                        if (this.config.debug) console.log('FTXX: Filtered duplicate pointer move event');
                        return; // Reduced from 100ms to 16ms (60fps)
                    }
                    
                    this._state.recentEvents.set(key, now);
                    
                    // Cleanup old events periodically
                    this._state.eventCleanupCounter++;
                    if (this._state.eventCleanupCounter > 100) {
                        this._state.eventCleanupCounter = 0;
                        const cutoff = now - 200;
                        const keysToDelete = [];
                        for (const [eventKey, time] of this._state.recentEvents.entries()) {
                            if (time < cutoff) keysToDelete.push(eventKey);
                        }
                        keysToDelete.forEach(key => this._state.recentEvents.delete(key));
                    }
                }
                
                // Normalize and process the event
                const pointerEvent = this._normalizeEvent(e, eventType);
                if (pointerEvent) {
                    if (this.config.debug) {
                        console.log(`FTXX: Emitting ${eventType} event`, {
                            inputType: pointerEvent.inputType,
                            pointerCount: pointerEvent.pointers.length,
                            isMouse: pointerEvent.isMouse,
                            isTouch: pointerEvent.isTouch
                        });
                    }
                    this._state.activeEventObjects.add(pointerEvent);
                    callback(pointerEvent);
                    this._state.activeEventObjects.delete(pointerEvent);
                    eventObjectPool.release(pointerEvent);
                } else {
                    if (this.config.debug) console.log('FTXX: Event normalization returned null');
                }
            };
        },

        // Normalize different event types into unified pointer events
        _normalizeEvent: function(e, eventType) {
            const eventTypeNum = getEventType(e);
            const isTouch = isTouchEvent(eventTypeNum);
            const isPointer = isPointerEvent(eventTypeNum);
            
            let pointers = [];
            
            // Handle touch events (mobile devices)
            if (isTouch && e.touches) {
                for (let i = 0; i < e.touches.length; i++) {
                    const touch = e.touches[i];
                    const pointerData = pointerDataPool.acquire();
                    
                    // Use normalized pointer ID (0-9)
                    let normalizedId;
                    if (e.type === 'touchstart') {
                        normalizedId = PointerIdManager.allocateId(touch.identifier);
                    } else {
                        normalizedId = PointerIdManager.getNormalizedId(touch.identifier);
                        // If we don't have a normalized ID for this touch, skip the event
                        if (normalizedId === undefined) {
                            if (this.config.debug) {
                                console.log(`FTXX: Skipping event for unknown touch ID: ${touch.identifier}`);
                            }
                            return;
                        }
                    }
                    
                    pointerData.id = normalizedId;
                    pointerData.x = touch.clientX;
                    pointerData.y = touch.clientY;
                    pointerData.pressure = touch.force || 1;
                    pointerData.type = 'touch';
                    pointerData.button = 'touch';
                    pointerData.inputType = 'touch'; // Explicit input type
                    pointers.push(pointerData);
                    
                    // Track touch start for tap and longpress detection
                    if (e.type === 'touchstart') {
                        this._state.pointers[normalizedId] = pointerData;
                        if (e.touches.length === 1) {
                            this._state.tapStart = { x: touch.clientX, y: touch.clientY, time: Date.now(), id: normalizedId };
                            this._startLongpressTimer(normalizedId, e.target);
                        }
                    } else if (e.type === 'touchend') {
                        // Handle touch end and check for tap
                        const storedPointer = this._state.pointers[normalizedId];
                        if (storedPointer) pointers.push(storedPointer);
                        delete this._state.pointers[normalizedId];
                        this._clearLongpressTimer(normalizedId);
                        PointerIdManager.releaseId(touch.identifier);
                        
                        if (this._state.tapStart && this._state.tapStart.id === normalizedId) {
                            const endX = touch.clientX !== undefined ? touch.clientX : this._state.tapStart.x;
                            const endY = touch.clientY !== undefined ? touch.clientY : this._state.tapStart.y;
                            this._checkForTap(endX, endY, e.target);
                        }
                        
                        // Clear gesture states when all touches end
                        if (Object.keys(this._state.pointers).length === 0) {
                            this._state.tapStart = null;
                            this._state.gestureGroups.clear();
                            this._state.gestureTargets && this._state.gestureTargets.clear();
                            this._state.unifiedTransforms && this._state.unifiedTransforms.clear();
                            this._state.nextGestureGroupId = 1;
                        }
                        
                        // Clean up gesture groups that no longer have enough pointers
                        // Do this after processing all touches in the event
                        if (i === e.touches.length - 1) {
                            this._cleanupInvalidGestureGroups();
                        }
                    } else if (e.type === 'touchmove') {
                        // Update pointer position and check for tap cancellation
                        this._state.pointers[normalizedId] = pointerData;
                        
                        if (this._state.tapStart && this._state.tapStart.id === normalizedId) {
                            const distanceSquared = MathUtils.distanceSquared(touch.clientX, touch.clientY, this._state.tapStart.x, this._state.tapStart.y);
                            if (distanceSquared > this._tuning.tapMovement) {
                                this._state.tapStart = null;
                                this._clearLongpressTimer(normalizedId);
                            }
                        }
                    }
                }
                
                // Detect multi-touch gestures based on total active pointers
                const activePointerCount = Object.keys(this._state.pointers).length;
                if (activePointerCount >= 2) {
                    // Create pointers array from active pointers
                    const activePointers = [];
                    for (const pointerId in this._state.pointers) {
                        activePointers.push(this._state.pointers[pointerId]);
                    }
                    if (e.type === 'touchstart') {
                        // Only validate on initial touch
                        this._detectGestures(e, activePointers, e.target);
                    } else if (e.type === 'touchmove' && this._state.gestureGroups.size > 0) {
                        // Continue tracking existing gestures
                        this._detectGestures(e, activePointers, e.target);
                    }
                }
                

            } else if (isPointer) {
                // Handle pointer events (stylus, touch, mouse)
                const browserPointerId = e.pointerId !== undefined ? e.pointerId.toString() : 'pointer';
                
                // Use normalized pointer ID (0-9)
                let normalizedId;
                if (e.type === 'pointerdown') {
                    normalizedId = PointerIdManager.allocateId(browserPointerId);
                } else {
                    normalizedId = PointerIdManager.getNormalizedId(browserPointerId);
                    // If we don't have a normalized ID for this browser pointer, skip the event
                    if (normalizedId === undefined) {
                        if (this.config.debug) {
                            console.log(`FTXX: Skipping event for unknown browser pointer ID: ${browserPointerId}`);
                        }
                        return;
                    }
                }
                
                // Determine input type from pointer event
                let inputType = 'unknown';
                if (e.pointerType) {
                    switch (e.pointerType) {
                        case 'mouse': inputType = 'mouse'; break;
                        case 'pen': inputType = 'stylus'; break;
                        case 'touch': inputType = 'touch'; break;
                        default: inputType = 'unknown'; break;
                    }
                } else {
                    // Fallback detection based on button and pressure
                    if (e.button !== undefined && e.button >= 0 && e.button <= 4) {
                        inputType = 'mouse';
                    } else if (e.pressure !== undefined && e.pressure > 0) {
                        inputType = 'stylus';
                    } else {
                        inputType = 'touch';
                    }
                }
                
                const pointerData = pointerDataPool.acquire();
                pointerData.id = normalizedId;
                pointerData.x = e.clientX;
                pointerData.y = e.clientY;
                pointerData.pressure = e.pressure || 1;
                pointerData.type = 'touch'; // Keep for compatibility
                pointerData.button = this._getPointerButton(e);
                pointerData.inputType = inputType; // New: explicit input type
                pointers.push(pointerData);
                
                // Track pointer down for tap and longpress detection
                if (e.type === 'pointerdown') {
                    this._state.pointers[normalizedId] = pointerData;
                    if (Object.keys(this._state.pointers).length === 1) {
                        this._state.tapStart = { x: e.clientX, y: e.clientY, time: Date.now(), id: normalizedId };
                        this._startLongpressTimer(normalizedId, e.target);
                    }
                } else if (e.type === 'pointerup') {
                    // Handle pointer up and check for tap
                    delete this._state.pointers[normalizedId];
                    this._clearLongpressTimer(normalizedId);
                    PointerIdManager.releaseId(browserPointerId);
                    
                    if (this._state.tapStart && this._state.tapStart.id === normalizedId) {
                        this._checkForTap(e.clientX, e.clientY, e.target);
                    }
                    
                    // Clean up gesture groups that no longer have enough pointers
                    this._cleanupInvalidGestureGroups();
                    
                    if (Object.keys(this._state.pointers).length === 0) {
                        this._state.tapStart = null;
                    }
                    
                    // For pointerup, only include the pointer that was actually lifted
                    // The client should track their own active pointers
                    
                    // Debug logging to help track pointer cleanup
                    if (this.config.debug) {
                        console.log(`FTXX: Pointer ${normalizedId} lifted, remaining: [${Object.keys(this._state.pointers)}]`);
                    }
                } else if (e.type === 'pointermove') {
                    // Update pointer position and check for tap cancellation
                    if (this._state.pointers.hasOwnProperty(normalizedId)) {
                        this._state.pointers[normalizedId] = pointerData;
                        
                        if (this._state.tapStart && this._state.tapStart.id === normalizedId) {
                            const distanceSquared = MathUtils.distanceSquared(e.clientX, e.clientY, this._state.tapStart.x, this._state.tapStart.y);
                            if (distanceSquared > this._tuning.tapMovement) {
                                this._state.tapStart = null;
                                this._clearLongpressTimer(normalizedId);
                            }
                        }
                    }
                }
                
                // Detect multi-touch gestures for pointer events based on total active pointers
                const activePointerCount = Object.keys(this._state.pointers).length;
                if (activePointerCount >= 2) {
                    // Create pointers array from active pointers
                    const activePointers = [];
                    for (const pointerId in this._state.pointers) {
                        activePointers.push(this._state.pointers[pointerId]);
                    }
                    if (e.type === 'pointerdown') {
                        // Only validate on initial touch
                        this._detectGestures(e, activePointers, e.target);
                    } else if (e.type === 'pointermove' && this._state.gestureGroups.size > 0) {
                        // Continue tracking existing gestures
                        this._detectGestures(e, activePointers, e.target);
                    }
                }
            }

            // Create unified event object
            const eventObj = eventObjectPool.acquire();
            eventObj.type = eventType;
            eventObj.pointers = pointers;
            eventObj.originalEvent = e;
            eventObj.target = e.target;
            eventObj.currentTarget = e.currentTarget;
            eventObj.timestamp = Date.now();
            eventObj.preventDefault = () => e.preventDefault();
            eventObj.stopPropagation = () => e.stopPropagation();
            
            // Add input type information to the event
            if (pointers.length > 0) {
                eventObj.inputType = pointers[0].inputType;
                eventObj.isMouse = pointers[0].inputType === 'mouse';
                eventObj.isTouch = pointers[0].inputType === 'touch';
                eventObj.isStylus = pointers[0].inputType === 'stylus';
            }
            
            return eventObj;
        },

        // Add native event listeners for the specified event type
        _addEventListeners: function(element, eventType, listener) {
            const events = this._getEventMapping(eventType);
            // Skip adding listeners for derived events (they're handled internally)
            if (eventType === 'pinch' || eventType === 'pan' || eventType === 'rotate' || eventType === 'tap' || eventType === 'longpress') return;
            
            const options = { passive: this.config.passive, capture: false };
            for (let i = 0; i < events.length; i++) {
                const eventName = events[i];
                element.addEventListener(eventName, listener, options);
                
                // Debug logging if enabled
                if (this.config.debug) {
                    console.log(`FTXX: Added listener for ${eventType} -> ${eventName} on`, element);
                }
            }
        },

        // Remove native event listeners
        _removeEventListeners: function(element, eventType, listener) {
            const events = this._getEventMapping(eventType);
            // Skip removing listeners for derived events
            if (eventType === 'pinch' || eventType === 'pan' || eventType === 'rotate') return;
            
            for (let i = 0; i < events.length; i++) {
                const eventName = events[i];
                element.removeEventListener(eventName, listener, false);
                
                // Debug logging if enabled
                if (this.config.debug) {
                    console.log(`FTXX: Removed listener for ${eventType} -> ${eventName} from`, element);
                }
            }
        },

        // Detect multi-touch gestures (pinch, pan, rotate) for multiple gesture groups
        _detectGestures: function(e, pointers, targetElement) {
            if (this.config.debug) {
                console.log(`FTXX: _detectGestures called with ${pointers.length} pointers`);
            }
            
            if (pointers.length < 2) return;

            // Group pointers into gesture groups (2-3 fingers per group)
            const gestureGroups = this._groupPointersForGestures(pointers);
            
            if (this.config.debug) {
                console.log(`FTXX: Created ${gestureGroups.size} gesture groups`);
            }
            
            // Process each gesture group independently
            gestureGroups.forEach((groupPointers, groupId) => {
                if (this.config.debug) {
                    console.log(`FTXX: Processing gesture group ${groupId} with ${groupPointers.length} pointers`);
                }
                this._processGestureGroup(groupId, groupPointers, targetElement, e);
            });
        },

        // Group pointers into gesture groups (2-5 fingers per group)
        _groupPointersForGestures: function(pointers) {
            const groups = new Map();
            
            // Check if we already have active gesture groups
            if (this._state.gestureGroups.size > 0) {
                if (this.config.debug) {
                    console.log(`FTXX: Reusing ${this._state.gestureGroups.size} existing gesture groups`);
                }
                
                // Reuse existing groups by matching pointer IDs
                const activePointerIds = new Set();
                this._state.gestureGroups.forEach((gestureState, groupId) => {
                    gestureState.pointerIds.forEach(id => activePointerIds.add(id));
                });
                
                // Find pointers that belong to existing groups
                const existingGroupPointers = pointers.filter(p => activePointerIds.has(p.id));
                const newPointers = pointers.filter(p => !activePointerIds.has(p.id));
                
                if (this.config.debug) {
                    console.log(`FTXX: Found ${existingGroupPointers.length} existing pointers, ${newPointers.length} new pointers`);
                }
                
                // Reuse existing groups
                this._state.gestureGroups.forEach((gestureState, groupId) => {
                    const groupPointers = existingGroupPointers.filter(p => 
                        gestureState.pointerIds.includes(p.id)
                    );
                    if (groupPointers.length >= 2) {
                        groups.set(groupId, groupPointers);
                        if (this.config.debug) {
                            console.log(`FTXX: Reusing group ${groupId} with ${groupPointers.length} pointers`);
                        }
                    }
                });
                
                // Create new groups for remaining pointers
                if (newPointers.length >= 2) {
                    this._createNewGestureGroups(newPointers, groups);
                }
            } else {
                // No existing groups, create new ones
                this._createNewGestureGroups(pointers, groups);
            }
            
            return groups;
        },

        // Create new gesture groups with validation
        _createNewGestureGroups: function(pointers, groups) {
            if (pointers.length === 2) {
                this._validateAndCreateGroup(pointers, groups);
            } else if (pointers.length === 3) {
                this._validateAndCreateGroup(pointers, groups);
            } else if (pointers.length === 4) {
                this._validateAndCreateGroup(pointers, groups);
            } else if (pointers.length === 5) {
                this._validateAndCreateGroup(pointers, groups);
            } else if (pointers.length >= 6) {
                const remainingPointers = [...pointers];
                while (remainingPointers.length >= 2) {
                    let groupSize = 5;
                    if (remainingPointers.length < 5) {
                        groupSize = remainingPointers.length >= 4 ? 4 : 
                                   remainingPointers.length >= 3 ? 3 : 2;
                    }
                    const groupPointers = remainingPointers.splice(0, groupSize);
                    this._validateAndCreateGroup(groupPointers, groups);
                }
            }
        },

        // Validate and create a new gesture group
        _validateAndCreateGroup: function(groupPointers, groups) {
            // Check if this is an existing gesture group
            const existingGroup = this._findExistingGroupForPointers(groupPointers);
            if (existingGroup) {
                // Reuse existing group and targets (no re-validation)
                groups.set(existingGroup.groupId, groupPointers);
                return;
            }
            
            // Calculate gesture data for validation
            const center = this._calculateGroupCenter(groupPointers);
            const boundingBox = this._calculateGroupBoundingBox(groupPointers);
            
            const gestureData = {
                touches: groupPointers,
                center: center,
                boundingBox: boundingBox,
                pointerCount: groupPointers.length
            };
            
            // Check if page wants to track this as a gesture
            let shouldTrack = true;
            let targets = [];
            
            if (this._state.gestureStartCallback) {
                try {
                    const result = this._state.gestureStartCallback(gestureData);
                    shouldTrack = result && result.keep;
                    targets = result && result.targets ? result.targets : (result.target ? [result.target] : []);
                } catch (error) {
                    if (this.config.debug) {
                        console.log('FTXX: Error in gesture start callback:', error);
                    }
                    shouldTrack = false;
                }
            }
            
            if (shouldTrack) {
                const groupId = this._state.nextGestureGroupId++;
                groups.set(groupId, groupPointers);
                
                // Store targets with the group for later use
                this._state.gestureTargets = this._state.gestureTargets || new Map();
                this._state.gestureTargets.set(groupId, targets);
                
                if (this.config.debug) {
                    console.log(`FTXX: Created gesture group ${groupId} with targets:`, targets);
                }
            } else {
                if (this.config.debug) {
                    console.log('FTXX: Gesture group rejected by page');
                }
            }
        },

        // Find existing gesture group for these pointers
        _findExistingGroupForPointers: function(groupPointers) {
            const pointerIds = groupPointers.map(p => p.id);
            
            for (const [groupId, gestureState] of this._state.gestureGroups) {
                const groupPointerIds = gestureState.pointerIds;
                
                // Check if these pointers belong to this existing group
                // Only reuse if ALL pointers are the same (no new pointers added)
                if (groupPointerIds.length === pointerIds.length && 
                    groupPointerIds.every(id => pointerIds.includes(id))) {
                    return { groupId, gestureState };
                }
            }
            
            return null;
        },

        // Calculate bounding box of all touches in a group
        _calculateGroupBoundingBox: function(groupPointers) {
            if (groupPointers.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 };
            
            let minX = groupPointers[0].x, maxX = groupPointers[0].x;
            let minY = groupPointers[0].y, maxY = groupPointers[0].y;
            
            groupPointers.forEach(pointer => {
                minX = MathUtils.min(minX, pointer.x);
                maxX = MathUtils.max(maxX, pointer.x);
                minY = MathUtils.min(minY, pointer.y);
                maxY = MathUtils.max(maxY, pointer.y);
            });
            
            return {
                left: minX,
                top: minY,
                right: maxX,
                bottom: maxY
            };
        },

        // Process a single gesture group
        _processGestureGroup: function(groupId, groupPointers, targetElement, originalEvent) {
            if (this.config.debug) {
                console.log(`FTXX: _processGestureGroup called for group ${groupId} with ${groupPointers.length} pointers`);
            }
            
            let gestureState = this._state.gestureGroups.get(groupId);
            
            // Initialize gesture state for new gesture group
            if (!gestureState) {
                if (this.config.debug) {
                    console.log(`FTXX: Creating new gesture state for group ${groupId}`);
                }
                
                // Calculate center and metrics from all fingers in the group
                const center = this._calculateGroupCenter(groupPointers);
                const distance = this._calculateGroupDistance(groupPointers);
                const angle = this._calculateGroupAngle(groupPointers);

                gestureState = {
                    groupId: groupId,
                    targetElement: targetElement,
                    gesturePointer1: groupPointers[0].id, 
                    gesturePointer2: groupPointers[1].id,
                    startDistance: distance, 
                    startCenterX: center.x, 
                    startCenterY: center.y, 
                    startAngle: angle,
                    lastCenterX: center.x, 
                    lastCenterY: center.y, 
                    lastDistance: distance, 
                    lastAngle: angle,
                    isActive: false, 
                    frameCount: 0,
                    pointerIds: groupPointers.map(p => p.id),
                    allPointers: [...groupPointers], // Store all pointers for multi-finger calculations
                    isValidated: true // Mark as validated since it passed the validation check
                };
                this._state.gestureGroups.set(groupId, gestureState);
                
                if (this.config.debug) {
                    console.log(`FTXX: Created gesture group ${groupId} with ${groupPointers.length} pointers:`, groupPointers.map(p => p.id));
                }
            }

            // Update stored pointers with current positions
            gestureState.allPointers = [...groupPointers];

            // Calculate current gesture metrics from all fingers
            const center = this._calculateGroupCenter(groupPointers);
            const distance = this._calculateGroupDistance(groupPointers);
            const angle = this._calculateGroupAngle(groupPointers);

            // Skip first few frames to stabilize gesture detection
            gestureState.frameCount++;
            if (gestureState.frameCount < this._tuning.gestureFrames) {
                if (this.config.debug) {
                    console.log(`FTXX: Group ${groupId} frame ${gestureState.frameCount}, skipping for stabilization`);
                }
                gestureState.lastCenterX = center.x; 
                gestureState.lastCenterY = center.y;
                gestureState.lastDistance = distance; 
                gestureState.lastAngle = angle;
                return;
            }
            
            // Initialize last values on first valid frame
            if (gestureState.frameCount === this._tuning.gestureFrames) {
                if (this.config.debug) {
                    console.log(`FTXX: Group ${groupId} frame ${gestureState.frameCount}, initializing last values`);
                }
                gestureState.lastCenterX = center.x; 
                gestureState.lastCenterY = center.y;
                gestureState.lastDistance = distance; 
                gestureState.lastAngle = angle;
                return;
            }
            
            if (this.config.debug) {
                console.log(`FTXX: Group ${groupId} processing gesture detection on frame ${gestureState.frameCount}`);
            }
            

            
            // Calculate scale and validate within bounds
            const scale = distance / gestureState.lastDistance;
            if (scale < this._tuning.scaleMin || scale > this._tuning.scaleMax) {
                gestureState.lastCenterX = center.x; 
                gestureState.lastCenterY = center.y;
                gestureState.lastDistance = distance; 
                gestureState.lastAngle = angle;
                return;
            }

            // Calculate deltas for gesture detection
            const deltaDistance = distance - gestureState.lastDistance;
            const deltaCenterX = center.x - gestureState.lastCenterX;
            const deltaCenterY = center.y - gestureState.lastCenterY;
            const deltaAngle = angle - gestureState.lastAngle;
            
            // Check if movement is too large (likely not a gesture)
            const panDistanceSquared = deltaCenterX * deltaCenterX + deltaCenterY * deltaCenterY;
            if (panDistanceSquared > this._tuning.panMovement) {
                gestureState.lastCenterX = center.x; 
                gestureState.lastCenterY = center.y;
                gestureState.lastDistance = distance; 
                gestureState.lastAngle = angle;
                return;
            }
            
            // Check if rotation is too large
            const rotationRadians = MathUtils.abs(deltaAngle);
            if (rotationRadians > this._tuning.rotationMax) {
                gestureState.lastCenterX = center.x; 
                gestureState.lastCenterY = center.y;
                gestureState.lastDistance = distance; 
                gestureState.lastAngle = angle;
                return;
            }

            // Calculate gesture magnitudes
            const distanceChange = MathUtils.abs(deltaDistance);
            const centerChange = MathUtils.sqrt(panDistanceSquared);
            const angleChange = MathUtils.abs(deltaAngle);

            // Determine which gesture is most prominent
            const configThresholds = this.config.gestureThresholds;
            const baseThresholds = this._tuning.baseThresholds;
            const actualThresholds = {
                pan: configThresholds.pan * baseThresholds.pan,
                rotation: configThresholds.rotation * baseThresholds.rotation,
                zoom: configThresholds.zoom * baseThresholds.zoom
            };
            
            const pinchRatio = distanceChange / actualThresholds.zoom;
            const panRatio = centerChange / actualThresholds.pan;
            
            if (this.config.debug) {
                console.log(`FTXX: Gesture ratios - pinch: ${pinchRatio.toFixed(3)}, pan: ${panRatio.toFixed(3)}, distanceChange: ${distanceChange.toFixed(3)}, centerChange: ${centerChange.toFixed(3)}`);
            }
            
            let primaryGesture = null;
            let maxRatio = 0;
            
            // Get targets for this gesture group
            const targets = this._state.gestureTargets ? this._state.gestureTargets.get(groupId) : [];
            
            // Determine which gesture types are enabled for each target
            const enabledGestureTypes = this._getEnabledGestureTypes(targets);
            
            // Emit all gestures that exceed their thresholds
            const gesturesToEmit = [];
            
            if (pinchRatio > 1 && enabledGestureTypes.includes('pinch')) {
                gesturesToEmit.push({ type: 'pinch', value: distanceChange, threshold: actualThresholds.zoom });
            }
            
            if (panRatio > 1 && enabledGestureTypes.includes('pan')) {
                gesturesToEmit.push({ type: 'pan', value: centerChange, threshold: actualThresholds.pan });
            }
            
            // For rotation, compare raw angle change to threshold
            if (this.config.debug) {
                console.log(`FTXX: Angle change: ${angleChange}, threshold: ${actualThresholds.rotation}`);
            }
            if (angleChange > actualThresholds.rotation && enabledGestureTypes.includes('rotate')) {
                gesturesToEmit.push({ type: 'rotate', value: angleChange, threshold: actualThresholds.rotation });
            }
            
            // Apply dampening to gestures if multiple are detected
            const dampenedGestures = this._applyDampening(gesturesToEmit, enabledGestureTypes);
            
            // Emit all detected gestures
            dampenedGestures.forEach(gesture => {
                // Apply dampening to the gesture values
                const dampenedDeltaX = gesture.type === 'pan' ? deltaCenterX * (gesture.value / centerChange) : deltaCenterX;
                const dampenedDeltaY = gesture.type === 'pan' ? deltaCenterY * (gesture.value / centerChange) : deltaCenterY;
                const dampenedDeltaScale = gesture.type === 'pinch' ? (gesture.value / distanceChange) : 1;
                const dampenedDeltaRotation = gesture.type === 'rotate' ? deltaAngle * (gesture.value / angleChange) : deltaAngle;
                
                const gestureData = {
                    groupId: groupId,
                    pointerIds: gestureState.pointerIds,
                    pointerCount: groupPointers.length,
                    type: gesture.type,
                    frameCount: gestureState.frameCount,
                    ...this._getGestureData(gesture.type, scale, center.x, center.y, dampenedDeltaX, dampenedDeltaY, dampenedDeltaRotation, originalEvent)
                };
                
                if (this.config.debug) {
                    console.log(`FTXX: About to emit ${gesture.type} for group ${groupId}`, gestureData);
                }
                
                this._emitGestureEvent(gesture.type, targetElement, gestureData);
                
                if (this.config.debug) {
                    console.log(`FTXX: Emitted ${gesture.type} for group ${groupId} with ${groupPointers.length} pointers`);
                }
            });
            
            if (gesturesToEmit.length === 0) {
                if (this.config.debug) {
                    console.log(`FTXX: No gestures detected for group ${groupId}`);
                }
            }

            // Update last values for next frame
            gestureState.lastCenterX = center.x; 
            gestureState.lastCenterY = center.y;
            gestureState.lastDistance = distance; 
            gestureState.lastAngle = angle;
            gestureState.isActive = true;
        },

        // Calculate center point from all fingers in a gesture group
        _calculateGroupCenter: function(groupPointers) {
            let totalX = 0, totalY = 0;
            groupPointers.forEach(pointer => {
                totalX += pointer.x;
                totalY += pointer.y;
            });
            return {
                x: totalX / groupPointers.length,
                y: totalY / groupPointers.length
            };
        },

        // Calculate average distance between all finger pairs in a gesture group
        _calculateGroupDistance: function(groupPointers) {
            if (groupPointers.length < 2) return 0;
            
            let totalDistance = 0;
            let pairCount = 0;
            
            // Calculate distance between all pairs of fingers
            for (let i = 0; i < groupPointers.length; i++) {
                for (let j = i + 1; j < groupPointers.length; j++) {
                    totalDistance += MathUtils.distance(
                        groupPointers[i].x, groupPointers[i].y,
                        groupPointers[j].x, groupPointers[j].y
                    );
                    pairCount++;
                }
            }
            
            return totalDistance / pairCount;
        },

        // Calculate average angle from all finger pairs in a gesture group
        _calculateGroupAngle: function(groupPointers) {
            if (groupPointers.length < 2) return 0;
            
            let totalAngle = 0;
            let pairCount = 0;
            
            // Calculate angle between all pairs of fingers
            for (let i = 0; i < groupPointers.length; i++) {
                for (let j = i + 1; j < groupPointers.length; j++) {
                    totalAngle += MathUtils.angle(
                        groupPointers[i].x, groupPointers[i].y,
                        groupPointers[j].x, groupPointers[j].y
                    );
                    pairCount++;
                }
            }
            
            return totalAngle / pairCount;
        },

        // Get gesture-specific data for event emission
        _getGestureData: function(gestureType, scale, centerX, centerY, deltaCenterX, deltaCenterY, deltaAngle, originalEvent) {
            const configThresholds = this.config.gestureThresholds;
            const configSensitivity = this.config.gestureSensitivity;
            const baseThresholds = this._tuning.baseThresholds;
            const baseSensitivity = this._tuning.baseSensitivity;
            
            // Calculate actual thresholds and sensitivity
            const actualThresholds = {
                pan: configThresholds.pan * baseThresholds.pan,
                rotation: configThresholds.rotation * baseThresholds.rotation,
                zoom: configThresholds.zoom * baseThresholds.zoom
            };
            const actualSensitivity = {
                pan: configSensitivity.pan * baseSensitivity.pan,
                rotation: configSensitivity.rotation * baseSensitivity.rotation,
                zoom: configSensitivity.zoom * baseSensitivity.zoom
            };
            
            switch (gestureType) {
                case 'pinch':
                    // Normalize scale: 1.0 = standard sensitivity, then apply sensitivity multiplier
                    const normalizedScale = 1.0 + (scale - 1.0) / actualThresholds.zoom;
                    const adjustedScale = 1.0 + (normalizedScale - 1.0) * actualSensitivity.zoom;
                    return { scale: adjustedScale, centerX: centerX, centerY: centerY, originalEvent: originalEvent };
                case 'pan':
                    // Normalize pan: 1.0 = standard sensitivity, then apply sensitivity multiplier
                    const normalizedDeltaX = deltaCenterX / actualThresholds.pan;
                    const normalizedDeltaY = deltaCenterY / actualThresholds.pan;
                    return { 
                        deltaX: normalizedDeltaX * actualSensitivity.pan, 
                        deltaY: normalizedDeltaY * actualSensitivity.pan, 
                        centerX: centerX, 
                        centerY: centerY, 
                        originalEvent: originalEvent 
                    };
                case 'rotate':
                    // Apply sensitivity multiplier to raw rotation (in radians)
                    const adjustedRotation = deltaAngle * actualSensitivity.rotation;
                    return { rotation: adjustedRotation, centerX: centerX, centerY: centerY, originalEvent: originalEvent };
                default:
                    return { originalEvent: originalEvent };
            }
        },

        // Emit unified transform event that combines all gesture changes
        _emitGestureEvent: function(gestureType, targetElement, data) {
            // Get the targets that were stored when the gesture group was created
            const gestureTargets = this._state.gestureTargets && this._state.gestureTargets.get(data.groupId);
            
            // Only emit unified transform event
            this._emitUnifiedTransformEvent(targetElement, data, gestureTargets);
        },
        
        // Emit unified transform event that combines all gesture changes
        _emitUnifiedTransformEvent: function(targetElement, data, gestureTargets) {
            // Get current transform state for this gesture group
            const groupId = data.groupId;
            let transformState = this._state.unifiedTransforms && this._state.unifiedTransforms.get(groupId);
            
            if (!transformState) {
                transformState = {
                    groupId: groupId,
                    deltaX: 0, deltaY: 0,
                    deltaScale: 1, deltaRotation: 0,
                    centerX: data.centerX || 0, centerY: data.centerY || 0,
                    timestamp: Date.now(),
                    frameCount: 0,
                    dominantGesture: null,
                    // Previous values for smoothing
                    prevDeltaX: 0, prevDeltaY: 0,
                    prevDeltaScale: 1, prevDeltaRotation: 0
                };
                if (!this._state.unifiedTransforms) this._state.unifiedTransforms = new Map();
                this._state.unifiedTransforms.set(groupId, transformState);
            }
            
            // Reset deltas at the start of each frame
            if (transformState.frameCount !== data.frameCount) {
                // Store previous values for smoothing
                transformState.prevDeltaX = transformState.deltaX;
                transformState.prevDeltaY = transformState.deltaY;
                transformState.prevDeltaScale = transformState.deltaScale;
                transformState.prevDeltaRotation = transformState.deltaRotation;
                
                transformState.deltaX = 0;
                transformState.deltaY = 0;
                transformState.deltaScale = 1;
                transformState.deltaRotation = 0;
                transformState.frameCount = data.frameCount;
                transformState.dominantGesture = null;
            }
            
            // Always update center point with current gesture data
            transformState.centerX = data.centerX || 0;
            transformState.centerY = data.centerY || 0;
            
            // Track dominant gesture (first one in the frame becomes dominant)
            if (!transformState.dominantGesture) {
                transformState.dominantGesture = data.type;
            }
            
            // Update transform state based on gesture type (accumulate deltas)
            switch (data.type || 'unknown') {
                case 'pan':
                    transformState.deltaX += data.deltaX || 0;
                    transformState.deltaY += data.deltaY || 0;
                    break;
                case 'pinch':
                    transformState.deltaScale *= data.scale || 1;
                    break;
                case 'rotate':
                    transformState.deltaRotation += data.rotation || 0;
                    break;
            }
            
            // Apply dampening to secondary gestures (affects sensitivity, not thresholds)
            if (transformState.dominantGesture && transformState.dominantGesture !== data.type) {
                const dampening = this._tuning.gestureDampening;
                switch (transformState.dominantGesture) {
                    case 'pan':
                        // If pan is dominant, dampen rotation and zoom
                        transformState.deltaRotation *= dampening.rotation;
                        transformState.deltaScale = 1 + (transformState.deltaScale - 1) * dampening.zoom;
                        break;
                    case 'rotate':
                        // If rotate is dominant, dampen pan and zoom
                        transformState.deltaX *= dampening.pan;
                        transformState.deltaY *= dampening.pan;
                        transformState.deltaScale = 1 + (transformState.deltaScale - 1) * dampening.zoom;
                        break;
                    case 'pinch':
                        // If pinch is dominant, dampen pan and rotation
                        transformState.deltaX *= dampening.pan;
                        transformState.deltaY *= dampening.pan;
                        transformState.deltaRotation *= dampening.rotation;
                        break;
                }
            }
            
            // Apply exponential moving average smoothing (more responsive, less laggy)
            const smoothing = this._tuning.smoothing;
            if (smoothing.pan > 0) {
                transformState.deltaX = transformState.deltaX * smoothing.pan + transformState.prevDeltaX * (1 - smoothing.pan);
                transformState.deltaY = transformState.deltaY * smoothing.pan + transformState.prevDeltaY * (1 - smoothing.pan);
            }
            if (smoothing.rotation > 0) {
                transformState.deltaRotation = transformState.deltaRotation * smoothing.rotation + transformState.prevDeltaRotation * (1 - smoothing.rotation);
            }
            if (smoothing.zoom > 0) {
                transformState.deltaScale = transformState.deltaScale * smoothing.zoom + transformState.prevDeltaScale * (1 - smoothing.zoom);
            }
            
            transformState.timestamp = Date.now();
            
            // Emit unified transform event
            this._state.listeners.forEach((listenerData, key) => {
                if (listenerData.event === 'transform') {
                    const transformEvent = {
                        type: 'transform',
                        targets: gestureTargets || [],
                        target: gestureTargets && gestureTargets[0],
                        groupId: groupId,
                        deltaX: transformState.deltaX,
                        deltaY: transformState.deltaY,
                        deltaScale: transformState.deltaScale,
                        deltaRotation: transformState.deltaRotation,
                        centerX: transformState.centerX,
                        centerY: transformState.centerY,
                        timestamp: transformState.timestamp,
                        preventDefault: () => data.originalEvent.preventDefault(),
                        stopPropagation: () => data.originalEvent.stopPropagation()
                    };
                    listenerData.callback(transformEvent);
                }
            });
        },

        // Map high-level event types to native DOM events
        _getEventMapping: function(eventType) {
            // Skip mouse events to prevent interference with camera rotation
            if (this.config.skipMouseEvents) {
                const mappings = new Map([
                    ['pointerdown', ['touchstart']],  // Only touch events, no mouse
                    ['pointerup', ['touchend']],
                    ['pointermove', ['touchmove']],
                    ['pointerenter', []],
                    ['pointerleave', []],
                    ['tap', []], ['longpress', ['touchstart']],
                    ['transform', []]
                ]);
                return mappings.get(eventType) || [];
            }
            
            const mappings = new Map([
                ['pointerdown', ['pointerdown']],  // Only listen to pointerdown, not touchstart
                ['pointerup', ['pointerup', 'touchend']],
                ['pointermove', ['pointermove', 'touchmove']],
                ['pointerenter', ['pointerenter']],
                ['pointerleave', ['pointerleave']],
                ['tap', []], ['longpress', ['touchstart']],
                ['transform', []]
            ]);
            return mappings.get(eventType) || [eventType];
        },

        // Start longpress timer for tap detection
        _startLongpressTimer: function(pointerId, targetElement) {
            this._clearLongpressTimer(pointerId);
            const timer = setTimeout(() => this._emitLongpressEvent(pointerId, targetElement), this.config.longpress.timeout);
            this._state.longpressTimers.set(pointerId, timer);
        },

        // Clear longpress timer when pointer is released or moved
        _clearLongpressTimer: function(pointerId) {
            const timer = this._state.longpressTimers.get(pointerId);
            if (timer) { clearTimeout(timer); this._state.longpressTimers.delete(pointerId); }
        },

        // Emit longpress event when timer expires
        _emitLongpressEvent: function(pointerId, targetElement) {
            const pointer = this._state.pointers[pointerId];
            if (!pointer) return;
            
            const longpressEvent = {
                type: 'longpress', pointers: [pointer], originalEvent: null,
                target: targetElement, currentTarget: targetElement,
                timestamp: Date.now(), preventDefault: () => {}, stopPropagation: () => {}
            };
            
            this._state.listeners.forEach((listenerData, key) => {
                if (listenerData.element === targetElement && listenerData.event === 'longpress') {
                    listenerData.callback(longpressEvent);
                }
            });
        },

        // Check if a tap event should be emitted based on time and distance
        _checkForTap: function(endX, endY, targetElement) {
            if (!this._state.tapStart) return;
            
            const timeDiff = Date.now() - this._state.tapStart.time;
            const distanceSquared = MathUtils.distanceSquared(endX, endY, this._state.tapStart.x, this._state.tapStart.y);
            
            // Emit tap if within time and distance thresholds
            if (timeDiff <= this.config.tap.timeout && distanceSquared <= this._tuning.tapMovement) {
                const tapEvent = {
                    type: 'tap', pointers: [{ id: this._state.tapStart.id, x: endX, y: endY, pressure: 1, type: 'touch' }],
                    originalEvent: null, target: targetElement, currentTarget: targetElement,
                    timestamp: Date.now(), preventDefault: () => {}, stopPropagation: () => {}
                };
                
                this._state.listeners.forEach((listenerData, key) => {
                    if (listenerData.element === targetElement && listenerData.event === 'tap') {
                        listenerData.callback(tapEvent);
                    }
                });
            }
            
            this._state.tapStart = null;
        },

        // Convert pointer button number to string identifier
        _getPointerButton: function(e) {
            if (e.button !== undefined) {
                switch (e.button) {
                    case 0: return 'LMB'; case 1: return 'MMB'; case 2: return 'RMB';
                    case 3: return 'X1'; case 4: return 'X2'; default: return 'BTN' + e.button;
                }
            }
            return 'LMB';
        },

        // Deep merge utility for configuration updates
        _deepMerge: function(target, source) {
            if (!source || typeof source !== 'object') return target;
            if (Array.isArray(source)) {
                target.length = 0;
                for (let i = 0; i < source.length; i++) target[i] = source[i];
                return target;
            }
            const keys = Object.keys(source);
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                const value = source[key];
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                    if (!target[key] || typeof target[key] !== 'object') target[key] = {};
                    this._deepMerge(target[key], value);
                } else {
                    target[key] = value;
                }
            }
        },

        // Clean up gesture groups that no longer have enough active pointers
        _cleanupInvalidGestureGroups: function() {
            const activePointerIds = new Set(Object.keys(this._state.pointers));
            
            // Check each gesture group to see if it still has enough pointers
            for (const [groupId, gestureState] of this._state.gestureGroups) {
                const groupPointerIds = gestureState.pointerIds;
                const activeGroupPointers = groupPointerIds.filter(id => activePointerIds.has(id.toString()));
                
                // Remove group if it has fewer than 2 active pointers
                if (activeGroupPointers.length < 2) {
                    if (this.config.debug) {
                        console.log(`FTXX: Removing gesture group ${groupId} - only ${activeGroupPointers.length} active pointers (was ${groupPointerIds.length})`);
                    }
                    this._state.gestureGroups.delete(groupId);
                    this._state.gestureTargets && this._state.gestureTargets.delete(groupId);
                    this._state.unifiedTransforms && this._state.unifiedTransforms.delete(groupId);
                } else {
                    // Update the group's pointer IDs to only include active ones
                    if (this.config.debug && activeGroupPointers.length !== groupPointerIds.length) {
                        console.log(`FTXX: Updated gesture group ${groupId} - ${activeGroupPointers.length} active pointers (was ${groupPointerIds.length})`);
                    }
                    gestureState.pointerIds = activeGroupPointers;
                }
            }
        },

        // Public API methods
        clearGestureState: function() {
            this._state.gestureGroups.clear();
            this._state.gestureTargets && this._state.gestureTargets.clear();
            this._state.nextGestureGroupId = 1;
            if (this.config.debug) {
                console.log('FTXX: Cleared all gesture state');
            }
        },

        // Clean up invalid gesture groups (public method)
        cleanupInvalidGestureGroups: function() {
            this._cleanupInvalidGestureGroups();
        },

        // Force cleanup of all pointers (for debugging)
        forceCleanupAllPointers: function() {
            this._state.pointers = {};
            this._state.tapStart = null;
            this._state.gestureGroups.clear();
            this._state.gestureTargets && this._state.gestureTargets.clear();
            this._state.unifiedTransforms && this._state.unifiedTransforms.clear();
            this._state.nextGestureGroupId = 1;
            // Clear pointer ID management
            this._state.usedPointerIds.clear();
            this._state.pointerIdMap.clear();
            if (this.config.debug) {
                console.log('FTXX: Force cleaned up all pointers and gesture state');
            }
        },

        // Get gesture targets for a specific group
        getGestureTargets: function(groupId) {
            if (this._state.gestureTargets) {
                return this._state.gestureTargets.get(groupId) || [];
            }
            return [];
        },

        // Get all active gesture group IDs
        getActiveGestureGroups: function() {
            return Array.from(this._state.gestureGroups.keys());
        },

        // Get which gesture group a specific pointer belongs to
        getGestureGroupForPointer: function(pointerId) {
            for (const [groupId, gestureState] of this._state.gestureGroups) {
                if (gestureState.pointerIds.includes(pointerId.toString())) {
                    return groupId;
                }
            }
            return null;
        },

        getActivePointersCount: function() {
            return Object.keys(this._state.pointers).length;
        },

        // Get current pointer state for debugging
        getPointerState: function() {
            return {
                pointers: Object.keys(this._state.pointers),
                pointerCount: Object.keys(this._state.pointers).length,
                gestureGroups: Array.from(this._state.gestureGroups.keys()),
                tapStart: this._state.tapStart
            };
        },

        getConfig: function() {
            return JSON.parse(JSON.stringify(this.config));
        },

        // Update configuration and apply related changes
        updateConfig: function(newConfig) {
            this._deepMerge(this.config, newConfig);
            if (newConfig.disableContextMenu !== undefined) {
                if (window.ftxxContextMenuControl) {
                    if (newConfig.disableContextMenu) window.ftxxContextMenuControl.disable();
                    else window.ftxxContextMenuControl.enable();
                }
            }
            if (newConfig.preventViewportScaling !== undefined) {
                if (window.ftxxViewportControl) {
                    if (newConfig.preventViewportScaling) window.ftxxViewportControl.enable();
                    else window.ftxxViewportControl.disable();
                }
            }
        },

        // Clean up all resources and listeners
        dispose: function() {
            // Remove all event listeners
            this._state.listeners.forEach((listenerData, key) => {
                this._removeEventListeners(listenerData.element, listenerData.event, listenerData.listener);
            });
            
            // Clear all state
            this._state.listeners.clear();
            for (const key in this._state.pointers) delete this._state.pointers[key];
            this._state.gestureGroups.clear();
            this._state.gestureTargets && this._state.gestureTargets.clear();
            this._state.unifiedTransforms && this._state.unifiedTransforms.clear();
            this._state.longpressTimers.forEach(timer => clearTimeout(timer));
            this._state.longpressTimers.clear();
            if (this._state.recentEvents) this._state.recentEvents.clear();
            this._state.eventCleanupCounter = 0;
            
            // Release all pooled objects
            this._state.activeEventObjects.forEach(obj => eventObjectPool.release(obj));
            this._state.activePointerData.forEach(obj => pointerDataPool.release(obj));
            this._state.activeEventObjects.clear();
            this._state.activePointerData.clear();
            
            this._state.isInitialized = false;
        },

        // Determine which gesture types are enabled for the given targets
        _getEnabledGestureTypes: function(targets) {
            const enabledTypes = new Set();
            
            if (!targets || !Array.isArray(targets)) {
                return ['pan', 'pinch', 'rotate']; // Default to all gestures if no targets
            }
            
            targets.forEach(target => {
                if (typeof target === 'string') {
                    if (target === 'page') {
                        // Page (BEEFY) only supports scale and rotate, no pan
                        enabledTypes.add('pinch');
                        enabledTypes.add('rotate');
                    } else if (target.startsWith('box')) {
                        // Boxes support all gesture types
                        enabledTypes.add('pan');
                        enabledTypes.add('pinch');
                        enabledTypes.add('rotate');
                    }
                }
            });
            
            const result = Array.from(enabledTypes);
            
            // If no enabled types were found, default to all gestures
            if (result.length === 0) {
                return ['pan', 'pinch', 'rotate'];
            }
            
            return result;
        },

        // Apply dampening to gesture values when multiple gestures are detected
        _applyDampening: function(gestures, enabledTypes) {
            if (gestures.length <= 1) {
                return gestures; // No dampening needed for single gesture
            }
            
            // Find the primary gesture (highest value)
            let primaryGesture = gestures[0];
            let maxValue = gestures[0].value;
            
            for (let i = 1; i < gestures.length; i++) {
                if (gestures[i].value > maxValue) {
                    maxValue = gestures[i].value;
                    primaryGesture = gestures[i];
                }
            }
            
            // Apply dampening to secondary gestures
            const dampeningFactor = 0.3; // Reduce secondary gestures by 70%
            
            return gestures.map(gesture => {
                if (gesture === primaryGesture) {
                    return gesture; // Keep primary gesture unchanged
                } else {
                    // Dampen secondary gestures
                    return {
                        ...gesture,
                        value: gesture.value * dampeningFactor
                    };
                }
            });
        }
    };

})(); 