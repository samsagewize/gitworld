import { handlers, authConfigured } from '../../../../auth';

const off = () => Response.json({ error: 'GitHub sign-in is not configured yet.' }, { status: 503 });
export const GET = (req) => authConfigured ? handlers.GET(req) : off();
export const POST = (req) => authConfigured ? handlers.POST(req) : off();
