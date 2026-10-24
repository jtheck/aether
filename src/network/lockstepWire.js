import { CMD } from '../sim/commands.js';

// Reserved transport-only field. Canonical command frames never contain it.
const UNIFORM_MOVE_TARGET = '$m';

function compactCommand(command) {
  if (
    !command ||
    command.type !== CMD.MOVE ||
    command.transportAssignments != null ||
    command[UNIFORM_MOVE_TARGET] != null ||
    !Array.isArray(command.entities) ||
    !Array.isArray(command.tx) ||
    !Array.isArray(command.ty) ||
    command.entities.length === 0 ||
    command.tx.length !== command.entities.length ||
    command.ty.length !== command.entities.length
  ) {
    return command;
  }

  const x = command.tx[0];
  const y = command.ty[0];
  if (!Number.isFinite(x) || !Number.isFinite(y)) return command;
  for (let i = 1; i < command.entities.length; i++) {
    if (command.tx[i] !== x || command.ty[i] !== y) return command;
  }

  const compact = { ...command, [UNIFORM_MOVE_TARGET]: [x, y] };
  delete compact.tx;
  delete compact.ty;
  return compact;
}

function expandCommand(command) {
  const target = command?.[UNIFORM_MOVE_TARGET];
  if (
    command?.type !== CMD.MOVE ||
    !Array.isArray(command.entities) ||
    !Array.isArray(target) ||
    target.length !== 2
  ) {
    return command;
  }

  const expanded = { ...command };
  delete expanded[UNIFORM_MOVE_TARGET];
  expanded.tx = new Array(command.entities.length).fill(target[0]);
  expanded.ty = new Array(command.entities.length).fill(target[1]);
  return expanded;
}

function mapFrameCommands(frame, mapper) {
  if (!frame || !Array.isArray(frame.commands) || frame.commands.length === 0) return frame;
  let changed = false;
  const commands = frame.commands.map((command) => {
    const next = mapper(command);
    if (next !== command) changed = true;
    return next;
  });
  return changed ? { ...frame, commands } : frame;
}

/** Compact a live frame for JSON transport without mutating its canonical form. */
export function compactFrameForTransport(frame) {
  return mapFrameCommands(frame, compactCommand);
}

/** Restore a transport frame to the canonical command shape before ingestion. */
export function expandTransportFrame(frame) {
  return mapFrameCommands(frame, expandCommand);
}
