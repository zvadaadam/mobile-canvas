import { Text, View } from 'react-native';
import { usePreviewNavigation, usePreviewState } from '@expo-canvas/preview';
import { color, DurationControl, Heading, NativeButton, Page, QuietControl, s } from '../components/still';

export default function Focus({ initialMinutes = 25, initialQuiet = true, intention = 'Make something thoughtful' }: { initialMinutes?: number; initialQuiet?: boolean; intention?: string }) {
  const { navigate } = usePreviewNavigation();
  const [minutes, setMinutes] = usePreviewState('focus.minutes', initialMinutes);
  const [quiet, setQuiet] = usePreviewState('focus.quiet', initialQuiet);
  const [starts, setStarts] = usePreviewState('focus.starts', 0);
  return <Page section="YOUR SPACE">
    <Heading eyebrow="ONE THING AT A TIME" title={'Make room\nfor good work.'} copy="A quiet place to begin. Give one thing your full attention." />
    <View style={[s.card, { backgroundColor: color.blueWash, borderColor: '#DCE2FB' }]}>
      <View style={s.row}><Text style={s.eyebrow}>TODAY'S INTENTION</Text><Text style={{ fontSize: 20, color: color.blue }}>↗</Text></View>
      <Text style={[s.label, { fontSize: 21, lineHeight: 27, fontWeight: '500' }]}>{intention}</Text>
      <Text style={[s.copy, { fontSize: 13 }]}>Creative work · A fresh start</Text>
    </View>
    <View style={s.card}>
      <View style={s.row}><Text style={s.label}>A little protected time</Text><Text style={{ color: color.blue, fontSize: 25, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{minutes} <Text style={{ fontSize: 13 }}>min</Text></Text></View>
      <DurationControl minutes={minutes} onChange={setMinutes} />
      <View style={s.row}><Text style={[s.eyebrow, { letterSpacing: 0.3 }]}>10 MIN</Text><Text style={[s.eyebrow, { letterSpacing: 0.3 }]}>60 MIN</Text></View>
      <View style={s.rule} />
      <QuietControl quiet={quiet} onChange={setQuiet} />
      <Text style={[s.copy, { fontSize: 13, lineHeight: 19 }]}>{quiet ? 'Just you and the work. Gentle reminders are off.' : 'Gentle reminders are on. A little nudge is welcome.'}</Text>
    </View>
    <View style={{ gap: 4 }}>
      <NativeButton label="Open focus space" onPress={() => { setStarts(starts + 1); navigate('ambient'); }} />
      <Text style={[s.copy, { fontSize: 12 }]}>{starts ? `You have made room ${starts} ${starts === 1 ? 'time' : 'times'} today.` : `${minutes} minutes. One small beginning.`}</Text>
    </View>
  </Page>;
}
