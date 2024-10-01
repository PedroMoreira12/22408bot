import { getUser } from './user.js';
import { camisa7Call } from './api.js';
import { postReply } from './replies.js';
import { getRandomGSDMessage, getRandomAZMessage, getRandomAntiGSDMessage } from './utils.js';

export async function handleMessage(latestMessage, discussion) {
    const lowerCaseText = latestMessage.text.toLowerCase().trim();
    const username = await getUser(latestMessage.from_id);

    if (lowerCaseText === '!camisa7') {
        const fanCount = await camisa7Call();
        await postReply(discussion.id, latestMessage.id, `[post${latestMessage.id}|${username}], Temos ${fanCount} sócios! ✈️`);
    } else if (latestMessage.text.includes('!c')) {
        const cleanedMessage = latestMessage.text.replace('!c', '').trim();
        await postReply(discussion.id, latestMessage.id, `[post${latestMessage.id}|${username}], ${cleanedMessage} ✈️`);
    } else if (lowerCaseText === '!gsd') {
        const randomGSDMessage = getRandomGSDMessage();
        await postReply(discussion.id, latestMessage.id, randomGSDMessage);
    } else if (lowerCaseText === '!antizica') {
        const randomAZMessage = getRandomAZMessage();
        await postReply(discussion.id, latestMessage.id, randomAZMessage);
    } else if (lowerCaseText === '!mongol') {
        const randomAntiGSDMessage = getRandomAntiGSDMessage();
        await postReply(discussion.id, latestMessage.id, randomAntiGSDMessage);
    }
}
