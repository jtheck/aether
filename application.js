



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

    // Wait for the scene to be ready before initializing the player
    gfx.scene.whenReadyAsync().then(function() {
      initPlayer();
      gfx.stretchTable(gfx.table);

      // Disable auto-follow to prevent cameraTarget jumps during touch gestures
      window.cameraAutoFollowEnabled = false;

      // Initialize touch manager on the canvas once gfx is ready
      if (window.touch && window.gfx && window.gfx.canvas) {
        window.touch.init(window.gfx.canvas);
      }

    });

    
    // net.init();
    // gfx.crank()
    app.initInputListeners();

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
}(window.app = window.app || {}));
