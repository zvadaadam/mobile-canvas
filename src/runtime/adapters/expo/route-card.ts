import type { RouteFrame } from "../../../shared/routes";

/** Native map metadata, explicitly distinct from a rendered app screen. No app imports. */
export function routeCard(frame: RouteFrame) {
  return `// Mobile Canvas route map: ${frame.file}
import { View, Text, ScrollView, Pressable } from "react-native";
import { usePreviewNavigation, usePreviewState } from "@expo-canvas/preview";
type Props = {
  route: { name: string; fullPath: string; file: string; presentation: string; tabbed: boolean; params: string[] };
  issues: string[];
  destinations: { key: string; name: string }[];
};
export default function RouteMap({ route, issues, destinations }: Props) {
  const { navigate } = usePreviewNavigation();
  usePreviewState("previewKind", "route-map");
  return <View style={{ flex: 1, backgroundColor: "#fff" }}><ScrollView contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} style={{ flex: 1 }} contentContainerStyle={{ padding: 28, gap: 22 }}>
    <Text style={{ fontSize: 11, fontWeight: "600", color: "#707070", letterSpacing: 1.5 }}>ROUTE MAP · NO LIVE PREVIEW</Text>
    <View style={{ gap: 8 }}><Text style={{ fontSize: 28, fontWeight: "600", color: "#181818" }}>{route.name}</Text>
      <Text selectable style={{ fontSize: 15, color: "#555" }}>{route.fullPath}</Text></View>
    <View style={{ borderTopWidth: 0.5, borderColor: "#ddd", paddingTop: 18, gap: 8 }}>
      <Text selectable style={{ fontSize: 13, color: "#555" }}>{route.file}</Text>
      <Text style={{ fontSize: 13, color: "#555" }}>{route.presentation}{route.tabbed ? " · Tab route" : ""}</Text>
      {route.params.length > 0 && <Text style={{ fontSize: 13, color: "#555" }}>Parameters: {route.params.join(", ")}</Text>}
    </View>
    <View style={{ backgroundColor: "#f5f5f5", padding: 16, borderRadius: 12, gap: 8 }}>
      <Text style={{ fontSize: 14, fontWeight: "600", color: "#333" }}>Mapped from source</Text>
      <Text style={{ fontSize: 13, lineHeight: 19, color: "#666" }}>This card describes the route. It does not render the app's interface.</Text>
      {issues.slice(0, 2).map(issue => <Text key={issue} style={{ fontSize: 12, lineHeight: 18, color: "#666" }}>{issue}</Text>)}
    </View>
    <View style={{ gap: 10 }}><Text style={{ fontSize: 11, color: "#777", letterSpacing: 1 }}>OPENS</Text>
      {destinations.length === 0 && <Text style={{ fontSize: 13, color: "#777" }}>No static destinations found</Text>}
      {destinations.map(destination => <Pressable key={destination.key} accessibilityRole="button" accessibilityLabel={"Show " + destination.name} onPress={() => navigate(destination.key)} style={{ paddingVertical: 12, borderBottomWidth: 0.5, borderColor: "#ddd" }}><Text style={{ fontSize: 15, color: "#222" }}>{destination.name} →</Text></Pressable>)}
    </View>
  </ScrollView></View>;
}
`;
}
