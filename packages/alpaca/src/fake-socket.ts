// Test double for `CreateSocket`: records every socket opened and lets a test
// play the server's side of the conversation.
import type { CreateSocket, Socket, SocketHandlers } from "./stream";

class FakeSocket implements Socket {
  readonly url: string;
  readonly sent: unknown[] = [];
  closed = false;
  private readonly handlers: SocketHandlers;

  constructor(url: string, handlers: SocketHandlers) {
    this.url = url;
    this.handlers = handlers;
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.handlers.close(1000, "");
  }

  /** Delivers one server frame holding `messages`. */
  receive(...messages: object[]): void {
    this.receiveRaw(JSON.stringify(messages));
  }

  /** Delivers `data` as a frame exactly as given. */
  receiveRaw(data: string): void {
    this.handlers.message(data);
  }

  /** Plays the handshake up to an accepted subscription. */
  accept(): void {
    this.receive({ T: "success", msg: "connected" });
    this.receive({ T: "success", msg: "authenticated" });
  }

  /** The server drops the connection. */
  drop(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.handlers.close(1006, "");
  }
}

class FakeServer {
  readonly sockets: FakeSocket[] = [];

  readonly createSocket: CreateSocket = (url, handlers) => {
    const socket = new FakeSocket(url, handlers);
    this.sockets.push(socket);
    return socket;
  };

  /** The most recent socket opened to `url` (or to anything). */
  latest(url?: string): FakeSocket {
    const socket = this.sockets.findLast(
      (candidate) => url === undefined || candidate.url === url
    );
    if (socket === undefined) {
      throw new Error(`no socket opened to ${url ?? "anything"}`);
    }
    return socket;
  }
}

const trade = (symbol: string, price: number): object => ({
  T: "t",
  S: symbol,
  p: price,
  s: 10,
  t: "2026-09-25T14:31:07.123Z",
});

const quote = (symbol: string, bid: number, ask: number): object => ({
  T: "q",
  S: symbol,
  bp: bid,
  bs: 5,
  ap: ask,
  as: 7,
  t: "2026-09-25T14:31:07.456Z",
});

export { FakeServer, quote, trade };
