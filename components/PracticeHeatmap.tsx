import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { getTalkHeatmap, heatmapIndex } from '@/lib/sessions';
import { localDateString } from '@/lib/topics';

/**
 * Count buckets, darkest last. All share the hue of the base `#bea9ea`; 2 and
 * 3+ are the same purple with the lightness dropped, so the ramp reads as one
 * colour rather than three. Index 0 is the empty-day track.
 */
const LEVEL_COLORS = ['#eceaf0', '#bea9ea', '#9171d6', '#6031c4'];

const CELL = 12;
const GAP = 3;

/** 0 talks -> 0, 1 -> 1, 2 -> 2, 3 or more -> 3. Indexes `LEVEL_COLORS`. */
function levelFor(count: number): number {
  if (count <= 0) return 0;
  return Math.min(count, 3);
}

/**
 * "2026-09-21" -> a Date at *local* midnight. Splitting the parts avoids
 * `new Date(string)` parsing the value as UTC and drifting a day, the same
 * reason `local_date` is a plain date string throughout.
 */
function parseLocal(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * The date window as columns of 7 days, oldest column first. Column 0 is padded
 * back to the Sunday on or before `from` so every column is a full week and the
 * rows line up by weekday; the padding days are `null` and render as gaps.
 *
 * Exported so the story gallery can build the same grid over a fixed range and
 * feed it fabricated counts.
 */
export function buildWeeks(from: string, to: string): (string | null)[][] {
  const start = parseLocal(from);
  const end = parseLocal(to);

  const cursor = parseLocal(from);
  cursor.setDate(cursor.getDate() - cursor.getDay());

  const weeks: (string | null)[][] = [];
  while (cursor <= end) {
    const week: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      week.push(cursor >= start && cursor <= end ? localDateString(cursor) : null);
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export type HeatmapState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; counts: Map<string, number>; weeks: (string | null)[][] };

interface HeatmapViewProps {
  state: HeatmapState;
  /**
   * When set, day cells become tappable and report the day they cover. Only
   * days inside the range are pressable; padding days stay inert. Omit it and
   * the grid is display-only, which is what the story gallery wants.
   */
  onSelectDay?: (date: string) => void;
  /** The currently drilled-into day, outlined so the tap has a visible target. */
  selectedDay?: string | null;
}

/**
 * The heatmap as pure presentation: hand it a resolved {@link HeatmapState} and
 * it draws that state, nothing more. Kept free of data fetching so the story
 * gallery can render every state without a network, and so the container below
 * is the only thing that talks to Supabase.
 */
export function HeatmapView({ state, onSelectDay, selectedDay }: HeatmapViewProps) {
  if (state.status === 'loading') {
    return (
      <View style={styles.placeholder}>
        <ActivityIndicator />
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.errorText}>{state.message}</Text>
      </View>
    );
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Newest week is the most interesting; start scrolled to it.
        ref={(node) => node?.scrollToEnd({ animated: false })}
        contentContainerStyle={styles.grid}
      >
        {state.weeks.map((week, weekIndex) => (
          <View key={weekIndex} style={styles.week}>
            {week.map((date, dayIndex) => {
              // Padding days outside the range paint nothing and never respond.
              if (!date) {
                return <View key={dayIndex} style={[styles.cell, styles.cellEmpty]} />;
              }
              const count = state.counts.get(date) ?? 0;
              const fill = { backgroundColor: LEVEL_COLORS[levelFor(count)] };
              const selected = date === selectedDay;
              // Cells with no talks are not worth drilling into — there is
              // nothing on the other side of the tap.
              if (!onSelectDay || count === 0) {
                return (
                  <View
                    key={dayIndex}
                    style={[styles.cell, fill, selected && styles.cellSelected]}
                  />
                );
              }
              return (
                <Pressable
                  key={dayIndex}
                  onPress={() => onSelectDay(date)}
                  style={({ pressed }) => [
                    styles.cell,
                    fill,
                    selected && styles.cellSelected,
                    pressed && styles.cellPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${date}: ${count} ${count === 1 ? 'talk' : 'talks'}`}
                  accessibilityState={{ selected }}
                />
              );
            })}
          </View>
        ))}
      </ScrollView>

      <View style={styles.legend}>
        <Text style={styles.legendLabel}>Less</Text>
        {LEVEL_COLORS.map((color) => (
          <View key={color} style={[styles.cell, { backgroundColor: color }]} />
        ))}
        <Text style={styles.legendLabel}>More</Text>
      </View>
    </View>
  );
}

export interface PracticeHeatmapProps {
  /** How many days back the grid covers, ending today. Defaults to a year. */
  days?: number;
  /** Forwarded to {@link HeatmapView}: makes days with talks tappable. */
  onSelectDay?: (date: string) => void;
  /** The day currently drilled into, outlined in the grid. */
  selectedDay?: string | null;
}

/**
 * A calendar heatmap of daily practice, GitHub-contributions style: one cell
 * per day, coloured by how many talks were recorded, scrolling horizontally
 * with the oldest week on the left. Fetches its own range and renders it
 * through {@link HeatmapView}.
 */
export function PracticeHeatmap({
  days = 365,
  onSelectDay,
  selectedDay,
}: PracticeHeatmapProps) {
  const [state, setState] = useState<HeatmapState>({ status: 'loading' });

  const fetchRange = useCallback(async () => {
    const to = localDateString();
    const fromDate = parseLocal(to);
    fromDate.setDate(fromDate.getDate() - (days - 1));
    const from = localDateString(fromDate);

    try {
      const heatmap = await getTalkHeatmap(from, to);
      setState({
        status: 'ready',
        counts: heatmapIndex(heatmap),
        weeks: buildWeeks(from, to),
      });
    } catch (error) {
      setState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Could not load your activity.',
      });
    }
  }, [days]);

  // Refetch on focus, not just on mount: a talk saved on the Practice tab has
  // to light its day up here without a manual reload. The grid keeps showing
  // its last-good state while the refetch runs, so a return to this tab does
  // not flash a spinner over data that is already correct.
  useFocusEffect(
    useCallback(() => {
      fetchRange();
    }, [fetchRange]),
  );

  return (
    <HeatmapView state={state} onSelectDay={onSelectDay} selectedDay={selectedDay} />
  );
}

const styles = StyleSheet.create({
  placeholder: {
    height: 7 * CELL + 6 * GAP,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: { fontSize: 13, color: '#c0392b', textAlign: 'center' },
  grid: { flexDirection: 'row', gap: GAP },
  week: { gap: GAP },
  cell: { width: CELL, height: CELL, borderRadius: 2 },
  // A padding day outside the range: takes space but paints nothing.
  cellEmpty: { backgroundColor: 'transparent' },
  // The drilled-into day, ringed so the current filter is legible at a glance.
  cellSelected: { borderWidth: 1.5, borderColor: '#333' },
  cellPressed: { opacity: 0.6 },
  legend: { flexDirection: 'row', alignItems: 'center', gap: GAP, marginTop: 10 },
  legendLabel: { fontSize: 12, color: '#888', marginHorizontal: 4 },
});
