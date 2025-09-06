




const svgIcons = {
  close: '<svg width="100%" height="100%" viewBox="0 0 26 26"><path style="fill-opacity:1;stroke:none;stroke-width:.183891;stroke-dasharray:none;stroke-opacity:.998532" d="M19.14 6.972s-.032 1.038-.467 1.829c-.435.79-5.86 3.536-5.86 3.536S7.497 8.797 7.29 8.222c-.207-.575-.106-1.277-.106-1.277s-.568 1.39-.917 1.957c-.348.566-1.342 1.511-1.342 1.511s1.066-.416 1.468-.426c.402-.01 5.4 2.95 5.4 2.95s-4.99 2.675-5.568 2.8c-.577.124-1.54-.338-1.54-.338s.936 1.134 1.235 1.702c.3.567.732 1.954.732 1.954s-.038-1.009.229-1.72c.268-.713 5.917-3.78 5.917-3.78s5.356 3.46 5.699 3.822c.342.361.636 1.645.636 1.645s.338-1.235.62-1.853c.282-.618 1.464-1.498 1.464-1.498s-1.21.18-2.024.165c-.813-.015-5.34-2.873-5.34-2.873s4.908-2.19 5.552-2.163c.643.027 1.91.392 1.91.392s-1.206-.974-1.499-1.717c-.293-.743-.676-2.503-.676-2.503z"/></svg>',
  gear: '<svg width="100%" height="100%" viewBox="0 0 99 99"><path style="fill:none;stroke-width:5.7247;stroke-linecap:round;stroke-linejoin:miter;stroke-dasharray:none;stroke-opacity:1" d="M19.848 32.659c-1.806-1.905-4.302-3.979-3.715-6.864.587-2.886 3.377-4.255 5.047-6.328 2.445-2.1 4.659-5.56 7.23-6.445 2.572-.885 4.303.334 5.625 2.136 1.444 2.713 4.159.962 5.743-.022 1.584-.983.24-3.364.553-4.91.847-2.783 3.137-3.896 6.53-3.612 3.393.285 8.163-.171 12.152.131 2.662.855 3.88 3.565 3.551 6.178-.847 2.877 2.343 3.544 4.249 3.831 1.906.287 2.703-3.106 4.718-3.6 2.318-.704 4.694.416 6.074 2.332 2.76 2.844 5.757 5.526 8.373 8.47 1.432 2.208.843 5.306-1.37 6.84-2.75 1.304-.863 3.523-.202 5.424.56 1.77 3.223.504 4.69.965 2.867.574 4.58 3.565 4.027 6.362-.087 4.144.173 8.37-.129 12.463-.903 2.728-3.739 3.794-6.36 3.4-2.815-.855-3.66 2.272-3.701 4.4-.044 2.129 3.832 3.143 3.715 6.158-.116 3.015-3.148 4.714-4.856 6.902-2.183 2.054-4.186 4.389-6.481 6.268-2.39 1.178-5.253.166-6.771-1.984-1.428-2.729-3.793.123-5.917.4M19.98 80.1c-5.245 1.61-7.395.366-8.912-3.324-1.517-3.69-5.408-9.343-.99-11.256 4.418-1.913 1.252-5.106-2.313-5.849-3.565-.743-1.383-5.87-.649-8.652.595-3.907 3.17-8.828 7.766-7.428 4.596 1.401 2.93-3.363 1.658-6.44-1.272-3.076 3.584-4.967 6.12-6.444 2.633-1.203 6.81-5.717 8.635-2.048 1.825 3.669 6.523 4.471 7.034.12.512-4.351 5.305-2.722 7.898-1.583 2.61.841 5.56 1.053 7.88 2.547 2.932 2.642-.63 8.371 3.075 8.724 3.705.354 5.675-3.05 7.805-.139 1.775 3.475 4.201 6.704 5.57 10.36.73 4.216-6.377 5.791-3.895 8.755 2.481 2.963 6.003 1.783 5.552 5.261-1.079 3.69-1.956 7.472-3.179 11.132-2.418 3.981-8.885-.369-9.17 3.624-.287 3.992 3.078 6.539-.7 8.185-3.041 1.654-6.004 3.484-9.102 5.008-4.584 1.5-6.762-6.63-9.566-3.565-2.803 3.065-1.815 5.694-4.947 5.31-3.62-.996-7.274-1.972-11.295-3.579-4.021-1.606.97-10.329-4.275-8.72zm30.24-22.711c.178 1.042.34 2.142.14 3.18-.377 1.97-.998 3.998-2.263 5.56-.794.98-1.716 1.896-2.78 2.576-2.67 1.707-6.104 2.281-9.212 1.467h0c-1.337-.451-2.836-.829-3.865-1.813-1.038-.991-2.251-1.885-2.992-3.108-1.627-2.687-2.132-6.068-1.269-9.143 1.01-3.593 3.887-6.46 7.381-7.759 1.176-.437 2.344-.556 3.568-.529 1.275.03 2.572.092 3.785.513"/></svg>',
  trophy: '<svg width="100%" height="100%" viewBox="0 0 99 99"><path style="fill:none;stroke-width:3.86427;stroke-dasharray:none;stroke-opacity:1" d="M27.375 41.888c1.195-1.69 4.677-2.685 1.736-5.076-.9-3.349 1.423-8.923 2.765-10.436.029 3.21 4.189 10.904 6.875 5.773.291-4.955-4.382-8.986-3.175-14.153C36.724 11.115 43.24 6.266 49.72 4.77c-1.163 3.627-3.244 8.977.451 11.79 4.656.522 10.524 3.142 10.173 8.737C62.01 27.575 64.8 21.151 63 19.435l-2.655-5.17c4.442 1.677 9.772 3.384 12.109 7.88 1.773 5.796.167 12.257-3.782 16.769-1.856 2.827 7.297 2.128 2.04 2.528-15.696-.007-31.392-.006-47.088-.02M46.104 8.19c-4.69 1.963-7.085 9.604-.82 11.269l.691.358m-9.43-5.168.168.169.09.09m11.627 5.814c4.91.183 10.091 5.615 6.54 10.316-1.937 2.768-5.796 3.872-6.928 7.253M70.65 25.889c-.014 3.795-1.051 7.666-3.359 10.723m4.763 4.489c2.472 1.023 8.926-.71 6.61 4.002-1.061 5.882 9.81-.576 8.088 5.52-2.263 7.175-9.567 12.24-16.996 12.539-3.97 3.67-9.948 5.015-13.843 7.854-1.115 4.465 1.433 9.14 4.397 12.347 2.502 2.652 7.18.513 7.167 6.535-.014 6.022-7.07 4.938-11.163 4.982-6.993-.022-13.987.028-20.98-.015-2.61-2.068-2.836-9.936 1.374-9.45 8.356-.159 16.794.374 25.1-.234l.163-.084M36.514 61.663c-4.254-4.036-7.532-9.616-7.367-15.633 5.013-1.34 10.268-.116 15.384-.524 2.947-.05 5.898-.267 8.842-.028M55.7 82.567c-2.677-3.574-2.287-8.298-1.184-11.94-3.93-1.435-8.376.292-12.39-1.153-5.058-1.42-9.41-4.667-13.338-8.023-4.373-5.193-7.67-11.794-7.516-18.697.22-1.202 1.555-1.581 2.598-1.32m54.802 5.629c-1.804 5.797-5.07 11.11-8.654 15.968M21.626 47.353c-2.819.748-9.924-.783-9.56 2.177.628 5.09 6.445 8.038 10.735 10.618 2.122 1.143 4.45 1.989 6.87 2.154m14.766 7.79c.48 5.731-1.667 11.273-6.238 14.835m-4.214 5.732h23.433"/></svg>',
  bars: '<svg width="100%" height="100%" viewBox="0 0 26 26"><path style="fill-opacity:1;stroke:none;stroke-width:.260162;stroke-dasharray:none;stroke-opacity:.998532" d="M13.834 7.576s9.03-.316 9.707-.854c.676-.539 1.076-1.46 1.076-1.46s-.348 2.096-.35 3.038c0 .94.495 2.816.495 2.816s-.975-1.292-1.452-1.603c-.476-.31-8.693-.457-8.693-.457l-1.67-.002s-9.018.19-9.7.37c-.68.181-1.988 1.51-1.988 1.51s.51-1.739.63-2.693c.12-.953-.65-2.89-.65-2.89s1.323 1.115 2.314 1.701c.99.586 8.564.506 8.564.506zM1.121 14.024s.755 1.26 1.838 1.938c1.082.676 9.677.33 9.677.33l1.674.038s8.009-.135 8.81-.38c.798-.244 1.669-1.478 1.669-1.478s-.375 2.046-.353 2.954c.02.907.443 2.919.443 2.919s-.649-1.273-1.469-1.968c-.822-.696-9.916-.591-9.916-.591l-1.711-.004s-7.573.677-8.35 1.154c-.776.477-2.09 1.801-2.09 1.801s.819-2.034.668-3.154c-.15-1.12-.89-3.559-.89-3.559z"/></svg>',
};

// Load SVGs
function loadIcon(iconName, targetElementId, size = 24) {
  const target = document.getElementById(targetElementId);
  if (!target || !svgIcons[iconName]) return;

  target.innerHTML = svgIcons[iconName];
}


const defaultNames = [
  'Cultivator', 'Gardener', 'Bloomwarden',
  'Planter', 'Weaver', 'Luminary',
  'Void-Caller', 'Astral Heart', 'Aetherean',
  'Architect', 'Steward', 'Warden',
  'Overseer', 'Commander', 'Strategist',
  'Sovereign', 'Chancellor', 'Arbiter',
  'Verdantheart', 'Greenwarden', 'Rootwarden',
  'Sporecaller', 'Starweaver', 'Voidbinder',
  'Aetherium', 'Starchild', 'Regent',
  'Magistrate', 'Highwarden', 'Ordinator',
  'Director', 'Conductor', 'Oathkeeper',
  'Dawncaller', 'Sunstone', 'Moonshadow',
  'Genesis', 'Nexus', 'Crucible',
  'Lodestar', 'Keystone', 'Player'
];

const playerColors = [
  "#FF5252", "#FF793F", "#FFB142", "#FFDA79", "#FFFA65",
  "#C4E538", "#A3CB38", "#78E08F", "#00C853", "#00B894",
  "#00CEC9", "#05CDFF", "#0984E3", "#0652DD", "#1B1464",
  "#4834D4", "#6C5CE7", "#B56FE1", "#D980FA", "#FD79A8",
  "#FF3E6C", "#E84393", "#FDA7DF", "#FEAFA8", "#D63031",
  "#B33939", "#82589F", "#5D2E8E", "#3C40C6", "#3742FA",
  "#2E86DE", "#00A8FF", "#0097E6", "#44BBDC", "#00D8D6",
  "#00BcC1", "#05C1A4", "#019D73", "#26DE81", "#A3DE83",
  "#C5E3BF", "#FFFFFF"
];

function getRandomName() {
  const randomIndex = Math.floor(Math.random() * defaultNames.length);
  return defaultNames[randomIndex];
}

function getRandomColor() {
  const randomIndex = Math.floor(Math.random() * playerColors.length);
  return playerColors[randomIndex];
}


(function(ui) {

  ui.init = function(){

    // if (isMobile()){
    //   document.getElementById("mobile_control_wrapper").style.display = "block";
    // }


    loadIcon('bars', 'menu_b');
    loadIcon('close', 'close_b');
    loadIcon('gear', 'settings_b');
    loadIcon('trophy', 'trophy_b');


    let pName = getRandomName();
    let pColor = getRandomColor();

    // Store the color globally so the player can access it
    window.currentPlayerColor = pColor;

    const playerName = document.getElementById('player_b');
    playerName.innerHTML = pName;
    playerName.style.color = pColor;

    const playerTitle = document.getElementById('player_menu_title');
    playerTitle.innerHTML = pName;
    playerTitle.style.color = pColor;
    
    // Set up color picker event listener
    const colorPicker = document.getElementById('colorPicker');
    if (colorPicker) {
      // Set initial color picker value to current player color
      colorPicker.value = pColor;
      
      // Listen for color changes
      colorPicker.addEventListener('change', function(e) {
        const newColor = e.target.value;
        
        // Update both player name locations with new color
        if (playerName) {
          playerName.style.color = newColor;
        }
        if (playerTitle) {
          playerTitle.style.color = newColor;
        }
        
        // Update the player's color property and apply to frog model
        if (window.player) {
          window.player.color = newColor;
          
          // Apply color to the frog model if it exists
          if (window.player.frog && window.player.frog.root) {
            // Create a new material with the player's color
            const playerMaterial = new BABYLON.StandardMaterial('playerMaterial', gfx.scene);
            playerMaterial.diffuseColor = BABYLON.Color3.FromHexString(newColor.replace('#', ''));
            playerMaterial.emissiveColor = BABYLON.Color3.FromHexString(newColor.replace('#', '')).scale(0.2); // Add slight glow
            
            // Apply the material to the frog model
            window.player.frog.root.material = playerMaterial;
          }
        }
        
        // Store the new color for persistence (optional)
        window.currentPlayerColor = newColor;
        
        console.log('Player color updated to:', newColor);
      });
    }

  }


  let prevMenu = 'main_menu';
  ui.showMenu = function(menuId){
    prevMenu = menuId;

    // Hide all menus
    document.getElementById('main_menu').style.display = 'none';
    document.getElementById('settings_menu').style.display = 'none';
    document.getElementById('player_menu').style.display = 'none';
    document.getElementById('trophy_menu').style.display = 'none';
    document.getElementById('ingame_menu').style.display = 'none';
    document.getElementById('adventure_lobby').style.display = 'none';
    document.getElementById('onevsone_lobby').style.display = 'none';
    document.getElementById('ffa_lobby').style.display = 'none';
    document.getElementById('koth_lobby').style.display = 'none';
    document.getElementById('teams_lobby').style.display = 'none';

    
    // Show the requested menu
    document.getElementById(menuId).style.display = 'block';
    document.getElementById('menu').style.display = 'block';
  }

  ui.hideMenu = function(){
    document.getElementById('menu').style.display = 'none';
  }

	


  ui.keyInput = function(evt) {
    // let assignedFunction = activeKeyboardConfig[evt.code];
    let state = evt.type == 'keydown' ? true : false;
  
    // // cancel on input typing
    // var activeElement = document.activeElement;
    // var inputs = ['input', 'select', 'button', 'textarea'];
    // if (activeElement && inputs.indexOf(activeElement.tagName.toLowerCase()) !== -1) {
    //     return false;
    // }
  
    // if (typeof assignedFunction !== 'undefined'){
    //   ui.registerKeyboardInput(assignedFunction, state);
    // } else {
    //   // console.log(evt.code)
    
    // }
  
    switch(evt.code){  
      case 'KeyS':
        if (state == true){
          // Move player physics body left
          if (window.player && window.player.pbody) {
            window.player.pbody.state.loc.x -= 1;
          }
        }
      break;
      case 'KeyF':
        if (state == true){
          // Move player physics body right
          if (window.player && window.player.pbody) {
            window.player.pbody.state.loc.x += 1;
          }
        }
      break;
      case 'KeyE':
        if (state == true){
          // Apply forward impulse
          if (window.player && window.player.pbody && window.player.pbody.imp) {
            window.player.pbody.imp.z += 1000; // MAXIMUM POWER!
            // console.log("Applied forward impulse, new imp.z:", window.player.pbody.imp.z);
          }
        }
      break;
      case 'KeyD':
        if (state == true){
          // Apply backward impulse
          if (window.player && window.player.pbody && window.player.pbody.imp) {
            window.player.pbody.imp.z -= 1000; // MAXIMUM POWER!
            // console.log("Applied backward impulse, new imp.z:", window.player.pbody.imp.z);
          }
        }
      break;
      case 'Escape':
        if (state == true){
          // Check if we're in building placement mode
          if (window.buildingSystem && window.buildingSystem.isPlacing) {
            window.buildingSystem.cancelPlacement();
          } else if (document.getElementById('menu').style.display == 'none'){
            ui.showMenu(prevMenu);
          } else {
            ui.hideMenu();
          }
        }
      break;
      case 'F9':
        // scene explorer
        if (state == true){
          if (gfx.scene.debugLayer.isVisible())
            gfx.scene.debugLayer.hide();
          else
            gfx.scene.debugLayer.show();
        }       
      break;
      
      // Camera rotation controls
      case 'KeyQ':
        if (state == true && gfx.camera) {
          // Rotate camera left
          cameraRotationTarget.alpha -= 0.2;
        }
      break;
      case 'KeyE':
        if (state == true && gfx.camera) {
          // Rotate camera right
          cameraRotationTarget.alpha += 0.2;
        }
      break;
      case 'KeyR':
        if (state == true && gfx.camera) {
          // Rotate camera up
          cameraRotationTarget.beta = Math.max(0.1, cameraRotationTarget.beta - 0.2);
        }
      break;
      case 'KeyC':
        if (state == true && gfx.camera) {
          // Rotate camera down
          cameraRotationTarget.beta = Math.min(1.5, cameraRotationTarget.beta + 0.2);
        }
      break;
      case 'KeyV':
        if (state == true && gfx.camera) {
          // Reset camera to reasonable viewing angle
          ui.resetCameraView();
        }       
      break;
      case 'KeyB':
        if (state == true){
          // Open building menu
          if (window.hud && window.hud.showRadialMenu && window.hud.showSubMenu) {
            // console.log('🏗️ B key pressed - opening building menu');
            
            // First show the radial menu at the bottom center of the screen
            const rect = gfx.canvas.getBoundingClientRect();
            const centerX = rect.width / 2;
            const centerY = rect.height * 0.9; // Bottom of screen
            
            // Show the radial menu first
            window.hud.showRadialMenu(centerX, centerY, 'bottom');
            
            // Then navigate to the buildings submenu after a short delay
            setTimeout(() => {
              window.hud.showSubMenu("buildings", centerX, centerY);
            }, 100);
          } else {
            // console.warn('🏗️ HUD system not available for building menu');
          }
        }
      break;
    }

    //   // update key state
    //   // broadcast keystate change to network
    //   // if (tr.prevKeyState[key] != tr.self.keyState[key]) {
    //   //   // console.log(tr.self.keyState)
    //   //   var payload = makeMessage({type:"action"});
    //   //   // console.log(payload);
    //   //   net.send('tr_'+tr.self.world, payload);
    //   // }
  
    //   tr.prevKeyState[key] = tr.self.keyState[key];
    //   return true;
  }; // end keyInput

  ui.rightClick = function(e) {
    e.preventDefault();
    return false;
  };

  // Double-click detection system
  let lastClickTime = 0;
  let lastClickPosition = { x: 0, y: 0 };
  const DOUBLE_CLICK_DELAY = 300; // milliseconds
  const DOUBLE_CLICK_DISTANCE = 10; // pixels - how far apart clicks can be to count as double-click
  // Separate tracking for right mouse button double-click
  let lastRightClickTime = 0;
  let lastRightClickPosition = { x: 0, y: 0 };
  
  // RMB pan state (anchor-based, matches touch pan)
  let rmbPanActive = false;
  let rmbLastScreen = { x: 0, y: 0 };

  // Handle pointer events (mouse clicks, touch)
  ui.handlePointer = function(e) {
    e.preventDefault();
    
    // Get pointer position
    const rect = gfx.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // RMB pan (hold RMB to pan like touch)
    if (e.pointerType === 'mouse' && e.type === 'pointerdown' && e.button === 2) {
      // Detect double right-click to clear selection (and block RMB pan)
      const currentTime = Date.now();
      const distance = Math.sqrt((x - lastRightClickPosition.x) ** 2 + (y - lastRightClickPosition.y) ** 2);
      if (currentTime - lastRightClickTime < DOUBLE_CLICK_DELAY && distance < DOUBLE_CLICK_DISTANCE) {
        if (window.player && window.player.clearSelection) window.player.clearSelection();
        lastRightClickTime = 0;
        lastRightClickPosition = { x: 0, y: 0 };
        // Prevent RMB pan from starting on this double-click
        e.preventDefault();
        return;
      }
      lastRightClickTime = currentTime;
      lastRightClickPosition = { x, y };
      rmbPanActive = true;
      rmbLastScreen.x = e.clientX;
      rmbLastScreen.y = e.clientY;
    } else if (e.pointerType === 'mouse' && e.type === 'pointermove' && rmbPanActive) {
      if (gfx && gfx.camera && gfx.canvas && gfx.cameraTarget) {
        const cam = gfx.camera;
        const rectC = gfx.canvas.getBoundingClientRect();
        const pixelsToWorld = (2 * (cam.radius || 60) * Math.tan((cam.fov || 0.8)/2)) / Math.max(1, rectC.height);
        const screenDx = (e.clientX - rmbLastScreen.x);
        const screenDy = (e.clientY - rmbLastScreen.y);
        rmbLastScreen.x = e.clientX;
        rmbLastScreen.y = e.clientY;
        const toTarget = gfx.cameraTarget.position.subtract(cam.position).normalize();
        const groundForward = new BABYLON.Vector3(toTarget.x, 0, toTarget.z);
        if (groundForward.lengthSquared() > 1e-6) {
          groundForward.normalize();
          const groundRight = new BABYLON.Vector3(-groundForward.z, 0, groundForward.x);
          const wx = groundRight.x * screenDx * pixelsToWorld + groundForward.x * screenDy * pixelsToWorld;
          const wz = groundRight.z * screenDx * pixelsToWorld + groundForward.z * screenDy * pixelsToWorld;
          const panSens = (window.touch && touch.getConfig ? (touch.getConfig().panSensitivity || 15) : 15);
          if (!window.cameraAnchor) window.cameraAnchor = gfx.cameraTarget.position.clone();
          window.cameraAnchor.x += wx * panSens;
          window.cameraAnchor.z += wz * panSens;
        }
      }
    } else if (e.pointerType === 'mouse' && e.type === 'pointerup' && e.button === 2) {
      rmbPanActive = false;
    }

    // Track RMB state for field position checking (mouse-only and gated)
    if (window.enableRmbCameraDrag && e.pointerType === 'mouse' && e.type === 'pointerdown' && e.button === 2) {
      rmbDown = true;
      lastRmbPosition = { x, y };
      // console.log('🎯 RMB DOWN detected during event:', e.type, 'lasso active:', window.lassoSelection?.isSelectionActive());
    } else if (window.enableRmbCameraDrag && e.pointerType === 'mouse' && e.type === 'pointerup' && e.button === 2) {
      rmbDown = false;
      // console.log('🎯 RMB UP detected during event:', e.type, 'lasso active:', window.lassoSelection?.isSelectionActive());
    } else if (window.enableRmbCameraDrag && e.pointerType === 'mouse' && e.type === 'pointermove' && rmbDown) {
      // Update position while RMB is held
      lastRmbPosition = { x, y };
      // console.log('🎯 RMB MOVE detected during event:', e.type, 'lasso active:', window.lassoSelection?.isSelectionActive());
    }
    
    // Handle LMB selection system move and up events
    if (e.type === 'pointermove') {
      // Skip lasso while placing buildings
      if (!(window.buildingSystem && window.buildingSystem.isPlacing)) {
        // Handle LMB move for selection (button is not set during move events)
        if (window.lassoSelection && window.lassoSelection.handleLmbMove) {
          window.lassoSelection.handleLmbMove(x, y);
        }
      }
    } else if (e.type === 'pointerup' && e.button === 0) {
      // Handle LMB up for selection (skip during building placement)
      if (!(window.buildingSystem && window.buildingSystem.isPlacing)) {
        if (window.lassoSelection && window.lassoSelection.handleLmbUp) {
          window.lassoSelection.handleLmbUp(x, y);
        }
      }
    }
    
    // Handle LMB selection system FIRST (before double-click detection)
    if (e.type === 'pointerdown' && e.button === 0) { // Left click only
      if (!(window.buildingSystem && window.buildingSystem.isPlacing)) {
        if (window.lassoSelection && window.lassoSelection.handleLmbDown) {
          window.lassoSelection.handleLmbDown(x, y, e);
        }
      }
    }
    
    // Handle double-click detection for left mouse button (mouse only; touch handled in touch.js)
    if (e.pointerType === 'mouse' && e.type === 'pointerdown' && e.button === 0) { // Left click only
      const currentTime = Date.now();
      const distance = Math.sqrt((x - lastClickPosition.x) ** 2 + (y - lastClickPosition.y) ** 2);
      
      // Check if this is a double-click
      if (currentTime - lastClickTime < DOUBLE_CLICK_DELAY && distance < DOUBLE_CLICK_DISTANCE) {
        // Double-click detected! Trigger special abilities on selected units
        const pickResult = gfx.scene.pick(x, y);
        const worldPos = pickResult.hit ? pickResult.pickedPoint : null;
        if (window.ui && window.ui.triggerSpecialAbilityAt) {
          window.ui.triggerSpecialAbilityAt(worldPos);
        }
        
        // Reset double-click detection
        lastClickTime = 0;
        lastClickPosition = { x: 0, y: 0 };
        return;
      }
      
      // Update last click info for next potential double-click
      lastClickTime = currentTime;
      lastClickPosition = { x, y };
      
      // Check if we clicked on a unit first (before terrain)
      // But only if we're not in the middle of a selection
      // console.log('🎯 UI: Checking for unit click, lasso active:', window.lassoSelection?.isSelectionActive());
      
      if (!window.lassoSelection || !window.lassoSelection.isSelectionActive()) {
        // Handle unit clicking - find unit at click position
        // console.log('🎯 UI: Lasso not active, checking for unit at position:', x, y);
        const unit = findUnitAtPosition(x, y);
        if (unit) {
          // Single click - select just this unit
          if (window.player && window.player.selectUnit) {
            window.player.clearSelection();
            window.player.selectUnit(unit);
            // console.log(`🎯 UI: Selected unit ${unit.name || unit.type}`);
          }
        } else {
          // console.log('🎯 UI: No unit found at click position');
        }
      } else {
        // console.log('🎯 UI: Lasso is active, skipping unit click');
      }
    }
    
    // Disable RMB double-click radial menu to avoid gesture interference
    
    // Check if the lasso system should handle this click (i.e., it was a drag selection)
    if (window.lassoSelection && window.lassoSelection.shouldHandleClick && window.lassoSelection.shouldHandleClick()) {
      // console.log('🎯 Lasso system handled this as a drag selection, skipping field click');
      return;
    }
    
    // Convert screen coordinates to world coordinates
    // All models are non-pickable so ray will pass through to terrain
    const pickResult = gfx.scene.pick(x, y);
    // If event is from touch synthetic drag or selection, suppress terrain click -> no move orders
    if (e.suppressTerrainClick) {
      return;
    }
    
    // console.log('🎯 Field click debug:', { 
    //   hit: pickResult.hit, 
    //   meshName: pickResult.pickedMesh?.name,
    //   button: e.button,
    //   type: e.type,
    //   fxAvailable: !!window.fx,
    //   createExplosionAvailable: !!(window.fx && window.fx.createExplosion)
    // });
    
    if (pickResult.hit) {
      // Handle different types of clicks
      if (e.type === 'pointerup' && e.button === 0) {
        // Left click - could be for placing tiles, selecting objects, etc.
        
        // If clicking on terrain, get precise tile coordinates
        if (pickResult.pickedMesh.name.includes('Mesh')) {
          // Get the world position where we clicked
          const worldPos = pickResult.pickedPoint;
          
          // Convert world position to tile coordinates
          const tileX = Math.floor(worldPos.x);
          const tileZ = Math.floor(worldPos.z);
          
          // console.log('🎯 Terrain hit:', { worldPos, tileX, tileZ });
          
          // Handle field actions based on click type
          if (e.button === 0) { // Left click
            // console.log('🎯 Left click on terrain, attempting explosion...');
            // Single click - create explosion at clicked position
            if (window.fx && window.fx.createExplosion) {
              // Small explosion for clicks - scale 0.3 for tiny effect
              // window.fx.createExplosion(worldPos, 0.123);
              // console.log(`💥 Field action: Small explosion at (${tileX}, ${tileZ})`);
              
              // Make selected units walk to the explosion location
              if (window.player && window.player.getSelectedUnits) {
                const selectedUnits = window.player.getSelectedUnits();
                if (selectedUnits.length > 0) {
                  // console.log(`🚶 Making ${selectedUnits.length} selected units walk to explosion location`);
                  
                  // Create a visual target marker at the explosion location
                  if (window.gfx && window.gfx.scene) {
                    createTargetMarker(worldPos);
                  }
                  
                  // Apply walk behavior to each selected unit
                  selectedUnits.forEach(unit => {
                    if (window.behaviorManager && unit) {
                      // Create target point slightly offset from explosion center for natural spread
                      const offsetX = worldPos.x + (Math.random() - 0.5) * 2; // Random spread ±1 unit
                      const offsetZ = worldPos.z + (Math.random() - 0.5) * 2;
                      const targetPoint = { x: offsetX, z: offsetZ };
                      
                      // console.log(`🚶 Setting walk behavior for unit ${unit.name || unit.type} to (${targetPoint.x.toFixed(1)}, ${targetPoint.z.toFixed(1)})`);
                      
                      window.behaviorManager.setBehavior(unit, 'walk', { 
                        targetPoint: targetPoint,
                        walkSpeed: 6.0 // Normal walking speed
                      });
                      
                      // console.log(`🚶 Unit ${unit.name || unit.type} walking to (${targetPoint.x.toFixed(1)}, ${targetPoint.z.toFixed(1)})`);
                    } else {
                      // console.warn(`⚠️ Cannot set behavior for unit:`, { 
                      //   hasBehaviorManager: !!window.behaviorManager, 
                      //   unit: unit,
                      //   unitPhysics: unit?.pb,
                      //   unitState: unit?.pb?.state
                      // });
                    }
                  });
                } else {
                  // console.log('🚶 No units selected, skipping walk behavior');
                }
              }
            } else {
              // console.warn('💥 FX system not available for explosion');
            }
          }
          
          // Get the specific tile at these coordinates
          if (liveField && liveField.tiles) {
            const tileIndex = tileZ * liveField.width + tileX;
            if (liveField.tiles[tileIndex]) {
              const tile = liveField.tiles[tileIndex];
              
              // Now you can modify this tile!
              // Example: tile.type = 25; // Change to dirt
              // Example: tile.type = 5;  // Change to grass
            }
          }
        }
      }
      
      // Handle right click for moving camera target (mouse-only and gated)
      if (window.enableRmbCameraDrag && e.pointerType === 'mouse' && e.type === 'pointerdown' && e.button === 2) { // Right mouse button
        // Check if building system is active - if so, let it handle the event
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          return; // Let building system handle this
        }
        
        if (pickResult.hit) {
          // Prevent default only for our custom right-click action
          e.preventDefault();
          
          // Get world position where we right-clicked
          const worldPos = pickResult.pickedPoint;
          
          // Set target destination for smooth camera movement
          if (gfx.cameraTarget) {
            // Use the RMB field position for smooth camera movement instead of instant teleport
            if (rmbFieldPosition.length() > 0) {
              // Set the camera movement target to the RMB field position
              cameraMovementTarget = new BABYLON.Vector3(rmbFieldPosition.x, gfx.cameraTarget.position.y, rmbFieldPosition.z);
              // console.log(`🎯 Camera moving to RMB position: ${cameraMovementTarget.toString()}`);
            } else {
              // Fallback to clicked position if no RMB field position
              cameraMovementTarget = new BABYLON.Vector3(worldPos.x, gfx.cameraTarget.position.y, worldPos.z);
              // console.log(`🎯 Camera moving to clicked position: ${cameraMovementTarget.toString()}`);
            }
          }
          
          // Start player drag system
          playerDragActive = true;
          playerDragStart = {
            x: e.clientX,
            y: e.clientY,
            worldX: worldPos.x,
            worldZ: worldPos.z
          };
          playerDragVelocity = { x: 0, z: 0 };
        }
      } else if (window.enableRmbCameraDrag && e.pointerType === 'mouse' && e.type === 'pointermove' && playerDragActive) {
        // Check if building system is active - if so, let it handle the event
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          return; // Let building system handle this
        }
        
        // Handle drag movement for momentum-based player movement
        const worldPos = ui.getWorldPositionFromScreen(e.clientX, e.clientY);
        if (worldPos && window.player && window.player.pbody) {
          // Calculate drag velocity based on mouse movement
          const dragDeltaX = e.clientX - playerDragStart.x;
          const dragDeltaY = e.clientY - playerDragStart.y;
          
          // Convert screen delta to world velocity (adjust sensitivity as needed)
          const dragSensitivity = 0.05; // Increased sensitivity for more responsive movement
          // Fix the coordinate mapping: screen right = world right, screen down = world forward
          playerDragVelocity.x = dragDeltaX * dragSensitivity; // Remove the negative sign
          playerDragVelocity.z = dragDeltaY * dragSensitivity; // Remove the negative sign
          
          // Apply velocity to player physics body CONTINUOUSLY during drag
          if (window.player.pbody.imp) {
            // Add to existing impulse instead of replacing it
            window.player.pbody.imp.x += playerDragVelocity.x;
            window.player.pbody.imp.z += playerDragVelocity.z;
            
            // Log the impulse being applied
            // console.log('🎯 Drag impulse applied:', { x: playerDragVelocity.x, z: playerDragVelocity.z });
          }
        }
      } else if (window.enableRmbCameraDrag && e.pointerType === 'mouse' && e.type === 'pointerup' && e.button === 2) {
        // Check if building system is active - if so, let it handle the event
        if (window.buildingSystem && window.buildingSystem.isPlacing) {
          return; // Let building system handle this
        }
        
        // Right mouse button released
        if (playerDragActive) {
          // Check if this was a drag or just a click
          const dragDistance = Math.sqrt(
            Math.pow(e.clientX - playerDragStart.x, 2) + 
            Math.pow(e.clientY - playerDragStart.y, 2)
          );
          
          if (dragDistance < 5) {
            // This was just a click (not a drag) - clear unit selection
            if (window.player && window.player.selectedUnits) {
              window.player.selectedUnits = [];
              // console.log('🎯 Right-click: Cleared unit selection');
            }
                             } else {
                     // This was a drag - apply final momentum
                     if (window.player && window.player.pbody && window.player.pbody.imp) {
                       // Apply the accumulated drag velocity as final impulse with more boost
                       const finalBoost = 5; // Increased from 2 to 5 for more noticeable movement
                       window.player.pbody.imp.x = playerDragVelocity.x * finalBoost;
                       window.player.pbody.imp.z = playerDragVelocity.z * finalBoost;
                      //  console.log('🎯 Right-click drag: Applied final momentum boost', { 
                      //    original: playerDragVelocity, 
                      //    boosted: { x: playerDragVelocity.x * finalBoost, z: playerDragVelocity.z * finalBoost } 
                      //  });
                     }
                   }
          
          // Reset drag state
          playerDragActive = false;
          playerDragStart = { x: 0, y: 0, worldX: 0, worldZ: 0 };
          playerDragVelocity = { x: 0, z: 0 };
        }
      } else {
        // Clicked on empty space
        if (e.type === 'pointerdown') {
          // Empty space clicked
        }
      }
    }
  };

  // Smooth camera rotation system for quick, responsive control
  let cameraRotationTarget = { alpha: 0, beta: 0 };
  let cameraRotationSpeed = 0.25; // How fast camera moves to target (0.25 = much faster and responsive)
  // Only animate camera after explicit user input (wheel/gesture)
  let cameraHasBeenNudged = false;
  
  // Camera momentum system
  let cameraVelocity = { alpha: 0, beta: 0, radius: 0 };
  let cameraMomentum = 0.9; // keep most of the momentum for longer glides
  let cameraDamping = 0.995; // very light damping to avoid immediate nullification
  
  // Player drag momentum system
  let playerDragActive = false;
  let playerDragStart = { x: 0, y: 0, worldX: 0, worldZ: 0 };
  let playerDragVelocity = { x: 0, z: 0 };
  let playerDragMomentum = 0.85; // How much momentum to keep (0.85 = 85% momentum)
  let playerDragDamping = 0.98; // How quickly momentum fades
  
  // Camera movement target system
  let cameraMovementTarget = null; // Target position to move camera to
  let cameraMovementSpeed = 0.02; // How fast to move towards target (0.02 = smooth movement)
  
  // RMB tracking system
  let rmbDown = false;
  let rmbLastCheck = 0;
  let rmbCheckThrottle = 39; // Check every 100ms (10 times per second)
  let lastRmbPosition = { x: 0, y: 0 };
  let rmbFieldPosition = new BABYLON.Vector3(0, 0, 0); // Track the 3D world position where RMB is pointing
  
  // Gate legacy RMB camera drag to mouse-only to avoid conflicts with touch gestures
  window.enableRmbCameraDrag = false;
  
    // Handle wheel events for camera rotation and zoom
  // Controls:
  // - Normal scroll wheel: Rotate camera horizontally (left/right)
  // - Right-click + scroll wheel: Zoom camera in/out
  // - Shift + scroll wheel: Zoom camera in/out (alternative method)
  ui.handleWheel = function(e) {
    // Only handle wheel events when we have a camera
    if (!gfx.camera || !gfx.camera.alpha) {
      return;
    }
    cameraHasBeenNudged = true;
    let INVERSEROT = -1;
    let INVERSEZOOM = 1;
    
    // Get wheel delta (positive = scroll up, negative = scroll down)
    const delta = e.deltaY;
    
    // Check if right mouse button OR shift key is held down
    if ((e.buttons && (e.buttons & 2) !== 0) || e.shiftKey) {
      // Right-click + scroll wheel OR Shift + scroll wheel = Camera zoom
      // Don't prevent default - let both zoom AND rotation happen!
      
      // Handle zoom manually
      const zoomSpeed = 0.085; // Adjust this for zoom sensitivity
      const zoomAmount = INVERSEZOOM*delta * zoomSpeed;
      
      // Add zoom velocity instead of directly changing radius (momentum-based zoom)
      if (gfx.camera.radius !== undefined) {
        cameraVelocity.radius += zoomAmount;
      }
      
      // Log for debugging (remove this in production)
      const zoomMethod = e.shiftKey ? "Shift + Wheel" : "Right-click + Wheel";
      // console.log(`${zoomMethod}: delta=${delta}, zoom amount=${zoomAmount.toFixed(4)}, radius=${gfx.camera.radius?.toFixed(4)}`);
    } else {
      // Normal scroll wheel = Camera rotation via momentum (no spring-back)
      e.preventDefault();
      const rotationAmount = 0.001;
      const impulse = INVERSEROT * delta * rotationAmount;
      const maxImpulse = 0.25;
      cameraVelocity.alpha += Math.max(-maxImpulse, Math.min(maxImpulse, impulse));
      // Keep beta fixed during wheel rotation
      cameraRotationTarget.beta = gfx.camera.beta;
    }
  };
  
  // Update camera rotation smoothly towards target (call this every frame)
  ui.updateCameraRotation = function() {
    if (!gfx.camera || !gfx.camera.alpha) {
      return;
    }
    // Leave camera exactly where it starts until the user interacts
    if (!cameraHasBeenNudged) {
      // Keep targets in sync with current camera so no drift accumulates
      cameraRotationTarget.alpha = gfx.camera.alpha;
      cameraRotationTarget.beta = gfx.camera.beta;
      return;
    }
    
    // Disable zoom→beta coupling to keep pinch/wheel from tilting the camera
    if (false) {
      // Calculate ideal beta based on zoom level
      // As you zoom out (larger radius), beta increases (look more upward)
      // As you zoom in (smaller radius), beta decreases (look more level)
      const minRadius = gfx.camera.lowerRadiusLimit || 15;
      const maxRadius = gfx.camera.upperRadiusLimit || 199;
      const currentRadius = gfx.camera.radius;
      
      // Normalize radius between 0 and 1
      const normalizedRadius = (currentRadius - minRadius) / (maxRadius - minRadius);
      
      // Beta range: 0.6 (looking down) to 1.1 (looking straight ahead)
      // INVERTED: minBeta = looking up (zoomed in), maxBeta = looking down (zoomed out)
      // const minBeta = 1.11; //min // Looking down (zoomed out)
      // const maxBeta = 0.88; //max // Looking up (zoomed in)
      const maxBeta = 1.11; //min // Looking down (zoomed out)
      const minBeta = 0.88; //max // Looking up (zoomed in)
      
      // Calculate target beta based on zoom (inverted)
      const targetBeta = minBeta - (normalizedRadius * (minBeta - maxBeta));
      
      // Only adjust beta target if we've already begun camera motion
      cameraRotationTarget.beta = BABYLON.Scalar.Lerp(cameraRotationTarget.beta, targetBeta, 0.4);
    }
    
    // Apply momentum-based camera movement
    // Keep alpha target synced to current to remove restoring force; only momentum drives alpha
    cameraRotationTarget.alpha = gfx.camera.alpha;
    // Calculate velocity towards target (beta only)
    const alphaDiff = cameraRotationTarget.alpha - gfx.camera.alpha; // zero
    const betaDiff = cameraRotationTarget.beta - gfx.camera.beta;
    
    // Add velocity towards target
    cameraVelocity.alpha += alphaDiff * cameraRotationSpeed;
    cameraVelocity.beta += betaDiff * cameraRotationSpeed;
    
    // Apply momentum (keep some of the previous velocity)
    cameraVelocity.alpha *= cameraMomentum;
    cameraVelocity.beta *= cameraMomentum;
    cameraVelocity.radius *= cameraMomentum;
    
    // Apply damping (gradually reduce velocity)
    cameraVelocity.alpha *= cameraDamping;
    cameraVelocity.beta *= cameraDamping;
    cameraVelocity.radius *= cameraDamping;
    
    // Move camera based on velocity
    gfx.camera.alpha += cameraVelocity.alpha;
    gfx.camera.beta += cameraVelocity.beta;
    
    // Apply zoom velocity and clamp to limits
    if (gfx.camera.radius !== undefined) {
      gfx.camera.radius += cameraVelocity.radius;
      gfx.camera.radius = Math.max(gfx.camera.lowerRadiusLimit, Math.min(gfx.camera.upperRadiusLimit, gfx.camera.radius));
    }
    
    // Clamp beta to prevent camera flipping
    gfx.camera.beta = Math.max(0.1, Math.min(1.5, gfx.camera.beta));
    
    // Smooth camera movement towards target position
    if (cameraMovementTarget && gfx.cameraTarget) {
      // Lerp camera target towards the movement target
      gfx.cameraTarget.position.x = BABYLON.Scalar.Lerp(gfx.cameraTarget.position.x, cameraMovementTarget.x, cameraMovementSpeed);
      gfx.cameraTarget.position.z = BABYLON.Scalar.Lerp(gfx.cameraTarget.position.z, cameraMovementTarget.z, cameraMovementSpeed);
      
      // Check if we're close enough to the target to stop moving
      const distance = BABYLON.Vector3.Distance(gfx.cameraTarget.position, cameraMovementTarget);
      if (distance < 0.1) {
        cameraMovementTarget = null; // Stop moving when we reach the target
        // console.log('🎯 Camera reached target position');
      }
    }
    
    // Check field position when RMB is held (throttled)
    if (rmbDown) {
      const currentTime = Date.now();
      if (currentTime - rmbLastCheck > rmbCheckThrottle) {
        ui.checkRmbFieldPosition();
        rmbLastCheck = currentTime;
      }
    }
  };
  
  // Sync rotation targets with current camera position (call this when camera is initialized)
  ui.syncCameraRotationTargets = function() {
    if (gfx.camera && gfx.camera.alpha !== undefined) {
      cameraRotationTarget.alpha = gfx.camera.alpha;
      
      // Set a reasonable default beta (not too high, not too low)
      // 0.6 = looking down, 0.9 = looking slightly down, 1.1 = looking straight ahead
      const defaultBeta = 0.6; // Looking slightly down (better for gameplay)
      
      // Only use current beta if it's reasonable, otherwise use default
      if (gfx.camera.beta >= 0.6 && gfx.camera.beta <= 1.1) {
        cameraRotationTarget.beta = gfx.camera.beta;
      } else {
        cameraRotationTarget.beta = defaultBeta;
        // Also fix the camera's current beta if it's way off
        gfx.camera.beta = defaultBeta;
      }
      
      // console.log('Camera rotation targets synced:', cameraRotationTarget);
    }
  };
  
  // Reset camera to a good viewing angle (call this if you get stuck looking down)
  ui.resetCameraView = function() {
    if (gfx.camera) {
      // Set reasonable viewing angles
      cameraRotationTarget.alpha = gfx.camera.alpha; // Keep current horizontal rotation
      cameraRotationTarget.beta = 1.0; // Look straight ahead
      
      // Immediately fix the camera if it's way off
      if (gfx.camera.beta < 0.5 || gfx.camera.beta > 1.3) {
        gfx.camera.beta = 0.6;
      }
      
      // console.log('Camera view reset to reasonable angle');
    }
  };

  // Touch-friendly camera nudges (exposed for gesture control)
  ui.nudgeRotation = function(deltaAlpha) {
    if (!gfx.camera) return;
    cameraHasBeenNudged = true;
    // Push rotation as momentum with clamp to avoid snap/bounce
    const maxImpulse = 0.2;
    const impulse = Math.max(-maxImpulse, Math.min(maxImpulse, deltaAlpha));
    cameraVelocity.alpha += impulse;
    // Sync target to current to avoid restoring force
    cameraRotationTarget.alpha = gfx.camera.alpha;
  };

  ui.nudgeZoom = function(deltaRadius) {
    if (!gfx.camera) return;
    if (typeof gfx.camera.radius !== 'number') return;
    cameraHasBeenNudged = true;
    cameraVelocity.radius += deltaRadius;
  };

  ui.nudgePan = function(deltaX, deltaZ) {
    if (!gfx.cameraTarget) return;
    cameraHasBeenNudged = true;
    // Directly move target to avoid fighting with touch controls
    gfx.cameraTarget.position.x += deltaX;
    gfx.cameraTarget.position.z += deltaZ;
    cameraMovementTarget = null;
  };
  
  // Check field position when RMB is held (throttled to avoid performance issues)
  ui.checkRmbFieldPosition = function() {
    if (!gfx.scene || !lastRmbPosition) return;
    
    // Convert screen coordinates to world coordinates
    const pickResult = gfx.scene.pick(lastRmbPosition.x, lastRmbPosition.y);
    
    if (pickResult.hit && pickResult.pickedMesh.name.includes('Mesh')) {
      // Get the world position where RMB is pointing
      const worldPos = pickResult.pickedPoint;
      
      // Convert world position to tile coordinates
      const tileX = Math.floor(worldPos.x);
      const tileZ = Math.floor(worldPos.z);
      
      // Get the specific tile at these coordinates
      if (window.liveField && window.liveField.tiles) {
        const tileIndex = tileZ * window.liveField.width + tileX;
        if (window.liveField.tiles[tileIndex]) {
          const tile = window.liveField.tiles[tileIndex];
          
          // Store the 3D world position in Vec3
          rmbFieldPosition.copyFrom(worldPos);
          
          // Log tile information (you can modify this to do whatever you want)
          // console.log(`🗺️ RMB HIT: Tile (${tileX}, ${tileZ}) - Type: ${tile.type}, Position: (${worldPos.x.toFixed(2)}, ${worldPos.z.toFixed(2)})`);
          // console.log(`📍 Stored Vec3: ${rmbFieldPosition.toString()}`);
          
          // You can add more logic here:
          // - Show tile info in HUD
          // - Highlight the tile
          // - Check if tile is buildable
          // - etc.
        }
      }
    }
  };
  
  // Find unit at screen position
  function findUnitAtPosition(screenX, screenY) {
    if (!window.gfx || !window.gfx.scene || !window.player || !window.player.units) return null;
    
    // Create picking ray
    const ray = window.gfx.scene.createPickingRay(
      screenX, 
      screenY, 
      BABYLON.Matrix.Identity(), 
      window.gfx.camera
    );
    
    // Check each unit for intersection
    let closestUnit = null;
    let closestDistance = Infinity;
    
    window.player.units.forEach(unit => {
      if (unit.mesh && unit.mesh.isPickable) {
        const pickResult = ray.intersectsMesh(unit.mesh);
        if (pickResult.hit && pickResult.distance < closestDistance) {
          closestUnit = unit;
          closestDistance = pickResult.distance;
        }
      }
    });
    
    return closestUnit;
  }
  
  // Create a visual target marker at the specified world position
  function createTargetMarker(worldPos) {
    if (!window.gfx || !window.gfx.scene) return;
    
    // Create a simple target marker (ring) at the explosion location
    const targetRing = BABYLON.MeshBuilder.CreateTorus("targetMarker", {
      diameter: 1.0,
      thickness: 0.1,
      tessellation: 16
    }, window.gfx.scene);
    
    // Position the marker at the explosion location
    targetRing.position.x = worldPos.x;
    targetRing.position.y = 0.1; // Slightly above ground
    targetRing.position.z = worldPos.z;
    
    // Create material for the target marker
    const markerMaterial = new BABYLON.StandardMaterial("targetMarkerMat", window.gfx.scene);
    markerMaterial.diffuseColor = new BABYLON.Color3(1, 0, 0); // Red color
    markerMaterial.emissiveColor = new BABYLON.Color3(0.5, 0, 0); // Glowing red
    markerMaterial.alpha = 0.8; // Semi-transparent
    
    targetRing.material = markerMaterial;
    targetRing.isPickable = false; // Don't interfere with clicking
    
    // Animate the marker (pulse and fade)
    let alpha = 0.8;
    let growing = false;
    
    const animateMarker = () => {
      if (growing) {
        alpha += 0.02;
        if (alpha >= 0.8) {
          alpha = 0.8;
          growing = false;
        }
      } else {
        alpha -= 0.02;
        if (alpha <= 0.2) {
          alpha = 0.2;
          growing = true;
        }
      }
      
      markerMaterial.alpha = alpha;
      
      // Continue animation
      requestAnimationFrame(animateMarker);
    };
    
    // Start the animation
    animateMarker();
    
    // Remove the marker after 3 seconds
    setTimeout(() => {
      if (targetRing && !targetRing.isDisposed()) {
        targetRing.dispose();
      }
    }, 3000);
    
    // console.log(`🎯 Created target marker at (${worldPos.x.toFixed(1)}, ${worldPos.z.toFixed(1)})`);
  }

  // Helper function to get world position from screen coordinates
  ui.getWorldPositionFromScreen = function(screenX, screenY) {
    if (!gfx.scene || !gfx.camera || !gfx.canvas) return null;
    
    // Convert from client/screen coordinates to canvas-local coordinates
    const rect = gfx.canvas.getBoundingClientRect();
    const localX = screenX - rect.left;
    const localY = screenY - rect.top;
    
    // Create picking ray from canvas-local coordinates
    const ray = gfx.scene.createPickingRay(
      localX, 
      localY, 
      BABYLON.Matrix.Identity(), 
      gfx.camera
    );
    
    // Pick against the ground plane (assuming Y=0)
    const groundPlane = new BABYLON.Plane(0, 1, 0, 0);
    const intersection = ray.intersectsPlane(groundPlane);
    
    if (intersection) {
      return intersection;
    }
    
    // Fallback: try to pick against the scene using canvas-local x/y
    const pickResult = gfx.scene.pick(localX, localY);
    if (pickResult.hit) {
      return pickResult.pickedPoint;
    }
    
    return null;
  };

  // Trigger unit special abilities at optional world position
  ui.triggerSpecialAbilityAt = function(worldPos) {
    if (!window.player || !window.player.getSelectedUnits || !window.behaviorManager) return;
    const units = window.player.getSelectedUnits();
    units.forEach(unit => {
      const type = unit.type || unit.name || '';
      if (/engineer/i.test(type)) {
        window.behaviorManager.setBehavior(unit, 'engineer_productivity_boost', {
          radius: 6,
          bonus: 1.5,
          duration: 7000,
          vfx: 'aura_blue'
        });
      } else if (/brigand/i.test(type)) {
        window.behaviorManager.setBehavior(unit, 'brigand_sprint', {
          speedMultiplier: 2.25,
          duration: 3000,
          vfx: 'speed_trail'
        });
      } else if (/monk/i.test(type)) {
        window.behaviorManager.setBehavior(unit, 'monk_stealth', {
          invisibility: true,
          duration: 5000,
          vfx: 'smoke_puff'
        });
      } else if (/wizard/i.test(type)) {
        window.behaviorManager.setBehavior(unit, 'wizard_cast', {
          targetPoint: worldPos ? { x: worldPos.x, z: worldPos.z } : null,
          spell: 'arc_blast',
          power: 1.5,
          vfx: 'spell_flash'
        });
      }
    });
  };

}(window.ui = window.ui || {}));



