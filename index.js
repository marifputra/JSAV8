const http = require('http');
const { appHandler } = require('./server');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const server = http.createServer(appHandler);

server.on('error', err => {
  console.error('JSA server gagal start:', err);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`JSA online server berjalan di ${HOST}:${PORT}`);
});
