import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import { app, setTestServer } from '../src/server';
import http from 'http';

/**
 * Graceful Shutdown tests.
 *
 * Each test spins up its own HTTP server on an ephemeral port so that
 * shutdown behaviour can be validated without closing the shared Redis /
 * Postgres / BullMQ singletons used by the rest of the test suite.
 */

const startServer = (): Promise<http.Server> =>
  new Promise(resolve => {
    const srv = app.listen(0, () => resolve(srv));
  });

describe('HTTP Server Close', () => {
  let srv: http.Server;

  beforeEach(async () => {
    srv = await startServer();
    setTestServer(srv);
  });

  afterEach(async () => {
    // Close only the HTTP server — leave Redis/Postgres open for other suites
    if (srv.listening) {
      await new Promise<void>(resolve => srv.close(() => resolve()));
    }
    vi.restoreAllMocks();
  });

  it('server stops listening after close()', async () => {
    expect(srv.listening).toBe(true);

    await new Promise<void>(resolve => srv.close(() => resolve()));

    expect(srv.listening).toBe(false);
  });

  it('no new HTTP connections accepted after server is closed', async () => {
    const port = (srv.address() as { port: number }).port;
    await new Promise<void>(resolve => srv.close(() => resolve()));

    await expect(
      request(`http://localhost:${port}`).get('/status'),
    ).rejects.toThrow();
  });

  it('SIGTERM handler is registered', () => {
    // Verify process.on('SIGTERM', ...) was wired — at minimum the event has
    // a listener attached by server.ts on import.
    const count = process.listenerCount('SIGTERM');
    expect(count).toBeGreaterThanOrEqual(1);
  });

  it('server remains healthy before shutdown', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
