
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { app } from "../src/app.js";
import { db, client } from "../src/db/index.js";
import { accounts } from "../src/db/schema.js";

describe("User Listing and Account Isolation", () => {
    let companyAKey: string;
    let companyBKey: string;
    let companyAId: string;
    let companyBId: string;
    let companyAUserId: string;
    let companyBUserId: string;

    beforeAll(async () => {
        // Create two independent companies.
        const companyA = await request(app)
            .post("/api/accounts")
            .send({
                name: `UsersTestA-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });

        expect(companyA.status).toBe(201);

        companyAKey = companyA.body.apiKey;
        companyAId = companyA.body.account.id;

        const companyB = await request(app)
            .post("/api/accounts")
            .send({
                name: `UsersTestB-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });

        expect(companyB.status).toBe(201);

        companyBKey = companyB.body.apiKey;
        companyBId = companyB.body.account.id;

        // Create a user inside each company.
        const userA = await request(app)
            .post("/api/users")
            .set("Authorization", `ApiKey ${companyAKey}`)
            .send({ name: "User A", planName: "Basic" });

        expect(userA.status).toBe(201);
        companyAUserId = userA.body.user.id;

        const userB = await request(app)
            .post("/api/users")
            .set("Authorization", `ApiKey ${companyBKey}`)
            .send({ name: "User B", planName: "Basic" });

        expect(userB.status).toBe(201);
        companyBUserId = userB.body.user.id;
    });

    afterAll(async () => {
        // Deleting test accounts also deletes their users
        // through the existing database cascade rules.
        if (companyAId) {
            await db.delete(accounts).where(eq(accounts.id, companyAId));
        }

        if (companyBId) {
            await db.delete(accounts).where(eq(accounts.id, companyBId));
        }

        await client.end();
    });

    it("rejects requests without an API key", async () => {
        const response = await request(app).get("/api/users");

        expect(response.status).toBe(401);
    });

    it("returns users belonging to the authenticated company", async () => {
        const response = await request(app)
            .get("/api/users")
            .set("Authorization", `ApiKey ${companyAKey}`);

        expect(response.status).toBe(200);
        expect(Array.isArray(response.body.users)).toBe(true);

        expect(
            response.body.users.some(
                (user: { id: string }) => user.id === companyAUserId
            )
        ).toBe(true);
    });

    it("does not expose another company's users", async () => {
        const response = await request(app)
            .get("/api/users")
            .set("Authorization", `ApiKey ${companyAKey}`);

        expect(response.status).toBe(200);

        const returnedIds = response.body.users.map(
            (user: { id: string }) => user.id
        );

        expect(returnedIds).toContain(companyAUserId);
        expect(returnedIds).not.toContain(companyBUserId);
    });
});
