import { Redirect } from 'expo-router';

// Dev-only shim — see app/stories/index.tsx. The require sits in the dead
// branch that minification drops, so the story code stays out of production.
export default function NotificationStoriesRoute() {
  if (!__DEV__) return <Redirect href="/" />;

  const NotificationStories = require('@/stories/NotificationStories').default;
  return <NotificationStories />;
}
