import { ScrollView, StyleSheet, Text, View } from 'react-native';

import FeedbackView from '@/components/FeedbackView';
import type { TalkFeedback } from '@/lib/feedback';

/**
 * Dev-only gallery for the feedback results UI. Feeds {@link FeedbackView}
 * fabricated scores across the three bands, so the layout can be checked without
 * the on-device model (which needs iOS 26 + Apple Intelligence).
 */
const SAMPLES: { caption: string; feedback: TalkFeedback }[] = [
  {
    caption: 'Sharp example',
    feedback: {
      overall: 91,
      scores: {
        clarity: 5,
        flow: 5,
        structure: 5,
        engagement: 4,
        expression: 5,
        flexibility: 4,
      },
      strengths: [
        'You opened with a vivid moment and stayed on it — the listener could picture the whole scene.',
        'Your closing line tied the story back to the topic cleanly and with real warmth.',
      ],
      suggestions: [
        'Next time, try one deliberate pause before the final line to let it land.',
      ],
    },
  },
  {
    caption: 'Solid example',
    feedback: {
      overall: 76,
      scores: {
        clarity: 4,
        flow: 3,
        structure: 4,
        engagement: 4,
        expression: 3,
        flexibility: 3,
      },
      strengths: [
        'A clear beginning, middle, and end — easy to follow the whole way through.',
        'The stranger-cheering-you-on detail gave the listener something concrete to hold onto.',
      ],
      suggestions: [
        'Next time, try varying your sentence length to add a little rhythm.',
        'A touch more emotion in the middle would let your personality come through.',
      ],
    },
  },
  {
    caption: 'Getting there example',
    feedback: {
      overall: 52,
      scores: {
        clarity: 3,
        flow: 2,
        structure: 2,
        engagement: 3,
        expression: 3,
        flexibility: 3,
      },
      strengths: [
        'You kept going for the full minute and stayed on topic — that is the hardest part.',
      ],
      suggestions: [
        'Next time, try planning a quick beginning-middle-end before you start.',
        'Pausing instead of filling gaps will make you sound more sure of yourself.',
      ],
    },
  },
];

export default function FeedbackStories() {
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Feedback</Text>
        {SAMPLES.map((sample) => (
          <View key={sample.caption}>
            <Text style={styles.caption}>{sample.caption}</Text>
            <FeedbackView feedback={sample.feedback} />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 24, paddingBottom: 60 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  caption: {
    fontSize: 12,
    fontWeight: '700',
    color: '#aa88f1',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: 24,
  },
});
