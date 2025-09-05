# 🎯 Lasso Selection System

A rectangle-based selection system for the Æther.Garden game that allows players to select multiple units by drawing a selection box on screen.

## How It Works

1. **Click and Drag**: Left-click and drag to create a selection rectangle
2. **Visual Feedback**: A green selection box appears while dragging
3. **Unit Detection**: Units within the selection area are automatically detected
4. **Selection Highlight**: Selected units get a green glow and slight scale increase

## Features

- **Real-time Selection Box**: Visual rectangle that follows your mouse/touch
- **Multi-unit Selection**: Select multiple units at once
- **Visual Feedback**: Selected units are highlighted with green glow
- **Integration**: Works with the existing game systems

## Usage

### Basic Selection
1. Left-click and hold at the starting point
2. Drag to expand the selection area
3. Release to complete the selection

### Programmatic Access
```javascript
// Get currently selected units
const selectedUnits = window.lassoSelection.getSelectedUnits();

// Check if currently selecting
const isSelecting = window.lassoSelection.isSelecting();

// Clear current selection
window.lassoSelection.clearSelection();

// Test the system
window.lassoSelection.test();
```

## Technical Details

### Selection Algorithm
The system converts screen coordinates to world coordinates and checks if units fall within the selection rectangle. It uses a simplified approach that creates a selection area in front of the camera.

### Unit Detection
- Checks all units in `window.gameUnits`
- Verifies units have valid mesh and position data
- Uses bounding box intersection for selection

### Visual Effects
- **Selection Box**: Green rectangle with glow effect
- **Unit Highlighting**: Green emissive color and 1.1x scale
- **Smooth Transitions**: CSS transitions for smooth visual updates

## Integration

The lasso system integrates with:
- **UI System**: Handles pointer events (down, move, up)
- **Graphics System**: Uses camera and scene for coordinate conversion
- **Units System**: Accesses `window.gameUnits` for unit management
- **Event System**: Calls `window.onUnitsSelected()` callback when units are selected

## Testing

To test the system:
1. Open the browser console
2. Run: `window.lassoSelection.test()`
3. Try clicking and dragging on the game screen

## Troubleshooting

### Common Issues
- **No units selected**: Check if `window.gameUnits` contains units with valid meshes
- **Selection box not visible**: Verify CSS is loaded and z-index is correct
- **Units not highlighting**: Check if units have materials that support emissive colors

### Debug Information
The system provides extensive console logging:
- Selection start/end events
- Unit detection process
- Coordinate conversion details
- Selection results

## Future Enhancements

- **Polygonal Selection**: Support for free-form selection shapes
- **Selection Groups**: Save and restore selection sets
- **Advanced Filtering**: Select units by type, owner, or other criteria
- **Selection Memory**: Remember last selection for quick re-selection
