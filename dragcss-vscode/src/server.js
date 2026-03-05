// DragCSS — WebSocket Server
// Uses Node.js built-in modules only (no ws dependency)

const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const WS_MAGIC = '258EAFA5-E914-47DA-95CA-5AB9AA86F783';

class DragCSSServer extends EventEmitter {
  constructor(port) {
    super();
    this.port = port;
    this.httpServer = null;
    this.client = null;
  }

  start() {
    this.httpServer = http.createServer((req, res) => {
      // Health check endpoint
      if (req.url === '/health') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(JSON.stringify({ status: 'ok', name: 'dragcss-vscode' }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    this.httpServer.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(req, socket, head);
    });

    this.httpServer.on('error', (err) => {
      this.emit('error', err);
    });

    this.httpServer.listen(this.port, '127.0.0.1');
  }

  stop() {
    if (this.client) {
      this._sendFrame(this.client, 8, Buffer.alloc(0)); // Close frame
      this.client.destroy();
      this.client = null;
    }
    if (this.httpServer) {
      this.httpServer.close();
      this.httpServer = null;
    }
  }

  send(data) {
    if (!this.client) return;
    const payload = JSON.stringify(data);
    this._sendFrame(this.client, 1, Buffer.from(payload));
  }

  _handleUpgrade(req, socket, head) {
    // Validate WebSocket upgrade
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }

    // Only allow connections from localhost or chrome-extension
    const origin = req.headers.origin || '';
    const isAllowed = !origin ||
      origin.startsWith('chrome-extension://') ||
      origin === 'http://localhost' ||
      origin === 'http://127.0.0.1';

    if (!isAllowed) {
      socket.destroy();
      return;
    }

    // Perform WebSocket handshake
    const acceptKey = crypto
      .createHash('sha1')
      .update(key + WS_MAGIC)
      .digest('base64');

    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${acceptKey}\r\n` +
      '\r\n'
    );

    // Close previous client if any
    if (this.client) {
      this.client.destroy();
    }

    this.client = socket;
    this.emit('connected');

    let buffer = Buffer.alloc(0);

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data]);

      while (buffer.length >= 2) {
        const frame = this._parseFrame(buffer);
        if (!frame) break;

        buffer = buffer.slice(frame.totalLength);

        if (frame.opcode === 8) {
          // Close
          socket.destroy();
          this.client = null;
          this.emit('disconnected');
          return;
        }

        if (frame.opcode === 9) {
          // Ping — respond with pong
          this._sendFrame(socket, 10, frame.payload);
          continue;
        }

        if (frame.opcode === 1) {
          // Text frame
          try {
            const message = JSON.parse(frame.payload.toString('utf8'));
            this._handleMessage(message);
          } catch (e) {
            // Ignore malformed messages
          }
        }
      }
    });

    socket.on('close', () => {
      if (this.client === socket) {
        this.client = null;
        this.emit('disconnected');
      }
    });

    socket.on('error', () => {
      if (this.client === socket) {
        this.client = null;
        this.emit('disconnected');
      }
    });
  }

  _handleMessage(message) {
    if (message.type === 'changes' && Array.isArray(message.data)) {
      // Validate the structure
      const validChanges = message.data.filter(c =>
        typeof c.selector === 'string' &&
        typeof c.diffs === 'object' &&
        c.selector.length < 500
      );
      if (validChanges.length > 0) {
        this.emit('changes', validChanges);
        // Acknowledge receipt
        this.send({ type: 'ack', count: validChanges.length });
      }
    } else if (message.type === 'ping') {
      this.send({ type: 'pong' });
    }
  }

  _parseFrame(buffer) {
    if (buffer.length < 2) return null;

    const byte1 = buffer[0];
    const byte2 = buffer[1];
    const opcode = byte1 & 0x0f;
    const masked = (byte2 & 0x80) !== 0;
    let payloadLength = byte2 & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
      if (buffer.length < 4) return null;
      payloadLength = buffer.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (buffer.length < 10) return null;
      // For safety, limit payload size
      const high = buffer.readUInt32BE(2);
      if (high > 0) return null; // Too large
      payloadLength = buffer.readUInt32BE(6);
      offset = 10;
    }

    // Limit payload to 1MB
    if (payloadLength > 1024 * 1024) return null;

    const maskSize = masked ? 4 : 0;
    const totalLength = offset + maskSize + payloadLength;

    if (buffer.length < totalLength) return null;

    let payload;
    if (masked) {
      const mask = buffer.slice(offset, offset + 4);
      payload = Buffer.alloc(payloadLength);
      for (let i = 0; i < payloadLength; i++) {
        payload[i] = buffer[offset + 4 + i] ^ mask[i % 4];
      }
    } else {
      payload = buffer.slice(offset, offset + payloadLength);
    }

    return { opcode, payload, totalLength };
  }

  _sendFrame(socket, opcode, payload) {
    const length = payload.length;
    let header;

    if (length < 126) {
      header = Buffer.alloc(2);
      header[0] = 0x80 | opcode; // FIN + opcode
      header[1] = length;
    } else if (length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 126;
      header.writeUInt16BE(length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 127;
      header.writeUInt32BE(0, 2);
      header.writeUInt32BE(length, 6);
    }

    try {
      socket.write(Buffer.concat([header, payload]));
    } catch (e) {
      // Socket may be closed
    }
  }
}

module.exports = { DragCSSServer };
