// Test-only: mint Auth.js session cookies for fake players against a LOCAL server with a throwaway AUTH_SECRET.
import { encode } from 'next-auth/jwt';
const [login] = process.argv.slice(2);
const v = await encode({ token: { login, gh: 'fake-token-for-local-test', ghId: 1, name: login }, secret: process.env.AUTH_SECRET, salt: 'authjs.session-token' });
console.log(v);
