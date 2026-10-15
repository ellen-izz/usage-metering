
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

    //Accept a request within quota limits
    /*
    Check	Comparison	Result
 Account max/request	50 ≤ 1,000	Pass
 User max/request	50 ≤ 100	Pass
 Account monthly quota	0 + 50 ≤ 10,000	Pass
 User monthly quota	0 + 50 ≤ 1,000	Pass
 */
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

    /*
    Check	Comparison	Result
Account max/request	150 ≤ 1,000	Pass
User max/request	150 ≤ 100	Fail*/

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
        expect(response.body.usage.user.usedUnits).toBe(50);//After Test 3, the counter is still 50, not 200.
    });


    //Prevent double consumption
    //With idempotency, the second request is recognized as a retry and doesn't consume units again.
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


    //Same idempotency key, different payload
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
        /*409 Conflict indicates that the new request conflicts with an 
        existing request.
        The key has already been used to represent 
        an operation for 20 units. 
        It cannot now represent an operation for 40 units.*/
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

    /*
    when a user reaches their monthly quota, the 
    backend rejects additional requests without 
    increasing their usage counter.*/
    it("rejects requests when the user monthly quota is exhausted", async () => {
        // Check how much the user has already consumed.
        const before = await request(app)
            .get(`/api/users/${userId}/usage`)
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(before.status).toBe(200);
        const usedBefore = before.body.usage.usedUnits;
        const monthlyAllowance = before.body.plan.monthlyAllowance;
        const remaining = monthlyAllowance - usedBefore;
        let unitsLeft = remaining;
        while (unitsLeft > 0) {

            const units = Math.min(100, unitsLeft);

            const response = await request(app)
                .post("/api/usage")
                .set("Authorization", `ApiKey ${apiKey}`)

                .set("Idempotency-Key", randomBytes(16).toString("hex"))//new Idempotency-key
                .send({
                    userId,
                    units,
                });

            expect(response.status).toBe(200);
            expect(response.body.allowed).toBe(true);

            unitsLeft -= units; //until the unitsLeft reach Zero
        }
        //the user now reach it monthly allowance 
        const full = await request(app)
            .get(`/api/users/${userId}/usage`)
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(full.status).toBe(200);
        expect(full.body.usage.usedUnits).toBe(monthlyAllowance);
        expect(full.body.usage.remainingUnits).toBe(0);


        const rejected = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", randomBytes(16).toString("hex"))
            .send({
                userId,
                units: 10,
            });

        expect(rejected.status).toBe(200);
        expect(rejected.body.allowed).toBe(false);
        expect(rejected.body.reason).toBe(
            "user_monthly_quota_exceeded"
        );

        // Rejected requests must not increase the counter.
        expect(rejected.body.usage.user.usedUnits).toBe(monthlyAllowance);
    });


    it("rejects requests when the account monthly quota is exhausted", async () => {
        // Create another user with the Premium plan.
        const userResponse = await request(app)
            .post("/api/users")
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                name: "PremiumQuotaTestUser",
                planName: "Premium",
            });

        expect(userResponse.status).toBe(201);

        const premiumUserId = userResponse.body.user.id;

        // Read the current account usage.
        const before = await request(app)
            .get("/api/account/usage")
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(before.status).toBe(200);

        const remaining = before.body.usage.remainingUnits;

        // Consume the remaining account quota.
        let unitsLeft = remaining;

        while (unitsLeft > 0) {
            const units = Math.min(1000, unitsLeft);

            const response = await request(app)
                .post("/api/usage")
                .set("Authorization", `ApiKey ${apiKey}`)
                .set("Idempotency-Key", randomBytes(16).toString("hex"))
                .send({
                    userId: premiumUserId,
                    units,
                });

            expect(response.status).toBe(200);
            expect(response.body.allowed).toBe(true);

            unitsLeft -= units;
        }

        // Verify the account quota is fully consumed.
        const full = await request(app)
            .get("/api/account/usage")
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(full.status).toBe(200);
        expect(full.body.usage.usedUnits).toBe(10000);
        expect(full.body.usage.remainingUnits).toBe(0);

        // Attempt another request from the Premium user.
        const rejected = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", randomBytes(16).toString("hex"))
            .send({
                userId: premiumUserId,
                units: 10,
            });

        expect(rejected.status).toBe(200);
        expect(rejected.body.allowed).toBe(false);
        expect(rejected.body.reason).toBe(
            "account_monthly_quota_exceeded"
        );
        expect(rejected.body.usage.account.usedUnits).toBe(10000);
    });

    it("rejects requests exceeding the account per-request limit", async () => {
        // Read the current account usage.
        const before = await request(app)
            .get("/api/account/usage")
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(before.status).toBe(200);

        const usedBefore = before.body.usage.usedUnits;

        // Request 1,001 units, exceeding the Starter plan's limit.
        const response = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", randomBytes(16).toString("hex"))
            .send({
                userId,
                units: 1001,
            });

        expect(response.status).toBe(200);
        expect(response.body.allowed).toBe(false);
        expect(response.body.reason).toBe(
            "account_max_units_per_request_exceeded"
        );

        // Rejected requests must not consume quota.
        expect(response.body.usage.account.usedUnits).toBe(usedBefore);
    });


    //premium
    it("prevents concurrent requests from exceeding monthly quotas", async () => {
        // Create a separate account for concurrency testing.
        const accountResponse = await request(app)
            .post("/api/accounts")
            .send({
                name: `ConcurrencyTest-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });

        expect(accountResponse.status).toBe(201);

        const concurrencyApiKey = accountResponse.body.apiKey;
        const concurrencyAccountId = accountResponse.body.account.id;

        try {
            // Create a Premium user with a 10,000-unit monthly quota.
            const userResponse = await request(app)
                .post("/api/users")
                .set("Authorization", `ApiKey ${concurrencyApiKey}`)
                .send({
                    name: "ConcurrentUser",
                    planName: "Premium",
                });

            expect(userResponse.status).toBe(201);

            const concurrencyUserId = userResponse.body.user.id;

            // Create 20 HTTP request promises, each requesting 1,000 units.
            const requests = Array.from({ length: 20 }, () =>
                request(app)
                    .post("/api/usage")
                    .set("Authorization", `ApiKey ${concurrencyApiKey}`)
                    .set("Idempotency-Key", randomBytes(16).toString("hex"))
                    .send({
                        userId: concurrencyUserId,
                        units: 1000,
                    })
                    .then(response => response)
            );

            // Execute all 20 requests concurrently.
            const responses = await Promise.all(requests);

            const accepted = responses.filter(r => r.body.allowed === true);
            const rejected = responses.filter(r => r.body.allowed === false);

            expect(responses.every(r => r.status === 200)).toBe(true);
            expect(accepted).toHaveLength(10);
            expect(rejected).toHaveLength(10);

            // Verify the actual database-backed usage counter.
            const usage = await request(app)
                .get("/api/account/usage")
                .set("Authorization", `ApiKey ${concurrencyApiKey}`);

            expect(usage.status).toBe(200);
            expect(usage.body.usage.usedUnits).toBe(10000);
            expect(usage.body.usage.remainingUnits).toBe(0);

        } finally {
            // Remove the temporary concurrency account and its records.
            await db.transaction(async (tx) => {
                await tx.delete(usageRequests)
                    .where(eq(usageRequests.accountId, concurrencyAccountId));

                await tx.delete(accountUsageCounters)
                    .where(eq(accountUsageCounters.accountId, concurrencyAccountId));

                const accountUsers = await tx
                    .select({ id: users.id })
                    .from(users)
                    .where(eq(users.accountId, concurrencyAccountId));

                for (const user of accountUsers) {
                    await tx.delete(userUsageCounters)
                        .where(eq(userUsageCounters.userId, user.id));
                }

                await tx.delete(users)
                    .where(eq(users.accountId, concurrencyAccountId));

                await tx.delete(accounts)
                    .where(eq(accounts.id, concurrencyAccountId));
            });
        }
    });


});
