import { getAllDiscussions, getDiscussionMessages } from './discussions.js';
import { handleMessage } from './messageHandlers.js';

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
  }, 3000);
};

listenAndRespond();
