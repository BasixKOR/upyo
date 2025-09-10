import type { Message } from "@upyo/core";
import { ResendTransport } from "./resend-transport.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Note: Tests are split into separate describe blocks instead of one unified block
// because Deno runs tests within the same describe block concurrently, which causes
// globalThis.fetch mocking to interfere between tests. Node.js runs tests sequentially
// so it doesn't have this issue. By separating each test into its own describe block,
// we ensure that fetch mocking is isolated between tests in both environments.

describe("ResendTransport - Send Message", () => {
  it("should send a message successfully", async () => {
    const originalFetch = globalThis.fetch;
    try {
      // Mock successful response
      // deno-lint-ignore require-await
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            id: "test-message-id",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      };

      const transport = new ResendTransport({
        apiKey: "test-key",
      });

      const message: Message = {
        sender: { address: "sender@example.com" },
        recipients: [{ address: "recipient@example.com" }],
        ccRecipients: [],
        bccRecipients: [],
        replyRecipients: [],
        subject: "Test Subject",
        content: { text: "Test content" },
        attachments: [],
        priority: "normal",
        tags: [],
        headers: new Headers(),
      };

      const receipt = await transport.send(message);

      assert.equal(receipt.successful, true);
      if (receipt.successful) {
        assert.equal(receipt.messageId, "test-message-id");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("ResendTransport - API Errors", () => {
  it("should handle API errors", async () => {
    const originalFetch = globalThis.fetch;
    try {
      // Mock error response
      // deno-lint-ignore require-await
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            message: "Invalid API key",
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      };

      const transport = new ResendTransport({
        apiKey: "invalid-key",
      });

      const message: Message = {
        sender: { address: "sender@example.com" },
        recipients: [{ address: "recipient@example.com" }],
        ccRecipients: [],
        bccRecipients: [],
        replyRecipients: [],
        subject: "Test Subject",
        content: { text: "Test content" },
        attachments: [],
        priority: "normal",
        tags: [],
        headers: new Headers(),
      };

      const receipt = await transport.send(message);

      assert.equal(receipt.successful, false);
      if (!receipt.successful) {
        assert.ok(receipt.errorMessages.length > 0);
        assert.ok(receipt.errorMessages[0].includes("Invalid API key"));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("ResendTransport - Network Errors", () => {
  it("should handle network errors", async () => {
    const originalFetch = globalThis.fetch;
    try {
      // Mock network error
      // deno-lint-ignore require-await
      globalThis.fetch = async () => {
        throw new Error("Network error");
      };

      const transport = new ResendTransport({
        apiKey: "test-key",
      });

      const message: Message = {
        sender: { address: "sender@example.com" },
        recipients: [{ address: "recipient@example.com" }],
        ccRecipients: [],
        bccRecipients: [],
        replyRecipients: [],
        subject: "Test Subject",
        content: { text: "Test content" },
        attachments: [],
        priority: "normal",
        tags: [],
        headers: new Headers(),
      };

      const receipt = await transport.send(message);

      assert.equal(receipt.successful, false);
      if (!receipt.successful) {
        assert.ok(receipt.errorMessages.length > 0);
        assert.ok(receipt.errorMessages[0].includes("Network error"));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("ResendTransport - Abort Signal", () => {
  it("should handle abort signal", async () => {
    const originalFetch = globalThis.fetch;
    try {
      // Mock slow response
      // deno-lint-ignore require-await
      globalThis.fetch = async () => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(
                JSON.stringify({ id: "test-id" }),
                { status: 200 },
              ),
            );
          }, 1000);
        });
      };

      const transport = new ResendTransport({
        apiKey: "test-key",
      });

      const message: Message = {
        sender: { address: "sender@example.com" },
        recipients: [{ address: "recipient@example.com" }],
        ccRecipients: [],
        bccRecipients: [],
        replyRecipients: [],
        subject: "Test Subject",
        content: { text: "Test content" },
        attachments: [],
        priority: "normal",
        tags: [],
        headers: new Headers(),
      };

      const controller = new AbortController();
      controller.abort();

      const receipt = await transport.send(message, {
        signal: controller.signal,
      });

      assert.equal(receipt.successful, false);
      if (!receipt.successful) {
        assert.ok(receipt.errorMessages.length > 0);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("ResendTransport - Batch Sending Small", () => {
  it("should send small batch using batch API", async () => {
    const originalFetch = globalThis.fetch;
    try {
      // Mock batch API response
      // deno-lint-ignore require-await
      globalThis.fetch = async (url) => {
        // Check that batch endpoint is called
        if (typeof url === "string" && url.includes("/emails/batch")) {
          return new Response(
            JSON.stringify({
              data: [
                { id: "message-1" },
                { id: "message-2" },
              ],
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error("Unexpected URL called");
      };

      const transport = new ResendTransport({
        apiKey: "test-key",
      });

      const messages: Message[] = [
        {
          sender: { address: "sender@example.com" },
          recipients: [{ address: "recipient1@example.com" }],
          ccRecipients: [],
          bccRecipients: [],
          replyRecipients: [],
          subject: "Test Subject 1",
          content: { text: "Test content 1" },
          attachments: [],
          priority: "normal",
          tags: [],
          headers: new Headers(),
        },
        {
          sender: { address: "sender@example.com" },
          recipients: [{ address: "recipient2@example.com" }],
          ccRecipients: [],
          bccRecipients: [],
          replyRecipients: [],
          subject: "Test Subject 2",
          content: { text: "Test content 2" },
          attachments: [],
          priority: "normal",
          tags: [],
          headers: new Headers(),
        },
      ];

      const receipts = [];
      for await (const receipt of transport.sendMany(messages)) {
        receipts.push(receipt);
      }

      assert.equal(receipts.length, 2);
      assert.equal(receipts[0].successful, true);
      assert.equal(receipts[1].successful, true);

      if (receipts[0].successful && receipts[1].successful) {
        assert.equal(receipts[0].messageId, "message-1");
        assert.equal(receipts[1].messageId, "message-2");
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("ResendTransport - Individual Sending", () => {
  it("should fall back to individual requests for messages with attachments", async () => {
    const originalFetch = globalThis.fetch;
    let callCount = 0;

    try {
      // Mock individual API responses
      // deno-lint-ignore require-await
      globalThis.fetch = async (url) => {
        callCount++;
        // Should call individual endpoint, not batch
        if (
          typeof url === "string" && url.includes("/emails") &&
          !url.includes("/batch")
        ) {
          return new Response(
            JSON.stringify({ id: `message-${callCount}` }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }

        throw new Error("Unexpected URL called");
      };

      const transport = new ResendTransport({
        apiKey: "test-key",
      });

      const messages: Message[] = [
        {
          sender: { address: "sender@example.com" },
          recipients: [{ address: "recipient1@example.com" }],
          ccRecipients: [],
          bccRecipients: [],
          replyRecipients: [],
          subject: "Test Subject 1",
          content: { text: "Test content 1" },
          attachments: [{
            filename: "test.txt",
            content: new Uint8Array(10),
            contentType: "text/plain",
            inline: false,
            contentId: "",
          }],
          priority: "normal",
          tags: [],
          headers: new Headers(),
        },
        {
          sender: { address: "sender@example.com" },
          recipients: [{ address: "recipient2@example.com" }],
          ccRecipients: [],
          bccRecipients: [],
          replyRecipients: [],
          subject: "Test Subject 2",
          content: { text: "Test content 2" },
          attachments: [],
          priority: "normal",
          tags: [],
          headers: new Headers(),
        },
      ];

      const receipts = [];
      for await (const receipt of transport.sendMany(messages)) {
        receipts.push(receipt);
      }

      assert.equal(receipts.length, 2);
      assert.equal(callCount, 2); // Should make 2 individual calls
      assert.equal(receipts[0].successful, true);
      assert.equal(receipts[1].successful, true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("ResendTransport - Empty Batch", () => {
  it("should handle empty message array", async () => {
    const transport = new ResendTransport({
      apiKey: "test-key",
    });

    const receipts = [];
    for await (const receipt of transport.sendMany([])) {
      receipts.push(receipt);
    }

    assert.equal(receipts.length, 0);
  });
});

describe("ResendTransport - Config Validation", () => {
  it("should create transport with minimal config", () => {
    const transport = new ResendTransport({
      apiKey: "test-key",
    });

    assert.equal(transport.config.apiKey, "test-key");
    assert.equal(transport.config.baseUrl, "https://api.resend.com");
    assert.equal(transport.config.timeout, 30000);
    assert.equal(transport.config.retries, 3);
  });

  it("should create transport with custom config", () => {
    const transport = new ResendTransport({
      apiKey: "test-key",
      baseUrl: "https://custom.resend.com",
      timeout: 60000,
      retries: 5,
    });

    assert.equal(transport.config.apiKey, "test-key");
    assert.equal(transport.config.baseUrl, "https://custom.resend.com");
    assert.equal(transport.config.timeout, 60000);
    assert.equal(transport.config.retries, 5);
  });
});
