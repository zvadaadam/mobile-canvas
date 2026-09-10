import { Text, View } from 'react-native';
import { usePreviewNavigation, usePreviewState } from '@expo-canvas/preview';
import { color, Heading, NativeButton, Page, ReflectionControl, s } from '../components/still';

export default function Session({ duration = 25, initialSaved = false, initialSheetOpen = false }: { duration?: number; initialSaved?: boolean; initialSheetOpen?: boolean }) {
  const { navigate } = usePreviewNavigation();
  const [sheetOpen, setSheetOpen] = usePreviewState('session.sheetOpen', initialSheetOpen);
  const [saved, setSaved] = usePreviewState('session.saved', initialSaved);
  const [reflections, setReflections] = usePreviewState('session.reflections', 0);
  return <Page section="A MOMENT WELL SPENT">
    <Heading eyebrow="TODAY · CREATIVE WORK" title={'Good things\ntake a little room.'} copy="You showed up for one thing. That is a lovely place to start." />
    <View style={[s.card, { gap: 22 }]}>
      <View style={s.row}><Text style={s.eyebrow}>YOUR SESSION</Text><View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: color.blueWash, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: color.blue, fontWeight: '600' }}>✓</Text></View></View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}><Text style={{ fontSize: 72, lineHeight: 80, color: color.ink, fontWeight: '500', letterSpacing: -4 }}>{duration}</Text><Text style={s.copy}>minutes of possibility</Text></View>
      <View style={s.rule} />
      <View style={s.row}><Text style={s.copy}>Intention</Text><Text style={[s.label, { fontSize: 14 }]}>Make something thoughtful</Text></View>
      <View style={s.row}><Text style={s.copy}>Rhythm</Text><Text style={[s.label, { fontSize: 14 }]}>One steady stretch</Text></View>
    </View>
    <View style={{ gap: 14 }}>
      <Text style={s.label}>Leave yourself a little note.</Text>
      <Text style={s.copy}>A moment to notice what moved forward, before the next thing begins.</Text>
      <ReflectionControl open={sheetOpen} saved={saved} onOpen={setSheetOpen} onSaved={setSaved} onDone={() => { setSaved(true); setReflections(reflections + 1); setSheetOpen(false); }} />
      <Text style={[s.copy, { fontSize: 12, color: saved ? color.blue : color.muted }]}>{saved ? `Reflection kept${reflections ? ` · ${reflections} ${reflections === 1 ? 'visit' : 'visits'}` : ''}. A small thing worth remembering.` : 'Just for you. Nothing to score or share.'}</Text>
    </View>
    <NativeButton label="Make room for another" secondary onPress={() => navigate('focus')} />
  </Page>;
}
