import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { usePreviewNavigation, usePreviewState } from '@expo-canvas/preview';
import { GlassTimer, SessionLink } from '../components/still';

export default function Ambient({ totalMinutes = 25, initialRunning = true, initialElapsed = 0 }: { totalMinutes?: number; initialRunning?: boolean; initialElapsed?: number }) {
  const { navigate } = usePreviewNavigation();
  const [running, setRunning] = usePreviewState('ambient.running', initialRunning);
  const [elapsed, setElapsed] = usePreviewState('ambient.elapsed', initialElapsed);
  const [width, setWidth] = useState(354);
  const drift = useRef(new Animated.Value(0)).current;
  const updateElapsed = useRef(setElapsed);
  updateElapsed.current = setElapsed;
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => updateElapsed.current((value) => value + 1), 1000);
    return () => clearInterval(interval);
  }, [running]);
  useEffect(() => {
    if (!running) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(drift, { toValue: 1, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(drift, { toValue: 0, duration: 6500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [drift, running]);
  const remaining = Math.max(0, totalMinutes * 60 - elapsed);
  const time = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
  return <View style={a.page}>
    <LinearGradient colors={['#142F41', '#29475B', '#657685']} style={StyleSheet.absoluteFill} />
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[a.orb, { width: 410, height: 480, left: -130, top: 210, transform: [{ translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-30, 120] }) }, { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [75, -85] }) }, { rotate: drift.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '30deg'] }) }] }]}>
        <LinearGradient colors={['#98B8AF', '#648E9B', '#284D67']} style={{ flex: 1 }} />
      </Animated.View>
      <Animated.View style={[a.orb, { width: 270, height: 360, right: -100, top: 360, opacity: 0.7, transform: [{ translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [-70, 110] }) }, { scale: drift.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.2] }) }] }]}>
        <LinearGradient colors={['#D0C4A9', '#658A97']} style={{ flex: 1 }} />
      </Animated.View>
    </View>
    <View style={a.content}>
      <View style={a.top}><Text style={a.wordmark}>still</Text><Text style={a.eyebrow}>FOCUS SPACE</Text></View>
      <View style={{ gap: 12 }}><Text style={a.eyebrow}>YOU ARE HERE</Text><Text style={a.title}>{'Nothing else\nneeds you now.'}</Text><Text style={a.copy}>Let the next little thing be enough.</Text></View>
      <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={{ marginTop: 30 }}>
        <GlassTimer width={width} time={time} running={running} onToggle={() => setRunning(!running)} />
      </View>
      <View style={{ flex: 1, minHeight: 26 }} />
      <Text style={[a.copy, { textAlign: 'center', fontSize: 13 }]}>{running ? 'Soft movement. A steady breath.' : 'Paused. Your place is right here.'}</Text>
      <SessionLink onPress={() => navigate('session')} />
      <View style={a.indicator} />
    </View>
  </View>;
}

const a = StyleSheet.create({
  page: { flex: 1, overflow: 'hidden', backgroundColor: '#142F41' },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 48, paddingBottom: 22, gap: 22 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  wordmark: { fontSize: 25, color: '#E5EBE5', fontWeight: '700', letterSpacing: -1 },
  eyebrow: { fontSize: 10, color: '#C2D2D3', fontWeight: '600', letterSpacing: 1.7 },
  title: { fontSize: 38, lineHeight: 43, letterSpacing: -1.5, color: '#F9F6EF', fontWeight: '500' },
  copy: { color: '#CCD9D9', fontSize: 15, lineHeight: 22 },
  orb: { position: 'absolute', borderRadius: 240, overflow: 'hidden' },
  indicator: { alignSelf: 'center', height: 4, width: 116, backgroundColor: '#E0E9E9', opacity: 0.5, borderRadius: 3 },
});
