import { MathUtils } from 'three'

const ZONE_FADE_RATE = 10

// Clamped smoothing. An unclamped `lerp(o, target, delta*10)` multiplies the
// error by |1 - 10*delta| per frame, so it DIVERGES once a frame exceeds
// 100 ms (idle render loop resuming, tab switch, software GPU): the opacity
// uniform ended far outside 0..1 and zones rendered as black patches.
// Clamping keeps every step a contraction: same feel at 60 fps, exact snap
// to the target on slow frames.
export function stepZoneOpacity(current: number, target: number, delta: number): number {
  return MathUtils.lerp(current, target, Math.min(1, ZONE_FADE_RATE * delta))
}
