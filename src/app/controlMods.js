/** Flip individually while trying alternate control schemes. */

/** Quest Touch: trigger selects and lassoes; grip is force-/attack-move and pie pick. */
export const XR_SWAP_TRIGGER_GRIP = true;

/** Quest Touch: X / A cast; Y / B cancel (default is the reverse). */
export const XR_SWAP_FACE_BUTTONS = true;

/** Mouse: a left click while right-drag pans the camera casts the primary ability. */
export const POINTER_LMB_CAST_WHILE_RMB_PAN = true;

/** Four height presets (ground-run + 3 floats): ms between auto steps while pinch or stick-click is held. */
export const XR_ALTITUDE_REPEAT_MS = 220;

/** Left stick click: ms before the first tier step, then same cadence as {@link XR_ALTITUDE_REPEAT_MS}. */
export const XR_ALTITUDE_CLICK_INITIAL_MS = 180;
export const XR_ALTITUDE_CLICK_REPEAT_MS = XR_ALTITUDE_REPEAT_MS;

/** Ease onto a locked band (higher = snappier height transition). */
export const XR_ALTITUDE_EASE = 16;
/** Fast catch-up right after a tier jump. */
export const XR_ALTITUDE_SNAP = 48;

/** Extra room below ground-run (× head height) before free crawl. */
export const XR_FREE_UNDER = 2.25;

/** On a locked float tier, pinch can nudge this far (world Y) then spring back when neutral. */
export const XR_ALTITUDE_PLAY_SLACK = 14;
/** Decay per second of that nudge when pinch is neutral. */
export const XR_ALTITUDE_SLACK_DECAY = 6;

/** Held cast / move (XR, keyboard Q/A/T/G/H, gamepad B·D-pad·LB·RB). Sim is 20 Hz = 50 ms/tick. */
export const XR_HELD_CAST_INITIAL_MS = 180;
export const XR_HELD_CAST_REPEAT_MS = 180;
export const XR_HELD_ORDER_INITIAL_MS = 180;
export const XR_HELD_ORDER_REPEAT_MS = 180;
export const HELD_CAST_INITIAL_MS = XR_HELD_CAST_INITIAL_MS;
export const HELD_CAST_REPEAT_MS = XR_HELD_CAST_REPEAT_MS;
export const HELD_ORDER_INITIAL_MS = XR_HELD_ORDER_INITIAL_MS;
export const HELD_ORDER_REPEAT_MS = XR_HELD_ORDER_REPEAT_MS;