
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { app } from "../src/app.js";
import { db, client } from "../src/db/index.js";
import {
    accounts,
    users,
    usageRequests,
    accountUsageCounters,
    userUsageCounters,
} from "../src/db/schema.js";

describe("Usage Quota Enforcement", () => {
    let apiKey: string;
    let accountId: string;
    let userId: string;

    beforeAll(async () => {
        // Create an account with the Starter plan.
        const accountResponse = await request(app)
            .post("/api/accounts")
            .send({
                name: `UsageTest-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });

        expect(accountResponse.status).toBe(201);

        apiKey = accountResponse.body.apiKey;
        accountId = accountResponse.body.account.id;

        // Create a user with the Basic plan.
        const userResponse = await request(app)
            .post("/api/users")
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                name: "QuotaTestUser",
                planName: "Basic",
            });

        expect(userResponse.status).toBe(201);

        userId = userResponse.body.user.id;
    });


    afterAll(async () => {
        try {
            if (accountId) {
                await db.transaction(async (tx) => {
                    // Delete usage history first.
                    await tx
                        .delete(usageRequests)
                        .where(eq(usageRequests.accountId, accountId));

                    // Delete the account's monthly counters.
                    await tx
                        .delete(accountUsageCounters)
                        .where(eq(accountUsageCounters.accountId, accountId));

                    // Delete the user's monthly counters.
                    if (userId) {
                        await tx
                            .delete(userUsageCounters)
                            .where(eq(userUsageCounters.userId, userId));
                    }

                    // Delete the user before deleting its account.
                    await tx
                        .delete(users)
                        .where(eq(users.accountId, accountId));

                    // Finally, delete the temporary account.
                    await tx
                        .delete(accounts)
                        .where(eq(accounts.id, accountId));
                });
            }
        } finally {
            await client.end();
        }
    });


    it("accepts a request within quota limits", async () => {
        const response = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", randomBytes(16).toString("hex"))
            .send({
                userId,
                units: 50,
            });

        expect(response.status).toBe(200);
        expect(response.body.allowed).toBe(true);
        expect(response.body.duplicate).toBe(false);
        expect(response.body.usage.user.usedUnits).toBe(50);
    });

    it("reports the updated usage counters", async () => {
        const response = await request(app)
            .get(`/api/users/${userId}/usage`)
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(response.status).toBe(200);
        expect(response.body.usage.usedUnits).toBe(50);
        expect(response.body.usage.remainingUnits).toBe(950);
    });

    it("rejects requests exceeding the user per-request limit", async () => {
        const response = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", randomBytes(16).toString("hex"))
            .send({
                userId,
                units: 150,
            });

        expect(response.status).toBe(200);
        expect(response.body.allowed).toBe(false);
        expect(response.body.reason).toBe(
            "user_max_units_per_request_exceeded"
        );
        expect(response.body.usage.user.usedUnits).toBe(50);
    });

    it("does not consume quota twice for the same idempotency key", async () => {
        const idempotencyKey = randomBytes(16).toString("hex");

        // Read the current usage before the test.
        const before = await request(app)
            .get(`/api/users/${userId}/usage`)
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(before.status).toBe(200);

        const usedBefore = before.body.usage.usedUnits;

        // First request: should consume 30 units.
        const first = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", idempotencyKey)
            .send({
                userId,
                units: 30,
            });

        expect(first.status).toBe(200);
        expect(first.body.allowed).toBe(true);
        expect(first.body.duplicate).toBe(false);

        // Retry with exactly the same key and payload.
        const second = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", idempotencyKey)
            .send({
                userId,
                units: 30,
            });

        expect(second.status).toBe(200);
        expect(second.body.allowed).toBe(true);
        expect(second.body.duplicate).toBe(true);
        expect(second.body.requestId).toBe(first.body.requestId);

        // Check the usage after both requests.
        const after = await request(app)
            .get(`/api/users/${userId}/usage`)
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(after.status).toBe(200);
        expect(after.body.usage.usedUnits).toBe(usedBefore + 30);
    });

    it("rejects reuse of an idempotency key with a different payload", async () => {
        const idempotencyKey = randomBytes(16).toString("hex");

        // Record the current quota consumption.
        const before = await request(app)
            .get(`/api/users/${userId}/usage`)
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(before.status).toBe(200);
        const usedBefore = before.body.usage.usedUnits;

        // First request: consume 20 units.
        const first = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", idempotencyKey)
            .send({
                userId,
                units: 20,
            });

        expect(first.status).toBe(200);
        expect(first.body.allowed).toBe(true);
        expect(first.body.duplicate).toBe(false);

        // Reuse the same key but change the units.
        const second = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", idempotencyKey)
            .send({
                userId,
                units: 40,
            });

        expect(second.status).toBe(409);
        expect(second.body.error).toBe(
            "Idempotency key was already used for a different request"
        );

        // Verify only the first request consumed quota.
        const after = await request(app)
            .get(`/api/users/${userId}/usage`)
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(after.status).toBe(200);
        expect(after.body.usage.usedUnits).toBe(usedBefore + 20);
    });

});
