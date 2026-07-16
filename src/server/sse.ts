import { FastifyReply, FastifyRequest } from 'fastify'
export class SseHub {
  private clients = new Set<FastifyReply>()
  handler(_req: FastifyRequest, reply: FastifyReply) {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive' })
    reply.raw.write('\n')
    this.clients.add(reply)
    reply.raw.on('close', () => this.clients.delete(reply))
  }
  broadcast(event: string, data: any) {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    for (const c of this.clients) c.raw.write(msg)
  }
}
