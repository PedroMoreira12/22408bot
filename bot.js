import { getAllDiscussions, getDiscussionMessages } from './discussions.js';
import { postReply } from './replies.js';
import { getUser } from './user.js';
import { camisa7Call } from './api.js';

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

          // Check if the latest message is new
          if (latestMessage.id !== lastMessageId) {
            lastMessageIds[discussion.id] = latestMessage.id;

            console.log(`New message in topic ${discussion.title} from ${latestMessage.from_id}: ${latestMessage.text}`);

            // Example: Reply to a specific command or keyword
            if (latestMessage.text.trim() === '!c') {
              const username = await getUser(latestMessage.from_id);
              await postReply(discussion.id, latestMessage.id,  `[post${latestMessage.id}|${username}],`);
            } else if (latestMessage.text.trim() === '!camisa7') {
              const username = await getUser(latestMessage.from_id);
              const fanCount = await camisa7Call();
              await postReply(discussion.id, latestMessage.id,  `[post${latestMessage.id}|${username}], Temos ${fanCount} sócios!`);
            }
          }
        }
      }
    }
  }, 5000);  // Check every 5 seconds
};

// Start the bot
listenAndRespond();
