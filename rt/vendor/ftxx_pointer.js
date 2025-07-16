/**
 * FTXX Pointer Library
 * multitouch+pointer library
 * 
 * @version 1.0.1
 * @author FTXX
 * 
 * USAGE:
 * ftxxPointer.on(element, events, callback)
 * ftxxPointer.off(element, events)
 * 
 * AVAILABLE EVENTS:
 * - pointerdown, pointerup, pointermove
 * - pointerenter, pointerleave
 * - tap, longpress
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
 */

(function() {
    'use strict';

    // Create the main library object
    window.ftxxPointer = {
        
        /**
         * Library information
         */
        version: '1.0.0',
        name: 'FTXX Pointer',
        
        /**
         * Configuration
         */
        config: {
            preventDefault: true,
            passive: false
        },

        /**
         * Internal state
         */
        _state: {
            pointers: new Map(), // Active pointers
            listeners: new Map(), // Event listeners
            isInitialized: false
        },

        /**
         * Initialize the library
         */
        init: function(options = {}) {
            if (this._state.isInitialized) {
                console.warn('FTXX Pointer already initialized');
                return this;
            }

            // Merge config
            Object.assign(this.config, options);
            
            // console.log('🧭 FTXX Pointer Library initialized!');
            
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

            events.forEach(event => {
                const listener = this._createListener(event, callback);
                this._state.listeners.set(`${element.id || 'anonymous'}_${event}`, {
                    element,
                    event,
                    callback,
                    listener
                });

                // Add appropriate event listeners based on device support
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
                const pointerEvent = this._normalizeEvent(e, eventType);
                if (pointerEvent) {
                    callback(pointerEvent);
                }
            };
        },

        /**
         * Normalize events to unified format
         */
        _normalizeEvent: function(e, eventType) {
            const isTouch = e.type.includes('touch');
            const isMouse = e.type.includes('mouse') || e.type.includes('pointer');
            const isWheel = e.type.includes('wheel') || e.type.includes('mousewheel') || e.type.includes('DOMMouseScroll');
            
            let pointers = [];
            
            if (isTouch && e.touches) {
                // Handle touch events
                for (let i = 0; i < e.touches.length; i++) {
                    const touch = e.touches[i];
                    const pointerData = {
                        id: touch.identifier,
                        x: touch.clientX,
                        y: touch.clientY,
                        pressure: touch.force || 1,
                        type: 'touch'
                    };
                    pointers.push(pointerData);
                    
                    // Track active pointers
                    if (e.type === 'touchstart') {
                        this._state.pointers.set(touch.identifier, pointerData);
                    } else if (e.type === 'touchend') {
                        this._state.pointers.delete(touch.identifier);
                    } else if (e.type === 'touchmove') {
                        this._state.pointers.set(touch.identifier, pointerData);
                    }
                }
            } else if (isMouse || e.type.includes('pointer')) {
                // Handle mouse and pointer events
                const pointerData = {
                    id: e.pointerId || 0,
                    x: e.clientX,
                    y: e.clientY,
                    pressure: e.pressure || 1,
                    type: e.pointerType || 'mouse'
                };
                pointers.push(pointerData);
                
                // Track pointer
                if (e.type === 'pointerdown' || e.type === 'mousedown') {
                    this._state.pointers.set(pointerData.id, pointerData);
                } else if (e.type === 'pointerup' || e.type === 'mouseup') {
                    this._state.pointers.delete(pointerData.id);
                } else if (e.type === 'pointermove' || e.type === 'mousemove') {
                    this._state.pointers.set(pointerData.id, pointerData);
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
            
            events.forEach(event => {
                element.removeEventListener(event, listener, false);
            });
        },

        /**
         * Map unified events to actual DOM events
         */
        _getEventMapping: function(eventType) {
            const mappings = {
                'pointerdown': ['mousedown', 'touchstart', 'pointerdown'],
                'pointerup': ['mouseup', 'touchend', 'pointerup'],
                'pointermove': ['mousemove', 'touchmove', 'pointermove'],
                'pointerenter': ['mouseenter', 'pointerenter'],
                'pointerleave': ['mouseleave', 'pointerleave'],
                'tap': ['click', 'touchend'],
                'longpress': ['mousedown', 'touchstart'],
                'wheel': ['wheel', 'mousewheel', 'DOMMouseScroll']
            };

            return mappings[eventType] || [eventType];
        },


    };

    // Auto-initialize when loaded
    ftxxPointer.init();

})(); 