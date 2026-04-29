import { WebSocketServer } from 'ws';

export function attachConsoleSocket(server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws/console'
  });

  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({
      type: 'system',
      message: 'GameForge Console ligada.'
    }));

    socket.on('message', (buffer) => {
      const message = buffer.toString();

      socket.send(JSON.stringify({
        type: 'echo',
        message: `> ${message}`
      }));
    });
  });
}
