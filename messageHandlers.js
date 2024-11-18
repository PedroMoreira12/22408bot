import { getUser } from './user.js';
import { camisa7Call } from './api.js';
import { postReply } from './replies.js';
import { getRandomGSDMessage, getRandomAZMessage, getRandomAntiGSDMessage, calculateReminderDate } from './utils.js';
import { messages } from './messages.js'
import Reminder from './models/Reminder.js'

export async function handleMessage(latestMessage, discussion) {
    const lowerCaseText = latestMessage.text.toLowerCase().trim();
    const username = await getUser(latestMessage.from_id);

    if (lowerCaseText === '!camisa7') {
        const fanCount = await camisa7Call();
        await postReply(discussion.id, latestMessage.id, `[post${latestMessage.id}|${username}], Temos ${fanCount} sócios! ✈️`);
    } else if (latestMessage.text.includes('!c ') || latestMessage.text === '!c') {
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
    } else if (lowerCaseText === '!upem') {
        await postReply(discussion.id, latestMessage.id, `[post${latestMessage.id}|${username}], Mais uma coisa que ninguém ouviu falar! PODE UPAR https://vk.com/topic-73670797_41317973 ✈️`)
    } else if (lowerCaseText.startsWith('!remind') || lowerCaseText.startsWith('!r ')) {
        try {
            const [_, time, unit] = lowerCaseText.split(' ');
            const reminderDate = calculateReminderDate(time, unit);
    
            const newReminder = new Reminder({
                topicId: discussion.id,
                messageId: latestMessage.id,
                userId: latestMessage.from_id,
                remindAt: reminderDate,
                message: `Reminder for ${username}`
            });
    
            await newReminder.save();
    
            await postReply(discussion.id, latestMessage.id, `[post${latestMessage.id}|${username}], Vou te marcar no tópico em ${time} ${unit} ✈️`);
        } catch (error) {
            console.log('Error:', error.message);
            await postReply(discussion.id, latestMessage.id, `[post${latestMessage.id}|${username}], Desculpe, ocorreu um erro ao configurar o lembrete. Verifique se escreveu corretamente ou chame o Sarmet ✈️`);
        }
    } else if (lowerCaseText === '!tutorial') {
        await postReply(discussion.id, latestMessage.id, messages.tutorial)
    }
}
