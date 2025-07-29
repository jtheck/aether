/**
 * FTXX Pointer Library v1.2.0
 * Touch + pointer library for unified input handling
 * 
 * USAGE: ftxxPointer.on(element, events, callback)
 * EVENTS: pointerdown, pointerup, pointermove, pointerenter, pointerleave, tap, longpress, pinch, pan, rotate
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
        abs: Math.abs, min: Math.min, max: Math.max, round: Math.round
    };

    // Thresholds for gesture detection and tap validation
    const THRESHOLDS = {
        TAP_MOVEMENT: 100, PAN_MOVEMENT: 10000, ROTATION_MAX: 0.5, SCALE_MIN: 0.5, SCALE_MAX: 2.0, GESTURE_FRAMES: 3
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
            gestureThresholds: { pan: 0.5, rotation: 0.002, zoom: 0.5 },
            tap: { threshold: 10, timeout: 300 },
            longpress: { timeout: 500 },
            debug: false // Added debug mode
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
            gestureStartCallback: null // Callback for gesture start validation
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
                    pointerData.id = touch.identifier;
                    pointerData.x = touch.clientX;
                    pointerData.y = touch.clientY;
                    pointerData.pressure = touch.force || 1;
                    pointerData.type = 'touch';
                    pointerData.button = 'touch';
                    pointerData.inputType = 'touch'; // Explicit input type
                    pointers.push(pointerData);
                    
                    // Track touch start for tap and longpress detection
                    if (e.type === 'touchstart') {
                        this._state.pointers[touch.identifier] = pointerData;
                        if (e.touches.length === 1) {
                            this._state.tapStart = { x: touch.clientX, y: touch.clientY, time: Date.now(), id: touch.identifier };
                            this._startLongpressTimer(touch.identifier, e.target);
                        }
                    } else if (e.type === 'touchend') {
                        // Handle touch end and check for tap
                        const storedPointer = this._state.pointers[touch.identifier];
                        if (storedPointer) pointers.push(storedPointer);
                        delete this._state.pointers[touch.identifier];
                        this._clearLongpressTimer(touch.identifier);
                        
                        if (this._state.tapStart && this._state.tapStart.id === touch.identifier) {
                            const endX = touch.clientX !== undefined ? touch.clientX : this._state.tapStart.x;
                            const endY = touch.clientY !== undefined ? touch.clientY : this._state.tapStart.y;
                            this._checkForTap(endX, endY, e.target);
                        }
                        
                        // Clear gesture states when all touches end
                        if (Object.keys(this._state.pointers).length === 0) {
                            this._state.tapStart = null;
                            this._state.gestureGroups.clear();
                            this._state.gestureTargets && this._state.gestureTargets.clear();
                            this._state.nextGestureGroupId = 1;
                        }
                    } else if (e.type === 'touchmove') {
                        // Update pointer position and check for tap cancellation
                        this._state.pointers[touch.identifier] = pointerData;
                        
                        if (this._state.tapStart && this._state.tapStart.id === touch.identifier) {
                            const distanceSquared = MathUtils.distanceSquared(touch.clientX, touch.clientY, this._state.tapStart.x, this._state.tapStart.y);
                            if (distanceSquared > THRESHOLDS.TAP_MOVEMENT) {
                                this._state.tapStart = null;
                                this._clearLongpressTimer(touch.identifier);
                            }
                        }
                    }
                }
                
                // Detect multi-touch gestures only on initial touch (touchstart) or if already tracking
                if (pointers.length >= 2) {
                    if (e.type === 'touchstart') {
                        // Only validate on initial touch
                        this._detectGestures(e, pointers, e.target);
                    } else if (e.type === 'touchmove' && this._state.gestureGroups.size > 0) {
                        // Continue tracking existing gestures
                        this._detectGestures(e, pointers, e.target);
                    }
                }
                
                // Clean up ended touches
                if (e.type === 'touchend') {
                    const activeTouchIds = new Set(Array.from(e.touches).map(t => t.identifier));
                    for (const pointerId in this._state.pointers) {
                        if (!activeTouchIds.has(parseInt(pointerId))) {
                            delete this._state.pointers[pointerId];
                            this._clearLongpressTimer(parseInt(pointerId));
                        }
                    }
                }
            } else if (isPointer) {
                // Handle pointer events (stylus, touch, mouse)
                const pointerId = e.pointerId !== undefined ? e.pointerId : 'pointer';
                
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
                pointerData.id = pointerId;
                pointerData.x = e.clientX;
                pointerData.y = e.clientY;
                pointerData.pressure = e.pressure || 1;
                pointerData.type = 'touch'; // Keep for compatibility
                pointerData.button = this._getPointerButton(e);
                pointerData.inputType = inputType; // New: explicit input type
                pointers.push(pointerData);
                
                // Track pointer down for tap and longpress detection
                if (e.type === 'pointerdown') {
                    this._state.pointers[pointerId] = pointerData;
                    if (Object.keys(this._state.pointers).length === 1) {
                        this._state.tapStart = { x: e.clientX, y: e.clientY, time: Date.now(), id: pointerId };
                        this._startLongpressTimer(pointerId, e.target);
                    }
                } else if (e.type === 'pointerup') {
                    // Handle pointer up and check for tap
                    delete this._state.pointers[pointerId];
                    this._clearLongpressTimer(pointerId);
                    
                    if (this._state.tapStart && this._state.tapStart.id === pointerId) {
                        this._checkForTap(e.clientX, e.clientY, e.target);
                    }
                    
                    if (Object.keys(this._state.pointers).length === 0) {
                        this._state.tapStart = null;
                        this._state.gestureGroups.clear();
                        this._state.gestureTargets && this._state.gestureTargets.clear();
                        this._state.nextGestureGroupId = 1;
                    }
                } else if (e.type === 'pointermove') {
                    // Update pointer position and check for tap cancellation
                    if (this._state.pointers.hasOwnProperty(pointerId)) {
                        this._state.pointers[pointerId] = pointerData;
                        
                        if (this._state.tapStart && this._state.tapStart.id === pointerId) {
                            const distanceSquared = MathUtils.distanceSquared(e.clientX, e.clientY, this._state.tapStart.x, this._state.tapStart.y);
                            if (distanceSquared > THRESHOLDS.TAP_MOVEMENT) {
                                this._state.tapStart = null;
                                this._clearLongpressTimer(pointerId);
                            }
                        }
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
                minX = Math.min(minX, pointer.x);
                maxX = Math.max(maxX, pointer.x);
                minY = Math.min(minY, pointer.y);
                maxY = Math.max(maxY, pointer.y);
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
            if (gestureState.frameCount < THRESHOLDS.GESTURE_FRAMES) {
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
            if (gestureState.frameCount === THRESHOLDS.GESTURE_FRAMES) {
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
            if (scale < THRESHOLDS.SCALE_MIN || scale > THRESHOLDS.SCALE_MAX) {
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
            if (panDistanceSquared > THRESHOLDS.PAN_MOVEMENT) {
                gestureState.lastCenterX = center.x; 
                gestureState.lastCenterY = center.y;
                gestureState.lastDistance = distance; 
                gestureState.lastAngle = angle;
                return;
            }
            
            // Check if rotation is too large
            const rotationRadians = MathUtils.abs(deltaAngle);
            if (rotationRadians > THRESHOLDS.ROTATION_MAX) {
                gestureState.lastCenterX = center.x; 
                gestureState.lastCenterY = center.y;
                gestureState.lastDistance = distance; 
                gestureState.lastAngle = angle;
                return;
            }

            // Calculate gesture magnitudes
            const distanceChange = MathUtils.abs(deltaDistance);
            const centerChange = Math.sqrt(panDistanceSquared);
            const angleChange = MathUtils.abs(deltaAngle);

            // Determine which gesture is most prominent
            const thresholds = this.config.gestureThresholds;
            const pinchRatio = distanceChange / thresholds.zoom;
            const panRatio = centerChange / thresholds.pan;
            const rotateRatio = angleChange / thresholds.rotation;
            
            let primaryGesture = null;
            let maxRatio = 0;
            
            if (pinchRatio > 1 && pinchRatio > maxRatio) {
                primaryGesture = { type: 'pinch', value: distanceChange, threshold: thresholds.zoom };
                maxRatio = pinchRatio;
            }
            
            if (panRatio > 1 && panRatio > maxRatio) {
                primaryGesture = { type: 'pan', value: centerChange, threshold: thresholds.pan };
                maxRatio = panRatio;
            }
            
            if (rotateRatio > 1 && rotateRatio > maxRatio) {
                primaryGesture = { type: 'rotate', value: angleChange, threshold: thresholds.rotation };
                maxRatio = rotateRatio;
            }
            
            // Emit the detected gesture event with group information
            if (primaryGesture) {
                const gestureData = {
                    groupId: groupId,
                    pointerIds: gestureState.pointerIds,
                    pointerCount: groupPointers.length,
                    ...this._getGestureData(primaryGesture.type, scale, center.x, center.y, deltaCenterX, deltaCenterY, deltaAngle, originalEvent)
                };
                
                if (this.config.debug) {
                    console.log(`FTXX: About to emit ${primaryGesture.type} for group ${groupId}`, gestureData);
                }
                
                this._emitGestureEvent(primaryGesture.type, targetElement, gestureData);
                
                if (this.config.debug) {
                    console.log(`FTXX: Emitted ${primaryGesture.type} for group ${groupId} with ${groupPointers.length} pointers`);
                }
            } else {
                if (this.config.debug) {
                    console.log(`FTXX: No primary gesture detected for group ${groupId}`);
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
            switch (gestureType) {
                case 'pinch':
                    return { scale: scale, centerX: centerX, centerY: centerY, originalEvent: originalEvent };
                case 'pan':
                    return { deltaX: deltaCenterX, deltaY: deltaCenterY, centerX: centerX, centerY: centerY, originalEvent: originalEvent };
                case 'rotate':
                    return { rotation: deltaAngle, centerX: centerX, centerY: centerY, originalEvent: originalEvent };
                default:
                    return { originalEvent: originalEvent };
            }
        },

        // Emit gesture events to registered listeners
        _emitGestureEvent: function(gestureType, targetElement, data) {
            // Get the targets that were stored when the gesture group was created
            const gestureTargets = this._state.gestureTargets && this._state.gestureTargets.get(data.groupId);
            
            this._state.listeners.forEach((listenerData, key) => {
                if (listenerData.event === gestureType) {
                    const gestureEvent = {
                        type: gestureType, 
                        targets: gestureTargets || [], // Include the targets from gesture validation
                        target: gestureTargets && gestureTargets[0], // Backward compatibility
                        ...data,
                        preventDefault: () => data.originalEvent.preventDefault(),
                        stopPropagation: () => data.originalEvent.stopPropagation()
                    };
                    listenerData.callback(gestureEvent);
                }
            });
        },

        // Map high-level event types to native DOM events
        _getEventMapping: function(eventType) {
            const mappings = new Map([
                ['pointerdown', ['pointerdown', 'touchstart']],
                ['pointerup', ['pointerup', 'touchend']],
                ['pointermove', ['pointermove', 'touchmove']],
                ['pointerenter', ['pointerenter']],
                ['pointerleave', ['pointerleave']],
                ['tap', []], ['longpress', ['touchstart']],
                ['pinch', []], ['pan', []], ['rotate', []]
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
            if (timeDiff <= this.config.tap.timeout && distanceSquared <= THRESHOLDS.TAP_MOVEMENT) {
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

        // Public API methods
        clearGestureState: function() {
            this._state.gestureGroups.clear();
            this._state.gestureTargets && this._state.gestureTargets.clear();
            this._state.nextGestureGroupId = 1;
            if (this.config.debug) {
                console.log('FTXX: Cleared all gesture state');
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

        getActivePointersCount: function() {
            return Object.keys(this._state.pointers).length;
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
            this._state.gestureStates.clear();
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
        }
    };

})(); 