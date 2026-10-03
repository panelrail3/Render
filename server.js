const server = require('./api/ws.js');

const PORT = Number(process.env.PORT || 10000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`VLESS-WS v4.6 listening on 0.0.0.0:${PORT}`);
});

server.on('error', (err) => {
  console.error('HTTP/WebSocket server error:', err);
  process.exit(1);
});
