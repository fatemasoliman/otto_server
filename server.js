const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 8080;  // AWS EB uses port 8080 by default

app.use(cors());
app.use(express.json());

let extensionSocket = null;

wss.on('connection', (ws) => {
  console.log('New WebSocket connection established');
  extensionSocket = ws;

  ws.on('message', (message) => {
    console.log('Received message from extension:', message.toString());
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    extensionSocket = null;
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

app.post('/message', (req, res) => {
  const message = req.body.message;
  if (extensionSocket) {
    extensionSocket.send(JSON.stringify({ message }));
    res.json({ status: 'Message sent to extension' });
  } else {
    res.status(503).json({ status: 'Extension not connected' });
  }
});

server.listen(port, () => {
  console.log(`Server listening on port ${port}`);
  console.log(`WebSocket server is ready for connections`);
});