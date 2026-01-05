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
  "#FFFFFF", // White
  "#FF0000", // Red
  "#0000FF", // Blue
  "#00FFFF", // Teal
  "#800080", // Purple
  "#FFFF00", // Yellow
  "#FFA500", // Orange
  "#008000", // Green
  "#FFB6C1", // Light Pink
  "#8A2BE2", // Violet
  "#D3D3D3", // Light Grey
  "#006400", // Dark Green
  "#A52A2A", // Brown
  "#00FF00", // Light Green
  "#696969", // Dark Grey
  "#FFC0CB"  // Pink
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

    // Set up menu button to show appropriate menu based on game state
    const menuButton = document.getElementById('menu_b');
    if (menuButton) {
      menuButton.onclick = function() {
        // Consider demo mode as menu scene (demo match is just a stub)
        const isMenuScene = !window.game && (!window.currentMatch || window.currentMatch.isDemo);
        console.log(`🎮 Menu button clicked - game: ${!!window.game}, currentMatch: ${!!window.currentMatch}, isDemo: ${window.currentMatch?.isDemo}, isMenuScene: ${isMenuScene}`);
        console.log('🎮 Current state:', { game: window.game, currentMatch: window.currentMatch });
        if (isMenuScene) {
          console.log('📋 Showing main_menu');
          ui.showMenu('main_menu');
        } else {
          console.log('📋 Showing ingame_menu');
          ui.showMenu('ingame_menu');
        }
      };
    }


    // Load saved player data from localStorage
    let pName = localStorage.getItem('playerName') || getRandomName();
    let pColor = localStorage.getItem('playerColor') || getRandomColor();
    let savedPlayerId = localStorage.getItem('playerId');
    
    // Generate player ID if not saved
    if (!savedPlayerId) {
      // Generate a unique ID (8 random hex characters)
      savedPlayerId = 'player-' + Math.random().toString(16).substring(2, 10);
      localStorage.setItem('playerId', savedPlayerId);
    }
    
    // Store player ID globally
    window.currentPlayerId = savedPlayerId;
    
    // Store name and color globally so the player can access it
    window.currentPlayerName = pName;
    window.currentPlayerColor = pColor;
    
    // Also store on player object if it exists
    if (window.player) {
      window.player.name = pName;
      window.player.color = pColor;
      if (!window.player.id || window.player.id === 'undefined' || window.player.id === 'player') {
        window.player.id = savedPlayerId;
      }
    }

    const playerName = document.getElementById('player_b');
    playerName.innerHTML = pName;
    playerName.style.color = pColor;

    const playerTitle = document.getElementById('player_menu_title');
    playerTitle.innerHTML = pName;
    playerTitle.style.color = pColor;
    
    // Set up name input field
    const nameInput = document.getElementById('nameInput');
    if (nameInput) {
      // Set initial name input value
      nameInput.value = pName;
      
      // Listen for name changes
      nameInput.addEventListener('input', function(e) {
        const newName = e.target.value.trim() || pName; // Use original name if empty
        
        // Update both player name locations
        if (playerName) {
          playerName.innerHTML = newName;
        }
        if (playerTitle) {
          playerTitle.innerHTML = newName;
        }
        
        // Update the player's name property
        if (window.player) {
          window.player.name = newName;
        }
        
        // Store the new name globally
        window.currentPlayerName = newName;
        
        // Save to localStorage
        try {
          localStorage.setItem('playerName', newName);
        } catch (e) {
          console.warn('Failed to save player name to localStorage:', e);
        }
        
        // Update lobby if we're in one
        if (window.Lobby && window.Lobby.currentLobby) {
          window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, window.Lobby.currentLobby);
        }
        
        // console.log('Player name updated to:', newName);
      });
    }
    
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
        
        // Store the new color globally
        window.currentPlayerColor = newColor;
        
        // Save to localStorage
        try {
          localStorage.setItem('playerColor', newColor);
        } catch (e) {
          console.warn('Failed to save player color to localStorage:', e);
        }
        
        // Update lobby if we're in one
        if (window.Lobby && window.Lobby.currentLobby) {
          window.Lobby.updateLobbyRoomUI(window.Lobby.currentGameType, window.Lobby.currentLobby);
        }
        
        // console.log('Player color updated to:', newColor);
      });
    }

    // Add lobby UI elements after existing menu setup
    ui.init = function() {
      // ... existing init code ...
      
      // NEW: Add 1v1 Quick Match functionality
      setupMultiplayerUI();
      
      // ... rest of existing init ...
    };
    
    // NEW: Multiplayer UI setup
    function setupMultiplayerUI() {
      // Create 1v1 lobby with dynamic lobby list
      const onevsoneLobby = document.getElementById('onevsone_lobby');
      if (onevsoneLobby) {
        onevsoneLobby.innerHTML = `
          <div class="lobby-header">
            <h2>1v1 Battle Lobbies</h2>
            <p>Choose a lobby or create your own!</p>
            <div class="lobby-controls">
              <button id="refresh-lobbies-btn" class="control-btn">🔄 Refresh Lobbies</button>
              <button id="create-lobby-btn" class="control-btn primary">➕ Create New Lobby</button>
            </div>
          </div>
          
          <div class="lobby-content">
            <div class="lobbies-list" id="lobbies-list">
              <div class="no-lobbies-message">
                <p>No lobbies available. Click Refresh to find games!</p>
                <p>Or create your own lobby to challenge others.</p>
              </div>
            </div>
            
            <div class="lobby-chat-section" id="lobby-chat-section">
              <h3>Lobby Chat</h3>
              <div class="chat-messages" id="lobby-chat-messages"></div>
              <input type="text" id="chat-input" placeholder="Chat with players..." maxlength="100">
              <button id="send-chat-btn">Send</button>
            </div>
            
            <div class="lobby-actions">
              <button id="back-to-main" class="secondary-button">← Back to Main Menu</button>
            </div>
          </div>
        `;
        
        // Lobby controls
        const refreshBtn = document.getElementById('refresh-lobbies-btn');
        if (refreshBtn) {
          refreshBtn.addEventListener('click', refreshAvailableLobbies);
          refreshBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            refreshAvailableLobbies();
          });
        }
        
        const createBtn = document.getElementById('create-lobby-btn');
        if (createBtn) {
          createBtn.addEventListener('click', createNewLobby);
          createBtn.addEventListener('touchstart', (e) => {
            e.preventDefault();
            createNewLobby();
          });
        }
        
        // Back button
        const backBtn = document.getElementById('back-to-main');
        if (backBtn) {
          backBtn.addEventListener('click', () => {
            ui.showMenu('main_menu');
            if (window.net && window.net.disconnect) {
              window.net.disconnect();
            }
          });
        }
        
        // Setup chat (same as before)
        setupLobbyChat();
        
        // Join global lobby list broadcast
        if (window.net && window.net.p2p) {
          window.net.p2p.joinBroadcast('aether-lobby-list');
        }
        
        // Initial lobby refresh
        refreshAvailableLobbies();
        
        // Listen for lobby updates
        if (window.net) {
          const originalOnBroadcast = window.net.onBroadcastMessage;
          window.net.onBroadcastMessage = function(data) {
            originalOnBroadcast.call(this, data);
            
            if (data.type === 'lobby_list') {
              updateLobbyList(data.lobbies);
            } else if (data.type === 'lobby_update') {
              updateSingleLobby(data.lobby);
            } else if (data.type === 'lobby_chat') {
              addChatMessage(data.message, data.from, data.timestamp);
            }
          };
        }
      }
      
      // Setup other lobbies similarly...
      setupOtherLobbies();
    };
    
    // Refresh available lobbies
    function refreshAvailableLobbies() {
      const refreshBtn = document.getElementById('refresh-lobbies-btn');
      const lobbiesList = document.getElementById('lobbies-list');
      
      if (refreshBtn) refreshBtn.disabled = true;
      if (lobbiesList) lobbiesList.innerHTML = '<p class="loading">Loading lobbies...</p>';
      
      // Request lobby list from server
      if (window.net && window.net.p2p) {
        window.net.p2p.broadcast({
          type: 'request_lobby_list',
          gameType: 'onevsone',
          from: window.net.getStatus().localPlayerId || 'anonymous'
        }, 'aether-lobby-list');
      }
      
      // Fallback: timeout after 3s
      setTimeout(() => {
        if (refreshBtn) refreshBtn.disabled = false;
      }, 3000);
    };
    
    // Update lobby list display
    function updateLobbyList(lobbies) {
      const lobbiesList = document.getElementById('lobbies-list');
      const refreshBtn = document.getElementById('refresh-lobbies-btn');
      
      if (!lobbiesList) return;
      
      if (refreshBtn) refreshBtn.disabled = false;
      
      if (!lobbies || lobbies.length === 0) {
        lobbiesList.innerHTML = `
          <div class="no-lobbies-message">
            <p>No lobbies available right now.</p>
            <p>Click "Create New Lobby" to start your own game!</p>
          </div>
        `;
        return;
      }
      
      let lobbyHTML = '<div class="lobbies-grid">';
      
      lobbies.forEach(lobby => {
        const playerCount = lobby.players ? lobby.players.length : 0;
        const maxPlayers = lobby.maxPlayers || 2;
        const isFull = playerCount >= maxPlayers;
        const pingClass = getPingClass(lobby.ping || 0);
        
        lobbyHTML += `
          <div class="lobby-card ${isFull ? 'full' : ''}" data-lobby="${lobby.id}">
            <div class="lobby-header">
              <h3>${lobby.name || `Lobby #${lobby.id.substring(0, 6)}`}</h3>
              <span class="ping ${pingClass}">${lobby.ping || '?'}ms</span>
            </div>
            
            <div class="lobby-info">
              <p><strong>Map:</strong> ${lobby.map || 'Random'}</p>
              <p><strong>Players:</strong> ${playerCount}/${maxPlayers}</p>
              <p><strong>Host:</strong> ${lobby.hostName || lobby.hostId?.substring(0, 8) || 'Unknown'}</p>
              ${lobby.password ? '<p><i>Password protected</i></p>' : ''}
            </div>
            
            <div class="lobby-players">
              ${lobby.players ? lobby.players.map(player => `
                <span class="player-slot ${player.id === window.net?.getStatus()?.localPlayerId ? 'you' : ''}">
                  ${player.id === window.net?.getStatus()?.localPlayerId ? 'You' : player.name?.substring(0, 8) || player.id?.substring(0, 8) || '?'}
                </span>
              `).join('') : '<span class="empty-slot">-</span>'}
            </div>
            
            <div class="lobby-actions">
              ${isFull ? 
                '<span class="status full">Full</span>' : 
                `<button class="join-btn" data-lobby="${lobby.id}">Join Lobby</button>`
              }
            </div>
          </div>
        `;
      });
      
      lobbyHTML += '</div>';
      lobbiesList.innerHTML = lobbyHTML;
      
      // Add event listeners to join buttons
      document.querySelectorAll('.join-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const lobbyId = e.target.dataset.lobby;
          joinLobby(lobbyId);
        });
        
        btn.addEventListener('touchstart', (e) => {
          e.preventDefault();
          const lobbyId = e.target.dataset.lobby;
          joinLobby(lobbyId);
        });
      });
    };
    
    // Update single lobby info
    function updateSingleLobby(lobby) {
      const lobbyCard = document.querySelector(`[data-lobby="${lobby.id}"]`);
      if (!lobbyCard) return;
      
      // Update player count and slots
      const playerCountEl = lobbyCard.querySelector('.lobby-info p:nth-child(2)');
      const playersEl = lobbyCard.querySelector('.lobby-players');
      
      if (playerCountEl) {
        playerCountEl.innerHTML = `<strong>Players:</strong> ${lobby.players.length}/${lobby.maxPlayers}`;
      }
      
      if (playersEl) {
        playersEl.innerHTML = lobby.players.map(player => `
          <span class="player-slot ${player.id === window.net?.getStatus()?.localPlayerId ? 'you' : ''}">
            ${player.id === window.net?.getStatus()?.localPlayerId ? 'You' : player.name?.substring(0, 8) || player.id?.substring(0, 8) || '?'}
          </span>
        `).join('');
      }
      
      // Update full status
      const actionsEl = lobbyCard.querySelector('.lobby-actions');
      const isFull = lobby.players.length >= (lobby.maxPlayers || 2);
      
      if (actionsEl) {
        if (isFull) {
          actionsEl.innerHTML = '<span class="status full">Full</span>';
        } else {
          actionsEl.innerHTML = `<button class="join-btn" data-lobby="${lobby.id}">Join Lobby</button>`;
          
          // Add event listener
          actionsEl.querySelector('.join-btn').addEventListener('click', (e) => {
            joinLobby(lobby.id);
          });
        }
      }
      
      // Update card class
      if (isFull) {
        lobbyCard.classList.add('full');
      } else {
        lobbyCard.classList.remove('full');
      }
    };
    
    // Join a specific lobby
    function joinLobby(lobbyId) {
      const lobbyCard = document.querySelector(`[data-lobby="${lobbyId}"]`);
      const joinBtn = lobbyCard ? lobbyCard.querySelector('.join-btn') : null;
      
      if (joinBtn) joinBtn.disabled = true;
      
      // Leave current lobby if joined
      if (window.net && window.net.p2p && window.net.currentLobby) {
        window.net.p2p.leaveLobby(window.net.currentLobby);
      }
      
      // Join the selected lobby
      if (window.net && window.net.p2p) {
        window.net.p2p.joinMatchLobby(lobbyId);
        window.net.currentLobby = lobbyId;
        
        // Update UI
        const statusEl = document.getElementById('lobby-status');
        if (statusEl) {
          statusEl.textContent = `Joining lobby ${lobbyId.substring(0, 8)}...`;
        }
        
        // Listen for connection status
        const statusInterval = setInterval(() => {
          const status = window.net.getStatus();
          if (status.isConnected && status.peers.length > 0) {
            // Successfully joined!
            statusEl.textContent = `Joined ${lobbyId.substring(0, 8)}! Game starting...`;
            
            setTimeout(() => {
              document.getElementById('menu').style.display = 'none';
              startMultiplayerGame('onevsone');
            }, 2000);
            
            clearInterval(statusInterval);
          } else if (status.reconnectAttempts > 3) {
            statusEl.textContent = 'Failed to join lobby. Try another!';
            if (joinBtn) joinBtn.disabled = false;
            clearInterval(statusInterval);
          }
        }, 500);
        
        // Timeout after 10s
        setTimeout(() => {
          if (joinBtn) joinBtn.disabled = false;
          statusEl.textContent = 'Join timed out. Try again!';
          clearInterval(statusInterval);
        }, 10000);
      }
    };
    
    // Create new lobby
    function createNewLobby() {
      const lobbyName = prompt('Enter lobby name:', `My 1v1 Lobby - ${Date.now()}`);
      if (!lobbyName) return;
      
      const mapName = prompt('Choose map:', 'Random');
      const isPasswordProtected = confirm('Password protect this lobby?');
      const password = isPasswordProtected ? prompt('Enter password:') : null;
      
      if (!lobbyName) return;
      
      // Create lobby via broadcast
      if (window.net && window.net.p2p) {
        const lobbyData = {
          type: 'create_lobby',
          gameType: 'onevsone',
          id: generateLobbyId(),
          name: lobbyName,
          map: mapName,
          hostId: window.net.getStatus().localPlayerId || 'host',
          hostName: window.player?.name || 'Host',
          maxPlayers: 2,
          players: [window.net.getStatus().localPlayerId],
          password: password ? true : false,
          timestamp: Date.now()
        };
        
        window.net.p2p.broadcast(lobbyData, 'aether-lobby-list');
        
        // Update UI
        const statusEl = document.getElementById('lobby-status');
        if (statusEl) {
          statusEl.textContent = `Created lobby: ${lobbyName}`;
        }
        
        // Join own lobby
        joinLobby(lobbyData.id);
      }
    };
    
    // Generate unique lobby ID
    function generateLobbyId() {
      return 'lobby-' + Math.random().toString(36).substring(2, 10) + 
             '-' + Date.now().toString(36).substring(2, 8);
    };
    
    // Get ping class for display
    function getPingClass(ping) {
      if (ping < 50) return 'excellent';
      if (ping < 100) return 'good';
      if (ping < 150) return 'fair';
      return 'poor';
    };
    
    // Updated CSS for lobby cards
    const lobbyCardStyles = `
      .lobbies-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 15px;
        margin: 20px 0;
      }
      
      .lobby-card {
        background: white;
        border: 2px solid #e0e0e0;
        border-radius: 12px;
        padding: 15px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        transition: all 0.3s ease;
      }
      
      .lobby-card:hover {
        border-color: #4CAF50;
        box-shadow: 0 4px 16px rgba(76,175,80,0.2);
        transform: translateY(-2px);
      }
      
      .lobby-card.full {
        opacity: 0.6;
        border-color: #f44336;
      }
      
      .lobby-card.full:hover {
        transform: none;
        border-color: #f44336;
      }
      
      .lobby-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 10px;
      }
      
      .lobby-header h3 {
        margin: 0;
        color: #333;
        font-size: 16px;
      }
      
      .ping {
        font-size: 12px;
        padding: 2px 6px;
        border-radius: 10px;
        font-weight: bold;
      }
      
      .ping.excellent { background: #4CAF50; color: white; }
      .ping.good { background: #8BC34A; color: white; }
      .ping.fair { background: #FF9800; color: white; }
      .ping.poor { background: #f44336; color: white; }
      
      .lobby-info p {
        margin: 5px 0;
        font-size: 14px;
        color: #666;
      }
      
      .lobby-players {
        display: flex;
        gap: 5px;
        margin: 10px 0;
        flex-wrap: wrap;
      }
      
      .player-slot {
        display: inline-block;
        padding: 4px 8px;
        background: #f0f0f0;
        border-radius: 12px;
        font-size: 12px;
        border: 1px solid #ddd;
      }
      
      .player-slot.you {
        background: #4CAF50;
        color: white;
        border-color: #4CAF50;
        font-weight: bold;
      }
      
      .empty-slot {
        color: #999;
        font-style: italic;
      }
      
      .lobby-actions {
        text-align: center;
        margin-top: 10px;
      }
      
      .join-btn {
        background: linear-gradient(45deg, #4CAF50, #45a049);
        color: white;
        border: none;
        padding: 8px 16px;
        border-radius: 20px;
        cursor: pointer;
        font-size: 14px;
        transition: all 0.2s ease;
      }
      
      .join-btn:hover {
        background: linear-gradient(45deg, #45a049, #4CAF50);
        transform: scale(1.05);
      }
      
      .join-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }
      
      .status.full {
        background: #f44336;
        color: white;
        padding: 8px 16px;
        border-radius: 20px;
        font-size: 14px;
        font-weight: bold;
      }
      
      .no-lobbies-message {
        text-align: center;
        padding: 40px 20px;
        color: #666;
      }
      
      .no-lobbies-message p {
        margin: 10px 0;
        font-size: 16px;
      }
      
      .loading {
        text-align: center;
        padding: 20px;
        color: #666;
        font-style: italic;
      }
      
      .lobby-controls {
        display: flex;
        gap: 10px;
        justify-content: center;
        margin: 15px 0;
      }
      
      .control-btn {
        padding: 8px 16px;
        border: 1px solid #ddd;
        background: white;
        border-radius: 20px;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .control-btn.primary {
        background: linear-gradient(45deg, #4CAF50, #45a049);
        color: white;
        border-color: #4CAF50;
      }
      
      .control-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      }
      
      /* Mobile responsiveness */
      @media (max-width: 480px) {
        .lobbies-grid {
          grid-template-columns: 1fr;
          gap: 10px;
        }
        
        .lobby-card {
          padding: 12px;
        }
        
        .lobby-header h3 {
          font-size: 14px;
        }
        
        .lobby-info p {
          font-size: 13px;
        }
        
        .control-btn {
          padding: 10px 12px;
          font-size: 14px;
        }
      }
    `;
    
    // Append updated styles
    const existingStyles = document.getElementById('lobby-styles');
    if (existingStyles) {
      existingStyles.textContent += lobbyCardStyles;
    } else {
      const styleEl = document.createElement('style');
      styleEl.id = 'lobby-styles';
      styleEl.textContent = lobbyCardStyles;
      document.head.appendChild(styleEl);
    }
    
    // ... rest of the file unchanged ...
    
    // Keep existing chat functionality
    function setupLobbyChat() {
      const chatInput = document.getElementById('chat-input');
      const sendBtn = document.getElementById('send-chat-btn');
      const messagesEl = document.getElementById('lobby-chat-messages');
      
      if (!chatInput || !sendBtn || !messagesEl) return;
      
      // Join global lobby chat
      if (window.net && window.net.p2p) {
        window.net.p2p.joinBroadcast('aether-lobby-chat');
      }
      
      // Send message
      function sendChatMessage() {
        const message = chatInput.value.trim();
        if (!message || !window.net || !window.net.p2p) return;
        
        // Broadcast chat message
        window.net.p2p.broadcast({
          type: 'lobby_chat',
          message: message,
          from: window.net.getStatus().localPlayerId?.substring(0, 8) || 'You',
          timestamp: Date.now()
        }, 'aether-lobby-chat');
        
        chatInput.value = '';
      }
      
      // Event listeners
      sendBtn.addEventListener('click', sendChatMessage);
      chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          sendChatMessage();
        }
      });
      
      // Touch support for mobile send
      sendBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        sendChatMessage();
      });
      
      // Handle incoming chat messages
      if (window.net) {
        const originalOnBroadcast = window.net.onBroadcastMessage;
        window.net.onBroadcastMessage = function(data) {
          originalOnBroadcast.call(this, data);
          
          if (data.type === 'lobby_chat') {
            addChatMessage(data.message, data.from, data.timestamp);
          }
        };
      }
      
      // Add chat message to UI
      function addChatMessage(message, from, timestamp) {
        const messageEl = document.createElement('div');
        messageEl.className = 'chat-message';
        messageEl.innerHTML = `<strong>${from}:</strong> ${escapeHtml(message)} <small>${new Date(timestamp).toLocaleTimeString()}</small>`;
        messagesEl.appendChild(messageEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;
        
        // Auto-focus input on new message (mobile-friendly)
        setTimeout(() => chatInput.focus(), 100);
      }
      
      // Escape HTML for security
      function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
      }
    };
    
    // Setup other lobby types (KoTH, Teams) with similar structure
    function setupOtherLobbies() {
      const lobbyTypes = ['koth_lobby', 'teams_lobby'];
      
      lobbyTypes.forEach(lobbyId => {
        const lobbyEl = document.getElementById(lobbyId);
        if (lobbyEl) {
          // Add game type specific content
          const gameType = lobbyId.replace('_lobby', '');
          lobbyEl.innerHTML = `
            <div class="lobby-header">
              <h2>${getGameTypeName(gameType)}</h2>
              <p>${getGameTypeDescription(gameType)}</p>
            </div>
            
            <div class="lobby-content">
              <button id="${gameType}-quick-match" class="primary-button">Quick ${getGameTypeName(gameType)}</button>
              <p class="status-message" id="${gameType}-status">Ready to play ${gameType}!</p>
              <div class="connection-indicators" id="${gameType}-indicators">
                <span class="status-dot offline">●</span>
                <span>Waiting for players</span>
              </div>
              
              <div class="lobby-actions">
                <button id="back-to-main-${gameType}" class="secondary-button">← Back to Main Menu</button>
              </div>
            </div>
          `;
          
          // Quick match button for this game type
          const quickBtn = document.getElementById(`${gameType}-quick-match`);
          if (quickBtn) {
            quickBtn.addEventListener('click', () => {
              startGameTypeMatch(gameType);
            });
          }
          
          // Back button
          const backBtn = document.getElementById(`back-to-main-${gameType}`);
          if (backBtn) {
            backBtn.addEventListener('click', () => {
              ui.showMenu('main_menu');
              if (window.net && window.net.disconnect) {
                window.net.disconnect();
              }
            });
          }
        }
      });
    };
    
    // Start match for specific game type
    function startGameTypeMatch(gameType) {
      const btn = document.getElementById(`${gameType}-quick-match`);
      const statusEl = document.getElementById(`${gameType}-status`);
      const indicatorsEl = document.getElementById(`${gameType}-indicators`);
      
      if (btn) btn.disabled = true;
      if (statusEl) statusEl.textContent = `Searching for ${gameType} match...`;
      if (indicatorsEl) indicatorsEl.innerHTML = '<span class="status-dot searching">●</span><span>Searching...</span>';
      
      // Initialize networking for this game type
      if (window.net && !window.net.initialized) {
        window.net.init({
          gameType: gameType,
          devMode: window.location.hostname === 'localhost'
        });
        
        // Status monitoring similar to 1v1...
        const statusInterval = setInterval(() => {
          if (window.net) {
            const status = window.net.getStatus();
            if (status.isConnected && status.peers.length >= getMinPlayersForGameType(gameType)) {
              // Match ready!
              if (statusEl) statusEl.textContent = `Match found! Starting ${gameType}...`;
              if (indicatorsEl) indicatorsEl.innerHTML = '<span class="status-dot connected">●</span><span>Game starting...</span>';
              
              setTimeout(() => {
                document.getElementById('menu').style.display = 'none';
                // Start game with appropriate player count
                startMultiplayerGame(gameType);
              }, 1500);
              
              clearInterval(statusInterval);
            }
          }
        }, 500);
      }
    };
    
    // Game type helpers
    function getGameTypeName(type) {
      const names = {
        'onevsone': '1v1',
        'adventure': 'Adventure',
        'koth': 'King of the Hill',
        'teams': '2v2 Teams'
      };
      return names[type] || type;
    };
    
    function getGameTypeDescription(type) {
      const descriptions = {
        'onevsone': 'One-on-one strategic battle',
        'adventure': 'Co-op exploration and building',
        'koth': 'Control the center to win',
        'teams': 'Team up with an ally against rivals'
      };
      return descriptions[type] || 'Multiplayer battle';
    };
    
    function getMinPlayersForGameType(type) {
      const minPlayers = {
        'onevsone': 1, // 1 opponent
        'adventure': 1,
        'koth': 1,
        'teams': 1
      };
      return minPlayers[type] || 1;
    };
    
    // Update showMenu to handle multiplayer states
    ui.showMenu = function(menuId) {
      prevMenu = menuId;
      
      // Hide all menus
      const allMenus = [
        'main_menu', 'settings_menu', 'player_menu', 'trophy_menu', 
        'ingame_menu', 'adventure_lobby', 'onevsone_lobby', 
        'koth_lobby', 'teams_lobby'
      ];
      allMenus.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      });
      
      // Show the requested menu
      const targetMenu = document.getElementById(menuId);
      if (targetMenu) {
        targetMenu.style.display = 'block';
        document.getElementById('menu').style.display = 'block';
      }
      
      // Update ingame menu player list if showing ingame menu
      if (menuId === 'ingame_menu' && window.currentMatch) {
        ui.updateIngamePlayerList();
      }
      
      // Special handling for multiplayer lobbies - show lobby browser
      if (menuId.includes('_lobby') && window.Lobby) {
        const gameTypeMap = {
          'adventure_lobby': 'adventure',
          'onevsone_lobby': 'onevsone',
          'koth_lobby': 'koth',
          'teams_lobby': 'teams'
        };
        
        const gameType = gameTypeMap[menuId];
        if (gameType) {
          // Show lobby browser instead of auto-joining
          window.Lobby.showLobbyBrowser(gameType);
        }
      }
      
      // Initialize LOD slider when settings menu is shown
      if (menuId === 'settings_menu' && window.hud && window.hud.initLODSlider) {
        window.hud.initLODSlider();
      }
      
      // Initialize AA slider when settings menu is shown
      if (menuId === 'settings_menu' && window.hud && window.hud.initAASlider) {
        window.hud.initAASlider();
      }
      
      // Initialize Shadow slider when settings menu is shown
      if (menuId === 'settings_menu' && window.hud && window.hud.initShadowSlider) {
        window.hud.initShadowSlider();
      }
    };
    
    // NEW: Start multiplayer game for specific type (called from lobby)
    function startMultiplayerGame(gameType = 'onevsone') {
      window.gameType = gameType;
      window.isMultiplayer = true;
      
      // Create players array
      const players = [window.player];
      
      // Create opponent based on game type
      if (!window.opponent) {
        // CRITICAL: Extract short player ID from P2P peer ID
        // P2P IDs are like "p2p-75kz40ogfchvej676hyrt" where last 6 chars are the player ID
        const peerP2PId = window.net.getStatus().peers[0] || 'ai-fallback';
        const opponentId = peerP2PId.length > 6 ? peerP2PId.slice(-6) : peerP2PId;
        
        window.opponent = new window.OpponentPlayer({
          id: opponentId,
          gameType: gameType,
          color: getOpponentColorForGameType(gameType),
          startingResources: { ...STARTING_RESOURCES }
        });
      }
      players.push(window.opponent);
      
      // console.log(`🎮 Starting ${gameType} multiplayer game`);
      
      // Initialize game
      if (window.game) {
        window.game.init({
          type: gameType,
          map: 'default',
          players: players,
          isMultiplayer: true,
          tickRate: window.net ? window.net.TICK_RATE : 60,
          maxPlayers: getMaxPlayersForGameType(gameType)
        });
      }
      
      // Start game loop
      if (window.gameLoop && window.gameLoop.start) {
        window.gameLoop.start();
      }
      
      // Hook commands to network
      hookUnitCommandsToNetwork(gameType);
    };
    
    // Game type specific helpers
    function getOpponentColorForGameType(type) {
      const colors = {
        'onevsone': {primary: '#0066cc', secondary: '#004499'},
        'adventure': {primary: '#00cc66', secondary: '#009944'},
        'koth': {primary: '#ffaa00', secondary: '#cc8800'},
        'teams': {primary: '#00aa00', secondary: '#008800'}
      };
      return colors[type] || colors.onevsone;
    };
    
    function getMaxPlayersForGameType(type) {
      const maxPlayers = {
        'onevsone': 2,
        'adventure': 4,
        'koth': 4,
        'teams': 4
      };
      return maxPlayers[type] || 2;
    };
    
    // Hook commands based on game type
    function hookUnitCommandsToNetwork(gameType) {
      // ... similar to application.js but game-type specific
      // For example, teams mode might broadcast to team members only
    };
    
    // CSS for lobby styling (add to your stylesheet or inline)
    const lobbyStyles = `
      .lobby-header { text-align: center; margin: 20px 0; }
      .lobby-header h2 { color: #4CAF50; margin-bottom: 10px; }
      .lobby-content { max-width: 400px; margin: 0 auto; }
      
      .quick-match-section { margin: 30px 0; text-align: center; }
      .primary-button { 
        background: linear-gradient(45deg, #4CAF50, #45a049);
        color: white; 
        border: none; 
        padding: 15px 30px; 
        font-size: 18px; 
        border-radius: 25px; 
        cursor: pointer; 
        min-width: 200px;
        box-shadow: 0 4px 8px rgba(0,0,0,0.2);
      }
      .primary-button:hover:not(:disabled) { background: linear-gradient(45deg, #45a049, #4CAF50); }
      .primary-button:disabled { opacity: 0.6; cursor: not-allowed; }
      
      .status-message { 
        margin: 15px 0; 
        font-size: 16px; 
        color: #666;
        min-height: 20px;
      }
      
      .connection-indicators { 
        display: flex; 
        align-items: center; 
        justify-content: center; 
        gap: 10px; 
        margin: 10px 0;
      }
      .status-dot { 
        width: 12px; height: 12px; 
        border-radius: 50%; 
        display: inline-block;
      }
      .status-dot.offline { background: #f44336; }
      .status-dot.searching { background: #ff9800; animation: pulse 1.5s infinite; }
      .status-dot.connected { background: #4CAF50; }
      .status-dot.error { background: #f44336; }
      
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
      
      .lobby-chat-section { 
        margin: 20px 0; 
        border: 1px solid #ddd; 
        border-radius: 10px; 
        padding: 15px;
        background: #f9f9f9;
      }
      .chat-messages { 
        height: 200px; 
        overflow-y: auto; 
        margin-bottom: 10px; 
        padding: 10px;
        background: white;
        border-radius: 5px;
      }
      .chat-message { 
        margin: 5px 0; 
        padding: 5px; 
        font-size: 14px;
        border-bottom: 1px solid #eee;
      }
      .chat-message:last-child { border-bottom: none; }
      .chat-message small { color: #999; font-size: 12px; }
      
      #chat-input { 
        width: 70%; 
        padding: 8px; 
        border: 1px solid #ddd; 
        border-radius: 5px; 
        margin-right: 10px;
      }
      #send-chat-btn { 
        padding: 8px 15px; 
        background: #4CAF50; 
        color: white; 
        border: none; 
        border-radius: 5px; 
        cursor: pointer;
      }
      
      .lobby-actions { text-align: center; margin-top: 20px; }
      .secondary-button { 
        background: #ddd; 
        color: #333; 
        border: none; 
        padding: 10px 20px; 
        border-radius: 20px; 
        cursor: pointer;
      }
      
      /* Mobile responsiveness */
      @media (max-width: 480px) {
        .lobby-content { padding: 0 10px; }
        #chat-input { width: 60%; font-size: 16px; } /* Prevent zoom */
        .primary-button { padding: 12px 20px; font-size: 16px; min-width: 150px; }
      }
    `;
    
    // Add styles to head
    if (!document.getElementById('lobby-styles')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'lobby-styles';
      styleEl.textContent = lobbyStyles;
      document.head.appendChild(styleEl);
    }

  }

  // prevMenu is used by the first showMenu definition above

  ui.hideMenu = function(){
    document.getElementById('menu').style.display = 'none';
  }
  
  ui.toggleMenu = function() {
    const menu = document.getElementById('menu');
    if (menu.style.display === 'none' || !menu.style.display) {
      // Show menu with appropriate submenu based on game state
      menu.style.display = 'block';

      // Check if we're in an active game (not menu scene, not demo)
      const isMenuScene = !window.game && (!window.currentMatch || window.currentMatch.isDemo);
      if (isMenuScene) {
        ui.showMenu('main_menu');
      } else {
        // We're in an active game - always show ingame menu
        ui.showMenu('ingame_menu');
      }
    } else {
      // Hide menu
      ui.hideMenu();
    }
  }
  
  // Update player list in ingame menu
  ui.updateIngamePlayerList = function() {
    const playersContent = document.getElementById('ingame_players_content');
    if (!playersContent || !window.currentMatch) return;
    
    const match = window.currentMatch;
    const players = match.players || [];
    const eliminatedPlayers = match.eliminatedPlayers || new Set();
    
    let html = '';
    players.forEach(player => {
      const playerId = player.id || player;
      const playerName = player.name || `Player ${playerId.slice(-4)}`;
      const playerColor = player.color || '#ffffff';
      const isLocal = playerId === match.localPlayerId;
      const isEliminated = eliminatedPlayers.has(playerId);
      
      html += `<div style="padding: 5px; margin: 5px 0; background: rgba(0,0,0,0.2); border-radius: 3px; ${isLocal ? 'border-left: 3px solid ' + playerColor + ';' : ''}">
        <span style="color: ${playerColor};">${isLocal ? '👤 ' : '👥 '}${playerName}${isLocal ? ' (You)' : ''}</span>
        ${isEliminated ? '<span style="color: #ff6666; margin-left: 10px;">💀 Eliminated</span>' : '<span style="color: #66ff66; margin-left: 10px;">✓ Active</span>'}
      </div>`;
    });
    
    // Add observers placeholder (for future)
    // html += `<div style="margin-top: 15px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,0.2);">
    //   <div style="font-weight: bold; margin-bottom: 5px; opacity: 0.7;">Observers:</div>
    //   <div style="opacity: 0.5;">Coming soon...</div>
    // </div>`;
    
    playersContent.innerHTML = html || '<div style="opacity: 0.5;">No players found</div>';
  }

	


  ui.keyInput = function(evt) {
    let state = evt.type == 'keydown' ? true : false;
    const key = evt.key.toLowerCase();

    // Cancel on input typing
    const activeElement = document.activeElement;
    const inputs = ['input', 'select', 'button', 'textarea'];
    if (activeElement && inputs.indexOf(activeElement.tagName.toLowerCase()) !== -1) {
      return;
    }

    // Initialize key states if not exist
    if (!ui.keyStates) ui.keyStates = {};
    if (!ui.prevKeyStates) ui.prevKeyStates = {};

    // Update key state
    ui.keyStates[key] = state;

    // Camera rotation keys
    // W and R for left/right rotation (primary)
    // PageUp and PageDown also rotate left/right
    if (key === 'w' || key === 'pageup') {
      if (state == true && gfx.camera) {
        // Rotate camera right
        cameraRotationTarget.alpha += 0.2;
      }
    } else if (key === 'r' || key === 'pagedown') {
      if (state == true && gfx.camera) {
        // Rotate camera left
        cameraRotationTarget.alpha -= 0.2;
      }
    // Q removed from rotation - now used for zoom out
    // E removed from rotation - now only used for panning forward
    } else if (key === 'q') {
      if (state == true && gfx.camera) {
        // Zoom out (increase radius)
        const zoomSpeed = 2.0;
        if (window.cameraVelocity) {
          window.cameraVelocity.radius += zoomSpeed;
        }
      }
    } else if (key === 't') {
      if (state == true && gfx.camera) {
        // Zoom in (decrease radius)
        const zoomSpeed = -2.0;
        if (window.cameraVelocity) {
          window.cameraVelocity.radius += zoomSpeed;
        }
      }
    } else if (key === 'z' && state && gfx && gfx.camera) {
      // Z key - Zoom in
      const zoomSpeed = 5;
      gfx.camera.radius = Math.max(gfx.camera.lowerRadiusLimit || 20, gfx.camera.radius - zoomSpeed);
    } else if (key === 'x' && state && gfx && gfx.camera) {
      // X key - Zoom out
      const zoomSpeed = 5;
      gfx.camera.radius = Math.min(gfx.camera.upperRadiusLimit || 300, gfx.camera.radius + zoomSpeed);
    } else if (key === 'escape' && state) {
      // Escape key - Toggle main page menu
      ui.toggleMenu();
    } else if (key === 'b') {
      // console.log('🏗️ B key pressed - opening 3D main menu');
      // Handle B key logic here...
    } else if (key === 'f9') {
      // Toggle Babylon Inspector
      if (state == true && gfx && gfx.scene) {
        if (gfx.scene.debugLayer.isVisible()) {
          gfx.scene.debugLayer.hide();
        } else {
          gfx.scene.debugLayer.show();
        }
      }
    }

    // NEW: ESDF and Arrow key panning (velocity-based, relative to camera angle)
    if (gfx.camera && gfx.cameraTarget && !ui.isKeyChangingRotation(key)) {
      // Only pan if not a rotation key (Q/E/A/Z/R)
      const camera = gfx.camera;
      const cameraTarget = gfx.cameraTarget;
      const canvas = gfx.canvas;
      
      // Calculate panning direction vectors (same as RMB/touch panning)
      const toTarget = cameraTarget.position.subtract(camera.position).normalize();
      const camRight = BABYLON.Vector3.Cross(toTarget, BABYLON.Vector3.Up()).normalize();
      const camForward = BABYLON.Vector3.Cross(camRight, toTarget).normalize();
      const groundRight = new BABYLON.Vector3(camRight.x, 0, camRight.z).normalize();
      const groundForward = new BABYLON.Vector3(camForward.x, 0, camForward.z).normalize();

      // Base pan sensitivity (matches existing touch/RMB)
      const basePanSens = (window.touch && touch.getConfig ? (touch.getConfig().panSensitivity || 5) : 5) * 0.6; // Half speed for keyboard
      const zoomFactor = Math.max(0.3, Math.min(2.0, gfx.camera.radius / 80)); // Adjust sensitivity based on zoom
      const panSens = basePanSens * zoomFactor;

      // Initialize cameraVelocity if not exists
      if (!window.cameraVelocity) {
        window.cameraVelocity = { panX: 0, panZ: 0, radius: 0, alpha: 0 };
      }

      // ESDF keys (primary movement scheme)
      if (key === 'e' || key === 's' || key === 'd' || key === 'f') {
        // Clear velocity when key is released
        if (!state) {
          // Apply friction when releasing movement keys
          window.cameraVelocity.panX *= 0.8;
          window.cameraVelocity.panZ *= 0.8;
          return;
        }

        // On keydown, add velocity in camera-relative direction
        let panX = 0, panZ = 0;

        // Map ESDF to directions (E=up, S=left, D=down, F=right - like WASD shifted right)
        if (key === 'e') { // Up/Forward
          panZ += 1.0;
        } else if (key === 's') { // Left (swapped with F)
          panX += 1.0; // S should be left but currently reversed
        } else if (key === 'd') { // Down/Back
          panZ -= 1.0;
        } else if (key === 'f') { // Right (swapped with S)
          panX -= 1.0; // F should be right but currently reversed
        }

        // Apply direction vectors and sensitivity
        const wx = (groundRight.x * panX + groundForward.x * panZ) * panSens;
        const wz = (groundRight.z * panX + groundForward.z * panZ) * panSens;

        // FIXED: Increased multiplier from 0.016 to 0.25 for half speed
        // This matches the direct pixel-to-world conversion speed of RMB/touch panning
        window.cameraVelocity.panX += wx * 0.25;
        window.cameraVelocity.panZ += wz * 0.25;
        
        // FIXED: Increased max velocity cap from 2.0 to 8.0 for more aggressive movement
        const maxVel = panSens * 8.0;
        window.cameraVelocity.panX = Math.max(-maxVel, Math.min(maxVel, window.cameraVelocity.panX));
        window.cameraVelocity.panZ = Math.max(-maxVel, Math.min(maxVel, window.cameraVelocity.panZ));

      // Arrow keys (secondary movement scheme - same as ESDF but different keys)
      } else if (key === 'arrowup' || key === 'arrowdown' || key === 'arrowleft' || key === 'arrowright') {
        // Clear velocity when key is released
        if (!state) {
          window.cameraVelocity.panX *= 0.8;
          window.cameraVelocity.panZ *= 0.8;
          return;
        }

        // On keydown, add velocity
        let panX = 0, panZ = 0;

        if (key === 'arrowup') {
          panZ += 1.0;
        } else if (key === 'arrowdown') {
          panZ -= 1.0;
        } else if (key === 'arrowleft') {
          panX += 1.0; // Left arrow = pan right (swapped)
        } else if (key === 'arrowright') {
          panX -= 1.0; // Right arrow = pan left (swapped)
        }

        // Apply direction vectors and sensitivity (same as ESDF)
        const wx = (groundRight.x * panX + groundForward.x * panZ) * panSens;
        const wz = (groundRight.z * panX + groundForward.z * panZ) * panSens;

        // FIXED: Same multiplier for arrow keys (half speed)
        window.cameraVelocity.panX += wx * 0.25;
        window.cameraVelocity.panZ += wz * 0.25;

        // FIXED: Same max velocity increase
        const maxVel = panSens * 8.0;
        window.cameraVelocity.panX = Math.max(-maxVel, Math.min(maxVel, window.cameraVelocity.panX));
        window.cameraVelocity.panZ = Math.max(-maxVel, Math.min(maxVel, window.cameraVelocity.panZ));
      }
    }

    // Update previous key states for change detection
    ui.prevKeyStates[key] = state;
  }; // end keyInput

  // NEW: Helper function to check if a key affects camera rotation (prevents pan conflicts)
  // Note: E and A are excluded because they're used for both rotation AND ESDF panning
  ui.isKeyChangingRotation = function(key) {
    const rotationKeys = ['q', 'z', 'r', 'w'];
    return rotationKeys.includes(key.toLowerCase());
  };

  // NEW: Update the camera update logic to apply keyboard panning velocity
  // This should be added to the existing camera update code (likely in the render loop or camera update function)
  // Find where cameraVelocity is applied (probably in gfx.js render loop or ui camera update)
  // For now, add this as a standalone function that should be called every frame:

  ui.updateCameraFromVelocity = function() {
    if (!window.cameraVelocity || !gfx.camera || !gfx.cameraTarget) {
      return;
    }

    const target = gfx.cameraTarget.position;
    const momentumDecay = 0.92; // Friction - keeps movement smooth

    // CONTINUOUS MOVEMENT: Check if movement keys are held and add velocity every frame
    if (ui.keyStates && gfx.camera && gfx.cameraTarget) {
      const camera = gfx.camera;
      const cameraTarget = gfx.cameraTarget;
      
      // Calculate panning direction vectors (same as RMB/touch panning)
      const toTarget = cameraTarget.position.subtract(camera.position).normalize();
      const camRight = BABYLON.Vector3.Cross(toTarget, BABYLON.Vector3.Up()).normalize();
      const camForward = BABYLON.Vector3.Cross(camRight, toTarget).normalize();
      const groundRight = new BABYLON.Vector3(camRight.x, 0, camRight.z).normalize();
      const groundForward = new BABYLON.Vector3(camForward.x, 0, camForward.z).normalize();

      // Base pan sensitivity
      const basePanSens = (window.touch && touch.getConfig ? (touch.getConfig().panSensitivity || 5) : 5) * 1.2;
      const zoomFactor = Math.max(0.3, Math.min(2.0, gfx.camera.radius / 80));
      const panSens = basePanSens * zoomFactor;

      let panX = 0, panZ = 0;

      // Check ESDF keys (W removed - now used for rotation)
      // ESDF = E=up, S=left, D=down, F=right (like WASD shifted right)
      if (ui.keyStates['e']) panZ += 1.0; // Up/Forward
      if (ui.keyStates['s']) panX += 1.0; // Left (swapped with F - reversed)
      if (ui.keyStates['d']) panZ -= 1.0; // Down/Back
      if (ui.keyStates['f']) panX -= 1.0; // Right (swapped with S - reversed)
      if (ui.keyStates['a']) panX -= 0.7; // Alternative left

      // Check arrow keys
      if (ui.keyStates['arrowup']) panZ += 1.0;
      if (ui.keyStates['arrowdown']) panZ -= 1.0;
      if (ui.keyStates['arrowleft']) panX += 1.0; // Left arrow = pan right (swapped)
      if (ui.keyStates['arrowright']) panX -= 1.0; // Right arrow = pan left (swapped)

      // Apply direction vectors and sensitivity if any keys are pressed
      if (panX !== 0 || panZ !== 0) {
        const wx = (groundRight.x * panX + groundForward.x * panZ) * panSens;
        const wz = (groundRight.z * panX + groundForward.z * panZ) * panSens;
        
        window.cameraVelocity.panX += wx * 0.25;
        window.cameraVelocity.panZ += wz * 0.25;
        
        const maxVel = panSens * 8.0;
        window.cameraVelocity.panX = Math.max(-maxVel, Math.min(maxVel, window.cameraVelocity.panX));
        window.cameraVelocity.panZ = Math.max(-maxVel, Math.min(maxVel, window.cameraVelocity.panZ));
      }
    }

    // Apply velocity to camera target with bounds checking
    if (Math.abs(window.cameraVelocity.panX) > 0.1 || Math.abs(window.cameraVelocity.panZ) > 0.1) {
      const newX = target.x + window.cameraVelocity.panX;
      const newZ = target.z + window.cameraVelocity.panZ;
      
      // Apply bounds clamping
      const tileSize = (window.TILE_SIZE || 4);
      const w = (window.liveField && window.liveField.width) ? window.liveField.width * tileSize : 256;
      const h = (window.liveField && window.liveField.height) ? window.liveField.height * tileSize : 256;
      const margin = 2 * tileSize;
      const minX = margin, minZ = margin;
      const maxX = Math.max(minX, w - margin);
      const maxZ = Math.max(minZ, h - margin);
      
      // Only apply velocity if it doesn't go out of bounds
      if (newX >= minX && newX <= maxX) {
        target.x = newX;
      } else {
        window.cameraVelocity.panX = 0; // Stop velocity if hitting bounds
      }
      
      if (newZ >= minZ && newZ <= maxZ) {
        target.z = newZ;
      } else {
        window.cameraVelocity.panZ = 0; // Stop velocity if hitting bounds
      }
      
      // Apply friction to velocity
      window.cameraVelocity.panX *= momentumDecay;
      window.cameraVelocity.panZ *= momentumDecay;
      
      // Stop when velocity is very low
      if (Math.abs(window.cameraVelocity.panX) < 0.1) window.cameraVelocity.panX = 0;
      if (Math.abs(window.cameraVelocity.panZ) < 0.1) window.cameraVelocity.panZ = 0;
    }

    // Optional: Apply camera rotation target (existing logic)
    if (cameraRotationTarget && gfx.camera) {
      gfx.camera.alpha = BABYLON.Scalar.LerpAngle(gfx.camera.alpha, cameraRotationTarget.alpha, 0.1);
      gfx.camera.beta = BABYLON.Scalar.Lerp(gfx.camera.beta, cameraRotationTarget.beta, 0.1);
    }
  };

  ui.rightClick = function(e) {
    e.preventDefault();
    return false;
  };

  // Double-click detection system
  let lastClickTime = 0;
  let lastClickPosition = null; // Use null to indicate no previous click
  const DOUBLE_CLICK_DELAY = 300; // milliseconds
  const DOUBLE_CLICK_DISTANCE = 10; // pixels - how far apart clicks can be to count as double-click
  let suppressNextPointerUp = false; // Flag to suppress pointerup after double-click
  // Separate tracking for right mouse button double-click
  let lastRightClickTime = 0;
  let lastRightClickPosition = { x: 0, y: 0 };
  
  // RMB pan state (anchor-based, matches touch pan)
  let rmbPanActive = false;
  let rmbLastScreen = { x: 0, y: 0 };

  // Track current mouse position for menu positioning
  let currentMousePosition = { x: 0, y: 0 };

  // Handle pointer events (mouse clicks, touch)
  ui.handlePointer = function(e) {
    // Check if we clicked on a UI element - if so, allow normal behavior
    const targetElement = document.elementFromPoint(e.clientX, e.clientY);
    if (targetElement && (
      targetElement.closest('.lod_slider') ||
      targetElement.closest('.lod_slider_container') ||
      targetElement.closest('#lod_slider') ||
      targetElement.closest('#lod_value') ||
      targetElement.closest('.binary_switch') ||
      targetElement.closest('.switch_handle') ||
      targetElement.closest('#hud_switch') ||
      targetElement.closest('#shadows_switch') ||
      targetElement.closest('input') ||
      targetElement.closest('select') ||
      targetElement.closest('button')
    )) {
      // Allow normal UI behavior for form elements and controls
      return;
    }
    
    e.preventDefault();
    // Cache frequently used locals
    const canvas = gfx.canvas;
    const camera = gfx.camera;
    const cameraTarget = gfx.cameraTarget;
    
    // Get pointer position
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    // Update current mouse position for menu positioning
    currentMousePosition.x = x;
    currentMousePosition.y = y;
    
    // Handle 3D menu closing on clicks outside menu
    if (e.type === 'pointerdown' && e.button === 0) { // Left click only
      if (window.hud && window.hud.isRadialMenuVisible && window.hud.isRadialMenuVisible()) {
        // Check if click is on a 3D menu element
        const pickResult = gfx.scene.pick(x, y);
        let isMenuClick = false;
        
        if (pickResult.hit && pickResult.pickedMesh) {
          // Walk up parent hierarchy checking both names and radial menu reference
          let currentMesh = pickResult.pickedMesh;
          while (currentMesh && !isMenuClick) {
            // Check if this mesh is the radial menu or has a menu item name or is a click sphere
            if (currentMesh === window.hud.radialMenu ||
                currentMesh.name.includes('menuItem_') || 
                currentMesh.name.includes('radialCenter') ||
                currentMesh.name.includes('clickSphere_') ||
                currentMesh.name.includes('clickPlane_')) {
              isMenuClick = true;
              break;
            }
            currentMesh = currentMesh.parent;
          }
        }
        
        if (!isMenuClick) {
          // Click outside 3D menu - close it
          window.hud.hideRadialMenu();
          return; // Don't process this click further
        }
      }
    }
    
    // RMB pan (hold RMB to pan like touch) - SKIP in Forge mode
    if (!window.isForgeMode && e.pointerType === 'mouse' && e.type === 'pointerdown' && e.button === 2) {
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
      
      // Cancel lasso selection if active when RMB pan starts (always cancel, even if just potential drag)
      if (window.lassoSelection && window.lassoSelection.cleanupSelection) {
        window.lassoSelection.cleanupSelection();
      }
      
      rmbPanActive = true;
      rmbLastScreen.x = e.clientX;
      rmbLastScreen.y = e.clientY;
    } else if (!window.isForgeMode && e.pointerType === 'mouse' && e.type === 'pointermove' && rmbPanActive) {
      if (camera && canvas && cameraTarget) {
        const cam = camera;
        const rectC = canvas.getBoundingClientRect();
        const pixelsToWorld = (2 * (cam.radius || 60) * Math.tan((cam.fov || 0.8)/2)) / Math.max(1, rectC.height);
        const screenDx = (e.clientX - rmbLastScreen.x);
        const screenDy = (e.clientY - rmbLastScreen.y);
        rmbLastScreen.x = e.clientX;
        rmbLastScreen.y = e.clientY;
        const toTarget = cameraTarget.position.subtract(cam.position).normalize();
        const groundForward = new BABYLON.Vector3(toTarget.x, 0, toTarget.z);
        if (groundForward.lengthSquared() > 1e-6) {
          groundForward.normalize();
          const groundRight = new BABYLON.Vector3(-groundForward.z, 0, groundForward.x);
          const wx = groundRight.x * screenDx * pixelsToWorld + groundForward.x * screenDy * pixelsToWorld;
          const wz = groundRight.z * screenDx * pixelsToWorld + groundForward.z * screenDy * pixelsToWorld;
          
          // Zoom-aware pan sensitivity - reduce sensitivity when zoomed out
          const basePanSens = (window.touch && touch.getConfig ? (touch.getConfig().panSensitivity || 5) : 5) * 1.0; // 3x faster - matches touch sensitivity exactly
          const zoomFactor = Math.min(1.0, Math.pow(60 / (cam.radius || 60), 1.5)); // More aggressive reduction
          const panSens = basePanSens * zoomFactor;
          
          // Add pan velocity instead of updating anchor
          cameraVelocity.panX += wx * panSens;
          cameraVelocity.panZ += wz * panSens;
        }
      }
    } else if (!window.isForgeMode && e.pointerType === 'mouse' && e.type === 'pointerup' && e.button === 2) {
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
      // Skip lasso while placing buildings or when 3D menu is visible
      if (!(window.buildingSystem && window.buildingSystem.isPlacing) && !(window.hud && window.hud.isRadialMenuVisible && window.hud.isRadialMenuVisible())) {
        // Handle LMB move for selection (button is not set during move events)
        if (window.lassoSelection && window.lassoSelection.handleLmbMove) {
          window.lassoSelection.handleLmbMove(x, y);
        }
      }
    } else if (e.type === 'pointerup' && e.button === 0) {
      // Handle LMB up for selection FIRST (even if double-click suppressed, we need to clean up lasso state)
      if (!(window.buildingSystem && window.buildingSystem.isPlacing) && !(window.hud && window.hud.isRadialMenuVisible && window.hud.isRadialMenuVisible())) {
        if (window.lassoSelection && window.lassoSelection.handleLmbUp) {
          const wasDragSelection = window.lassoSelection.handleLmbUp(x, y);
          // If a drag selection was just performed, suppress the terrain click to prevent move command
          if (wasDragSelection) {
            return; // Exit early to prevent move command from being issued
          }
        }
      }
      
      // Check if we need to suppress this pointerup (due to double-click)
      // Do this AFTER lasso cleanup so state is properly reset
      if (suppressNextPointerUp) {
        suppressNextPointerUp = false;
        return; // Skip remaining pointerup processing
      }
    }
    
    // Handle LMB selection system FIRST (before double-click detection)
    if (e.type === 'pointerdown' && e.button === 0) { // Left click only
      if (!(window.buildingSystem && window.buildingSystem.isPlacing) && !(window.hud && window.hud.isRadialMenuVisible && window.hud.isRadialMenuVisible())) {
        if (window.lassoSelection && window.lassoSelection.handleLmbDown) {
          window.lassoSelection.handleLmbDown(x, y, e);
        }
      }
    }
    
    // Handle double-click detection for left mouse button (mouse only; touch handled in touch.js)
    if (e.pointerType === 'mouse' && e.type === 'pointerdown' && e.button === 0) { // Left click only
      const currentTime = Date.now();
      const distance = lastClickPosition ? Math.sqrt((x - lastClickPosition.x) ** 2 + (y - lastClickPosition.y) ** 2) : Infinity;
      
      // Check if this is a double-click
      if (lastClickPosition && currentTime - lastClickTime < DOUBLE_CLICK_DELAY && distance < DOUBLE_CLICK_DISTANCE) {
        // Double-click detected! Trigger special abilities on selected units
        const pickResult = gfx.scene.pick(x, y);
        const worldPos = pickResult.hit ? pickResult.pickedPoint : null;
        if (window.ui && window.ui.triggerSpecialAbilityAt) {
          window.ui.triggerSpecialAbilityAt(worldPos);
        }
        
        // Cancel any potential lasso drag from the first click
        if (window.lassoSelection && window.lassoSelection.cleanupSelection) {
          window.lassoSelection.cleanupSelection();
        }
        
        // Reset double-click detection and suppress the upcoming pointerup event
        lastClickTime = 0;
        lastClickPosition = null;
        suppressNextPointerUp = true; // Prevent the pointerup from issuing a move command
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
    
    // If event is from touch synthetic drag or selection, suppress terrain click -> no move orders
    if (e.suppressTerrainClick) {
      return;
    }
    
    // Check if we clicked on a menu element - if so, don't process as terrain click
    const clickedElement = document.elementFromPoint(x, y);
    if (clickedElement && (
      clickedElement.closest('.radial-menu-button') ||
      clickedElement.closest('[id^="anchor_"]') ||
      clickedElement.closest('.radial-menu-label') ||
      clickedElement.closest('.lod_slider') ||
      clickedElement.closest('.lod_slider_container') ||
      clickedElement.closest('#lod_slider') ||
      clickedElement.closest('#lod_value')
    )) {
      return;
    }
    // Convert screen coordinates to world coordinates
    // All models are non-pickable so ray will pass through to terrain
    const pickResult = gfx.scene.pick(x, y);
    
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
        // Check if we should suppress this due to double-click
        if (suppressNextPointerUp) {
          suppressNextPointerUp = false;
          return;
        }
        
        // Left click - could be for placing tiles, selecting objects, etc.
        
        // Check if we clicked on a building - if so, ignore the building and pick through to terrain
        let actualPickResult = pickResult;
        if (pickResult.pickedMesh && (pickResult.pickedMesh.isBuilding || !pickResult.pickedMesh.name.includes('Mesh'))) {
          // We clicked on a building or other non-terrain object, try to pick through to terrain
          
          // Temporarily make ALL building meshes non-pickable
          const meshesToRestore = [];
          gameBuildings.forEach(building => {
            if (building.mesh) {
              meshesToRestore.push({mesh: building.mesh, pickable: building.mesh.isPickable});
              building.mesh.isPickable = false;
              building.mesh.getChildMeshes().forEach(child => {
                meshesToRestore.push({mesh: child, pickable: child.isPickable});
                child.isPickable = false;
              });
            }
          });
          
          // Pick again to get terrain
          const terrainPickResult = gfx.scene.pick(x, y);
          
          // Restore original pickable state for all meshes
          meshesToRestore.forEach(item => {
            item.mesh.isPickable = item.pickable;
          });
          
          // If we found terrain, use that instead
          if (terrainPickResult.hit && terrainPickResult.pickedMesh && terrainPickResult.pickedMesh.name.includes('Mesh')) {
            actualPickResult = terrainPickResult;
          }
        }
        
        // If clicking on terrain (or we successfully picked through to terrain), get precise tile coordinates
        if (actualPickResult.pickedMesh.name.includes('Mesh')) {
          // Get the world position where we clicked
          const worldPos = actualPickResult.pickedPoint;
          
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
                  // MATCH SYSTEM: Submit move commands through Match system for synchronization
                  if (window.currentMatch) {
                    // Submit a move command for all selected units through Match system
                    const unitIds = selectedUnits.map(u => u.id);
                    // CRITICAL: Include starting positions so other clients can snap units before moving
                    // This prevents teleporting when positions drift between checkpoints
                    const startPositions = {};
                    selectedUnits.forEach(u => {
                      if (u.pb && u.pb.state && u.pb.state.loc) {
                        startPositions[u.id] = {
                          x: u.pb.state.loc.x,
                          z: u.pb.state.loc.z
                        };
                      }
                    });
                    const command = {
                      type: 'move',
                      playerId: window.player?.id, // CRITICAL: Set player ID explicitly
                      unitIds: unitIds,
                      startPositions: startPositions, // Include where units are starting from
                      target: { x: worldPos.x, y: 0, z: worldPos.z }
                    };
                    window.currentMatch.submitCommand(command);
                  } else {
                    // SINGLE PLAYER: Apply walk behavior directly to each unit
                    selectedUnits.forEach((unit, index) => {
                      if (window.behaviorManager && unit) {
                        // Create target point slightly offset from explosion center for natural spread
                        const offsetX = worldPos.x + (Math.random() - 0.5) * 2; // Random spread
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
                  }
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
          const dragSensitivity = 1.1; // Doubled from 0.4 for even stronger panning
          // Fix the coordinate mapping: screen right = world right, screen down = world forward
          playerDragVelocity.x = dragDeltaX * dragSensitivity;
          playerDragVelocity.z = dragDeltaY * dragSensitivity;
          
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
                       const finalBoost = 8; // Increased from 5 to 8 for much stronger momentum on release
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
  let cameraRotationSpeed = 0.15; // How fast camera moves to target (reduced for smoother movement)
  // Only animate camera after explicit user input (wheel/gesture)
  let cameraHasBeenNudged = false;
  
  // Expose the flag so it can be set externally if needed (for fallback initialization)
  ui.enableCameraControls = function() {
    cameraHasBeenNudged = true;
  };
  
  ui.getCameraControlsEnabled = function() {
    return cameraHasBeenNudged;
  };
  
  // Camera momentum system (beta handled directly, no momentum)
  let cameraVelocity = { alpha: 0, radius: 0, panX: 0, panZ: 0 };
  let cameraMomentum = 0.95; // keep more momentum for smoother glides
  let cameraDamping = 0.998; // lighter damping for smoother movement
  
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
  // - Normal scroll wheel: Zoom camera in/out
  // - Right-click + scroll wheel: Rotate camera horizontally (left/right)
  // - Shift + scroll wheel: Rotate camera horizontally (left/right) (alternative method)
  ui.handleWheel = function(e) {
    // Skip in Forge mode - Forge has its own camera wheel handling
    if (window.isForgeMode) return;
    
    // Check if mouse is over any scrollable menu (settings or lobbies)
    const mouseX = e.clientX;
    const mouseY = e.clientY;
    
    // Get all menu_menu elements (settings and lobbies)
    const scrollableMenus = document.querySelectorAll('.menu_menu');
    for (let menu of scrollableMenus) {
      // Check if menu is visible
      if (menu.style.display !== 'none' && menu.offsetParent !== null) {
        const menuRect = menu.getBoundingClientRect();
        const isOverMenu = mouseX >= menuRect.left && 
                          mouseX <= menuRect.right && 
                          mouseY >= menuRect.top && 
                          mouseY <= menuRect.bottom;
        
        if (isOverMenu) {
          // Handle scrolling within the menu
          e.preventDefault();
          const delta = e.deltaY;
          menu.scrollTop += delta * 0.5; // Adjust scroll speed as needed
          return; // Don't process camera rotation
        }
      }
    }
    
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
      // Right-click + scroll wheel OR Shift + scroll wheel = Camera rotation via momentum (no spring-back)
      e.preventDefault();
      const rotationAmount = 0.0003; // Reduced from 0.001 to 0.0003 (70% reduction)
      const impulse = INVERSEROT * delta * rotationAmount;
      const maxImpulse = 0.08; // Reduced from 0.25 to 0.08 (68% reduction)
      cameraVelocity.alpha += Math.max(-maxImpulse, Math.min(maxImpulse, impulse));
      // Keep beta fixed during wheel rotation
      cameraRotationTarget.beta = gfx.camera.beta;

      // Log for debugging (remove this in production)
      const rotateMethod = e.shiftKey ? "Shift + Wheel" : "Right-click + Wheel";
      // console.log(`${rotateMethod}: delta=${delta}, rotation impulse=${impulse.toFixed(4)}, alpha=${gfx.camera.alpha?.toFixed(4)}`);
    } else {
      // Normal scroll wheel = Camera zoom
      // Don't prevent default - let both zoom AND rotation happen!

      // Handle zoom manually
      const zoomSpeed = 0.025; // Reduced from 0.085 to 0.025 (70% reduction)
      const zoomAmount = INVERSEZOOM*delta * zoomSpeed;

      // Add zoom velocity instead of directly changing radius (momentum-based zoom)
      if (gfx.camera.radius !== undefined) {
        cameraVelocity.radius += zoomAmount;
      }

      // Log for debugging (remove this in production)
      // console.log(`Normal Wheel: delta=${delta}, zoom amount=${zoomAmount.toFixed(4)}, radius=${gfx.camera.radius?.toFixed(4)}`);
    }
  };
  
  // Update camera rotation smoothly towards target (call this every frame)
  ui.updateCameraRotation = function() {
    // Skip in Forge mode - Forge has its own camera system
    if (window.isForgeMode) return;
    
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
    
    // CONTINUOUS ROTATION: Check if W/R or PageUp/PageDown are held and rotate continuously
    if (ui.keyStates) {
      const rotationSpeed = 0.2; // Same as keydown rotation speed
      if (ui.keyStates['w'] || ui.keyStates['pageup']) {
        // Rotate right - directly update camera alpha for immediate response
        gfx.camera.alpha += rotationSpeed;
        cameraRotationTarget.alpha = gfx.camera.alpha; // Sync target
      } else if (ui.keyStates['r'] || ui.keyStates['pagedown']) {
        // Rotate left - directly update camera alpha for immediate response
        gfx.camera.alpha -= rotationSpeed;
        cameraRotationTarget.alpha = gfx.camera.alpha; // Sync target
      }
      
      // CONTINUOUS ZOOM: Check if Q/T are held and zoom continuously
      const zoomSpeed = 2.0;
      if (ui.keyStates['q']) {
        // Zoom out (increase radius)
        cameraVelocity.radius += zoomSpeed;
      }
      if (ui.keyStates['t']) {
        // Zoom in (decrease radius)
        cameraVelocity.radius -= zoomSpeed;
      }
      
      if (!ui.keyStates['r'] && !ui.keyStates['w']) {
        // Apply momentum-based camera movement for alpha only when not rotating
        // Keep alpha target synced to current to remove restoring force; only momentum drives alpha
        cameraRotationTarget.alpha = gfx.camera.alpha;
        const alphaDiff = cameraRotationTarget.alpha - gfx.camera.alpha; // zero
        cameraVelocity.alpha += alphaDiff * cameraRotationSpeed;
      }
    } else {
      // Apply momentum-based camera movement for alpha only
      cameraRotationTarget.alpha = gfx.camera.alpha;
      const alphaDiff = cameraRotationTarget.alpha - gfx.camera.alpha; // zero
      cameraVelocity.alpha += alphaDiff * cameraRotationSpeed;
    }
    
    // Handle zoom→beta coupling directly (no momentum conflict)
    const minRadius = gfx.camera.lowerRadiusLimit || 35;
    const maxRadius = gfx.camera.upperRadiusLimit || 199;
    const currentRadius = gfx.camera.radius;
    
    // Normalize radius between 0 and 1
    const normalizedRadius = (currentRadius - minRadius) / (maxRadius - minRadius);
    
    // Beta range: 1.2 (looking toward horizon when zoomed in) to 0.62 (looking down when zoomed out)
    const minBeta = 1.2;  // Looking toward horizon (zoomed in)
    const maxBeta = 0.61; // Looking down when zoomed out (split between 0.7 and 0.55)
    
    // Calculate target beta based on zoom and apply directly with smooth lerp
    const targetBeta = minBeta + (normalizedRadius * (maxBeta - minBeta));
    const betaDiff = Math.abs(gfx.camera.beta - targetBeta);
    
    // Use faster lerp (0.35) so angle adjusts fully during zoom, not after
    // Also snap when very close to prevent lingering drift
    if (betaDiff < 0.01) {
      gfx.camera.beta = targetBeta; // Snap to target when close
    } else {
      gfx.camera.beta = BABYLON.Scalar.Lerp(gfx.camera.beta, targetBeta, 0.35);
    }
    
    // Apply momentum (keep some of the previous velocity) - alpha and radius only
    cameraVelocity.alpha *= cameraMomentum;
    cameraVelocity.radius *= cameraMomentum;
    // Split the difference for panning - more direct than rotation/zoom but not too aggressive
    cameraVelocity.panX *= 0.8; // Between 0.9 (original) and 0.7 (aggressive)
    cameraVelocity.panZ *= 0.8; // Between 0.9 (original) and 0.7 (aggressive)
    
    // Apply damping (gradually reduce velocity) - alpha and radius only
    cameraVelocity.alpha *= cameraDamping;
    cameraVelocity.radius *= cameraDamping;
    // Split the difference for panning damping
    cameraVelocity.panX *= 0.975; // Between 0.995 (original) and 0.95 (aggressive)
    cameraVelocity.panZ *= 0.975; // Between 0.995 (original) and 0.95 (aggressive)
    
    // Zero velocity threshold to stop imperceptible movement
    const CAMERA_ROTATION_THRESHOLD = 0.01; // Stop rotation when velocity is very small
    const CAMERA_ZOOM_THRESHOLD = 0.1; // Stop zoom when velocity is very small
    const CAMERA_PAN_THRESHOLD = 0.001; // Stop pan when velocity is very small
    
    if (Math.abs(cameraVelocity.alpha) < CAMERA_ROTATION_THRESHOLD) {
      cameraVelocity.alpha = 0;
    }
    if (Math.abs(cameraVelocity.radius) < CAMERA_ZOOM_THRESHOLD) {
      cameraVelocity.radius = 0;
    }
    if (Math.abs(cameraVelocity.panX) < CAMERA_PAN_THRESHOLD) {
      cameraVelocity.panX = 0;
    }
    if (Math.abs(cameraVelocity.panZ) < CAMERA_PAN_THRESHOLD) {
      cameraVelocity.panZ = 0;
    }
    
    // Move camera based on velocity (alpha only, beta handled directly above)
    gfx.camera.alpha += cameraVelocity.alpha;
    
    // Apply pan velocity to camera target with bounds checking
    if (gfx.cameraTarget) {
      const newX = gfx.cameraTarget.position.x + cameraVelocity.panX;
      const newZ = gfx.cameraTarget.position.z + cameraVelocity.panZ;
      
      // Apply bounds clamping
      const tileSize = (window.TILE_SIZE || 4);
      const w = (window.liveField && window.liveField.width) ? window.liveField.width * tileSize : 256;
      const h = (window.liveField && window.liveField.height) ? window.liveField.height * tileSize : 256;
      const margin = 2 * tileSize;
      const minX = margin, minZ = margin;
      const maxX = Math.max(minX, w - margin);
      const maxZ = Math.max(minZ, h - margin);
      
      // Only apply velocity if it doesn't go out of bounds
      if (newX >= minX && newX <= maxX) {
        gfx.cameraTarget.position.x = newX;
      } else {
        cameraVelocity.panX = 0; // Stop velocity if hitting bounds
      }
      
      if (newZ >= minZ && newZ <= maxZ) {
        gfx.cameraTarget.position.z = newZ;
      } else {
        cameraVelocity.panZ = 0; // Stop velocity if hitting bounds
      }
    }
    
    // Apply zoom velocity and clamp to limits
    if (gfx.camera.radius !== undefined) {
      gfx.camera.radius += cameraVelocity.radius;
      gfx.camera.radius = Math.max(gfx.camera.lowerRadiusLimit, Math.min(gfx.camera.upperRadiusLimit, gfx.camera.radius));
    }
    
    // Clamp beta to camera limits to prevent flipping
    if (typeof gfx.camera.lowerBetaLimit === 'number' && typeof gfx.camera.upperBetaLimit === 'number') {
      gfx.camera.beta = Math.max(gfx.camera.lowerBetaLimit, Math.min(gfx.camera.upperBetaLimit, gfx.camera.beta));
    } else {
      gfx.camera.beta = Math.max(0.1, Math.min(1.5, gfx.camera.beta));
    }
    
    // Camera movement target system removed - now using velocity-based panning
    
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
      
      // Enable camera updates immediately when camera is initialized
      // This allows camera controls to work without requiring initial scrollwheel input
      cameraHasBeenNudged = true;
      
      // console.log('📷 Camera rotation targets synced - controls enabled immediately:', cameraRotationTarget);
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
    // Add pan velocity instead of direct movement
    cameraVelocity.panX += deltaX;
    cameraVelocity.panZ += deltaZ;
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
    if (!window.gfx || !window.gfx.scene || !window.gfx.getModel) return;
    
    const scene = window.gfx.scene;
    
    // Load the target model
    window.gfx.getModel("assets/models/target.glb", scene).then(model => {
      if (!model || !model.root) return;
      
      const targetMesh = model.root;
      
      // Position at target location
      targetMesh.position.x = worldPos.x;
      targetMesh.position.y = worldPos.y || 0;
      targetMesh.position.z = worldPos.z;
      
      // Enable the mesh (getModel disables it by default)
      targetMesh.setEnabled(true);
      targetMesh.isVisible = true;
      targetMesh.isPickable = false;
      
      // Clear rotation quaternion so we can use Euler angles for rotation
      targetMesh.rotationQuaternion = null;
      targetMesh.rotation.y = 0;
      
      // Add glow effect if available
      if (window.gfx.glowLayer) {
        const allMeshes = targetMesh.getChildMeshes(true);
        allMeshes.forEach(mesh => {
          window.gfx.glowLayer.addIncludedOnlyMesh(mesh);
        });
      }
      
      // Store initial Y position and scale for animations
      const initialY = targetMesh.position.y;
      const initialScale = targetMesh.scaling.clone();
      
      // Simple fade-out and floaty animation
      let fadeTime = 0;
      let floatTime = 0;
      const fadeDuration = 3000; // 3 seconds
      
      // Get all materials from the model for fading
      const materials = [];
      const allMeshes = targetMesh.getChildMeshes(true);
      allMeshes.forEach(mesh => {
        if (mesh.material && !materials.includes(mesh.material)) {
          materials.push(mesh.material);
        }
      });
      
      const animateMarker = () => {
        fadeTime += 16; // ~60fps
        floatTime += 0.02;
        const fade = Math.max(0, 1 - (fadeTime / fadeDuration));
        
        if (fade <= 0 || targetMesh.isDisposed()) {
          // Clean up
          if (targetMesh && !targetMesh.isDisposed()) {
            const meshesToClean = targetMesh.getChildMeshes(true);
            meshesToClean.forEach(mesh => {
              if (mesh && !mesh.isDisposed()) {
                if (window.gfx.glowLayer) {
                  window.gfx.glowLayer.removeIncludedOnlyMesh(mesh);
                }
              }
            });
            targetMesh.dispose();
          }
          return;
        }
        
        // Floaty animation - more pronounced vertical bobbing
        const floatAmount = Math.sin(floatTime) * 0.5;
        targetMesh.position.y = initialY + floatAmount;
        
        // Rotate around Y axis (make sure rotationQuaternion is null)
        if (targetMesh.rotationQuaternion) {
          targetMesh.rotationQuaternion = null;
        }
        targetMesh.rotation.y += 0.02; // Faster rotation
        
        // Shrink animation - scale down as it fades
        targetMesh.scaling.x = initialScale.x * fade;
        targetMesh.scaling.y = initialScale.y * fade;
        targetMesh.scaling.z = initialScale.z * fade;
        
        // Fade out all materials (check if material exists and has alpha property)
        materials.forEach(mat => {
          if (mat && typeof mat.alpha !== 'undefined') {
            try {
              mat.alpha = fade;
            } catch (e) {
              // Material might be disposed or read-only, ignore
            }
          }
        });
        
        // Continue animation
        requestAnimationFrame(animateMarker);
      };
      
      // Start the animation
      animateMarker();
      
      // console.log(`🎯 Created target marker at (${worldPos.x.toFixed(1)}, ${worldPos.z.toFixed(1)})`);
    }).catch(err => {
      console.warn('⚠️ Failed to load target.glb model:', err);
    });
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
    const distance = ray.intersectsPlane(groundPlane);
    
    if (distance !== null && distance !== false) {
      // Calculate the actual world position from ray origin + direction * distance
      const worldPos = ray.origin.add(ray.direction.scale(distance));
      return worldPos;
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
    if (!window.player || !window.player.getSelectedUnits || !window.behaviorManager) {
      return;
    }
    const units = window.player.getSelectedUnits();
    
    // MATCH SYSTEM: Submit ability commands through Match system
    if (window.currentMatch && units.length > 0) {
      units.forEach(unit => {
        const type = unit.type || unit.name || '';
        let abilityType = null;
        let abilityParams = {};
        
        if (/engineer/i.test(type)) {
          abilityType = 'engineer_productivity_boost';
          abilityParams = { radius: 6, bonus: 1.5, duration: 7000, vfx: 'aura_blue' };
        } else if (/brigand/i.test(type)) {
          abilityType = 'brigand_sprint';
          // Extract coordinates properly from Vector3 or plain object
          let targetPoint = null;
          if (worldPos) {
            const xCoord = worldPos.x !== undefined ? worldPos.x : (worldPos._x !== undefined ? worldPos._x : 0);
            const zCoord = worldPos.z !== undefined ? worldPos.z : (worldPos._z !== undefined ? worldPos._z : 0);
            targetPoint = { x: xCoord, z: zCoord };
          }
          abilityParams = { speedMultiplier: 2.25, duration: 6000, targetPoint: targetPoint, vfx: 'speed_trail' };
        } else if (/monk/i.test(type)) {
          abilityType = 'monk_stealth';
          abilityParams = { invisibility: true, duration: 4000, vfx: 'smoke_puff' };
        } else if (/wizard/i.test(type)) {
          // For wizards, submit a stop command first
          window.currentMatch.submitCommand({
            type: 'stop',
            unitIds: [unit.id]
          });
          abilityType = 'wizard_cast';
          // Extract coordinates properly from Vector3 or plain object
          let targetPoint = null;
          if (worldPos) {
            const xCoord = worldPos.x !== undefined ? worldPos.x : (worldPos._x !== undefined ? worldPos._x : 0);
            const zCoord = worldPos.z !== undefined ? worldPos.z : (worldPos._z !== undefined ? worldPos._z : 0);
            targetPoint = { x: xCoord, z: zCoord };
          }
          abilityParams = { targetPoint: targetPoint, spell: 'arc_blast', power: 1.5, vfx: 'spell_flash' };
        }
        
        if (abilityType) {
          window.currentMatch.submitCommand({
            type: 'ability',
            playerId: window.player?.id, // CRITICAL: Set player ID explicitly
            unitId: unit.id,
            abilityType: abilityType,
            params: abilityParams
          });
        }
      });
    } else {
      // SINGLE PLAYER: Apply abilities directly
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
          // Extract coordinates properly from Vector3 or plain object
          let targetPoint = null;
          if (worldPos) {
            const xCoord = worldPos.x !== undefined ? worldPos.x : (worldPos._x !== undefined ? worldPos._x : 0);
            const zCoord = worldPos.z !== undefined ? worldPos.z : (worldPos._z !== undefined ? worldPos._z : 0);
            targetPoint = { x: xCoord, z: zCoord };
          }
          window.behaviorManager.setBehavior(unit, 'brigand_sprint', {
            speedMultiplier: 2.25,
            duration: 6000,
            targetPoint: targetPoint,
            vfx: 'speed_trail'
          });
        } else if (/monk/i.test(type)) {
          window.behaviorManager.setBehavior(unit, 'monk_stealth', {
            invisibility: true,
            duration: 4000,
            vfx: 'smoke_puff'
          });
        } else if (/wizard/i.test(type)) {
          // Stop wizard movement completely before casting
          window.behaviorManager.setBehavior(unit, 'linger', {
            center: { x: unit.pb.state.loc.x, z: unit.pb.state.loc.z },
            radius: 0, // Don't wander at all
            wanderInterval: 999999 // Never wander
          });
          
          // Extract coordinates properly - worldPos might be a Vector3 or plain object
          let targetPoint = null;
          if (worldPos) {
            // Handle both Vector3 (with _x, _z) and plain objects (with x, z)
            const xCoord = worldPos.x !== undefined ? worldPos.x : (worldPos._x !== undefined ? worldPos._x : 0);
            const zCoord = worldPos.z !== undefined ? worldPos.z : (worldPos._z !== undefined ? worldPos._z : 0);
            targetPoint = { x: xCoord, z: zCoord };
          }
          
          // Then apply the cast ability as a modifier
          window.behaviorManager.setBehavior(unit, 'wizard_cast', {
            targetPoint: targetPoint,
            spell: 'arc_blast',
            power: 1.5,
            vfx: 'spell_flash'
          });
        }
      });
    }
  };

}(window.ui = window.ui || {}));

// Global function to view replays from menu
window.viewReplaysFromMenu = function() {
  console.log('🎬 Opening replay viewer from menu...');
  
  // Hide the menu
  if (window.ui && window.ui.hideMenu) {
    window.ui.hideMenu();
  }
  
  // Get list of saved replays
  const replays = window.Determinism ? window.Determinism.listReplays() : [];
  
  // Create replay viewer overlay
  let viewer = document.getElementById('replay_viewer');
  if (!viewer) {
    viewer = document.createElement('div');
    viewer.id = 'replay_viewer';
    document.body.appendChild(viewer);
  }
  
  viewer.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.95);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    color: white;
    font-family: sans-serif;
  `;
  
  // Format date nicely
  const formatDate = (timestamp) => {
    if (!timestamp) return 'Unknown date';
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    // If today, show time
    if (diff < 24 * 60 * 60 * 1000 && date.getDate() === now.getDate()) {
      return 'Today ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    // If yesterday
    if (diff < 48 * 60 * 60 * 1000) {
      return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    // Otherwise show date
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + 
           date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  
  // Build replay list HTML
  let replayListHtml = '';
  if (replays.length === 0) {
    replayListHtml = '<p style="color: #888; font-size: 1.2em;">No replays saved yet.</p><p style="color: #666;">Complete a match to save a replay!</p>';
  } else {
    replayListHtml = replays.map((r, i) => {
      const duration = r.duration ? `${Math.floor(r.duration / 60)}:${Math.floor(r.duration % 60).toString().padStart(2, '0')}` : '?:??';
      const players = r.players ? r.players.map(p => p.name || 'Unknown').join(' vs ') : 'Unknown players';
      const commands = r.commandCount || 0;
      const dateStr = formatDate(r.savedAt);
      const savedIcon = r.saved ? '⭐' : '☆';
      const versionWarning = (!r.version || r.version < '1.1') ? ' ⚠️' : '';
      
      return `
        <div class="replay_item" data-id="${r.id}" style="
          background: ${r.saved ? 'rgba(80, 70, 40, 0.8)' : 'rgba(50, 50, 80, 0.8)'};
          padding: 12px 15px;
          margin: 6px 0;
          border-radius: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          width: 100%;
          max-width: 550px;
          border: ${r.saved ? '1px solid rgba(255, 200, 50, 0.3)' : '1px solid transparent'};
        ">
          <div style="flex: 1; cursor: pointer;" onclick="window.playReplayFromMenu('${r.id}')">
            <div style="font-weight: bold; font-size: 1em;">${players}${versionWarning}</div>
            <div style="color: #aaa; font-size: 0.85em;">${r.gameType || 'Match'} • ${commands} cmds • ${duration}</div>
            <div style="color: #888; font-size: 0.75em;">${dateStr}</div>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <button onclick="window.toggleReplaySave('${r.id}')" title="${r.saved ? 'Unprotect from deletion' : 'Protect from auto-deletion'}"
                    style="background: none; border: none; cursor: pointer; font-size: 1.3em; padding: 5px;">
              ${savedIcon}
            </button>
            <button onclick="window.deleteReplayConfirm('${r.id}')" title="Delete replay"
                    style="background: rgba(200, 50, 50, 0.5); border: none; cursor: pointer; 
                           color: white; padding: 5px 10px; border-radius: 3px; font-size: 0.85em;">
              🗑️
            </button>
          </div>
        </div>
      `;
    }).join('');
  }
  
  const savedCount = replays.filter(r => r.saved).length;
  const totalCount = replays.length;
  
  viewer.innerHTML = `
    <h2 style="margin-bottom: 10px;">🎬 Saved Replays</h2>
    <p style="color: #888; margin-bottom: 15px; font-size: 0.9em;">
      ${totalCount} replay${totalCount !== 1 ? 's' : ''} (${savedCount} protected ⭐)
    </p>
    <div style="max-height: 60vh; overflow-y: auto; width: 100%; max-width: 580px; padding: 10px;">
      ${replayListHtml}
    </div>
    <button onclick="document.getElementById('replay_viewer').style.display='none'" 
            style="margin-top: 20px; padding: 10px 30px; background: rgba(100, 100, 100, 0.8); 
                   border: none; color: white; cursor: pointer; border-radius: 5px; font-size: 1em;">
      Close
    </button>
  `;
  
  viewer.style.display = 'flex';
};

// Toggle replay save status
window.toggleReplaySave = function(replayId) {
  if (window.Determinism && window.Determinism.toggleReplaySaved) {
    window.Determinism.toggleReplaySaved(replayId);
    // Refresh the list
    window.viewReplaysFromMenu();
  }
};

// Delete replay with confirmation
window.deleteReplayConfirm = function(replayId) {
  if (confirm('Delete this replay? This cannot be undone.')) {
    if (window.Determinism && window.Determinism.deleteReplay) {
      window.Determinism.deleteReplay(replayId);
      // Refresh the list
      window.viewReplaysFromMenu();
    }
  }
};

// Global function to play a replay from the menu
window.playReplayFromMenu = async function(replayId) {
  console.log(`🎬 Playing replay: ${replayId}`);
  
  // Hide the viewer
  const viewer = document.getElementById('replay_viewer');
  if (viewer) viewer.style.display = 'none';
  
  // Load replay data
  const replayData = window.Determinism ? window.Determinism.loadReplay(replayId) : null;
  if (!replayData) {
    console.error('❌ Failed to load replay');
    alert('Failed to load replay. The file may be corrupted.');
    return;
  }
  
  // Check replay version/compatibility
  const version = replayData.version || '0.9';
  if (version < '1.0') {
    const proceed = confirm(
      '⚠️ This replay was saved with an older version and may not play correctly.\n\n' +
      'Old replays might have compatibility issues with the current game.\n\n' +
      'Do you want to try playing it anyway?'
    );
    if (!proceed) return;
  }
  
  // Validate required replay data
  if (!replayData.mapSeed) {
    alert('❌ This replay is missing map seed data and cannot be played.');
    return;
  }
  
  if (!replayData.commands || replayData.commands.length === 0) {
    const proceed = confirm(
      '⚠️ This replay has no recorded commands.\n\n' +
      'It might be from a very short match or incomplete.\n\n' +
      'Do you want to try loading the map anyway?'
    );
    if (!proceed) return;
  }
  
  console.log(`📊 Replay loaded: ${replayData.commands?.length || 0} commands, seed: ${replayData.mapSeed}, version: ${version}`);
  
  try {
    // Create a temporary match object for replay if none exists
    if (!window.currentMatch) {
      window.currentMatch = new window.Match({
        id: 'replay-' + Date.now(),
        gameType: replayData.gameType || '1v1',
        mapSeed: replayData.mapSeed,
        players: replayData.players || [],
        localPlayerId: replayData.players?.[0]?.id || 'replay-viewer'
      });
    }
    
    // Use the match's replay loading function
    await window.currentMatch.loadAndPlayReplay(replayId);
  } catch (error) {
    console.error('❌ Error playing replay:', error);
    alert('Failed to play replay: ' + error.message);
  }
};

