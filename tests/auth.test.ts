
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";

import { app } from "../src/app.js";
import { db, client } from "../src/db/index.js";
import { accounts, accountPlans } from "../src/db/schema.js";
import { eq, and } from "drizzle-orm";

describe("API Key Authentication", () => {
    let validApiKey: string;
    let testAccountId: string;

    beforeAll(async () => {
        // Create an account using the real account creation API.
        const response = await request(app)
            .post("/api/accounts")
            .send({
                name: `AuthTest-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });

        expect(response.status).toBe(201);//http 201 created that the account was successfully created

        validApiKey = response.body.apiKey;
        testAccountId = response.body.account.id;
    });

    afterAll(async () => {
        // Clean up the account created by this test suite.
        if (testAccountId) { //if the acount id is successfully assigned 
            await db
                .delete(accounts)
                .where(eq(accounts.id, testAccountId));
        }

        await client.end();
    });
    //It verifies that your endpoint isn't publicly accessible without authentication.
    it("rejects requests without an API key", async () => {
        const response = await request(app)
            .get("/api/account");

        expect(response.status).toBe(401);
    });

    //Incorrect authentication scheme
    it("rejects an invalid Authorization scheme", async () => {
        const response = await request(app)
            .get("/api/account")
            .set("Authorization", "Bearer invalid-token");

        expect(response.status).toBe(401);
    });

    //invalid-key does not meet this structure
    it("rejects malformed API keys", async () => {
        const response = await request(app)
            .get("/api/account")
            .set("Authorization", "ApiKey invalid-key");

        expect(response.status).toBe(401);
    });

    it("rejects a correctly formatted but nonexistent API key", async () => {
        const nonexistentKey = randomBytes(32).toString("hex");

        const response = await request(app)
            .get("/api/account")
            .set("Authorization", `ApiKey ${nonexistentKey}`);

        expect(response.status).toBe(401);
    });

    it("accepts a valid API key", async () => {
        const response = await request(app)
            .get("/api/account")
            .set("Authorization", `ApiKey ${validApiKey}`);

        expect(response.status).toBe(200);
        expect(response.body.accountId).toBe(testAccountId);
    });
});
