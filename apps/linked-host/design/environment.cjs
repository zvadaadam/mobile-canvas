// Supported service boundaries; explicit and shared across apps, never inferred
// from component names or generated as per-app fixtures.
const excluded = ['@clerk/expo', '@clerk/expo-google-signin', 'react-native-purchases', 'react-native-purchases-ui', 'expo-observe'];
const iconPackages = ['@hugeicons-pro/core-stroke-rounded', '@hugeicons-pro/core-solid-rounded'];
const adapters = {
  '@clerk/expo': 'Clerk.tsx', '@clerk/expo/apple': 'Clerk.tsx', '@clerk/expo/google': 'Clerk.tsx', '@clerk/expo/token-cache': 'Clerk.tsx', '@clerk/expo/resource-cache': 'Clerk.tsx',
  'convex/react': 'Convex.tsx', 'convex/react-clerk': 'Convex.tsx',
  'react-native-purchases': 'Purchases.ts', 'react-native-purchases-ui': 'PurchasesUI.tsx', 'expo-observe': 'Observe.tsx',
  'expo-speech-recognition': 'Speech.ts',
};
module.exports = { excluded, iconPackages, adapters };
