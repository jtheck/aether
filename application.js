



// Namespaces
window.app = {};  // Application
window.ui = {};   // Interface
window.gfx = {};  // Graphics
window.tr = {};   // Game
window.net = {};  // Network
window.aud = {};  // Audio


(function(app) {
  


  app.init = function(){
    
    // initProgressiveWebApp();
    // initUXListeners();
  
    ui.init();
    
    gfx.init();
    
    // Initialize HUD mode from saved preference or default
    if (window.hud && window.hud.initializeHUDMode) {
      window.hud.initializeHUDMode();
    }
    
    // Wait for the scene to be ready before initializing player and networking
    gfx.scene.whenReadyAsync().then(function() {
      initPlayer();
      
      // Initialize empty arrays for menu scene (buildings/units only spawn when match starts)
      window.playerBuildings = [];
      window.gameUnits = [];
      
      // DON'T initialize networking here - let the lobby system handle it when user picks a game type
      // Network will be initialized when user clicks a game type in the menu
      
      // Initialize shadow generator after lighting system is ready
      // Add a small delay to ensure lighting system is fully initialized
      setTimeout(() => {
        if (gfx.initializeShadowGenerator) {
          gfx.initializeShadowGenerator();
        }
        
        // Initialize shadows mode AFTER shadow generator is ready
        if (window.hud && window.hud.initializeShadowsMode) {
          window.hud.initializeShadowsMode();
        }
        
        // Initialize selection mode
        if (window.hud && window.hud.initializeSelectionMode) {
          window.hud.initializeSelectionMode();
        }
      }, 100); // 100ms delay
      
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
      chat = GETFIRE({topicNames: ["test"],
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
          .register("/sw-treha.js", {
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
    // Override unit movement to use net.sendCommand
    const originalMoveUnit = window.pathfinding?.moveUnit || window.Unit.prototype.move;
    window.pathfinding = window.pathfinding || {};
    window.pathfinding.moveUnit = function(unit, target) {
      if (window.isMultiplayer && unit.owner === window.player.id) {
        // Send move command over network
        window.net.sendCommand({
          type: 'move',
          unitId: unit.id,
          target: {x: target.x, z: target.z}
        });
      }
      
      // Execute locally (prediction)
      return originalMoveUnit.call(this, unit, target);
    };
    
    // Similarly hook attack, build, etc.
    // ... additional hooks for other command types
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
    // console.log('🔄 Window focused');
  });
  
  window.addEventListener('blur', () => {
    if (window.net) {
      // Pause sending commands while tabbed out (safe even if getStatus missing)
      window.net.pauseCommands = true;
    }
  });
}(window.app = window.app || {}));
