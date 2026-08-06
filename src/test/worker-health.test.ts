import { describe, expect, it } from "vitest";

import worker from "../../cloudflare/worker";

describe("worker health endpoint", () => {
  it("exposes a safe health response without portfolio data", async () => {
    const response = await worker.fetch(
      new Request("https://worker.test/health", { method: "GET" }),
      {
        AI: {},
        WORKERS_AI_MODEL: "@cf/zai-org/glm-4.7-flash",
      },
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      ok: true,
      worker: "cofre-investimentos-functions",
      portfolioAi: {
        enabled: true,
        workersAiBinding: true,
        model: "@cf/zai-org/glm-4.7-flash",
      },
    });
    expect(data.endpoints).toContain("/analyze-portfolio");
    expect(JSON.stringify(data)).not.toContain("claudiorico");
  });
});
