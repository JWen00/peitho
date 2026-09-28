import { StyleSheet, Text, View } from 'react-native';

import { bandFor, SKILLS, type Band, type TalkFeedback } from '@/lib/feedback';

const BRAND = '#aa88f1';

const BAND_COLOR: Record<Band, string> = {
  'Getting there': '#d98a3d',
  Solid: '#7c5fd6',
  Sharp: '#2e9e6b',
};

/** Five dots, filled up to `score` (out of 5). */
function ScoreDots({ score }: { score: number }) {
  return (
    <View style={styles.dots}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View key={n} style={[styles.dot, n <= score ? styles.dotOn : styles.dotOff]} />
      ))}
    </View>
  );
}

/**
 * Pure presentation of a scored talk: the band, per-skill dots, strengths and
 * suggestions. Free of data fetching so the story gallery can render fabricated
 * feedback without the on-device model — the container owns `scoreTalk`.
 */
export default function FeedbackView({ feedback }: { feedback: TalkFeedback }) {
  const band = bandFor(feedback.overall);

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>Feedback</Text>

      <View style={styles.overallRow}>
        <Text style={[styles.overallScore, { color: BAND_COLOR[band] }]}>
          {feedback.overall}
        </Text>
        <View style={[styles.bandPill, { backgroundColor: BAND_COLOR[band] }]}>
          <Text style={styles.bandText}>{band}</Text>
        </View>
      </View>

      <View style={styles.skills}>
        {SKILLS.map((skill) => (
          <View key={skill.key} style={styles.skillRow}>
            <Text style={styles.skillLabel}>{skill.label}</Text>
            <ScoreDots score={feedback.scores[skill.key] ?? 0} />
          </View>
        ))}
      </View>

      {feedback.strengths.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>What went well</Text>
          {feedback.strengths.map((item, i) => (
            <Text key={i} style={styles.item}>
              • {item}
            </Text>
          ))}
        </View>
      ) : null}

      {feedback.suggestions.length > 0 ? (
        <View style={styles.block}>
          <Text style={styles.blockLabel}>Try next time</Text>
          {feedback.suggestions.map((item, i) => (
            <Text key={i} style={styles.item}>
              • {item}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 40, borderTopWidth: 1, borderTopColor: '#eee', paddingTop: 24 },
  sectionLabel: {
    fontSize: 13,
    color: '#888',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 14,
  },
  overallRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  overallScore: { fontSize: 44, fontWeight: '800', fontVariant: ['tabular-nums'] },
  bandPill: { borderRadius: 999, paddingHorizontal: 14, paddingVertical: 6 },
  bandText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  skills: { gap: 12, marginBottom: 8 },
  skillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skillLabel: { fontSize: 15, color: '#333' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotOn: { backgroundColor: BRAND },
  dotOff: { backgroundColor: '#e6e0f2' },
  block: { marginTop: 20 },
  blockLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  item: { fontSize: 15, color: '#444', lineHeight: 22, marginBottom: 4 },
});
