import { Redirect } from 'expo-router';

// Dev-only shim — see app/stories/index.tsx. The require sits in the dead
// branch that minification drops, so the story code stays out of production.
export default function HeatmapStoriesRoute() {
  if (!__DEV__) return <Redirect href="/" />;

  // eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: the require sits in the dead __DEV__ branch so Metro drops the story from production bundles.
  const HeatmapStories = require('@/stories/HeatmapStories').default;
  return <HeatmapStories />;
}
