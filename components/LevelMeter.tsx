import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** How many bars are on screen at once. */
const BAR_COUNT = 40;
/** Bars never fully collapse, so the meter reads as a live baseline, not a gap. */
const MIN_BAR_PERCENT = 8;
/** Below this normalized level, a sample counts as silence. */
const SILENT_LEVEL = 0.04;
/** Roughly two seconds of consecutive silence before we say anything. */
const SILENT_SAMPLE_COUNT = 20;
/** Don't cry silence before the mic has had a moment to deliver real samples. */
const SILENCE_GRACE_MS = 2500;

interface LevelMeterProps {
  /**
   * Latest input level, already normalized to 0-1 by whoever owns the mic.
   * Kept scale-agnostic on purpose: the recorder knows whether it is reading
   * dBFS or the recognizer's own -2 to 10 range, and this does not need to.
   */
  level: number;
  /**
   * The recorder's elapsed time. Drives one bar per tick — keyed on this rather
   * than on `level` so the meter keeps scrolling through silence, where the
   * reading holds steady at the floor and would otherwise freeze.
   */
  durationMillis: number;
  /** Whether a take is currently under way. */
  active: boolean;
  /** Tints the bars amber in step with the recorder's wrap-up cue. */
  warning?: boolean;
}

/**
 * A scrolling bar meter of live mic input, so the user can see their voice is
 * actually reaching the recorder rather than trusting a timer that ticks just
 * as happily through a dead microphone.
 *
 * Forty plain views re-laid-out per poll is well within budget for this screen,
 * which animates nothing else; if the meter ever shares a screen with heavier
 * animation, this is the thing to move onto `react-native-svg` as a single path.
 */
export default function LevelMeter({
  level,
  durationMillis,
  active,
  warning = false,
}: LevelMeterProps) {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));

  // Start each take from a clean baseline rather than the tail of the last one.
  useEffect(() => {
    if (active) setLevels(new Array(BAR_COUNT).fill(0));
  }, [active]);

  // `level` and `durationMillis` are set together on the recorder's tick, so
  // this appends exactly one bar per frame.
  useEffect(() => {
    if (!active) return;
    setLevels((previous) => [...previous.slice(1), Number.isFinite(level) ? level : 0]);
  }, [active, durationMillis, level]);

  const heardNothing =
    active &&
    durationMillis >= SILENCE_GRACE_MS &&
    levels.slice(-SILENT_SAMPLE_COUNT).every((sample) => sample <= SILENT_LEVEL);

  return (
    <View style={styles.wrapper}>
      <View style={styles.bars}>
        {levels.map((level, index) => (
          <View
            key={index}
            style={[
              styles.bar,
              warning && styles.barWarning,
              { height: `${MIN_BAR_PERCENT + level * (100 - MIN_BAR_PERCENT)}%` },
            ]}
          />
        ))}
      </View>
      {heardNothing ? (
        <Text style={styles.silence}>
          No sound reaching the mic — is something covering it?
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'center', gap: 8, alignSelf: 'stretch' },
  bars: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 56,
    gap: 3,
  },
  bar: { width: 3, borderRadius: 2, backgroundColor: '#c0392b' },
  barWarning: { backgroundColor: '#e67e22' },
  silence: { fontSize: 13, color: '#e67e22', textAlign: 'center' },
});
