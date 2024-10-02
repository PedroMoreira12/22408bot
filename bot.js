import express from 'express';
import { getAllDiscussions, getDiscussionMessages } from './discussions.js';
import { handleMessage } from './messageHandlers.js';

const app = express();
const PORT = process.env.PORT || 3000;

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const listenAndRespond = async () => {
  let lastMessageIds = {};

  setInterval(async () => {
    const discussions = await getAllDiscussions();

    if (discussions && discussions.length > 0) {
      for (const discussion of discussions) {
        const messages = await getDiscussionMessages(discussion.id);

        if (messages && messages.length > 0) {
          const latestMessage = messages[0];
          const lastMessageId = lastMessageIds[discussion.id];

          if (latestMessage.id !== lastMessageId) {
            lastMessageIds[discussion.id] = latestMessage.id;

            console.log(`New message in topic ${discussion.title} from ${latestMessage.from_id}: ${latestMessage.text}`);

            await handleMessage(latestMessage, discussion);
          }
          await delay(500);
        }
      }
    }
  }, 6000);
};

// Start your bot logic
listenAndRespond();

// Set up a simple route for the web server
app.get('/', (req, res) => {
  res.send('Hello, VK Bot is running!');
});

// Start the Express server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
