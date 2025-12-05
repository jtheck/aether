# Victory and Loss Conditions

## Overview
Added two new win/loss conditions to make matches more dynamic and engaging.

## Loss Condition: Villager Elimination
**When it triggers**: Player has 0 villagers remaining  
**Why it matters**: Villagers are essential - they gather resources, construct buildings, and can convert into other units. Without them, you can't rebuild your economy.

### Implementation
- Checked every second during match tick
- Triggers elimination immediately when villager count drops to zero
- Works alongside existing building destruction mechanics

```javascript
const villagers = player.units?.filter(u => u && u.type === 'villager') || [];
if (villagers.length === 0) {
  this.eliminatePlayer(pid);
}
```

## Win Condition: Agora Occupation
**When it triggers**: Enemy units occupy opponent's Agora for 5 seconds  
**Why it matters**: Capturing the enemy's main base = instant victory

### How Occupation Works
1. **Detection**: Any enemy unit within 8 tiles of an Agora starts occupation
2. **Timer**: Must hold position for 5 seconds continuously
3. **Interruption**: If defenders push attackers away, timer resets
4. **Victory**: After 5 seconds of continuous occupation, game ends

### Visual Feedback
- 🚩 **Notification** when occupation starts: "Agora under attack!"
- ⏳ **Progress updates** every second showing occupation percentage
- ✅ **Clear notification** when defenders successfully push back
- 🏆 **Victory/defeat screen** shows "Enemy Agora Captured!" or "Your Agora Was Captured!"

### Technical Details
```javascript
const OCCUPATION_RADIUS = 8; // Tiles around Agora
const OCCUPATION_TIME = 5;    // Seconds to hold for victory

// Occupation tracked per Agora with:
// - occupier: Player ID attempting capture
// - startTime: When occupation began (game time)
// - defender: Player being attacked
```

### Implementation Features
- ✅ Works in both single-player and multiplayer
- ✅ Handles multiple players correctly
- ✅ Resets timer if occupation is broken
- ✅ Shows appropriate notifications to all players
- ✅ Marks Agora as "contested" with attacker ID
- ✅ Victory reason properly displayed on end screen

## Notification System
Created a visual notification system for in-game events:

- **Warning** (orange): Agora under attack
- **Error** (red): Desyncs, critical issues
- **Success** (green): Achievements, milestones
- **Defeat** (dark red): Elimination messages
- **Info** (blue): General information

Notifications:
- Slide in from top center
- Auto-dismiss after 3 seconds
- Stack if multiple occur
- Don't block gameplay (pointer-events: none)

## Victory Screen Updates
Enhanced end game screen to show specific victory reasons:

- 🚩 "Enemy Agora Captured!" (occupation victory)
- ⚔️ "All Enemies Eliminated!" (standard elimination)
- 💀 "All Your Villagers Died!" (villager loss)
- ⏱️ "Time Limit Reached" (time limit)
- 🏛️ "Wonder Victory" (wonder completion)
- ✨ "Relic Victory" (relic collection)

## Files Modified
- `game/match.js`: Victory condition logic, occupation checking, notifications
- `rt.css`: Notification animations and styling

## Testing Recommendations
1. Test villager elimination by killing all villagers
2. Test Agora occupation by moving units near enemy Agora
3. Test occupation interruption by pushing attackers away
4. Verify multiplayer synchronization
5. Check notification display timing and stacking
6. Verify victory screen shows correct reason









