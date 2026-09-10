import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import * as UI from '@expo/ui/swift-ui';
import * as M from '@expo/ui/swift-ui/modifiers';

// Targets the native-studio SDK 54 lab: @expo/ui 0.2.0-beta.9.
// Keep its version-specific native APIs here, apart from ordinary screen layout.

export const color = { paper: '#F6F4EF', card: '#FFFDF8', ink: '#242F33', muted: '#747B78', line: '#DEDFD5', blue: '#405ED8', blueWash: '#E9EDFF' };

export function Page({ children, section }: { children: ReactNode; section: string }) {
  return <ScrollView style={s.page} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
    <View style={s.brand}><View style={s.mark} /><Text style={s.wordmark}>still</Text><View style={{ flex: 1 }} /><Text style={s.eyebrow}>{section}</Text></View>
    {children}
    <View style={s.homeIndicator} />
  </ScrollView>;
}

export function Heading({ eyebrow, title, copy }: { eyebrow: string; title: string; copy: string }) {
  return <View style={{ gap: 10 }}><Text style={s.eyebrow}>{eyebrow}</Text><Text style={s.title}>{title}</Text><Text style={s.copy}>{copy}</Text></View>;
}

export function NativeButton({ label, onPress, secondary = false }: { label: string; onPress: () => void; secondary?: boolean }) {
  return <UI.Host colorScheme="light" modifiers={[M.ignoreSafeArea()]} style={{ height: 56, width: '100%' }}>
    <UI.Button onPress={onPress} variant={secondary ? 'glass' : 'glassProminent'} controlSize="large" color={color.blue} testID={label} modifiers={[M.foregroundStyle(secondary ? color.ink : '#FFFFFF')]}>{label}</UI.Button>
  </UI.Host>;
}

export function DurationControl({ minutes, onChange }: { minutes: number; onChange: (value: number) => void }) {
  return <UI.Host colorScheme="light" modifiers={[M.ignoreSafeArea()]} style={{ height: 38 }}>
    {/* SDK 54 counts intermediate stops, so 9 stops produce ten 5-minute intervals. */}
    <UI.Slider value={minutes} min={10} max={60} steps={9} onValueChange={onChange} color={color.blue} testID="Focus duration" modifiers={[M.accessibilityLabel('Focus duration'), M.accessibilityValue(`${minutes} minutes`)]} />
  </UI.Host>;
}

export function QuietControl({ quiet, onChange }: { quiet: boolean; onChange: (value: boolean) => void }) {
  return <UI.Host colorScheme="light" modifiers={[M.ignoreSafeArea()]} style={{ height: 35 }}>
    <UI.Switch label="Quiet mode" value={quiet} onValueChange={onChange} color={color.blue} testID="Quiet mode" />
  </UI.Host>;
}

export function GlassTimer({ width, time, running, onToggle }: { width: number; time: string; running: boolean; onToggle: () => void }) {
  return <UI.Host colorScheme="dark" modifiers={[M.ignoreSafeArea()]} style={{ height: 244 }}>
    <UI.VStack spacing={14} modifiers={[M.frame({ width: Math.max(140, width - 48) }), M.padding({ all: 24 }), M.glassEffect({ glass: { variant: 'regular' }, shape: 'rectangle' }), M.cornerRadius(32), M.foregroundStyle('#FFFFFF')]}>
      <UI.Text size={10} weight="semibold" modifiers={[M.opacity(0.75)]}>{running ? 'ROOM TO THINK' : 'TAKE YOUR TIME'}</UI.Text>
      <UI.Text size={60} weight="light" design="monospaced">{time}</UI.Text>
      <UI.Button systemImage={running ? 'pause.fill' : 'play.fill'} onPress={onToggle} variant="glass" controlSize="large" color="#E9F3EE" testID="Pause or resume focus">{running ? 'Pause focus' : 'Resume focus'}</UI.Button>
    </UI.VStack>
  </UI.Host>;
}

export function SessionLink({ onPress }: { onPress: () => void }) {
  return <UI.Host colorScheme="dark" modifiers={[M.ignoreSafeArea()]} style={{ height: 52 }}>
    <UI.Button systemImage="arrow.right" onPress={onPress} variant="glass" controlSize="large" modifiers={[M.foregroundStyle('#FFFFFF')]}>View this session</UI.Button>
  </UI.Host>;
}

export function ReflectionControl({ open, saved, onOpen, onSaved, onDone }: { open: boolean; saved: boolean; onOpen: (value: boolean) => void; onSaved: (value: boolean) => void; onDone: () => void }) {
  return <UI.Host colorScheme="light" modifiers={[M.ignoreSafeArea()]} style={{ height: 56, width: '100%' }}>
    <UI.ZStack>
      <UI.BottomSheet isOpened={open} onIsOpenedChange={onOpen} presentationDetents={[0.55, 'large']} presentationDragIndicator="visible" modifiers={[M.frame({ width: 1, height: 1 })]}>
        <UI.VStack alignment="leading" spacing={22} modifiers={[M.padding({ horizontal: 26, top: 32, bottom: 24 }), M.foregroundStyle(color.ink)]}>
          <UI.HStack spacing={12}>
            <UI.Text size={11} weight="semibold" color={color.muted}>A LITTLE REFLECTION</UI.Text>
            <UI.Spacer />
            <UI.Button systemImage="xmark" role="cancel" onPress={() => onOpen(false)} variant="glass" controlSize="regular" testID="Close reflection" modifiers={[M.accessibilityLabel('Close reflection'), M.frame({ minHeight: 44 })]}>Close</UI.Button>
          </UI.HStack>
          <UI.Text size={30} weight="semibold">Small progress counts.</UI.Text>
          <UI.Text size={16} color={color.muted}>{'I made a little space for thoughtful work.\nI can pick it up from here tomorrow.'}</UI.Text>
          <UI.Switch label="Keep this reflection" value={saved} onValueChange={onSaved} color={color.blue} testID="Keep this reflection" />
          <UI.Button onPress={onDone} variant="glassProminent" controlSize="large" color={color.blue}>That is enough for today</UI.Button>
        </UI.VStack>
      </UI.BottomSheet>
      <UI.Button systemImage="square.and.pencil" onPress={() => onOpen(true)} variant="glassProminent" controlSize="large" color={color.blue}>{saved ? 'Read your reflection' : 'Reflect on this session'}</UI.Button>
    </UI.ZStack>
  </UI.Host>;
}

export const s = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: 24, paddingTop: 48, paddingBottom: 22, gap: 26, flexGrow: 1 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 },
  mark: { width: 15, height: 15, borderRadius: 8, backgroundColor: color.blue },
  wordmark: { fontSize: 25, color: color.ink, letterSpacing: -1, fontWeight: '700' },
  eyebrow: { color: color.muted, fontSize: 10, fontWeight: '600', letterSpacing: 1.7 },
  title: { color: color.ink, fontSize: 38, lineHeight: 42, fontWeight: '600', letterSpacing: -1.5 },
  copy: { color: color.muted, fontSize: 15, lineHeight: 22 },
  card: { backgroundColor: color.card, borderRadius: 24, padding: 20, gap: 14, borderWidth: 1, borderColor: '#E9E8E0' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { color: color.ink, fontSize: 16, fontWeight: '600' },
  rule: { height: 1, backgroundColor: color.line },
  homeIndicator: { width: 116, height: 4, borderRadius: 3, backgroundColor: color.ink, opacity: 0.22, alignSelf: 'center', marginTop: 'auto' },
});
