const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const AWS = require('aws-sdk');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const port = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Configure AWS
AWS.config.update({ region: 'eu-north-1' });

// DynamoDB client
const dynamodb = new AWS.DynamoDB.DocumentClient();
const dynamodbClient = new AWS.DynamoDB(); // Add this line for the DynamoDB client

// DynamoDB table name
const TABLE_NAME = 'email_queue';

// Function to check if the table exists and is accessible
async function checkTable() {
  const params = {
    TableName: TABLE_NAME
  };

  try {
    const data = await dynamodbClient.describeTable(params).promise();
    console.log("Table exists and is accessible:", data.Table.TableName);
    return true;
  } catch (error) {
    if (error.code === 'ResourceNotFoundException') {
      console.error("Table does not exist:", TABLE_NAME);
    } else {
      console.error("Error checking table:", error);
    }
    return false;
  }
}

app.get('/', (req, res) => {
  console.log('Handling GET request on /');
  res.send('Hello from OttoFill server!');
});

// GET route to fetch all emails
app.get('/email', async (req, res) => {
  console.log('Received GET request to fetch all emails');
  try {
    const params = {
      TableName: TABLE_NAME,
    };
    const result = await dynamodb.scan(params).promise();
    const emails = result.Items;
    res.status(200).json(emails);
  } catch (error) {
    console.error('Error fetching emails:', error);
    res.status(500).send('Error fetching emails');
  }
});

// POST route to add a new email
app.post('/email', async (req, res) => {
  console.log('Received request:', req.body);
  const { 
    emailTimestamp, 
    body, 
    sender, 
    subject, 
    user, 
    status 
  } = req.body;

  const newEmail = {
    emailTimestamp,
    body,
    sender,
    subject,
    user,
    status,
    timestampAddedToQueue: new Date().toISOString()
  };
  
  try {
    const params = {
      TableName: TABLE_NAME,
      Item: newEmail
    };
    await dynamodb.put(params).promise();
    console.log('Received new email:', newEmail);
    res.status(200).send('Email received');

    // Notify all connected WebSocket clients about the new email
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: 'newEmail', email: newEmail }));
      }
    });
  } catch (error) {
    console.error('Error saving email:', error);
    res.status(500).send('Error saving email');
  }
});

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', async (message) => {
    const data = JSON.parse(message);
    console.log('Received:', data);

    if (data.type === 'getEmails') {
      try {
        const params = {
          TableName: TABLE_NAME,
        };
        const result = await dynamodb.scan(params).promise();
        const emails = result.Items;
        ws.send(JSON.stringify({ type: 'emails', emails: emails }));
      } catch (error) {
        console.error('Error fetching emails:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Error fetching emails' }));
      }
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Modify the server startup
async function startServer() {
  const tableExists = await checkTable();
  if (!tableExists) {
    console.error("Table does not exist or is not accessible. Please create the table before starting the server.");
    process.exit(1);
  }

  server.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });

  server.on('error', (error) => {
    console.error('Server error:', error);
  });
}

// Call startServer instead of directly calling server.listen
startServer();

// Middleware to log requests
app.use((req, res, next) => {
  console.log(`Received ${req.method} request on ${req.path}`);
  next();
});