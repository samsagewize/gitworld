import { Redis } from '@upstash/redis';

// Works with the Vercel Marketplace Upstash integration (KV_REST_API_*) or a plain Upstash database (UPSTASH_REDIS_REST_*).
const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
export const redis = url && token ? new Redis({ url, token, automaticDeserialization: false }) : null;
