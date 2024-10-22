require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const AWS = require('aws-sdk');
const cors = require('cors');
const fs = require('fs');
const util = require('util');
const mysql = require('mysql2/promise');

// Set up logging
const log_file = fs.createWriteStream('/home/ec2-user/ottoq-server/debug.log', {flags : 'a'});
const log_stdout = process.stdout;

console.log = function(d) {
  const message = typeof d === 'object' ? JSON.stringify(d) : d;
  log_file.write(util.format(message) + '\n');
  log_stdout.write(util.format(message) + '\n');
};

const app = express();
const port = 8080;

// Add this near the top of your server.js file, after creating the app
app.use((req, res, next) => {
  console.log(`Received ${req.method} request to ${req.path}`);
  next();
});

// Configure AWS (no explicit credentials)
AWS.config.update({ region: process.env.AWS_REGION });

const dynamoDB = new AWS.DynamoDB.DocumentClient();

app.use(cors());
app.use(bodyParser.json());

// Create a MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Check if the table exists
async function checkTableExists() {
  try {
    const params = {
      TableName: 'email_queue'
    };
    await dynamoDB.scan(params).promise();
    console.log('Table exists and is accessible: email_queue');
  } catch (error) {
    console.error('Error checking table:', error);
  }
}

// Define the /email GET route
app.get('/email', async (req, res) => {
  console.log('Received GET request to /email');
  console.log('Auth token:', req.headers.authorization);
  console.log('User email:', req.headers['user-email']);

  const userEmail = req.headers['user-email'];

  if (!userEmail) {
    console.error('No user email provided in request headers');
    return res.status(400).json({ error: 'User email is required' });
  }

  try {
    const params = {
      TableName: 'email_queue',
      FilterExpression: '(attribute_not_exists(#status) OR (#status <> :clearedStatus AND #status <> :completedStatus)) AND #user = :userEmail',
      ExpressionAttributeNames: {
        '#status': 'status',
        '#user': 'user'
      },
      ExpressionAttributeValues: {
        ':clearedStatus': 'Cleared',
        ':completedStatus': 'Completed',
        ':userEmail': userEmail
      }
    };

    console.log('DynamoDB params:', JSON.stringify(params));

    const data = await dynamoDB.scan(params).promise();
    console.log('DynamoDB response:', JSON.stringify(data));

    console.log('Emails retrieved successfully');
    const emails = data.Items.map(item => ({
      id: item.id,
      subject: item.subject,
      from: item.from,
      timestamp: item.timestamp,
      messageId: item.messageId,
      user: item.user,
      status: item.status // Include status in the response
    }));
    console.log('Sample email:', emails[0]);
    res.json(emails);
  } catch (error) {
    console.error('Error retrieving emails from DynamoDB:', error);
    res.status(500).json({ error: 'Error retrieving emails', details: error.message, stack: error.stack });
  }
});

// Update the /email/:id/done route
app.post('/email/:id/done', async (req, res) => {
    console.log('Received POST request to mark email as done:', req.params.id);

    try {
        // First, find the item with the given id
        const findParams = {
            TableName: 'email_queue',
            FilterExpression: 'id = :id',
            ExpressionAttributeValues: {
                ':id': req.params.id
            }
        };

        console.log('Finding email with params:', JSON.stringify(findParams));
        const findResult = await dynamoDB.scan(findParams).promise();
        console.log('Find result:', JSON.stringify(findResult));
        
        if (findResult.Items.length === 0) {
            console.log('Email not found');
            return res.status(404).json({ error: 'Email not found', id: req.params.id });
        }

        const item = findResult.Items[0];
        console.log('Found email:', JSON.stringify(item));

        // Now update the item using the emailTimestamp as the primary key
        const updateParams = {
            TableName: 'email_queue',
            Key: {
                emailTimestamp: item.emailTimestamp
            },
            UpdateExpression: 'set #status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'Completed'
            },
            ReturnValues: 'ALL_NEW'
        };

        console.log('Updating email with params:', JSON.stringify(updateParams));
        const data = await dynamoDB.update(updateParams).promise();
        console.log('Email marked as done successfully:', JSON.stringify(data.Attributes));
        res.status(200).json({ message: 'Email marked as done successfully', email: data.Attributes });
    } catch (error) {
        console.error('Error marking email as done in DynamoDB:', error);
        res.status(500).json({ error: 'Error marking email as done', details: error.message, stack: error.stack });
    }
});

// Update the /email/:id/clear route similarly
app.post('/email/:id/clear', async (req, res) => {
    console.log('Received POST request to clear email:', req.params.id);

    try {
        // First, find the item with the given id
        const findParams = {
            TableName: 'email_queue',
            FilterExpression: 'id = :id',
            ExpressionAttributeValues: {
                ':id': req.params.id
            }
        };

        console.log('Finding email with params:', JSON.stringify(findParams));
        const findResult = await dynamoDB.scan(findParams).promise();
        console.log('Find result:', JSON.stringify(findResult));
        
        if (findResult.Items.length === 0) {
            console.log('Email not found');
            return res.status(404).json({ error: 'Email not found', id: req.params.id });
        }

        const item = findResult.Items[0];
        console.log('Found email:', JSON.stringify(item));

        // Now update the item using the emailTimestamp as the primary key
        const updateParams = {
            TableName: 'email_queue',
            Key: {
                emailTimestamp: item.emailTimestamp
            },
            UpdateExpression: 'set #status = :status',
            ExpressionAttributeNames: {
                '#status': 'status'
            },
            ExpressionAttributeValues: {
                ':status': 'Cleared'
            },
            ReturnValues: 'ALL_NEW'
        };

        console.log('Updating email with params:', JSON.stringify(updateParams));
        const data = await dynamoDB.update(updateParams).promise();
        console.log('Email cleared successfully:', JSON.stringify(data.Attributes));
        res.status(200).json({ message: 'Email cleared successfully', email: data.Attributes });
    } catch (error) {
        console.error('Error clearing email in DynamoDB:', error);
        res.status(500).json({ error: 'Error clearing email', details: error.message, stack: error.stack });
    }
});

// Add a simple test route
app.get('/test', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Add this new route to handle POST requests to /email
app.post('/email', async (req, res) => {
  console.log('Received POST request to /email');
  console.log('Request body:', req.body);

  try {
    const params = {
      TableName: 'email_queue',
      Item: {
        id: Date.now().toString(), // Use timestamp as a unique ID
        subject: req.body.subject,
        from: req.body.from,
        timestamp: req.body.timestamp,
        body: req.body.body,
        user: req.body.user,
        status: req.body.status,
        messageId: req.body.messageId,
        emailTimestamp: req.body.timestamp // Use this as the primary key
      }
    };

    await dynamoDB.put(params).promise();
    console.log('Email saved successfully');
    res.status(200).json({ message: 'Email saved successfully' });
  } catch (error) {
    console.error('Error saving email to DynamoDB:', error);
    res.status(500).json({ error: 'Error saving email', details: error.message });
  }
});

// Add this new route near the other route definitions
app.get('/health', (req, res) => {
  console.log('Received GET request to /health');
  res.status(200).json({ status: 'healthy', message: 'Server is running' });
});

checkTableExists().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
}).catch(error => {
  console.error('Failed to start server:', error);
});
