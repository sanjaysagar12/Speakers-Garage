/**
 * Hot input state shared between the React joystick and Phaser movement.
 * Deliberately a plain mutable object (not zustand) so 60Hz writes never trigger React renders.
 */
export const inputState = {
  joyX: 0,
  joyY: 0,
  joyActive: false,
  joyRun: false,
};
