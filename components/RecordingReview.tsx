import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { SymbolView } from 'expo-symbols';
import { useCallback, useEffect, useState } from 'react';
import {
  type LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
} from 'react-native';

/**
 * Elapsed playback time, floored.
 *
 * Deliberately not the recorder's `formatClock`, which rounds *up* because it
 * renders a countdown — flooring is what a position readout wants, so that a
 * clip sitting at 0.4s reads 0:00 rather than jumping straight to 0:01.
 */
function formatTime(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${`${seconds}`.padStart(2, '0')}`;
}

/** Matches the recorder's poll cadence, which keeps the progress bar smooth. */
const UPDATE_INTERVAL_MS = 200;
/** Treat "within this much of the end" as finished, for the replay tap. */
const END_EPSILON_SECONDS = 0.05;

interface RecordingReviewProps {
  /** File URI of the clip — a local path, or a signed URL for a saved talk. */
  uri: string;
  /** A caller's own measurement, used until the player reports a duration. */
  durationSeconds: number;
  /**
   * Fetch the whole clip before playing. Off for local files, which are
   * already on disk; on for remote ones, where seeking into a stream that has
   * not arrived yet leaves the scrubber fighting the buffer.
   */
  downloadFirst?: boolean;
}

/**
 * Plays a clip back with a scrubber.
 *
 * Used in two places: reviewing a take before saving it, where the uri is the
 * local file `VoiceRecorder` wrote, and replaying a saved talk, where it is a
 * short-lived signed URL. Unmounting releases the player, which is how the
 * save, discard and navigate-away paths all stop playback.
 */
export default function RecordingReview({
  uri,
  durationSeconds,
  downloadFirst = false,
}: RecordingReviewProps) {
  // A fresh object literal each render is fine: `useAudioPlayer` memoizes on
  // the serialized source, so the native player is not re-created.
  const player = useAudioPlayer(
    { uri },
    { updateInterval: UPDATE_INTERVAL_MS, downloadFirst },
  );
  const status = useAudioPlayerStatus(player);

  const [trackWidth, setTrackWidth] = useState(0);

  // `status.duration` is 0 until the file is loaded, and on some Android
  // encoders it stays slightly short of what was actually captured.
  const duration = Math.max(status.duration, durationSeconds);
  const progress = duration > 0 ? Math.min(1, status.currentTime / duration) : 0;

  // Rewind when the clip runs out, so the button reads as "play from the top"
  // rather than leaving the bar pinned at the end.
  useEffect(() => {
    if (!status.didJustFinish) return;
    void player.seekTo(0);
  }, [player, status.didJustFinish]);

  const toggle = useCallback(async () => {
    if (status.playing) {
      player.pause();
      return;
    }
    // Backstop for the rewind above, in case the finish event was missed.
    if (duration > 0 && status.currentTime >= duration - END_EPSILON_SECONDS) {
      await player.seekTo(0);
    }
    player.play();
  }, [duration, player, status.currentTime, status.playing]);

  const handleTrackLayout = useCallback((event: LayoutChangeEvent) => {
    setTrackWidth(event.nativeEvent.layout.width);
  }, []);

  const handleTrackPress = useCallback(
    (event: GestureResponderEvent) => {
      if (trackWidth <= 0 || duration <= 0) return;
      const ratio = Math.min(1, Math.max(0, event.nativeEvent.locationX / trackWidth));
      void player.seekTo(ratio * duration);
    },
    [duration, player, trackWidth],
  );

  const ready = status.isLoaded;

  return (
    <View style={styles.container}>
      <Pressable
        style={[styles.playButton, !ready && styles.playButtonDisabled]}
        onPress={() => void toggle()}
        disabled={!ready}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? 'Pause playback' : 'Play your recording'}
      >
        <SymbolView
          name={{
            ios: status.playing ? 'pause.fill' : 'play.fill',
            android: status.playing ? 'pause' : 'play_arrow',
            web: status.playing ? 'pause' : 'play_arrow',
          }}
          tintColor="#fff"
          size={24}
        />
      </Pressable>

      <View style={styles.scrubber}>
        <Pressable
          style={styles.track}
          hitSlop={{ top: 14, bottom: 14 }}
          onLayout={handleTrackLayout}
          onPress={handleTrackPress}
        >
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
        </Pressable>
        <View style={styles.times}>
          <Text style={styles.time}>{formatTime(status.currentTime)}</Text>
          <Text style={styles.time}>{formatTime(duration)}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    alignSelf: 'stretch',
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playButtonDisabled: { opacity: 0.4 },
  scrubber: { flex: 1, gap: 6 },
  // hitSlop gives the thin bar a finger-sized tap target without thickening it.
  track: { height: 6, borderRadius: 3, backgroundColor: '#e4e4e4', overflow: 'hidden' },
  trackFill: { height: 6, borderRadius: 3, backgroundColor: '#333' },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 12, color: '#888', fontVariant: ['tabular-nums'] },
});
