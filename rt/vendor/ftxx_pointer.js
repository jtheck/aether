/**
 * FTXX Pointer Library
 * Multitouch + pointer library for unified input handling
 * 
 * @version 1.1.1
 * @author FTXX
 * 
 * USAGE:
 * ftxxPointer.on(element, events, callback)
 * ftxxPointer.off(element, events)
 * ftxxPointer.init(options)
 * 
 * AVAILABLE EVENTS:
 * - pointerdown, pointerup, pointermove
 * - pointerenter, pointerleave
 * - tap, longpress
 * - pinch, pan, rotate (two-finger gestures)
 * - wheel
 * 
 * EVENT DATA:
 * {
 *   type: 'pointerdown',
 *   pointers: [{ id: 0, x: 100, y: 200, pressure: 1, type: 'mouse' }],
 *   target: element,
 *   timestamp: 1234567890,
 *   preventDefault: function,
 *   stopPropagation: function
 * }
 * 
 * GESTURE EVENT DATA:
 * {
 *   type: 'pinch' | 'pan' | 'rotate',
 *   scale: 1.2,           // for pinch
 *   deltaX: 10,           // for pan
 *   deltaY: 5,            // for pan
 *   rotation: 0.5,        // for rotate (radians)
 *   centerX: 150,         // center point
 *   centerY: 200,         // center point
 *   originalEvent: event,
 *   preventDefault: function
 * }
 */

(function() {
    'use strict';

    // CRITICAL: Prevent any browser scaling that would break coordinate calculations
    (function preventViewportScaling() {
        // Set viewport meta tag to prevent scaling
        let viewportMeta = document.querySelector('meta[name="viewport"]');
        if (!viewportMeta) {
            viewportMeta = document.createElement('meta');
            viewportMeta.name = 'viewport';
            document.head.appendChild(viewportMeta);
        }
        
        // Force no scaling, no zoom, no user-scalable
        viewportMeta.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, minimum-scale=1.0, user-scalable=no, viewport-fit=cover';
        
        // Additional CSS to prevent scaling
        const style = document.createElement('style');
        style.textContent = `
            html, body {
                -webkit-text-size-adjust: 100%;
                -ms-text-size-adjust: 100%;
                text-size-adjust: 100%;
                touch-action: manipulation;
                -webkit-touch-callout: none;
                -webkit-user-select: none;
                -khtml-user-select: none;
                -moz-user-select: none;
                -ms-user-select: none;
                user-select: none;
            }
            
            * {
                -webkit-tap-highlight-color: transparent;
            }
        `;
        document.head.appendChild(style);
        
        // Prevent zoom gestures on iOS
        document.addEventListener('gesturestart', function(e) {
            e.preventDefault();
        }, { passive: false });
        
        document.addEventListener('gesturechange', function(e) {
            e.preventDefault();
        }, { passive: false });
        
        document.addEventListener('gestureend', function(e) {
            e.preventDefault();
        }, { passive: false });
        
        // Prevent double-tap zoom
        let lastTouchEnd = 0;
        document.addEventListener('touchend', function(event) {
            const now = (new Date()).getTime();
            if (now - lastTouchEnd <= 300) {
                event.preventDefault();
            }
            lastTouchEnd = now;
        }, { passive: false });
        
        // Prevent pinch zoom
        document.addEventListener('touchmove', function(event) {
            if (event.scale !== 1) {
                event.preventDefault();
            }
        }, { passive: false });
        
        // Disable context menu by default
        let contextMenuDisabled = true;
        document.addEventListener('contextmenu', function(event) {
            if (contextMenuDisabled) {
                event.preventDefault();
            }
        }, { passive: false });
        
        // Expose context menu control
        window.ftxxContextMenuControl = {
            disable: () => { contextMenuDisabled = true; },
            enable: () => { contextMenuDisabled = false; },
            isDisabled: () => contextMenuDisabled
        };
        
        console.log('🧭 FTXX: Viewport scaling prevention enabled');
    })();

    // Create the main library object
    window.ftxxPointer = {
        
        /**
         * Library information
         */
        version: '1.1.1',
        name: 'FTXX Pointer',
        
        /**
         * Default configuration
         */
        config: {
            preventDefault: true,
            passive: false,
            debug: false,
            disableContextMenu: true,  // Disable right-click context menu by default
            gestureThresholds: {
                pan: 0.5,       // Center movement threshold for pan (highest priority)
                rotation: 0.002, // Angle change threshold for rotate (radians)
                zoom: 0.5       // Distance change threshold for pinch (lowest priority)
            },
            tap: {
                threshold: 10,  // Maximum movement in pixels
                timeout: 300    // Maximum duration in milliseconds
            },
            longpress: {
                timeout: 500    // Duration to trigger longpress in milliseconds
            }
        },

        /**
         * Internal state
         */
        _state: {
            pointers: new Map(),
            listeners: new Map(),
            isInitialized: false,
            gestureStates: new Map(),
            gestureDetected: false,
            tapStart: null,
            longpressTimers: new Map()
        },

        /**
         * Initialize the library with custom options
         */
        init: function(options = {}) {
            if (this._state.isInitialized) {
                this._log('warn', 'FTXX Pointer already initialized');
                return this;
            }

            // Deep merge config
            this._deepMerge(this.config, options);
            
            this._log('info', 'FTXX Pointer Library initialized!');
            
            this._state.isInitialized = true;
            return this;
        },

        /**
         * Add pointer event listeners to an element
         */
        on: function(element, events, callback) {
            if (!this._state.isInitialized) {
                this.init();
            }

            if (typeof events === 'string') {
                events = [events];
            }

            this._log('debug', 'Registering listeners for events:', events, 'on element:', element);

            events.forEach(event => {
                const listener = this._createListener(event, callback);
                const key = `${element.id || 'anonymous'}_${event}`;
                
                this._state.listeners.set(key, {
                    element,
                    event,
                    callback,
                    listener
                });

                this._addEventListeners(element, event, listener);
            });

            return this;
        },

        /**
         * Remove pointer event listeners
         */
        off: function(element, events) {
            if (typeof events === 'string') {
                events = [events];
            }

            events.forEach(event => {
                const key = `${element.id || 'anonymous'}_${event}`;
                const listenerData = this._state.listeners.get(key);
                
                if (listenerData) {
                    this._removeEventListeners(element, event, listenerData.listener);
                    this._state.listeners.delete(key);
                }
            });

            return this;
        },

        /**
         * Create unified event listener
         */
        _createListener: function(eventType, callback) {
            return (e) => {
                this._log('debug', 'Event received:', e.type, 'for eventType:', eventType);
                
                // For tap events, check if a gesture was detected
                if (eventType === 'tap' && this._state.gestureDetected) {
                    this._state.gestureDetected = false;
                    return;
                }
                
                // CRITICAL FIX: Prevent duplicate event processing
                // If this is a mouse event and we just processed a touch event, skip it
                if (e.type.includes('mouse') || e.type.includes('pointer')) {
                    const now = Date.now();
                    const key = `recent_${Math.round(e.clientX)}_${Math.round(e.clientY)}_${e.type}`;
                    const lastProcessed = this._state.recentEvents || {};
                    

                    
                    if (lastProcessed[key] && (now - lastProcessed[key]) < 100) {
                        this._log('debug', 'Skipping duplicate event:', e.type, 'at', e.clientX, e.clientY);
                        return;
                    }
                    
                    // Mark this event as recently processed
                    if (!this._state.recentEvents) this._state.recentEvents = {};
                    this._state.recentEvents[key] = now;
                    
                    // Clean up old entries
                    Object.keys(this._state.recentEvents).forEach(k => {
                        if (now - this._state.recentEvents[k] > 200) {
                            delete this._state.recentEvents[k];
                        }
                    });
                }
                
                const pointerEvent = this._normalizeEvent(e, eventType);
                if (pointerEvent) {
                    callback(pointerEvent);
                }
                
                // Reset gesture detected flag after processing tap
                if (eventType === 'tap') {
                    this._state.gestureDetected = false;
                }
            };
        },

        /**
         * Normalize events to unified format - Treat all events as touch events
         */
        _normalizeEvent: function(e, eventType) {
            const isTouch = e.type.includes('touch');
            const isMouse = e.type.includes('mouse') || (e.type.includes('pointer') && !e.type.includes('touch'));
            const isWheel = e.type.includes('wheel') || e.type.includes('mousewheel') || e.type.includes('DOMMouseScroll');
            
            let pointers = [];
            
            if (isTouch && e.touches) {
                // Handle native touch events
                for (let i = 0; i < e.touches.length; i++) {
                    const touch = e.touches[i];
                    const pointerData = {
                        id: touch.identifier,
                        x: touch.clientX,
                        y: touch.clientY,
                        pressure: touch.force || 1,
                        type: 'touch',
                        button: 'touch'
                    };
                    pointers.push(pointerData);
                    
                    // Track active pointers
                    if (e.type === 'touchstart') {
                        this._state.pointers.set(touch.identifier, pointerData);
                        // Start tap detection for single touch
                        if (e.touches.length === 1) {
                            this._state.tapStart = {
                                x: touch.clientX,
                                y: touch.clientY,
                                time: Date.now(),
                                id: touch.identifier
                            };
                            
                            // Start longpress timer
                            this._startLongpressTimer(touch.identifier, e.target);
                        }
                    } else if (e.type === 'touchend') {
                        // CRITICAL FIX: For touchend, we need to get the pointer data from our stored state
                        // because e.touches is empty when the touch ends
                        const storedPointer = this._state.pointers.get(touch.identifier);
                        if (storedPointer) {
                            pointers.push(storedPointer);
                        }
                        
                        // Clean up pointer state
                        this._state.pointers.delete(touch.identifier);
                        this._clearLongpressTimer(touch.identifier);
                        
                        // Clear tap start if this was the tap pointer
                        if (this._state.tapStart && this._state.tapStart.id === touch.identifier) {
                            const endX = touch.clientX !== undefined ? touch.clientX : this._state.tapStart.x;
                            const endY = touch.clientY !== undefined ? touch.clientY : this._state.tapStart.y;
                            this._checkForTap(endX, endY, e.target);
                        }
                        
                        // Clear gesture state when all touches end
                        if (this._state.pointers.size === 0) {
                            this._state.gestureDetected = false;
                            // Don't clear gesture states immediately - keep them for seamless transitions
                            // They will be cleared after a timeout or when a new gesture starts
                            this._state.tapStart = null; // Clear any remaining tap state
                            
                            // Clear gesture states after a delay to allow for seamless transitions
                            setTimeout(() => {
                                this._state.gestureStates.clear();
                            }, 1000); // 1 second delay
                        }
                    } else if (e.type === 'touchmove') {
                        this._state.pointers.set(touch.identifier, pointerData);
                        
                        // Cancel tap if moved too much
                        if (this._state.tapStart && this._state.tapStart.id === touch.identifier) {
                            const distance = Math.sqrt(
                                Math.pow(touch.clientX - this._state.tapStart.x, 2) +
                                Math.pow(touch.clientY - this._state.tapStart.y, 2)
                            );
                            if (distance > this.config.tap.threshold) {
                                this._state.tapStart = null;
                                this._clearLongpressTimer(touch.identifier);
                            }
                        }
                    }
                }
                
                // Detect gestures for touch events
                if (e.type === 'touchmove' && pointers.length >= 2) {
                    this._detectGestures(e, pointers, e.target);
                }
                
                // Additional cleanup for touch end
                if (e.type === 'touchend') {
                    // Clear any orphaned pointers that aren't in the current touch list
                    const activeTouchIds = new Set(Array.from(e.touches).map(t => t.identifier));
                    for (const [pointerId, pointer] of this._state.pointers.entries()) {
                        if (!activeTouchIds.has(pointerId)) {
                            this._state.pointers.delete(pointerId);
                            this._clearLongpressTimer(pointerId);
                        }
                    }
                }
            } else if (isMouse || e.type.includes('pointer')) {
                // Handle mouse events as touch events for consistency
                const mouseButton = this._getMouseButton(e);
                
                // CRITICAL FIX: Use consistent pointer ID for mouse events
                // For mouse events, always use the button as the ID for consistency
                let pointerId = mouseButton;
                
                // Only use pointerId for non-mouse pointer events
                if (e.type.includes('pointer') && !e.type.includes('mouse') && e.pointerId !== undefined) {
                    pointerId = e.pointerId;
                }
                
                const pointerData = {
                    id: pointerId,
                    x: e.clientX,
                    y: e.clientY,
                    pressure: e.pressure || 1,
                    type: 'touch', // Treat mouse as touch for unified handling
                    button: mouseButton
                };
                pointers.push(pointerData);
                
                // Track pointer
                if (e.type === 'pointerdown' || e.type === 'mousedown') {
                    this._state.pointers.set(pointerId, pointerData);
                    
                    // Start tap detection for single mouse click
                    if (this._state.pointers.size === 1) {
                        this._state.tapStart = {
                            x: e.clientX,
                            y: e.clientY,
                            time: Date.now(),
                            id: pointerId
                        };
                        
                        // Start longpress timer for mouse
                        this._startLongpressTimer(pointerId, e.target);
                    }
                } else if (e.type === 'pointerup' || e.type === 'mouseup') {
                    this._state.pointers.delete(pointerId);
                    this._clearLongpressTimer(pointerId);
                    
                    // Check for tap completion
                    if (this._state.tapStart && this._state.tapStart.id === pointerId) {
                        this._checkForTap(e.clientX, e.clientY, e.target);
                    }
                    
                    // Clear state when all pointers are gone
                    if (this._state.pointers.size === 0) {
                        this._state.tapStart = null;
                        this._state.gestureDetected = false;
                    }
                } else if (e.type === 'pointermove' || e.type === 'mousemove') {
                    // CRITICAL FIX: Only update pointer if it's already being tracked
                    // This prevents creating new pointers during mouse movement
                    if (this._state.pointers.has(pointerId)) {
                        this._state.pointers.set(pointerId, pointerData);
                        
                        // Cancel tap if moved too much
                        if (this._state.tapStart && this._state.tapStart.id === pointerId) {
                            const distance = Math.sqrt(
                                Math.pow(e.clientX - this._state.tapStart.x, 2) +
                                Math.pow(e.clientY - this._state.tapStart.y, 2)
                            );
                            if (distance > this.config.tap.threshold) {
                                this._state.tapStart = null;
                                this._clearLongpressTimer(pointerId);
                            }
                        }
                    }
                }
            } else if (isWheel) {
                // Handle wheel events
                const wheelData = {
                    deltaX: e.deltaX || 0,
                    deltaY: e.deltaY || 0,
                    deltaZ: e.deltaZ || 0,
                    deltaMode: e.deltaMode || 0
                };
                
                return {
                    type: eventType,
                    wheel: wheelData,
                    originalEvent: e,
                    target: e.target,
                    currentTarget: e.currentTarget,
                    timestamp: Date.now(),
                    preventDefault: () => e.preventDefault(),
                    stopPropagation: () => e.stopPropagation()
                };
            }

            return {
                type: eventType,
                pointers,
                originalEvent: e,
                target: e.target,
                currentTarget: e.currentTarget,
                timestamp: Date.now(),
                preventDefault: () => e.preventDefault(),
                stopPropagation: () => e.stopPropagation()
            };
        },

        /**
         * Add appropriate event listeners
         */
        _addEventListeners: function(element, eventType, listener) {
            const events = this._getEventMapping(eventType);
            
            // For gesture events, tap events, and longpress events, we don't add DOM listeners since they're handled internally
            if (eventType === 'pinch' || eventType === 'pan' || eventType === 'rotate' || eventType === 'tap' || eventType === 'longpress') {
                return;
            }
            
            events.forEach(event => {
                element.addEventListener(event, listener, {
                    passive: this.config.passive,
                    capture: false
                });
            });
        },

        /**
         * Remove event listeners
         */
        _removeEventListeners: function(element, eventType, listener) {
            const events = this._getEventMapping(eventType);
            
            if (eventType === 'pinch' || eventType === 'pan' || eventType === 'rotate') {
                return;
            }
            
            events.forEach(event => {
                element.removeEventListener(event, listener, false);
            });
        },

        /**
         * Detect and emit gesture events
         */
        _detectGestures: function(e, pointers, targetElement) {
            // Need at least 2 pointers for gestures
            if (pointers.length < 2) {
                return;
            }

            // Get or create gesture state for this element
            let gestureState = this._state.gestureStates.get(targetElement);
            
            // If no gesture state exists, initialize with the first two pointers
            if (!gestureState) {
                const pointer1 = pointers[0];
                const pointer2 = pointers[1];
                
                const distance = Math.sqrt(
                    Math.pow(pointer2.x - pointer1.x, 2) + 
                    Math.pow(pointer2.y - pointer1.y, 2)
                );
                const centerX = (pointer1.x + pointer2.x) / 2;
                const centerY = (pointer1.y + pointer2.y) / 2;
                const angle = Math.atan2(pointer2.y - pointer1.y, pointer2.x - pointer1.x);

                gestureState = {
                    gesturePointer1: pointer1.id,
                    gesturePointer2: pointer2.id,
                    startDistance: distance,
                    startCenterX: centerX,
                    startCenterY: centerY,
                    startAngle: angle,
                    lastCenterX: centerX,
                    lastCenterY: centerY,
                    lastDistance: distance,
                    lastAngle: angle,
                    isActive: false,
                    frameCount: 0
                };
                this._state.gestureStates.set(targetElement, gestureState);
                // Don't return here - continue to process the gesture immediately
            }

            // Find the gesture pointers in the current pointer list
            let gesturePointer1 = pointers.find(p => p.id === gestureState.gesturePointer1);
            let gesturePointer2 = pointers.find(p => p.id === gestureState.gesturePointer2);
            
            // If either gesture pointer is missing, start a new gesture with the first two available pointers
            if (!gesturePointer1 || !gesturePointer2) {
                if (pointers.length >= 2) {
                    gesturePointer1 = pointers[0];
                    gesturePointer2 = pointers[1];
                    
                    // CRITICAL FIX: Completely reset gesture state for new gesture session
                    // This prevents any carryover from previous gestures that could cause jumping
                    const distance = Math.sqrt(
                        Math.pow(gesturePointer2.x - gesturePointer1.x, 2) + 
                        Math.pow(gesturePointer2.y - gesturePointer1.y, 2)
                    );
                    const centerX = (gesturePointer1.x + gesturePointer2.x) / 2;
                    const centerY = (gesturePointer1.y + gesturePointer2.y) / 2;
                    const angle = Math.atan2(gesturePointer2.y - gesturePointer1.y, gesturePointer2.x - gesturePointer1.x);
                    
                    // Reset ALL gesture state values to prevent any carryover
                    gestureState.gesturePointer1 = gesturePointer1.id;
                    gestureState.gesturePointer2 = gesturePointer2.id;
                    gestureState.startDistance = distance;
                    gestureState.startCenterX = centerX;
                    gestureState.startCenterY = centerY;
                    gestureState.startAngle = angle;
                    gestureState.lastCenterX = centerX;
                    gestureState.lastCenterY = centerY;
                    gestureState.lastDistance = distance;
                    gestureState.lastAngle = angle;
                    gestureState.frameCount = 0;
                    gestureState.isActive = false;
                } else {
                    return;
                }
            }

            // Calculate current gesture state using the tracked gesture pointers
            const distance = Math.sqrt(
                Math.pow(gesturePointer2.x - gesturePointer1.x, 2) + 
                Math.pow(gesturePointer2.y - gesturePointer1.y, 2)
            );
            const centerX = (gesturePointer1.x + gesturePointer2.x) / 2;
            const centerY = (gesturePointer1.y + gesturePointer2.y) / 2;
            const angle = Math.atan2(gesturePointer2.y - gesturePointer1.y, gesturePointer2.x - gesturePointer1.x);

            // Wait a few frames before emitting gestures to prevent jerky initial movement
            gestureState.frameCount++;
            if (gestureState.frameCount < 3) {
                gestureState.lastCenterX = centerX;
                gestureState.lastCenterY = centerY;
                gestureState.lastDistance = distance;
                gestureState.lastAngle = angle;
                return;
            }
            
            // CRITICAL FIX: If this is a new gesture session (frameCount just reached 3),
            // don't emit any events yet - wait for actual movement
            if (gestureState.frameCount === 3) {
                // Just update the last values and wait for the next frame
                gestureState.lastCenterX = centerX;
                gestureState.lastCenterY = centerY;
                gestureState.lastDistance = distance;
                gestureState.lastAngle = angle;
                return;
            }
            
            // CRITICAL FIX: Don't emit pinch events if the scale change is too extreme
            // This prevents the box from jumping when a new gesture starts
            const scale = distance / gestureState.lastDistance;
            if (scale < 0.5 || scale > 2.0) {
                // Scale change is too extreme, probably a new gesture starting
                // Just update the last values and don't emit the event
                gestureState.lastCenterX = centerX;
                gestureState.lastCenterY = centerY;
                gestureState.lastDistance = distance;
                gestureState.lastAngle = angle;
                return;
            }

            // Calculate changes
            const deltaDistance = distance - gestureState.lastDistance;
            const deltaCenterX = centerX - gestureState.lastCenterX;
            const deltaCenterY = centerY - gestureState.lastCenterY;
            const deltaAngle = angle - gestureState.lastAngle;
            
            // CRITICAL FIX: Don't emit pan events if the movement is too extreme
            // This prevents the box from jumping when a new gesture starts
            const panDistance = Math.sqrt(deltaCenterX * deltaCenterX + deltaCenterY * deltaCenterY);
            if (panDistance > 100) { // More than 100px movement in one frame is probably wrong
                // Pan movement is too extreme, probably a new gesture starting
                // Just update the last values and don't emit the event
                gestureState.lastCenterX = centerX;
                gestureState.lastCenterY = centerY;
                gestureState.lastDistance = distance;
                gestureState.lastAngle = angle;
                return;
            }
            
            // CRITICAL FIX: Don't emit rotate events if the rotation is too extreme
            // This prevents the box from jumping when a new gesture starts
            const rotationRadians = Math.abs(deltaAngle);
            if (rotationRadians > 0.5) { // More than ~28 degrees in one frame is probably wrong
                // Rotation is too extreme, probably a new gesture starting
                // Just update the last values and don't emit the event
                gestureState.lastCenterX = centerX;
                gestureState.lastCenterY = centerY;
                gestureState.lastDistance = distance;
                gestureState.lastAngle = angle;
                return;
            }

            // Determine which gesture is being performed
            const distanceChange = Math.abs(deltaDistance);
            const centerChange = Math.sqrt(deltaCenterX * deltaCenterX + deltaCenterY * deltaCenterY);
            const angleChange = Math.abs(deltaAngle);

            const thresholds = this.config.gestureThresholds;

            // Determine the primary gesture based on which change is most significant
            const changes = [
                { type: 'pinch', value: distanceChange, threshold: thresholds.zoom },
                { type: 'pan', value: centerChange, threshold: thresholds.pan },
                { type: 'rotate', value: angleChange, threshold: thresholds.rotation }
            ];
            
            // Sort by relative change (value / threshold) to find the most significant gesture
            changes.sort((a, b) => (b.value / b.threshold) - (a.value / a.threshold));
            
            // Only emit the most significant gesture that meets its threshold
            const primaryGesture = changes[0];
            if (primaryGesture.value > primaryGesture.threshold) {
                this._state.gestureDetected = true;
                
                switch (primaryGesture.type) {
                    case 'pinch':
                        // Use the pre-calculated scale (already validated to be reasonable)
                        this._emitGestureEvent('pinch', targetElement, {
                            scale: scale,
                            centerX: centerX,
                            centerY: centerY,
                            originalEvent: e
                        });
                        break;
                        
                    case 'pan':
                        this._emitGestureEvent('pan', targetElement, {
                            deltaX: deltaCenterX,
                            deltaY: deltaCenterY,
                            centerX: centerX,
                            centerY: centerY,
                            originalEvent: e
                        });
                        break;
                        
                    case 'rotate':
                        this._emitGestureEvent('rotate', targetElement, {
                            rotation: deltaAngle,
                            centerX: centerX,
                            centerY: centerY,
                            originalEvent: e
                        });
                        break;
                }
            }

            // Update last values
            gestureState.lastCenterX = centerX;
            gestureState.lastCenterY = centerY;
            gestureState.lastDistance = distance;
            gestureState.lastAngle = angle;
            gestureState.isActive = true;
        },

        /**
         * Emit gesture event to registered listeners for specific element
         */
        _emitGestureEvent: function(gestureType, targetElement, data) {
            this._state.listeners.forEach((listenerData, key) => {
                if (listenerData.event === gestureType && listenerData.element === targetElement) {
                    const gestureEvent = {
                        type: gestureType,
                        ...data,
                        preventDefault: () => data.originalEvent.preventDefault(),
                        stopPropagation: () => data.originalEvent.stopPropagation()
                    };
                    listenerData.callback(gestureEvent);
                }
            });
        },

        /**
         * Map unified events to actual DOM events
         */
        _getEventMapping: function(eventType) {
            const mappings = {
                'pointerdown': ['pointerdown', 'touchstart', 'mousedown'],
                'pointerup': ['pointerup', 'touchend', 'mouseup'],
                'pointermove': ['pointermove', 'touchmove', 'mousemove'],
                'pointerenter': ['pointerenter', 'mouseenter'],
                'pointerleave': ['pointerleave', 'mouseleave'],
                'tap': [],
                'longpress': ['touchstart', 'mousedown'],
                'wheel': ['wheel', 'mousewheel', 'DOMMouseScroll'],
                'pinch': [],
                'pan': [],
                'rotate': []
            };

            return mappings[eventType] || [eventType];
        },

        /**
         * Process touch events for gesture detection
         */
        _processTouchEvent: function(e) {
            if (e.touches && e.touches.length === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                
                const pointers = [
                    {
                        id: touch1.identifier,
                        x: touch1.clientX,
                        y: touch1.clientY,
                        pressure: touch1.force || 1,
                        type: 'touch'
                    },
                    {
                        id: touch2.identifier,
                        x: touch2.clientX,
                        y: touch2.clientY,
                        pressure: touch2.force || 1,
                        type: 'touch'
                    }
                ];
                
                if (e.type === 'touchstart') {
                    pointers.forEach(pointer => {
                        this._state.pointers.set(pointer.id, pointer);
                    });
                } else if (e.type === 'touchmove') {
                    pointers.forEach(pointer => {
                        this._state.pointers.set(pointer.id, pointer);
                    });
                    this._detectGestures(e, pointers, e.target);
                } else if (e.type === 'touchend') {
                    // CRITICAL FIX: Properly clean up all pointers
                    pointers.forEach(pointer => {
                        this._state.pointers.delete(pointer.id);
                        this._clearLongpressTimer(pointer.id);
                    });
                    
                    // Clear all state when touches end
                    if (this._state.pointers.size === 0) {
                        this._state.gestureDetected = false;
                        // Don't clear gesture states - keep them for seamless transitions
                        this._state.tapStart = null;
                    }
                }
            } else if (e.touches && e.touches.length === 1) {
                const touch = e.touches[0];
                const pointer = {
                    id: touch.identifier,
                    x: touch.clientX,
                    y: touch.clientY,
                    pressure: touch.force || 1,
                    type: 'touch'
                };
                
                if (e.type === 'touchstart') {
                    this._state.pointers.set(pointer.id, pointer);
                    this._state.tapStart = {
                        x: touch.clientX,
                        y: touch.clientY,
                        time: Date.now(),
                        id: touch.identifier
                    };
                } else if (e.type === 'touchmove') {
                    this._state.pointers.set(pointer.id, pointer);
                    if (this._state.tapStart && this._state.tapStart.id === touch.identifier) {
                        const distance = Math.sqrt(
                            Math.pow(touch.clientX - this._state.tapStart.x, 2) +
                            Math.pow(touch.clientY - this._state.tapStart.y, 2)
                        );
                        if (distance > this.config.tap.threshold) {
                            this._state.tapStart = null;
                            this._clearLongpressTimer(touch.identifier);
                        }
                    }
                } else if (e.type === 'touchend') {
                    // CRITICAL FIX: Properly clean up pointer
                    this._state.pointers.delete(pointer.id);
                    this._clearLongpressTimer(pointer.id);
                    
                    if (this._state.tapStart && this._state.tapStart.id === touch.identifier) {
                        this._checkForTap(touch.clientX, touch.clientY, e.target);
                    }
                    
                    // Clear state when all touches end
                    if (this._state.pointers.size === 0) {
                        this._state.tapStart = null;
                        this._state.gestureDetected = false;
                    }
                }
            } else if (e.touches && e.touches.length === 0) {
                // CRITICAL FIX: Handle case when all touches are removed
                this._state.pointers.clear();
                this._state.gestureDetected = false;
                // Don't clear gesture states - keep them for seamless transitions
                this._state.tapStart = null;
                this._state.longpressTimers.forEach(timer => clearTimeout(timer));
                this._state.longpressTimers.clear();
            }
        },

        /**
         * Start longpress timer
         */
        _startLongpressTimer: function(pointerId, targetElement) {
            this._clearLongpressTimer(pointerId);
            
            const timer = setTimeout(() => {
                this._emitLongpressEvent(pointerId, targetElement);
            }, this.config.longpress.timeout);
            
            this._state.longpressTimers.set(pointerId, timer);
        },

        /**
         * Clear longpress timer
         */
        _clearLongpressTimer: function(pointerId) {
            const timer = this._state.longpressTimers.get(pointerId);
            if (timer) {
                clearTimeout(timer);
                this._state.longpressTimers.delete(pointerId);
            }
        },

        /**
         * Emit longpress event
         */
        _emitLongpressEvent: function(pointerId, targetElement) {
            const pointer = this._state.pointers.get(pointerId);
            if (!pointer) return;
            
            const longpressEvent = {
                type: 'longpress',
                pointers: [pointer],
                originalEvent: null,
                target: targetElement,
                currentTarget: targetElement,
                timestamp: Date.now(),
                preventDefault: () => {},
                stopPropagation: () => {}
            };
            
            this._state.listeners.forEach((listenerData, key) => {
                if (listenerData.event === 'longpress' && listenerData.element === targetElement) {
                    listenerData.callback(longpressEvent);
                }
            });
        },

        /**
         * Check if a touch event qualifies as a tap
         */
        _checkForTap: function(endX, endY, targetElement) {
            if (!this._state.tapStart) {
                return;
            }
            
            const timeDiff = Date.now() - this._state.tapStart.time;
            const distance = Math.sqrt(
                Math.pow(endX - this._state.tapStart.x, 2) +
                Math.pow(endY - this._state.tapStart.y, 2)
            );
            
            if (timeDiff <= this.config.tap.timeout && distance <= this.config.tap.threshold && !this._state.gestureDetected) {
                const tapEvent = {
                    type: 'tap',
                    pointers: [{
                        id: this._state.tapStart.id,
                        x: endX,
                        y: endY,
                        pressure: 1,
                        type: 'touch'
                    }],
                    originalEvent: null,
                    target: targetElement,
                    currentTarget: targetElement,
                    timestamp: Date.now(),
                    preventDefault: () => {},
                    stopPropagation: () => {}
                };
                
                this._state.listeners.forEach((listenerData, key) => {
                    if (listenerData.event === 'tap' && listenerData.element === targetElement) {
                        listenerData.callback(tapEvent);
                    }
                });
            }
            
            this._state.tapStart = null;
        },

        /**
         * Get mouse button label
         */
        _getMouseButton: function(e) {
            if (e.button !== undefined) {
                switch (e.button) {
                    case 0: return 'LMB';
                    case 1: return 'MMB';
                    case 2: return 'RMB';
                    case 3: return 'X1';
                    case 4: return 'X2';
                    default: return 'BTN' + e.button;
                }
            }
            return 'LMB'; // Default to left mouse button
        },

        /**
         * Deep merge utility
         */
        _deepMerge: function(target, source) {
            for (const key in source) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    if (!target[key]) target[key] = {};
                    this._deepMerge(target[key], source[key]);
                } else {
                    target[key] = source[key];
                }
            }
        },

        /**
         * Logging utility
         */
        _log: function(level, ...args) {
            if (!this.config.debug && level === 'debug') return;
            
            const prefix = '🧭 FTXX:';
            switch (level) {
                case 'debug':
                    console.log(prefix, ...args);
                    break;
                case 'info':
                    console.log(prefix, ...args);
                    break;
                case 'warn':
                    console.warn(prefix, ...args);
                    break;
                case 'error':
                    console.error(prefix, ...args);
                    break;
            }
        },

        /**
         * Clear gesture state for an element
         */
        clearGestureState: function(element) {
            this._state.gestureStates.delete(element);
        },

        /**
         * Get active pointers count
         */
        getActivePointersCount: function() {
            return this._state.pointers.size;
        },

        /**
         * Get current configuration
         */
        getConfig: function() {
            return JSON.parse(JSON.stringify(this.config));
        },

        /**
         * Update configuration
         */
        updateConfig: function(newConfig) {
            this._deepMerge(this.config, newConfig);
            
            // Handle context menu setting
            if (newConfig.disableContextMenu !== undefined) {
                if (window.ftxxContextMenuControl) {
                    if (newConfig.disableContextMenu) {
                        window.ftxxContextMenuControl.disable();
                    } else {
                        window.ftxxContextMenuControl.enable();
                    }
                }
            }
        },

        /**
         * Dispose and cleanup
         */
        dispose: function() {
            this._state.listeners.forEach((listenerData, key) => {
                this._removeEventListeners(listenerData.element, listenerData.event, listenerData.listener);
            });
            
            this._state.listeners.clear();
            this._state.pointers.clear();
            this._state.gestureStates.clear();
            this._state.longpressTimers.forEach(timer => clearTimeout(timer));
            this._state.longpressTimers.clear();
            this._state.isInitialized = false;
        }
    };

    // Auto-initialize when loaded
    ftxxPointer.init();

})(); 