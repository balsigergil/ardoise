// SPDX-License-Identifier: AGPL-3.0-only
import type { AddressInfo } from 'node:net';
import { SMTPServer } from 'smtp-server';

export interface CapturedMail {
  to: string[];
  raw: string;
  /** Raw message with quoted-printable soft breaks and escapes decoded. */
  decoded: string;
}

function decodeQuotedPrintable(raw: string): string {
  const joined = raw.replace(/=\r?\n/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < joined.length; i++) {
    const hex =
      joined[i] === '=' ? /^[0-9A-F]{2}/.exec(joined.slice(i + 1, i + 3))?.[0] : undefined;
    if (hex) {
      bytes.push(parseInt(hex, 16));
      i += 2;
    } else bytes.push(...Buffer.from(joined[i]!, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** In-process SMTP server that records every message (tests only). */
export async function startSmtpCapture() {
  const messages: CapturedMail[] = [];
  const server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS', 'AUTH'],
    logger: false,
    onData(stream, session, callback) {
      const chunks: Buffer[] = [];
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        messages.push({
          to: session.envelope.rcptTo.map((r) => r.address),
          raw,
          decoded: decodeQuotedPrintable(raw),
        });
        callback();
      });
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.server.address() as AddressInfo;
  return {
    port,
    messages,
    /** Waits for a message to `to` and returns its link carrying a token. */
    async linkFor(to: string, timeoutMs = 10_000): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const mail = messages.find((m) => m.to.includes(to));
        const link = mail && /https?:\/\/[^\s"<>]+#token=[\w-]+/.exec(mail.decoded)?.[0];
        if (link) return link;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`no email with a link for ${to}`);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
