import { gsdMessages, azMessages, antigsdMessages } from './messages.js';

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
