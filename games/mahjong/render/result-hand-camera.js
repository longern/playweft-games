export const RESULT_HAND_CAMERA_ELEVATION_DEGREES = 72;
export const RESULT_HAND_CAMERA_PITCH_DEGREES =
  90 - RESULT_HAND_CAMERA_ELEVATION_DEGREES;
export const RESULT_HAND_CAMERA_HORIZONTAL_FOV_DEGREES = 28;
export const RESULT_HAND_KEY_LIGHT_POSITION = Object.freeze({
  x: 0,
  y: 9,
  z: -6.5,
});

export function resultHandVerticalFov(aspect) {
  const horizontalFov =
    (RESULT_HAND_CAMERA_HORIZONTAL_FOV_DEGREES * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(horizontalFov / 2) / aspect) * 180) / Math.PI;
}

export function resultHandCameraDistance(viewWidth) {
  const horizontalFov =
    (RESULT_HAND_CAMERA_HORIZONTAL_FOV_DEGREES * Math.PI) / 180;
  return viewWidth / (2 * Math.tan(horizontalFov / 2));
}

export function resultHandCameraPosition(distance = 12) {
  const elevation = (RESULT_HAND_CAMERA_ELEVATION_DEGREES * Math.PI) / 180;
  return {
    x: 0,
    y: Math.sin(elevation) * distance,
    z: Math.cos(elevation) * distance,
  };
}
