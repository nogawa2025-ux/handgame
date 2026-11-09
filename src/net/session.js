// Facade used by main.js.
export { createRoom, joinRoom, errorText } from './peer.js';
export { createHostSync, createGuestSync } from './sync.js';

export const requestRematch = (conn) => conn.requestRematch();
