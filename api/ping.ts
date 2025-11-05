export const runtime = 'edge';

export default async function handler(_req: Request) {
  return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
