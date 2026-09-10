import { createConnection, createServer, type Server } from 'node:net';
const close = (server: Server) => new Promise<void>(done => server.close(() => done()));
const bind = (port: number, host: string) => new Promise<Server>((done, fail) => {
  const server = createServer(socket => socket.destroy());
  server.once('error', fail); server.listen(port, host, () => done(server));
});
/** Hold a loopback coordination socket for the launcher's lifetime. Checking
 * availability then releasing the probes alone races concurrent Expo launches,
 * and macOS can let IPv4/IPv6 Metros share the same numeric port. */
export async function reserveMetroPort(first = 8108, last = 8190) {
  for (let port = first; port < last; port++) {
    let reservation: Server;
    try { reservation = await bind(port + 10000, '127.0.0.1'); } catch { continue; }
    const probes: Server[] = [];
    let free = false;
    try {
      const occupied = await Promise.all(['127.0.0.1', '::1'].map(host => new Promise<boolean>(done => {
        const socket = createConnection({ host, port });
        const finish = (value: boolean) => { socket.destroy(); done(value); };
        socket.once('connect', () => finish(true)); socket.once('error', () => finish(false)); socket.setTimeout(300, () => finish(false));
      })));
      if (!occupied.some(Boolean)) {
        for (const host of ['127.0.0.1', '::1']) probes.push(await bind(port, host));
        free = true;
      }
    } catch {} finally { await Promise.all(probes.map(close)); }
    if (free) return { port, release: () => close(reservation) };
    await close(reservation);
  }
  throw new Error('No free native Metro port.');
}
