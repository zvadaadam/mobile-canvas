/** The starter uses native APIs shared by both supported Expo host versions. */
export function screenTemplate(name: string): string {
  return `import { View, Text, Switch, Pressable } from "react-native";
import { GlassView } from "expo-glass-effect";
import { usePreviewState } from "@expo-canvas/preview";

export default function Screen({ enabled = true }: { enabled?: boolean }) {
  const [isOn, setIsOn] = usePreviewState("notifications", enabled);
  return <View style={{ flex: 1, padding: 24, paddingTop: 60, gap: 28, backgroundColor: "#14243A" }}>
    <Text style={{ fontSize: 34, fontWeight: "700", color: "white" }}>{${JSON.stringify(name)}}</Text>
    <Text style={{ fontSize: 17, lineHeight: 24, color: "#C3D2E4" }}>A real native screen. Edit this component to explore.</Text>
    <GlassView glassEffectStyle="regular" style={{ padding: 20, borderRadius: 24, gap: 24 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ fontSize: 16, color: "white" }}>Notifications</Text>
        <Switch accessibilityLabel="Enable notifications" value={isOn} onValueChange={setIsOn} />
      </View>
      <Pressable accessibilityRole="button" onPress={() => setIsOn(value => !value)} style={{ padding: 14, borderRadius: 24, backgroundColor: "#D3E4FF" }}>
        <Text style={{ fontSize: 16, textAlign: "center", color: "#14243A" }}>Try native interaction</Text>
      </Pressable>
    </GlassView>
  </View>;
}
`;
}
