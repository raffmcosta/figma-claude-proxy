/**
 * Test serverless function (NOT edge runtime)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    success: true,
    message: 'Serverless function works!',
    timestamp: Date.now(),
    runtime: 'nodejs'
  });
}
