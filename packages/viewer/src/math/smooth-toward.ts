import { lerp } from 'three/src/math/MathUtils.js'

// Frame-rate smoothing toward a target. The factor is clamped because the
// naive `lerp(current, target, delta * speed)` multiplies the error by
// |1 - speed*delta| each frame: it overshoots once delta > 1/speed and
// diverges past 2/speed. Clamped, every step is a contraction — identical feel
// at 60 fps, exact snap on a long frame.
export function smoothToward(current: number, target: number, delta: number, speed: number) {
  return lerp(current, target, Math.min(1, delta * speed))
}
