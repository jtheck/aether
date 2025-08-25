




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

    const playerName = document.getElementById('player_b');
    playerName.innerHTML = pName;
    playerName.style.color = pColor;

    const playerTitle = document.getElementById('player_menu_title');
    playerTitle.innerHTML = pName;
    playerTitle.style.color = pColor;

  }


  ui.showMenu = function(menuId){
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
      // scene explorer
      case 'Escape':
        ui.hideMenu();
      break;
      case 'F9':
        if (state == true){
          if (gfx.scene.debugLayer.isVisible())
            gfx.scene.debugLayer.hide();
          else
            gfx.scene.debugLayer.show();
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

}(window.ui = window.ui || {}));



