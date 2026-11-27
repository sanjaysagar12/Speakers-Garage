/**
 * Simulation constants shared by the client (prediction) and the server (authority). Changing any of these
 * changes movement for everyone, so both sides must run the same build of this package.
 * World units are metres: x = east, z = south, y = up. Map "north" is -z.
 */
export const SIM = {
  player: {
    walkSpeed: 3.4,
    runSpeed: 6.4,
    shallowMultiplier: 0.55,
    /** units/s² style responsiveness of the velocity filter */
    acceleration: 11,
    /** radians/s the body turns toward the movement direction */
    turnSpeed: 10,
    /** collider radius (a true circle) */
    radius: 0.28,
    /** largest height change walkable in one step (deck edges are taller; ramps are not) */
    stepHeight: 0.4,
  },
  collision: {
    cell: 0.25,
    pathCell: 0.5,
  },
} as const;

export const DEG = Math.PI / 180;
