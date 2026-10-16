
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

describe("Usage History", () => {
    let apiKey: string;
    let accountId: string;
    let userId: string;

    beforeAll(async () => {
        // Create a temporary account.
        const accountResponse = await request(app)
            .post("/api/accounts")
            .send({
                name: `HistoryTest-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });

        expect(accountResponse.status).toBe(201);

        apiKey = accountResponse.body.apiKey;
        accountId = accountResponse.body.account.id;

        // Create a Basic user belonging to this account.
        const userResponse = await request(app)
            .post("/api/users")
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                name: "HistoryUser",
                planName: "Basic",
            });

        expect(userResponse.status).toBe(201);

        userId = userResponse.body.user.id;

        // Generate three accepted usage requests.
        for (let i = 0; i < 3; i++) {
            const response = await request(app)
                .post("/api/usage")
                .set("Authorization", `ApiKey ${apiKey}`)
                .set("Idempotency-Key", randomBytes(16).toString("hex"))
                .send({
                    userId,
                    units: 20,
                });

            expect(response.status).toBe(200);
            expect(response.body.allowed).toBe(true);
        }
    });

    afterAll(async () => {
        try {
            if (accountId) {
                await db.transaction(async (tx) => {
                    await tx.delete(usageRequests)
                        .where(eq(usageRequests.accountId, accountId));

                    await tx.delete(accountUsageCounters)
                        .where(eq(accountUsageCounters.accountId, accountId));

                    if (userId) {
                        await tx.delete(userUsageCounters)
                            .where(eq(userUsageCounters.userId, userId));
                    }

                    await tx.delete(users)
                        .where(eq(users.accountId, accountId));

                    await tx.delete(accounts)
                        .where(eq(accounts.id, accountId));
                });
            }
        } finally {
            await client.end();
        }
    });


    it("retrieves an account's usage history", async () => {
        const response = await request(app)
            .get("/api/account/history")
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(response.status).toBe(200);

        // Verify pagination information.
        expect(response.body.total).toBe(3);
        expect(response.body.limit).toBe(10);
        expect(response.body.offset).toBe(0);

        // Get the actual history array.
        const history = response.body.requests;

        expect(Array.isArray(history)).toBe(true);
        expect(history).toHaveLength(3);

        // Verify every recorded request.
        for (const record of history) {
            expect(record.userId).toBe(userId);
            expect(record.unitsRequested).toBe(20);
            expect(record.status).toBe("accepted");
            expect(record.decisionReason).toBeNull();
        }
    });

    it("supports pagination for account usage history", async () => {
        // Request the first page: 2 records.
        const firstPage = await request(app)
            .get("/api/account/history")
            .set("Authorization", `ApiKey ${apiKey}`)
            .query({
                limit: 2,
                offset: 0,
            });

        expect(firstPage.status).toBe(200);
        expect(firstPage.body.total).toBe(3);
        expect(firstPage.body.requests).toHaveLength(2);
        expect(firstPage.body.limit).toBe(2);
        expect(firstPage.body.offset).toBe(0);

        // Request the second page: skip the first 2 records.
        const secondPage = await request(app)
            .get("/api/account/history")
            .set("Authorization", `ApiKey ${apiKey}`)
            .query({
                limit: 2,
                offset: 2,
            });

        expect(secondPage.status).toBe(200);
        expect(secondPage.body.total).toBe(3);
        expect(secondPage.body.requests).toHaveLength(1);
        expect(secondPage.body.offset).toBe(2);

        // The two pages must not contain the same records.
        const firstPageIds = firstPage.body.requests.map(
            (record: { id: string }) => record.id
        );

        const secondPageId = secondPage.body.requests[0].id;

        expect(firstPageIds).not.toContain(secondPageId);
    });



    it("retrieves an individual user's usage history", async () => {
        const response = await request(app)
            .get(`/api/users/${userId}/history`)
            .set("Authorization", `ApiKey ${apiKey}`);

        expect(response.status).toBe(200);

        // Verify the response belongs to the requested user.
        expect(response.body.userId).toBe(userId);

        // Verify the total number of requests.
        expect(response.body.total).toBe(3);

        const history = response.body.requests;

        expect(Array.isArray(history)).toBe(true);
        expect(history).toHaveLength(3);

        // Verify the properties of each usage request.
        for (const record of history) {
            expect(record.unitsRequested).toBe(20);
            expect(record.status).toBe("accepted");
            expect(record.decisionReason).toBeNull();
        }
    });


    it("prevents an account from viewing another account's user history", async () => {

        // Create a second account (Account B).
        const accountResponse = await request(app)
            .post("/api/accounts")
            .send({
                name: `HistoryIsolation-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });

        expect(accountResponse.status).toBe(201);

        const accountBId = accountResponse.body.account.id;
        const accountBKey = accountResponse.body.apiKey;

        try {
            // Account B attempts to access Account A's user history.
            const response = await request(app)
                .get(`/api/users/${userId}/history`)
                .set("Authorization", `ApiKey ${accountBKey}`);

            // The backend must deny access.
            expect(response.status).toBe(404);

            // Account B must not receive Account A's records.
            expect(response.body.requests).toBeUndefined();

        } finally {
            // Delete the temporary Account B.
            await db.delete(accounts)
                .where(eq(accounts.id, accountBId));
        }
    });

});
