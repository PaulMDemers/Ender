const { z } = require("zod");
const { tool } = require("@langchain/core/tools");

function emailConfigured(emailConfig) {
  return Boolean(emailConfig?.smtp?.host && emailConfig?.smtp?.port && emailConfig?.smtp?.user && emailConfig?.smtp?.pass);
}

function imapConfigured(emailConfig) {
  return Boolean(emailConfig?.imap?.host && emailConfig?.imap?.port && emailConfig?.imap?.user && emailConfig?.imap?.pass);
}

function decodeMimeWords(input) {
  return String(input || "")
    .replace(/=\?UTF-8\?B\?([^?]+)\?=/gi, (_m, b64) => {
      try {
        return Buffer.from(b64, "base64").toString("utf8");
      } catch {
        return "";
      }
    })
    .replace(/=\?UTF-8\?Q\?([^?]+)\?=/gi, (_m, qp) => qp.replace(/_/g, " "));
}

function stripHtml(input) {
  return String(input || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTextFromRawMessage(raw) {
  const source = raw.toString("utf8");
  const bodySplit = source.split(/\r?\n\r?\n/);
  if (bodySplit.length < 2) return source.slice(0, 6000);
  const body = bodySplit.slice(1).join("\n\n");
  const htmlMatch = body.match(/<html[\s\S]*<\/html>/i);
  if (htmlMatch) return stripHtml(htmlMatch[0]).slice(0, 6000);
  return body.slice(0, 6000);
}

function createEmailTools(emailConfig) {
  const email_send = tool(
    async ({ to, subject, text, html }) => {
      if (!emailConfigured(emailConfig)) {
        return JSON.stringify({
          ok: false,
          error: "email_not_configured",
          message: "Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally SMTP_FROM)"
        });
      }

      const nodemailer = require("nodemailer");
      const transporter = nodemailer.createTransport({
        host: emailConfig.smtp.host,
        port: Number(emailConfig.smtp.port),
        secure: Boolean(emailConfig.smtp.secure),
        auth: {
          user: emailConfig.smtp.user,
          pass: emailConfig.smtp.pass
        }
      });

      const from = emailConfig.smtp.from || emailConfig.smtp.user;
      const info = await transporter.sendMail({
        from,
        to,
        subject,
        text: text || undefined,
        html: html || undefined
      });

      return JSON.stringify({
        ok: true,
        messageId: info.messageId,
        accepted: info.accepted || [],
        rejected: info.rejected || []
      });
    },
    {
      name: "email_send",
      description: "Send an email via SMTP",
      schema: z.object({
        to: z.string().min(1),
        subject: z.string().min(1),
        text: z.string().nullable(),
        html: z.string().nullable()
      })
    }
  );

  const email_list = tool(
    async ({ mailbox, limit, unseenOnly }) => {
      if (!imapConfigured(emailConfig)) {
        return JSON.stringify({
          ok: false,
          error: "email_imap_not_configured",
          message: "Set IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS to list or read emails"
        });
      }

      const { ImapFlow } = require("imapflow");
      const client = new ImapFlow({
        host: emailConfig.imap.host,
        port: Number(emailConfig.imap.port),
        secure: Boolean(emailConfig.imap.secure),
        auth: {
          user: emailConfig.imap.user,
          pass: emailConfig.imap.pass
        }
      });

      const max = Math.min(Math.max(Number(limit || 20), 1), 100);
      const box = String(mailbox || emailConfig.imap.mailbox || "INBOX");
      const search = unseenOnly ? { seen: false } : { all: true };

      try {
        await client.connect();
        await client.mailboxOpen(box);
        const uids = await client.search(search, { uid: true });
        const selected = uids.slice(-max).reverse();
        const items = [];
        for await (const msg of client.fetch(selected, { uid: true, envelope: true, flags: true, internalDate: true })) {
          items.push({
            uid: msg.uid,
            date: msg.internalDate,
            from: (msg.envelope?.from || []).map((entry) => ({
              name: decodeMimeWords(entry.name || ""),
              address: entry.address || ""
            })),
            subject: decodeMimeWords(msg.envelope?.subject || ""),
            seen: Array.isArray(msg.flags) ? msg.flags.includes("\\Seen") : null
          });
        }
        return JSON.stringify({ ok: true, mailbox: box, count: items.length, items });
      } finally {
        await client.logout().catch(() => {});
      }
    },
    {
      name: "email_list",
      description: "List recent emails from a mailbox",
      schema: z.object({
        mailbox: z.string().nullable(),
        limit: z.number().int().positive().max(100).nullable(),
        unseenOnly: z.boolean().nullable()
      })
    }
  );

  const email_read = tool(
    async ({ uid, mailbox }) => {
      if (!imapConfigured(emailConfig)) {
        return JSON.stringify({
          ok: false,
          error: "email_imap_not_configured",
          message: "Set IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASS to list or read emails"
        });
      }

      const { ImapFlow } = require("imapflow");
      const client = new ImapFlow({
        host: emailConfig.imap.host,
        port: Number(emailConfig.imap.port),
        secure: Boolean(emailConfig.imap.secure),
        auth: {
          user: emailConfig.imap.user,
          pass: emailConfig.imap.pass
        }
      });

      const box = String(mailbox || emailConfig.imap.mailbox || "INBOX");
      try {
        await client.connect();
        await client.mailboxOpen(box);
        const msg = await client.fetchOne(Number(uid), { uid: true, envelope: true, source: true, internalDate: true }, { uid: true });
        if (!msg) {
          return JSON.stringify({ ok: false, error: "not_found", message: `No message found for uid=${uid}` });
        }

        const textBody = parseTextFromRawMessage(msg.source || Buffer.from(""));
        return JSON.stringify({
          ok: true,
          mailbox: box,
          uid: msg.uid,
          date: msg.internalDate,
          subject: decodeMimeWords(msg.envelope?.subject || ""),
          from: (msg.envelope?.from || []).map((entry) => ({
            name: decodeMimeWords(entry.name || ""),
            address: entry.address || ""
          })),
          body: textBody
        });
      } finally {
        await client.logout().catch(() => {});
      }
    },
    {
      name: "email_read",
      description: "Read a specific email by IMAP UID",
      schema: z.object({
        uid: z.number().int().positive(),
        mailbox: z.string().nullable()
      })
    }
  );

  return [email_list, email_read, email_send];
}

module.exports = { createEmailTools };
