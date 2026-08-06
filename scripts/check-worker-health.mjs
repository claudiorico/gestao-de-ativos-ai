const DEFAULT_HEALTH_URL =
  "https://cofre-investimentos-functions.claudiorico81-20f.workers.dev/health";
const EXPECTED_MODEL = "@cf/zai-org/glm-4.7-flash";

const healthUrl = process.env.WORKER_HEALTH_URL || DEFAULT_HEALTH_URL;

async function main() {
  const response = await fetch(healthUrl, { method: "GET" });
  const text = await response.text();

  if (!response.ok) {
    if (response.status === 405) {
      throw new Error(
        `Worker health returned HTTP 405. The published Worker is probably older and does not include /health yet. Run npm run worker:deploy, then retry npm run worker:health.`,
      );
    }
    throw new Error(`Worker health returned HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Worker health did not return JSON: ${text.slice(0, 300)}`);
  }

  const failures = [];
  if (payload.ok !== true) failures.push("ok is not true");
  if (payload.portfolioAi?.workersAiBinding !== true) failures.push("Workers AI binding is not active");
  if (payload.portfolioAi?.model !== EXPECTED_MODEL) {
    failures.push(`model is ${payload.portfolioAi?.model ?? "missing"}, expected ${EXPECTED_MODEL}`);
  }
  if (!Array.isArray(payload.endpoints) || !payload.endpoints.includes("/analyze-portfolio")) {
    failures.push("/analyze-portfolio is not listed");
  }

  if (failures.length > 0) {
    throw new Error(`Worker health check failed: ${failures.join("; ")}`);
  }

  console.log("Worker health OK");
  console.log(`URL: ${healthUrl}`);
  console.log(`Version: ${payload.version ?? "unknown"}`);
  console.log(`Model: ${payload.portfolioAi.model}`);
}

main().catch((error) => {
  const cause = error?.cause ? `; cause: ${error.cause.message ?? error.cause}` : "";
  console.error(`${error.message}${cause}`);
  if (String(error?.cause?.message ?? "").includes("certificate")) {
    console.error("Try again with: $env:NODE_OPTIONS='--use-system-ca'; npm run worker:health");
  }
  process.exit(1);
});
