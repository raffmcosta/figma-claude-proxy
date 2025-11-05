/**
 * CLAUDE STREAMING ENDPOINT - Node.js Runtime
 * Works with Vercel Hobby plan (no Edge runtime required)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { anthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';

export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle OPTIONS
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { model, messages, maxTokens = 4096 } = req.body;

    // Validate
    if (!model || !messages) {
      res.status(400).json({ error: 'Missing required fields: model, messages' });
      return;
    }

    // Model mapping
    const modelMap: Record<string, string> = {
      'claude-sonnet-4-5-20250929': 'claude-sonnet-4',
      'claude-haiku-4-5-20251001': 'claude-haiku-4',
      'claude-opus-4-1-20250805': 'claude-opus-4',
    };
    const mappedModel = modelMap[model] || model;

    // Validate API key
    if (!process.env.ANTHROPIC_API_KEY?.startsWith('sk-ant-')) {
      res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured' });
      return;
    }

    console.log('[STREAM-V2] Starting stream:', { model: mappedModel, messages: messages.length });

    // Create stream
    const result = await streamText({
      model: anthropic(mappedModel),
      messages,
      temperature: 1,
      maxTokens,
    });

    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Stream the response
    const stream = result.textStream;

    for await (const chunk of stream) {
      res.write(`data: ${chunk}\n\n`);
    }

    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error: any) {
    console.error('[STREAM-V2] Error:', error);

    if (!res.headersSent) {
      res.status(500).json({
        error: error.message || 'Internal server error',
        details: error.toString()
      });
    } else {
      res.end();
    }
  }
}
