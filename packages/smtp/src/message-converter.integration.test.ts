import type { Message } from "@upyo/core";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { convertMessage } from "./message-converter.ts";

describe("Message Converter Integration Tests", () => {
  const createTestMessage = (overrides: Partial<Message> = {}): Message => ({
    sender: { name: "John Doe", address: "john@example.com" },
    recipients: [{ name: "Jane Doe", address: "jane@example.com" }],
    ccRecipients: [],
    bccRecipients: [],
    replyRecipients: [],
    subject: "Test Subject",
    content: { text: "Hello, World!" },
    attachments: [],
    priority: "normal",
    tags: [],
    headers: new Headers(),
    ...overrides,
  });

  describe("Basic Message Conversion", () => {
    test("should convert simple text message to SMTP format", async () => {
      const message = createTestMessage();
      const result = await convertMessage(message);

      // Test envelope
      assert.strictEqual(result.envelope.from, "john@example.com");
      assert.deepStrictEqual(result.envelope.to, ["jane@example.com"]);

      // Test raw message structure
      const lines = result.raw.split("\r\n");
      assert.ok(
        lines.some((line) =>
          line.startsWith("From: John Doe <john@example.com>")
        ),
      );
      assert.ok(
        lines.some((line) =>
          line.startsWith("To: Jane Doe <jane@example.com>")
        ),
      );
      assert.ok(lines.some((line) => line.startsWith("Subject: Test Subject")));
      assert.ok(lines.some((line) => line.startsWith("Date:")));
      assert.ok(lines.some((line) => line.startsWith("Message-ID:")));
      assert.ok(lines.some((line) => line === "MIME-Version: 1.0"));
      assert.ok(result.raw.includes("Hello, World!"));
    });

    test("should handle multiple recipients in envelope", async () => {
      const message = createTestMessage({
        recipients: [
          { address: "jane@example.com" },
          { address: "bob@example.com" },
        ],
        ccRecipients: [{ address: "cc@example.com" }],
        bccRecipients: [{ address: "bcc@example.com" }],
      });

      const result = await convertMessage(message);

      // Envelope should include all recipients
      assert.deepStrictEqual(result.envelope.to, [
        "jane@example.com",
        "bob@example.com",
        "cc@example.com",
        "bcc@example.com",
      ]);

      // Raw message should only show To and Cc headers (not BCC)
      assert.ok(result.raw.includes("To: jane@example.com, bob@example.com"));
      assert.ok(result.raw.includes("Cc: cc@example.com"));
      assert.ok(!result.raw.includes("Bcc:")); // BCC should not appear in headers
    });
  });

  describe("Content Type Handling", () => {
    test("should create single-part HTML message", async () => {
      const message = createTestMessage({
        content: { html: "<h1>Hello</h1><p>World!</p>" },
      });

      const result = await convertMessage(message);

      assert.ok(result.raw.includes("Content-Type: text/html; charset=utf-8"));
      assert.ok(
        result.raw.includes("Content-Transfer-Encoding: quoted-printable"),
      );
      assert.ok(result.raw.includes("<h1>Hello</h1><p>World!</p>"));
      assert.ok(!result.raw.includes("multipart"));
    });

    test("should create multipart/alternative for mixed content", async () => {
      const message = createTestMessage({
        content: {
          text: "Hello World in plain text",
          html: "<h1>Hello World</h1><p>in HTML</p>",
        },
      });

      const result = await convertMessage(message);

      // Should be multipart/alternative
      assert.ok(result.raw.includes("Content-Type: multipart/alternative"));

      // Should contain both content types
      assert.ok(result.raw.includes("Content-Type: text/plain; charset=utf-8"));
      assert.ok(result.raw.includes("Content-Type: text/html; charset=utf-8"));

      // Should contain both content versions
      assert.ok(result.raw.includes("Hello World in plain text"));
      assert.ok(result.raw.includes("<h1>Hello World</h1>"));

      // Should have proper boundary structure
      const boundaryMatch = result.raw.match(/boundary="([^"]+)"/);
      assert.ok(boundaryMatch);
      const boundary = boundaryMatch[1];
      assert.ok(result.raw.includes(`--${boundary}`));
      assert.ok(result.raw.includes(`--${boundary}--`));
    });
  });

  describe("Attachment Handling", () => {
    test("should create multipart/mixed with single attachment", async () => {
      const attachmentContent = new TextEncoder().encode("File content here");
      const message = createTestMessage({
        attachments: [
          {
            filename: "test.txt",
            content: attachmentContent,
            contentType: "text/plain",
            contentId: "test-file",
            inline: false,
          },
        ],
      });

      const result = await convertMessage(message);

      // Should be multipart/mixed
      assert.ok(result.raw.includes("Content-Type: multipart/mixed"));

      // Should contain attachment headers
      assert.ok(
        result.raw.includes('Content-Type: text/plain; name="test.txt"'),
      );
      assert.ok(result.raw.includes("Content-Transfer-Encoding: base64"));
      assert.ok(
        result.raw.includes(
          'Content-Disposition: attachment; filename="test.txt"',
        ),
      );

      // Should contain base64 encoded content
      const expectedBase64 = btoa(String.fromCharCode(...attachmentContent));
      assert.ok(result.raw.includes(expectedBase64));
    });

    test("should handle inline attachments with Content-ID", async () => {
      const imageContent = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG signature
      const message = createTestMessage({
        attachments: [
          {
            filename: "image.png",
            content: imageContent,
            contentType: "image/png",
            contentId: "embedded-image",
            inline: true,
          },
        ],
      });

      const result = await convertMessage(message);

      assert.ok(
        result.raw.includes('Content-Type: image/png; name="image.png"'),
      );
      assert.ok(
        result.raw.includes(
          'Content-Disposition: inline; filename="image.png"',
        ),
      );
      assert.ok(result.raw.includes("Content-ID: <embedded-image>"));
    });

    test("should handle mixed content with attachments", async () => {
      const attachmentContent = new TextEncoder().encode("Attachment data");
      const message = createTestMessage({
        content: {
          text: "Text version",
          html: "<p>HTML version</p>",
        },
        attachments: [
          {
            filename: "document.pdf",
            content: attachmentContent,
            contentType: "application/pdf",
            contentId: "doc",
            inline: false,
          },
        ],
      });

      const result = await convertMessage(message);

      // Should be multipart/mixed at top level
      assert.ok(result.raw.includes("Content-Type: multipart/mixed"));

      // Should contain nested multipart/alternative for content
      assert.ok(result.raw.includes("Content-Type: multipart/alternative"));

      // Should contain all parts
      assert.ok(result.raw.includes("Text version"));
      assert.ok(result.raw.includes("<p>HTML version</p>"));
      assert.ok(
        result.raw.includes(
          'Content-Type: application/pdf; name="document.pdf"',
        ),
      );
    });
  });

  describe("Header Encoding", () => {
    test("should encode non-ASCII headers with RFC 2047", async () => {
      const message = createTestMessage({
        sender: { name: "김철수", address: "kim@example.com" },
        recipients: [{ name: "박영희", address: "park@example.com" }],
        subject: "한글 제목입니다",
      });

      const result = await convertMessage(message);

      // Should use RFC 2047 encoding for non-ASCII characters in subject
      assert.ok(result.raw.includes("Subject: =?UTF-8?B?"));
    });

    test("should leave ASCII headers unchanged", async () => {
      const message = createTestMessage({
        subject: "Plain ASCII Subject",
        sender: { name: "John Doe", address: "john@example.com" },
      });

      const result = await convertMessage(message);

      assert.ok(result.raw.includes("Subject: Plain ASCII Subject"));
      assert.ok(result.raw.includes("From: John Doe <john@example.com>"));
      assert.ok(!result.raw.includes("=?UTF-8?B?"));
    });
  });

  describe("Content Encoding", () => {
    test("should use quoted-printable for text content", async () => {
      const message = createTestMessage({
        content: { text: "Hello, 世界! This contains non-ASCII characters." },
      });

      const result = await convertMessage(message);

      assert.ok(
        result.raw.includes("Content-Transfer-Encoding: quoted-printable"),
      );

      // Should encode non-ASCII characters as quoted-printable
      assert.ok(result.raw.includes("=E4=B8=96=E7=95=8C")); // 世界 in UTF-8 quoted-printable
    });

    test("should handle special characters in quoted-printable", async () => {
      const message = createTestMessage({
        content: { text: "End=" },
      });

      const result = await convertMessage(message);

      // Should escape equals at end of line
      assert.ok(result.raw.includes("=3D")); // Escaped equals
    });
  });

  describe("Priority and Custom Headers", () => {
    test("should add priority headers for high priority", async () => {
      const message = createTestMessage({
        priority: "high",
      });

      const result = await convertMessage(message);

      assert.ok(result.raw.includes("X-Priority: 1"));
      assert.ok(result.raw.includes("X-MSMail-Priority: High"));
    });

    test("should add priority headers for low priority", async () => {
      const message = createTestMessage({
        priority: "low",
      });

      const result = await convertMessage(message);

      assert.ok(result.raw.includes("X-Priority: 5"));
      assert.ok(result.raw.includes("X-MSMail-Priority: Low"));
    });

    test("should not add priority headers for normal priority", async () => {
      const message = createTestMessage({
        priority: "normal",
      });

      const result = await convertMessage(message);

      assert.ok(!result.raw.includes("X-Priority:"));
      assert.ok(!result.raw.includes("X-MSMail-Priority:"));
    });

    test("should include custom headers", async () => {
      const headers = new Headers();
      headers.set("X-Custom-Header", "Custom Value");
      headers.set("X-Mailer", "Test Mailer");
      headers.set("X-ASCII-Header", "ASCII Value");

      const message = createTestMessage({ headers });
      const result = await convertMessage(message);

      assert.ok(result.raw.includes("x-custom-header: Custom Value"));
      assert.ok(result.raw.includes("x-mailer: Test Mailer"));
      assert.ok(result.raw.includes("x-ascii-header: ASCII Value"));
    });

    test("should handle reply-to addresses", async () => {
      const message = createTestMessage({
        replyRecipients: [
          { name: "Support", address: "support@example.com" },
          { address: "noreply@example.com" },
        ],
      });

      const result = await convertMessage(message);

      assert.ok(
        result.raw.includes(
          "Reply-To: Support <support@example.com>, noreply@example.com",
        ),
      );
    });
  });

  describe("Message ID Generation", () => {
    test("should generate unique message IDs", async () => {
      const message = createTestMessage();

      const result1 = await convertMessage(message);
      const result2 = await convertMessage(message);

      const messageId1 = result1.raw.match(/Message-ID: <([^>]+)>/)?.[1];
      const messageId2 = result2.raw.match(/Message-ID: <([^>]+)>/)?.[1];

      assert.ok(messageId1);
      assert.ok(messageId2);
      assert.notStrictEqual(messageId1, messageId2);

      // Should follow expected format
      assert.ok(messageId1.includes("@upyo.local"));
      assert.ok(messageId2.includes("@upyo.local"));
    });

    test("should generate valid date headers", async () => {
      const message = createTestMessage();
      const result = await convertMessage(message);

      const dateMatch = result.raw.match(/Date: (.+)/);
      assert.ok(dateMatch);

      const dateString = dateMatch[1];
      const parsedDate = new Date(dateString);
      assert.ok(!isNaN(parsedDate.getTime()));

      // Should be recent (within last minute)
      const now = new Date();
      const timeDiff = Math.abs(now.getTime() - parsedDate.getTime());
      assert.ok(timeDiff < 60000); // Less than 1 minute
    });
  });

  describe("Base64 Encoding", () => {
    test("should properly encode binary attachments", async () => {
      // Create a test binary file (ZIP signature + some data)
      const binaryContent = new Uint8Array([
        0x50,
        0x4B,
        0x03,
        0x04, // ZIP signature
        0x14,
        0x00,
        0x00,
        0x00, // Version, flags
        0x08,
        0x00,
        0x00,
        0x00, // Compression method, time
      ]);

      const message = createTestMessage({
        attachments: [
          {
            filename: "test.zip",
            content: binaryContent,
            contentType: "application/zip",
            contentId: "zip-file",
            inline: false,
          },
        ],
      });

      const result = await convertMessage(message);

      // Should contain base64 encoded content
      const expectedBase64 = btoa(String.fromCharCode(...binaryContent));
      assert.ok(result.raw.includes(expectedBase64));

      // Should have proper line breaks (76 chars max per line)
      const base64Lines = result.raw.split("\r\n").filter((line) =>
        /^[A-Za-z0-9+/]+=*$/.test(line) && line.length > 50
      );

      if (base64Lines.length > 0) {
        base64Lines.forEach((line) => {
          assert.ok(
            line.length <= 76,
            `Base64 line too long: ${line.length} chars`,
          );
        });
      }
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty content", async () => {
      const message = createTestMessage({
        content: { text: "" },
      });

      const result = await convertMessage(message);

      assert.strictEqual(result.envelope.from, "john@example.com");
      assert.ok(result.raw.includes("Content-Type: text/plain; charset=utf-8"));
      // Empty content should still result in valid message structure
      assert.ok(result.raw.includes("MIME-Version: 1.0"));
    });

    test("should handle message with no To recipients", async () => {
      const message = createTestMessage({
        recipients: [], // No To recipients
        ccRecipients: [{ address: "cc@example.com" }],
        bccRecipients: [{ address: "bcc@example.com" }],
      });

      const result = await convertMessage(message);

      // Envelope should contain all recipients
      assert.deepStrictEqual(result.envelope.to, [
        "cc@example.com",
        "bcc@example.com",
      ]);

      // Should have Cc header and empty To header (RFC compliant)
      assert.ok(result.raw.includes("Cc: cc@example.com"));
      assert.ok(result.raw.includes("To: "));
    });

    test("should handle very long lines in content", async () => {
      const longLine = "A".repeat(1000);
      const message = createTestMessage({
        content: { text: longLine },
      });

      const result = await convertMessage(message);

      // Should use quoted-printable encoding
      assert.ok(
        result.raw.includes("Content-Transfer-Encoding: quoted-printable"),
      );

      // Long lines should be present (quoted-printable doesn't break long ASCII lines)
      assert.ok(result.raw.includes(longLine));
    });
  });
});
