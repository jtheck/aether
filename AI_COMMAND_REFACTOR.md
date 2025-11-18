# AI Command System Refactor 🤖⚔️

## Problem

The AI was using **two different systems** to control units:

### ❌ Old (Legacy) - Direct Manipulation
```javascript
// opponent.js - executeAIAction()
window.placeBuilding(type, x, z);  // Direct manipulation
aiPlayer.addUnit(type, pos);       // Bypasses validation
window.behaviorManager.setBehavior(...); // No sync in multiplayer
```

**Issues:**
- ❌ Bypasses command validation
- ❌ Not synchronized in multiplayer (causes desync)
- ❌ Different code path than human players
- ❌ Can't be replayed or audited

### ✅ New - Command System
```javascript
// opponent.js - executeAIAction()
window.currentMatch.submitCommand({
  type: 'build',
  playerId: aiPlayer.id,
  buildingType: 'camp',
  gridX: x,
  gridZ: z
});
```

**Benefits:**
- ✅ Uses same validation as human players
- ✅ Synchronized in multiplayer (deterministic)
- ✅ Goes through Match command buffer
- ✅ Can be replayed and audited
- ✅ Host generates AI commands, clients execute them

---

## Changes Made

### 1. Refactored `executeAIAction()` (opponent.js:659-741)

**Before:**
- `case 'build'`: Called `window.placeBuilding()` directly
- `case 'train'`: Called `aiPlayer.addUnit()` directly
- `case 'gather'`: Called `window.resources.gather()` directly
- `case 'attack'`: Called `window.combat.attack()` directly

**After:**
- All cases now call `window.currentMatch.submitCommand({...})`
- Commands go through the same validation and execution as human commands
- In multiplayer, commands are broadcast and executed deterministically

### 2. Refactored Tactical Functions

#### `defendBase()` (opponent.js:461-496)
- **Before**: `window.behaviorManager.setBehavior(unit, 'run', {...})`
- **After**: `window.currentMatch.submitCommand({type: 'move', ...})`

#### `launchAttack()` (opponent.js:498-534)
- **Before**: `window.behaviorManager.setBehavior(unit, 'run', {...})`
- **After**: `window.currentMatch.submitCommand({type: 'move', ...})` with formation

#### `patrolTerritory()` (opponent.js:569-594)
- **Before**: `window.behaviorManager.setBehavior(unit, 'walk', {...})`
- **After**: `window.currentMatch.submitCommand({type: 'move', ...})`

#### `manageWorkerUnits()` (opponent.js:619-663)
- **Before**: Called `assignWorkerToBuilding()` which directly set behaviors
- **After**: `window.currentMatch.submitCommand({type: 'work', ...})`
- **Removed**: `assignWorkerToBuilding()` helper (obsolete)

---

## Architecture

### How It Works Now

```
┌─────────────────────────────────────────────────────────────┐
│                      MATCH SYSTEM                            │
│  (Single source of truth for all player actions)            │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │
         ┌─────────────────┼─────────────────┐
         │                 │                 │
         │                 │                 │
    ┌────▼────┐       ┌────▼────┐      ┌────▼────┐
    │ HUMAN   │       │   AI    │      │ REMOTE  │
    │ PLAYER  │       │ PLAYER  │      │ PLAYER  │
    │         │       │         │      │         │
    │ ui.js   │       │opponent │      │  net.js │
    │ click→  │       │ .js     │      │ receive │
    │ submit  │       │ think→  │      │ →submit │
    │ command │       │ submit  │      │ command │
    └─────────┘       └─────────┘      └─────────┘
```

### Command Flow (Multiplayer)

```
HOST:
1. AI thinks (makeAIDecision)
2. AI submits command (submitCommand)
3. Command broadcast to all clients
4. Host executes command (executeCommand)

CLIENT:
1. Receives command from host
2. Validates and adds to command buffer
3. Executes command at same tick as host
```

---

## What Still Uses Direct Manipulation?

### ✅ Allowed Direct Behaviors:
- **Idle behaviors**: Units lingering, wandering when idle (local visual)
- **Physics**: Unit movement integration (deterministic)
- **Animation**: Visual states (cosmetic)

### ❌ Never Direct:
- Building placement
- Unit training
- Unit movement commands
- Attack commands
- Gather/work commands

---

## Testing Checklist

### Single Player
- [ ] AI builds camps near resources
- [ ] AI trains villagers
- [ ] AI assigns workers to camps
- [ ] AI builds military buildings
- [ ] AI trains military units
- [ ] AI defends base when attacked
- [ ] AI launches attacks when strong enough
- [ ] AI patrols with military units

### Multiplayer (Host vs AI)
- [ ] Host sees AI building
- [ ] Client sees AI building (synchronized)
- [ ] AI units move on both clients
- [ ] No desync errors in console
- [ ] Checksum validation passes

### Replay System
- [ ] AI commands recorded in replay
- [ ] Replay shows correct AI actions
- [ ] Can replay AI vs Player matches

---

## Performance Notes

### Command Spam Prevention
The AI decision maker runs at different rates based on difficulty:
- **Easy**: 1 action per second
- **Normal**: 2 actions per second
- **Hard**: 3 actions per second

This prevents command buffer overflow and keeps network traffic manageable.

### Tactical Command Throttling
- `defendBase()`: Checks every tick but only issues commands when needed
- `patrolTerritory()`: Only issues commands when units are idle
- `manageWorkerUnits()`: Only assigns idle workers (doesn't reassign)

---

## Future Improvements

### Potential Optimizations
1. **Batch Commands**: Group multiple unit moves into single command
2. **Command Prediction**: Predict AI moves client-side for smoothness
3. **Command Compression**: Compress repeated patterns (formations)

### AI Enhancements
1. **Scouting**: AI sends scouts to explore map
2. **Tech Upgrades**: AI researches technologies
3. **Formations**: AI uses better military formations
4. **Micro**: AI retreats damaged units
5. **Macro**: AI expands to new resource locations

---

## Summary

✅ **AI now works through the same systems as humans**
✅ **Multiplayer-safe and deterministic**
✅ **Can be replayed and audited**
✅ **Easier to debug (all actions logged as commands)**
✅ **No more desync issues from AI actions**

The AI is now a **first-class player** that follows all the same rules as humans! 🎮

