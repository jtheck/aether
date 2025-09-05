# Building Placement System

## Overview
The building placement system allows players to place various structures on the game map, including camps, houses, and watchtowers.

## How to Use

### 1. Access Building Menu
- Click the 🏗️ button in the bottom-left corner of the screen
- This opens the Building Construction menu

### 2. Select Building Type
The menu shows three building types:
- **🏕️ Camp** - Basic work camp (Cost: Wood: 30, Stone: 10)
- **🏠 House** - Basic housing for villagers (Cost: Wood: 30, Stone: 10)  
- **🗼 Watchtower** - Defensive structure (Cost: Stone: 80, Wood: 20)

### 3. Place Building
- Click on a building type to enter placement mode
- A green preview box will appear and follow your mouse
- Move the preview to your desired location
- Click to place the building
- The preview will turn red if the location is invalid

### 4. Building Controls
- **Rotate Button** - Rotate the building 90 degrees
- **Cancel Button** - Exit placement mode without placing

### 5. Placement Rules
- Buildings must be placed at least 3 tiles away from the Agora
- Buildings cannot be placed on occupied tiles
- Buildings snap to the grid automatically
- Press ESC to cancel placement at any time

## Technical Details

### Files Modified
- `rt.html` - Added building menu UI
- `rt.css` - Added building menu styles
- `game/buildings.js` - Added building placement system
- `game/ui.js` - Added ESC key support for building placement

### Building System Features
- Visual preview with color-coded validity (green = valid, red = invalid)
- Grid snapping for precise placement
- Rotation support (90-degree increments)
- Collision detection with existing buildings
- Distance validation from Agora
- Success/error feedback messages

### Integration
- Works with existing building types and models
- Integrates with the current UI system
- Uses the same TILE_SIZE constant as the rest of the game
- Compatible with existing building placement logic

## Future Enhancements
- Resource cost validation
- Building construction time
- Building upgrades and demolition
- More building types
- Building-specific effects and bonuses
