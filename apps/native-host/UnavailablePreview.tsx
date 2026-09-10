import { Pressable, StyleSheet, Text, View } from 'react-native';

/** Decorative shapes suggest an unfilled design slot, never a fabricated app screenshot. */
export default function UnavailablePreview({ title, reason, detail, onRetry, kind = 'unavailable' }: {
  title: string; reason: string; detail?: string; onRetry?: () => void; kind?: 'unavailable' | 'error';
}) {
  return <View style={styles.screen}>
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.ghost}>
      <View style={[styles.block, { width: '44%', height: 18, marginBottom: 34 }]} />
      <View style={[styles.block, { height: 140 }]} />
      <View style={[styles.block, { height: 65 }]} />
      <View style={[styles.block, { height: 65 }]} />
      <View style={[styles.block, { height: 180, marginTop: 34 }]} />
    </View>
    <View style={styles.veil} />
    <View style={styles.content}>
      <View accessibilityLabel={kind === 'error' ? 'Preview error' : 'Unavailable preview'} style={styles.icon}>
        <View style={styles.device}><View style={styles.deviceLine} /></View>
        <View style={styles.slash} />
      </View>
      <Text style={styles.badge}>{kind === 'error' ? 'PREVIEW ERROR' : 'PREVIEW UNAVAILABLE'}</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.reason}>{reason}</Text>
      {detail && <Text selectable style={styles.detail} numberOfLines={7}>{detail}</Text>}
      {onRetry && <Pressable accessibilityRole="button" accessibilityLabel="Retry this preview" onPress={onRetry} style={({ pressed }) => [styles.retry, { opacity: pressed ? 0.65 : 1 }]}><Text style={styles.retryText}>Retry preview</Text></Pressable>}
      <Text style={styles.footnote}>Kept in your screen map</Text>
    </View>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f0f1f3', justifyContent: 'center', overflow: 'hidden' },
  ghost: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, padding: 28, paddingTop: 80, opacity: 0.13 },
  block: { backgroundColor: '#8d929c', borderRadius: 18, marginBottom: 16, shadowColor: '#8d929c', shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 0 } },
  veil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(245,246,248,0.78)' },
  content: { alignItems: 'center', paddingHorizontal: 32, paddingVertical: 32 },
  icon: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#e8eaee', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  device: { width: 21, height: 30, borderWidth: 1.8, borderColor: '#858c98', borderRadius: 5, alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 4 },
  deviceLine: { width: 7, height: 1.8, borderRadius: 1, backgroundColor: '#858c98' },
  slash: { position: 'absolute', width: 35, height: 2, backgroundColor: '#858c98', transform: [{ rotate: '-45deg' }], borderWidth: 0.4, borderColor: '#e8eaee' },
  badge: { fontSize: 10, fontWeight: '600', letterSpacing: 1.3, color: '#858b95', marginBottom: 12 },
  title: { fontSize: 21, lineHeight: 27, fontWeight: '600', textAlign: 'center', color: '#484e58', marginBottom: 12 },
  reason: { fontSize: 14, lineHeight: 21, textAlign: 'center', color: '#737a85', maxWidth: 300 },
  detail: { fontSize: 12, lineHeight: 18, textAlign: 'center', color: '#858c96', marginTop: 16, maxWidth: 300 },
  footnote: { fontSize: 11, color: '#969ca5', marginTop: 24 },
  retry: { borderRadius: 20, backgroundColor: '#e3e6eb', paddingHorizontal: 20, paddingVertical: 11, marginTop: 20 },
  retryText: { color: '#4d5562', fontSize: 13, fontWeight: '600' },
});
