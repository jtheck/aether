



// Namespaces
window.app = {};  // Application
window.ui = {};   // Interface
window.gfx = {};  // Graphics
window.tr = {};   // Game
window.net = {};  // Network
window.aud = {};  // Audio (loaded from game/audio.js)


(function(app) {
  const hiddenTabController = {
    MENU_SUSPEND_MS: 10000,
    LOCAL_PAUSE_MS: 10000,
    LIVE_PAUSE_MS: 30000,
    LIVE_CONCEDE_MS: 60000,
    hiddenAt: null,
    menuSuspended: false,
    _lastHiddenSource: null,
    _timers: {
      menuSuspend: null,
      localPause: null,
      livePause: null,
      liveConcede: null
    },

    init() {
      if (this._initialized) return;
      this._initialized = true;
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.handleHidden('visibilitychange');
        } else {
          this.handleVisible('visibilitychange');
        }
      });
      window.addEventListener('pagehide', () => {
        this.handleHidden('pagehide');
      });
      window.addEventListener('pageshow', () => {
        if (!document.hidden) {
          this.handleVisible('pageshow');
        }
      });
      document.addEventListener('freeze', () => {
        this.handleHidden('freeze');
      });
      document.addEventListener('resume', () => {
        if (!document.hidden) {
          this.handleVisible('resume');
        }
      });
    },

    clearTimers() {
      Object.keys(this._timers).forEach(key => {
        if (this._timers[key]) {
          clearTimeout(this._timers[key]);
          this._timers[key] = null;
        }
      });
    },

    getCurrentContext() {
      const match = window.currentMatch;
      if (!match || match.isDemo) {
        return 'menu';
      }
      if (typeof match.isLiveMultiplayerMatch === 'function' && match.isLiveMultiplayerMatch()) {
        return 'live';
      }
      return 'local';
    },

    resetTiming() {
      if (window.gameLoop) {
        window.gameLoop.physicsTime = 0;
        window.gameLoop.lastTime = performance.now();
      }
      if (window.gfx && window.gfx.menuGameLoop) {
        window.gfx.menuGameLoop.physicsTime = 0;
        window.gfx.menuGameLoop.lastTime = performance.now();
      }
      if (window.demo && window.demo.resetTiming) {
        window.demo.resetTiming();
      }
    },

    setCommandPause(paused) {
      if (window.net) {
        window.net.pauseCommands = paused;
      }
    },

    isLikelyMobileStandbyRisk() {
      const uaMobile = !!navigator.userAgentData?.mobile;
      const touchPoints = navigator.maxTouchPoints || 0;
      let coarsePointer = false;
      if (typeof window.matchMedia === 'function') {
        coarsePointer = window.matchMedia('(pointer: coarse)').matches;
      }
      return uaMobile || (touchPoints > 0 && coarsePointer);
    },

    shouldPauseLiveImmediately(source) {
      if (source === 'freeze' || source === 'pagehide') {
        return true;
      }
      return source === 'visibilitychange' && this.isLikelyMobileStandbyRisk();
    },

    pauseLiveMatchForHidden(match, source, options = {}) {
      if (!match || typeof match.pauseMatch !== 'function') {
        return false;
      }
      if (typeof match.isIntentionalPauseActive === 'function' && match.isIntentionalPauseActive()) {
        return false;
      }
      return match.pauseMatch({
        reason: 'auto_away',
        message: '⏸️ AUTO-AWAY PAUSE',
        broadcast: true,
        hiddenTriggered: true,
        standbyTriggered: !!options.standbyTriggered,
        lifecycleSource: source
      });
    },

    isMenuSuspended() {
      return !!this.menuSuspended;
    },

    handleHidden(source = 'visibilitychange') {
      this.init();
      if (this.hiddenAt === null) {
        this.hiddenAt = performance.now();
      }
      this._lastHiddenSource = source;
      this.menuSuspended = false;
      this.clearTimers();
      this.setCommandPause(true);

      const context = this.getCurrentContext();
      const match = window.currentMatch;

      if (context === 'menu') {
        this._timers.menuSuspend = setTimeout(() => {
          if (!document.hidden || this.getCurrentContext() !== 'menu') return;
          this.menuSuspended = true;
          this.resetTiming();
        }, this.MENU_SUSPEND_MS);
        return;
      }

      if (!match || typeof match.pauseMatch !== 'function') {
        return;
      }

      if (typeof match.isIntentionalPauseActive === 'function' && match.isIntentionalPauseActive()) {
        return;
      }

      if (context === 'local') {
        this._timers.localPause = setTimeout(() => {
          if (document.hidden && this.getCurrentContext() === 'local') {
            match.pauseMatch({
              reason: 'auto_hidden',
              message: '⏸️ AUTO-PAUSED (TAB HIDDEN)',
              broadcast: false,
              hiddenTriggered: true
            });
          }
        }, this.LOCAL_PAUSE_MS);
        return;
      }

      if (this.shouldPauseLiveImmediately(source)) {
        this.pauseLiveMatchForHidden(match, source, { standbyTriggered: true });
      } else {
        this._timers.livePause = setTimeout(() => {
          if (!document.hidden || this.getCurrentContext() !== 'live') return;
          this.pauseLiveMatchForHidden(match, 'hidden_timeout');
        }, this.LIVE_PAUSE_MS);
      }

      this._timers.liveConcede = setTimeout(() => {
        if (!document.hidden || this.getCurrentContext() !== 'live') return;
        if (typeof match.isLocalAutoAwayPauseActive === 'function' && !match.isLocalAutoAwayPauseActive()) return;
        if (typeof match.concede === 'function') {
          match.concede();
        }
      }, this.LIVE_CONCEDE_MS);
    },

    flushMissedHiddenActions(hiddenDurationMs) {
      const context = this.getCurrentContext();
      const match = window.currentMatch;
      if (context === 'local' && match && typeof match.pauseMatch === 'function') {
        if (hiddenDurationMs >= this.LOCAL_PAUSE_MS && !match.isPaused) {
          match.pauseMatch({
            reason: 'auto_hidden',
            message: '⏸️ AUTO-PAUSED (TAB HIDDEN)',
            broadcast: false,
            hiddenTriggered: true
          });
        }
        return;
      }

      if (context === 'live' && match && typeof match.pauseMatch === 'function') {
        if (typeof match.isIntentionalPauseActive === 'function' && match.isIntentionalPauseActive()) {
          return;
        }
        if (hiddenDurationMs >= this.LIVE_PAUSE_MS && !match.isPaused) {
          this.pauseLiveMatchForHidden(match, 'visible_flush');
        }
      }
    },

    handleVisible(source = 'visibilitychange') {
      this.init();
      const hadHiddenSession = this.hiddenAt !== null;
      const lastHiddenSource = this._lastHiddenSource;
      const hiddenDurationMs = hadHiddenSession ? (performance.now() - this.hiddenAt) : 0;

      this.flushMissedHiddenActions(hiddenDurationMs);
      this.hiddenAt = null;
      this._lastHiddenSource = null;
      this.menuSuspended = false;
      this.clearTimers();
      this.setCommandPause(false);
      this.resetTiming();

      const match = window.currentMatch;
      if (hadHiddenSession && match && typeof match.onTabVisible === 'function') {
        match.onTabVisible(hiddenDurationMs / 1000, {
          lifecycleSource: source,
          lastHiddenSource,
          hiddenDurationMs
        });
      }
    }
  };

  window.hiddenTabController = hiddenTabController;
  hiddenTabController.init();
  


  app.init = function(){
    
    initProgressiveWebApp();
    // initUXListeners();
  
    ui.init();
    
    gfx.init();

    // Initialize AudioEngineV2
    aud.init();

    // Initialize HUD mode from saved preference or default
    if (window.hud && window.hud.initializeHUDMode) {
      window.hud.initializeHUDMode();
    }
    
    // Wait for the scene to be ready before initializing player and networking
    gfx.scene.whenReadyAsync().then(function() {
      initPlayer();
      
      // Initialize empty arrays for menu scene (buildings/units only spawn when match starts)
      window.playerBuildings = [];
      // NOTE: Do NOT reset window.gameUnits here — units.js already exports the authoritative
      // reference (window.gameUnits = gameUnits), and demo.init() may have already pushed
      // villagers into it before this async callback fires on slow devices.
      
      // DON'T initialize networking here - let the lobby system handle it when user picks a game type
      // Network will be initialized when user clicks a game type in the menu
      
      // Initialize shadows mode after lighting system is ready
      // This will check the saved preference and only initialize shadows if enabled
      // Add a small delay to ensure lighting system is fully initialized
      setTimeout(() => {
        // Give extra time for meshes to be loaded
        setTimeout(() => {
          if (window.hud && window.hud.initializeShadowsMode) {
            window.hud.initializeShadowsMode();
          }
          
          // Initialize selection mode
          if (window.hud && window.hud.initializeSelectionMode) {
            window.hud.initializeSelectionMode();
          }
        }, 200); // Additional delay for mesh loading
      }, 100); // Initial delay for lighting
      
      // Ensure table exists before stretching it
      if (gfx.table && gfx.table.parts && gfx.table.parts.SW) {
        gfx.stretchTable(gfx.table);
      } else {
        console.warn('Table not available for stretching - gfx.table:', gfx.table);
      }
      
      // Disable auto-follow to prevent cameraTarget jumps during touch gestures
      window.cameraAutoFollowEnabled = false;
      
      // Initialize touch manager on the canvas once gfx is ready
      if (window.touch && window.gfx && window.gfx.canvas) {
        window.touch.init(window.gfx.canvas);
      }
      
      // DON'T auto-start game here - user picks game mode from lobby menu
      // The lobby system (lobby.js) will handle game initialization and network setup
      // console.log('🎮 Ready! Open menu to select a game mode.');
    });
    
    let chat;
    // Init chat
    if (typeof GETFIRE !== "undefined"){
      chat = GETFIRE({topicNames: ["AEG", "gaming", "SC2"],
        defaultName: "Strategist",
        startOpen: false,
        startPreview: false,
        clickAwayHide: false,
        mouseOutFade: true,
        titleAlerts: true,
        // topCorner: true,
        devMode: (window.location.protocol != 'https:')
      });
    }
    
    // net.init();
    // gfx.crank()
    app.initInputListeners();
    window._inputListenersInitialized = true; // Mark as initialized
    
    log("©'25 Aether.Garden");
  }; // end app.init




  function initProgressiveWebApp(){
    // Add Service Worker for Progressive Web App capabilities
    if ("serviceWorker" in navigator) {
      if (navigator.serviceWorker.controller) {
        // console.log("[PWA Builder] active service worker found, no need to register");
      } else {
        // Register the service worker
        navigator.serviceWorker
          .register("/sw-aether.js", {
            scope: "./"
          })
          .then(function (reg) {
            // console.log("[PWA Builder] Service worker has been registered for scope: " + reg.scope);
          });
      }
    }
  };



  function initUXListeners() {
    // // listeners
    // window.addEventListener('resize', app.resize.debounce(150,false), false);
    // window.addEventListener('orientationchange', function() {app.resize.debounce(150,false)}, {once : true});
    // window.addEventListener("beforeunload", function(){net.send('tr_'+tr.self.world, makeMessage({type:"exit"}))});

    // // console    
    // document.getElementById("util_b").addEventListener("click", function(){ui.toggleConsole()});
   
    // prevent browser back
    history.pushState(null, "", location.href);
    window.addEventListener("popstate", function () {
      history.pushState(null, "", location.href);
    });
  };



  app.initInputListeners = function() {
    window.addEventListener('resize', app.resize.debounce(150,false), false);
    window.addEventListener('orientationchange', function() {app.resize.debounce(150,false)}, {once : true});
    
    document.addEventListener('keydown', ui.keyInput, false);
    document.addEventListener('keyup', ui.keyInput, false);
  
    document.addEventListener('pointermove', (e) => {ui.handlePointer(e)});
    document.addEventListener('pointerup', (e) => {ui.handlePointer(e)});
    document.addEventListener('pointerdown', (e) => {ui.handlePointer(e)});

    // Add wheel event for camera rotation
    document.addEventListener('wheel', ui.handleWheel, { passive: false });

    // Disable Right Click menu
    document.addEventListener("contextmenu", ui.rightClick, false);
  };

  



  
  app.resize = function() {
    // gfx.canvas.height = window.innerHeight-12;
    // gfx.canvas.width = window.innerWidth-12;
    gfx.engine.resize();
  };



  // log to in-game console
  app.log = function (log) {
    // // log = JSON.stringify(log) + '<br />';
    // log = log + '<br />';
    // // document.getElementById("console_log").innerHTML += log;
    // document.getElementById("console_log").insertAdjacentHTML('afterbegin', log);

    // var objDiv = document.getElementById("console_log");
    // objDiv.scrollTop = 0;// objDiv.scrollHeight;
  };

  // UPDATED: Separate single-player start function for fallback
  function startSinglePlayerGame() {
    window.isMultiplayer = false;
    window.gameType = 'single';
    
    // Create AI opponent if needed
    if (!window.opponent) {
      window.opponent = new AIPlayer({
        id: 'ai',
        difficulty: 'normal',
        color: getOpponentColor()
      });
    }
    
    const players = [window.player, window.opponent];
    
    // Initialize game
    window.game = new Game({
      type: window.gameType,
      map: 'default',
      players: players,
      isMultiplayer: window.isMultiplayer,
      tickRate: 60
    });
    
    // Start game loop
    if (window.gameLoop && window.gameLoop.start) {
      window.gameLoop.start();
    }
    
    // console.log('🎮 Starting single player game (network fallback)');
  }

  // UPDATED: Enhanced startMultiplayerGame with safety check
  function startMultiplayerGame() {
    try {
      const status = window.net.getStatus();
      
      // Create players based on connection status
      const players = [window.player]; // Always include local player
      
      if (status.isConnected && status.peers.length > 0) {
        // Multiplayer: create opponent proxy
        if (!window.opponent) {
          window.opponent = new OpponentPlayer({
            id: status.peers[0], // First peer
            color: getOpponentColor(), // Blue for opponent
            startingResources: {food: 100, wood: 50, stone: 25, magic: 10}
          });
        }
        players.push(window.opponent);
        
        // Set multiplayer flag
        window.isMultiplayer = true;
        window.gameType = 'onevsone';
        
        // console.log(`🎮 Starting 1v1 multiplayer game vs ${window.opponent.id}`);
      } else {
        // Fallback to single-player even in multiplayer attempt
        console.warn('No peers connected, starting single-player');
        startSinglePlayerGame();
        return;
      }
      
      // Initialize game with players
      window.game = new Game({
        type: window.gameType,
        map: 'default',
        players: players,
        isMultiplayer: window.isMultiplayer,
        tickRate: window.net ? window.net.TICK_RATE : 60
      });
      
      // Start game loop
      if (window.gameLoop && window.gameLoop.start) {
        window.gameLoop.start();
      }
      
      // Hook unit commands to network layer
      hookUnitCommandsToNetwork();
    } catch (error) {
      console.error('Failed to start multiplayer game:', error);
      // Fallback to single-player
      startSinglePlayerGame();
    }
  }

  // Hook existing unit commands to send via network
  function hookUnitCommandsToNetwork() {
    // Lockstep multiplayer commands must flow through currentMatch.submitCommand().
    // Keep this function as a no-op for older startup paths that still call it.
  };
  
  // Get opponent color (blue team)
  function getOpponentColor() {
    return {
      primary: '#0066cc',
      secondary: '#004499',
      accent: '#99ccff'
    };
  };
  
  // UPDATED: Safe focus/blur event listeners
  window.addEventListener('focus', () => {
    // DON'T re-initialize networking on focus!
    // The lobby system handles network initialization
    // Re-initing creates a new P2P instance and breaks broadcast channels
    if (window.hiddenTabController) {
      window.hiddenTabController.setCommandPause(false);
    }
  });
  
  window.addEventListener('blur', () => {
    if (window.hiddenTabController) {
      window.hiddenTabController.setCommandPause(true);
    }
  });
}(window.app = window.app || {}));
