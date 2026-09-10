// Expo's localhost listener binds ::1 on this Mac while its manifest uses 127.0.0.1.
// Forward the IPv4 loopback socket, including Metro's WebSocket traffic.
import net from "node:net";

const port = Number(process.env.EXPO_CANVAS_METRO_PORT ?? 8102);
const connections = new Set<net.Socket>();
const server = net.createServer((client) => {
  const metro = net.connect(port, "::1");
  connections.add(client);
  connections.add(metro);
  client.pipe(metro).pipe(client);
  const close = () => {
    client.destroy();
    metro.destroy();
    connections.delete(client);
    connections.delete(metro);
  };
  client.on("error", close);
  metro.on("error", close);
  client.on("close", close);
});
server.listen(port, "127.0.0.1", () => console.log(`Metro IPv4 loopback bridge on ${port}`));
process.on("SIGTERM", () => {
  for (const socket of connections) socket.destroy();
  server.close();
});
