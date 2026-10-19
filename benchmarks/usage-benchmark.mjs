
import { randomUUID, randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

const BASE_URL = "http://localhost:8080";
const TOTAL_REQUESTS = 250;
const CONCURRENCY = 10;
const UNITS_PER_REQUEST = 1;

const latencies = [];
const statusCounts = {};

let completed = 0;
let accepted = 0;
let rejected = 0;
let duplicates = 0;
let errors = 0;

// Send an HTTP request and parse the response.
async function apiRequest(path, options = {}) {
    const response = await fetch(`${BASE_URL}${path}`, {
        ...options,
        signal: AbortSignal.timeout(20000),
    });

    const body = await response.json();

    return {
        status: response.status,
        body,
    };
}

// Calculate a latency percentile.
function percentile(values, percentage) {
    if (values.length === 0) return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentage / 100) * sorted.length) - 1;

    return sorted[Math.max(0, index)];
}

// Run the benchmark.

async function main() {
    if (process.env.ALLOW_USAGE_BENCHMARK !== "yes") {
        console.error(
            "Benchmark disabled. Set ALLOW_USAGE_BENCHMARK=yes to run it."
        );
        process.exitCode = 1;
        return;
    }

    console.log("Creating an isolated benchmark company...");


    const companyName =
        `Benchmark-${randomBytes(6).toString("hex")}`;

    const accountResponse = await apiRequest("/api/accounts", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            name: companyName,
            planName: "Starter",
        }),
    });

    if (accountResponse.status !== 201) {
        throw new Error(
            `Account creation failed: ${JSON.stringify(accountResponse.body)}`
        );
    }

    const apiKey = accountResponse.body.apiKey;
    const accountId = accountResponse.body.account.id;

    console.log(`Company: ${companyName}`);
    console.log(`Account ID: ${accountId}`);

    // Create a Basic user for the benchmark.
    const userResponse = await apiRequest("/api/users", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `ApiKey ${apiKey}`,
        },
        body: JSON.stringify({
            name: "Benchmark User",
            planName: "Basic",
        }),
    });

    if (userResponse.status !== 201) {
        throw new Error(
            `User creation failed: ${JSON.stringify(userResponse.body)}`
        );
    }

    const userId = userResponse.body.user.id;

    console.log(`User ID: ${userId}`);
    console.log(
        `Running ${TOTAL_REQUESTS} requests with ${CONCURRENCY} workers...`
    );

    // Shared counter for assigning each logical request once.
    let nextRequest = 0;

    async function worker() {
        while (nextRequest < TOTAL_REQUESTS) {
            nextRequest++;

            const idempotencyKey = randomUUID();
            const started = performance.now();

            try {
                const result = await apiRequest("/api/usage", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `ApiKey ${apiKey}`,
                        "Idempotency-Key": idempotencyKey,
                    },
                    body: JSON.stringify({
                        userId,
                        units: UNITS_PER_REQUEST,
                    }),
                });

                const duration = performance.now() - started;
                latencies.push(duration);

                completed++;

                statusCounts[result.status] =
                    (statusCounts[result.status] || 0) + 1;

                if (result.status !== 200) {
                    errors++;
                } else if (result.body.duplicate === true) {
                    duplicates++;
                } else if (result.body.allowed === true) {
                    accepted++;
                } else if (result.body.allowed === false) {
                    rejected++;
                } else {
                    errors++;
                }
            } catch (error) {
                errors++;
                completed++;
                console.error("Request failed:", error.message);
            }
        }
    }

    const start = performance.now();

    // Launch 10 workers concurrently.
    await Promise.all(
        Array.from({ length: CONCURRENCY }, () => worker())
    );

    const durationSeconds = (performance.now() - start) / 1000;

    console.log("\n===== BENCHMARK RESULTS =====");
    console.log(`Total requests: ${TOTAL_REQUESTS}`);
    console.log(`Completed: ${completed}`);
    console.log(`Accepted: ${accepted}`);
    console.log(`Rejected: ${rejected}`);
    console.log(`Duplicates: ${duplicates}`);
    console.log(`Errors: ${errors}`);
    console.log(`HTTP statuses: ${JSON.stringify(statusCounts)}`);
    console.log(`Duration: ${durationSeconds.toFixed(2)} seconds`);

    console.log(
        `Throughput: ${(completed / durationSeconds).toFixed(2)} requests/sec`
    );

    if (latencies.length > 0) {
        const average =
            latencies.reduce((sum, value) => sum + value, 0) /
            latencies.length;

        console.log(`Average latency: ${average.toFixed(2)} ms`);
        console.log(`p50 latency: ${percentile(latencies, 50).toFixed(2)} ms`);
        console.log(`p95 latency: ${percentile(latencies, 95).toFixed(2)} ms`);
        console.log(`p99 latency: ${percentile(latencies, 99).toFixed(2)} ms`);
    }

    console.log(`Benchmark account ID: ${accountId}`);
    console.log("Temporary benchmark data has not been deleted.");
    console.log("Do not use this script against production.");
}

main().catch((error) => {
    console.error("Benchmark failed:", error);
    process.exitCode = 1;
});
