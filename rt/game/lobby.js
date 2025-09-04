// Lobby system for managing game matches
const Lobby = {
  
  // Reset the field and game state to defaults
  resetGameState: function() {
    console.log('🔄 Resetting game state...');
    
    // Stop the current game loop if running
    if (window.gameLoop && window.gameLoop.stop) {
      window.gameLoop.stop();
    }
    
    // Clear existing game units
    if (window.gameUnits) {
      window.gameUnits.forEach(unit => {
        if (unit.mesh && unit.mesh.dispose) {
          unit.mesh.dispose();
        }
      });
      window.gameUnits = [];
    }
    
    // Clear player units
    if (window.player && window.player.units) {
      window.player.units.forEach(unit => {
        if (unit.mesh && unit.mesh.dispose) {
          unit.mesh.dispose();
        }
      });
      window.player.units = [];
    }
    
    // Clear player selection
    if (window.player && window.player.clearSelection) {
      window.player.clearSelection();
    }
    
    // Reset player resources to starting values
    if (window.player && window.player.resources) {
      window.player.resources = {
        food: 100,
        wood: 50,
        stone: 25,
        magic: 10
      };
    }
    
    // Reset player position to agora
    if (window.player && window.player.pbody) {
      const agoraX = window.player.agora.x * TILE_SIZE;
      const agoraZ = window.player.agora.y * TILE_SIZE;
      window.player.pbody.state.loc.set(agoraX, 0, agoraZ);
      window.player.pbody.vel.set(0, 0, 0);
      window.player.pbody.imp.set(0, 0, 0);
    }
    
    // Clear any existing buildings
    if (window.buildingSystem && window.buildingSystem.buildings) {
      window.buildingSystem.buildings.forEach(building => {
        if (building.mesh && building.mesh.dispose) {
          building.mesh.dispose();
        }
      });
      window.buildingSystem.buildings = [];
    }
    
    // Reset the field to default state
    if (window.liveField) {
      // Clear existing chunks
      if (window.liveField.chunks) {
        window.liveField.chunks.forEach((chunk, key) => {
          if (chunk.mesh && chunk.mesh.dispose) {
            chunk.mesh.dispose();
          }
        });
        window.liveField.chunks.clear();
      }
      
      // Regenerate the field with specified size and seed
      const fieldDimensions = this.getFieldDimensions(fieldSize);
      const seed = mapSeed || Math.floor(Math.random() * 1000000);
      
      window.liveField = new Field({
        width: fieldDimensions.width, 
        height: fieldDimensions.height, 
        seed: seed
      });
      
      // Set random time of day
      window.liveField.timeOfDay = 0.2 + (Math.random() * 0.6);
      
      console.log(`🗺️ Generated ${fieldSize} field: ${fieldDimensions.width}x${fieldDimensions.height} with seed ${seed}`);
    }
    
    // Clear any existing fog of war
    if (window.fogSystem && window.fogSystem.clear) {
      window.fogSystem.clear();
    }
    
    // Clean up opponent
    if (window.OpponentSystem) {
      window.OpponentSystem.cleanupOpponent();
    }
    
    console.log('✅ Game state reset complete');
  },
  
  // Start a new match from the lobby
  startMatch: function(matchType = '1v1', fieldSize = 'medium', mapSeed = null) {
    console.log(`🎮 Starting ${matchType} match with ${fieldSize} field...`);
    
    // Reset the game state first
    this.resetGameState();
    
    // Initialize the player
    if (!window.player) {
      initPlayer();
    }
    
    // Start the game loop
    if (window.gameLoop && window.gameLoop.start) {
      window.gameLoop.start();
    }
    
    // Villagers are now spawned automatically in the Player constructor
    console.log('✅ Player initialized with villagers');
    
    // Hide the menu and show the game
    if (window.ui && window.ui.hideMenu) {
      window.ui.hideMenu();
    }
    
    // Update HUD with current resources
    if (window.hud && window.hud.updateResources) {
      window.hud.updateResources();
    }
    
    // Set up opponent for 1v1 matches with a delay to ensure player system is ready
    if (matchType === '1v1' && window.OpponentSystem) {
      setTimeout(() => {
        console.log('🤖 Spawning opponent after player system is ready...');
        window.OpponentSystem.spawnOpponent();
      }, 1000); // 1 second delay to ensure everything is initialized
    }
    
    console.log(`🎮 ${matchType} match started successfully!`);
    
    // Dispatch custom event for other systems to listen to
    const event = new CustomEvent('matchStarted', { 
      detail: { matchType: matchType } 
    });
    window.dispatchEvent(event);
  },
  
  // Initialize the lobby system
  init: function() {
    console.log('🏛️ Lobby system initialized');
    
    // Set up the Game Start button event listener
    const gameStartButton = document.querySelector('#onevsone_lobby .lobby_b');
    if (gameStartButton) {
      gameStartButton.addEventListener('click', () => {
        console.log('🎮 Game Start button clicked');
        
        // Get selected field size from dropdown
        const fieldSizeSelect = document.getElementById('fieldSize');
        const selectedFieldSize = fieldSizeSelect ? fieldSizeSelect.value : 'medium';
        
        // Get map seed from input
        const mapSeedInput = document.getElementById('mapSeed');
        const selectedSeed = mapSeedInput ? parseInt(mapSeedInput.value) : null;
        
        console.log(`🎮 Starting with field size: ${selectedFieldSize}, seed: ${selectedSeed}`);
        
        this.startMatch('1v1', selectedFieldSize, selectedSeed);
      });
    }
    
    // Add click handlers for other lobby types
    this.setupLobbyButtons();
  },
  
  // Get field dimensions based on size preset
  getFieldDimensions: function(fieldSize) {
    const fieldSizes = {
      'tiny': { width: 32, height: 32 },
      'small': { width: 64, height: 64 },
      'medium': { width: 128, height: 128 },
      'large': { width: 256, height: 256 },
      'huge': { width: 512, height: 512 }
    };
    
    return fieldSizes[fieldSize] || fieldSizes['medium'];
  },
  
  // Generate a random seed
  generateRandomSeed: function() {
    return Math.floor(Math.random() * 1000000);
  },
  
  // Set up lobby buttons for different game types
  setupLobbyButtons: function() {
    // Adventure lobby
    const adventureButton = document.querySelector('#adventure_lobby .lobby_b');
    if (adventureButton) {
      adventureButton.addEventListener('click', () => {
        this.startMatch('adventure', 'medium');
      });
    }
    
    // FFA lobby
    const ffaButton = document.querySelector('#ffa_lobby .lobby_b');
    if (ffaButton) {
      ffaButton.addEventListener('click', () => {
        this.startMatch('ffa', 'large');
      });
    }
    
    // King of the Hill lobby
    const kothButton = document.querySelector('#koth_lobby .lobby_b');
    if (kothButton) {
      kothButton.addEventListener('click', () => {
        this.startMatch('koth', 'medium');
      });
    }
    
    // Teams lobby
    const teamsButton = document.querySelector('#teams_lobby .lobby_b');
    if (teamsButton) {
      teamsButton.addEventListener('click', () => {
        this.startMatch('teams', 'large');
      });
    }
  }
};

// Make Lobby available globally
window.Lobby = Lobby;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  Lobby.init();
});
