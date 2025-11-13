# Menu System Audit & Fixes

## Issue
The 2D menu (menu.js) and 3D HUD (hud.js) were performing different actions for the same user choices, causing bugs and confusion.

## Comparison Results

### ✅ Buildings - CONSISTENT
Both menus:
- Camp, Village, Farm, Tower
- Call: `window.buildingSystem.selectBuilding(type)`
- **Status: Already consistent**

### ✅ Units (Monk/Wizard/Engineer) - CONSISTENT  
Both menus:
- Call: `window.recruitUnit(type)`
- Uses 'train' command in multiplayer, direct spawn in single-player
- **Status: Already consistent**

### ✅ Units (Brigand) - FIXED ✨
**Before:**
- 2D Menu: Used `TransformBehavior` (auto-reverts after 60s, breaks selection)
- 3D HUD: Used convert command (permanent, preserves selection)

**After:**
- Both now use: `window.currentMatch.submitCommand({ type: 'convert' })`
- Permanent conversion, no auto-revert
- Selection preserved
- Fully responsive units
- **Status: FIXED**

### ✅ Research - CONSISTENT
Both menus:
- Scribes, Drayage, Prospecting
- Placeholder console.log statements (not implemented yet)
- **Status: Already consistent**

### ✅ Rally - CONSISTENT
Both menus:
- Home
- Placeholder console.log statement (not implemented yet)
- **Status: Already consistent**

## Changes Made

### 1. `game/menu.js`
- Removed single-player TransformBehavior path for brigand conversion
- Now always uses convert command system (same as HUD)
- Simplified logic: check for `window.currentMatch && window.player`

### 2. `game/ai.js`
- Added safeguard in TransformBehavior constructor
- Disables in multiplayer with error message
- Prevents accidental use of legacy system

### 3. `game/match.js`
- Fixed `executeConvertCommand` to preserve unit ID
- Added selection transfer logic
- Added behavior cleanup
- Fixed checksum to include unit type

### 4. `game/units.js`
- Fixed `spawnUnitModels` to not override existing behaviors
- Prevents async race conditions

## Result
✅ Both menus now perform **identical actions**  
✅ No more auto-reverting brigands  
✅ Selection properly maintained  
✅ Fully deterministic in multiplayer  
✅ Consistent user experience regardless of menu choice  

## Testing Recommendations
1. Create brigand from 2D menu → should stay brigand permanently
2. Create brigand from 3D HUD → should stay brigand permanently  
3. Both should preserve selection
4. Both should work in single-player and multiplayer
5. No desync in multiplayer matches

