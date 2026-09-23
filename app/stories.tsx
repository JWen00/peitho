import { Redirect } from 'expo-router';

/**
 * Dev-only entry to the heatmap story gallery.
 *
 * The gallery itself lives outside `app/` (in `stories/`) so it is never part
 * of the shipped route tree; this shim is the only thing in `app/`. In a
 * production build `__DEV__` is false, so it renders a redirect and — because
 * the `require` sits in the dead branch that minification drops — the story
 * code and its fixtures are left out of the bundle entirely.
 */
export default function StoriesRoute() {
  if (!__DEV__) return <Redirect href="/" />;

  const HeatmapStories = require('@/stories/HeatmapStories').default;
  return <HeatmapStories />;
}
