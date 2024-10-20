const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, UpdateCommand } = require("@aws-sdk/lib-dynamodb");
const OpenAI = require('openai');

const dynamoDB = DynamoDBDocumentClient.from(new DynamoDBClient());
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  for (const record of event.Records) {
    console.log('Processing record:', JSON.stringify(record, null, 2));

    if (record.eventName === 'INSERT') {
      let emailId, body;

      if (record.dynamodb.NewImage.emailId) {
        emailId = record.dynamodb.NewImage.emailId.S;
      } else if (record.dynamodb.NewImage.emailTimestamp) {
        emailId = record.dynamodb.NewImage.emailTimestamp.S;
      }

      body = record.dynamodb.NewImage.body?.S;

      if (!emailId || !body) {
        console.error('Invalid record structure. Missing emailId/emailTimestamp or body.');
        continue;
      }

      try {
        const thread = await openai.beta.threads.create();
        await openai.beta.threads.messages.create(thread.id, {
          role: "user",
          content: body
        });

        const run = await openai.beta.threads.runs.create(thread.id, {
          assistant_id: process.env.OPENAI_ASSISTANT_ID,
          instructions: "Please analyze this email and respond in JSON format."
        });

        let runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
        while (runStatus.status !== "completed") {
          await new Promise(resolve => setTimeout(resolve, 1000));
          runStatus = await openai.beta.threads.runs.retrieve(thread.id, run.id);
        }

        const messages = await openai.beta.threads.messages.list(thread.id);
        const assistantResponse = messages.data.find(message => message.role === "assistant");

        if (assistantResponse) {
          let jsonResponse = JSON.parse(assistantResponse.content[0].text.value);
          
          // Clean up the response
          jsonResponse = Object.entries(jsonResponse).reduce((acc, [key, value]) => {
            acc[key] = value.S || value.N || value;
            return acc;
          }, {});

          await dynamoDB.send(new UpdateCommand({
            TableName: process.env.DYNAMODB_TABLE_NAME,
            Key: { [record.dynamodb.NewImage.emailId ? 'emailId' : 'emailTimestamp']: emailId },
            UpdateExpression: 'set assistantResponse = :r, #s = :status',
            ExpressionAttributeNames: {
              '#s': 'status'
            },
            ExpressionAttributeValues: {
              ':r': jsonResponse,
              ':status': 'processed'
            }
          }));
        }
      } catch (error) {
        console.error('Error processing email:', error);
        await dynamoDB.send(new UpdateCommand({
          TableName: process.env.DYNAMODB_TABLE_NAME,
          Key: { [record.dynamodb.NewImage.emailId ? 'emailId' : 'emailTimestamp']: emailId },
          UpdateExpression: 'set #s = :status',
          ExpressionAttributeNames: {
            '#s': 'status'
          },
          ExpressionAttributeValues: {
            ':status': 'error'
          }
        }));
      }
    }
  }
};