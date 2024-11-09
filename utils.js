import { gsdMessages, azMessages, antigsdMessages } from './messages.js';
import Reminder from './models/Reminder.js'
import { postReply } from './replies.js';
import { getUser } from './user.js';

export function getRandomGSDMessage() { 
    const randomIndex = Math.floor(Math.random() * gsdMessages.length);
    return gsdMessages[randomIndex];
}

export function getRandomAZMessage() {
    const randomIndex = Math.floor(Math.random() * azMessages.length);
    return azMessages[randomIndex];
}

export function getRandomAntiGSDMessage() {
    const randomIndex = Math.floor(Math.random() * antigsdMessages.length);
    return antigsdMessages[randomIndex];
}

export function calculateReminderDate(time, unit) {
    const timeInSeconds = parseInt(time);
    let totalSeconds = 0;

    switch (unit) {
        case 'minuto':
        case 'minutos':
            totalSeconds = timeInSeconds * 60;
            break;
        case 'hora':
        case 'horas':
            totalSeconds = timeInSeconds * 60 * 60;
            break;
        case 'dia':
        case 'dias':
            totalSeconds = timeInSeconds * 60 * 60 * 24;
            break;
        case 'mes':
        case 'meses':
        case 'mês':
            totalSeconds = timeInSeconds * 60 * 60 * 24 * 30;
            break;
        default:
            throw new Error('Invalid time unit');
    }

    return new Date(Date.now() + (totalSeconds-1) * 1000);
}

export const checkReminders = async () => {
  const now = new Date();
  
  const dueReminders = await Reminder.find({ remindAt: { $lte: now } });
  
  for (const reminder of dueReminders) {
    const username = await getUser(reminder.userId);
    await postReply(reminder.topicId, reminder.messageId, `[post${reminder.messageId}|${username}], Lembrando, conforme você pediu ✈️`);
    
    await Reminder.deleteOne({ _id: reminder._id });
  }
};
