import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** How many bars are on screen at once. */
const BAR_COUNT = 40;
/**
 * Visual floor in dBFS.
 *
 * Both platforms report dBFS in [-160, 0] (iOS `averagePower`, Android
 * `20 * log10(amplitude / 32767)` with silence pinned to -160), but the bottom
 * 100 dB of that range is all inaudible. Speech sits around -40 to -10, so
 * anchoring the bars at -60 spends the height where the signal actually is.
 */
const FLOOR_DB = -60;
/** Bars never fully collapse, so the meter reads as a live baseline, not a gap. */
const MIN_BAR_PERCENT = 8;
/** Below this normalized level, a sample counts as silence. */
const SILENT_LEVEL = 0.04;
/** Roughly two seconds of consecutive silence before we say anything. */
const SILENT_SAMPLE_COUNT = 20;
/** Don't cry silence before the mic has had a moment to deliver real samples. */
const SILENCE_GRACE_MS = 2500;

function levelFromMetering(metering: number | undefined): number {
  // `metering` is absent until the first poll, and absent entirely if the
  // recorder was built without `isMeteringEnabled`.
  if (metering == null || !Number.isFinite(metering)) return 0;
  const clamped = Math.min(0, Math.max(FLOOR_DB, metering));
  return (clamped - FLOOR_DB) / -FLOOR_DB;
}

interface LevelMeterProps {
  /** Latest dBFS reading from `RecorderState`. */
  metering?: number;
  /**
   * The recorder's elapsed time. Drives one bar per status poll — keyed on this
   * rather than on `metering` so the meter keeps scrolling through silence,
   * where the reading holds steady at the floor and would otherwise freeze.
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
  metering,
  durationMillis,
  active,
  warning = false,
}: LevelMeterProps) {
  const [levels, setLevels] = useState<number[]>(() => new Array(BAR_COUNT).fill(0));

  // Start each take from a clean baseline rather than the tail of the last one.
  useEffect(() => {
    if (active) setLevels(new Array(BAR_COUNT).fill(0));
  }, [active]);

  // `metering` and `durationMillis` arrive on the same status object, so this
  // appends exactly one bar per poll.
  useEffect(() => {
    if (!active) return;
    setLevels((previous) => [...previous.slice(1), levelFromMetering(metering)]);
  }, [active, durationMillis, metering]);

  const heardNothing =
    active &&
    durationMillis >= SILENCE_GRACE_MS &&
    levels.slice(-SILENT_SAMPLE_COUNT).every((level) => level <= SILENT_LEVEL);

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
        <Text style={styles.silence}>No sound reaching the mic — is something covering it?</Text>
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
