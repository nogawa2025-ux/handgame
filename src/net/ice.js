// The single place to configure ICE servers. Add a TURN entry here if friends
// on mobile data cannot connect, e.g.
// { urls: 'turn:turn.example.com:3478', username: '...', credential: '...' }
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];
