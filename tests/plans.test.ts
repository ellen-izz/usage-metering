import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";


import { app } from "../src/app.js";
import { db, client } from "../src/db/index.js";
import { accounts, accountPlans, users, userPlans, usageRequests, accountUsageCounters, userUsageCounters } from "../src/db/schema.js";
describe("Custom Plan Management", () => {
    let apiKey: string;
    let accountId: string;
    beforeAll(async () => {
        //create a temporary account
        const response = await request(app)
            .post("/api/accounts")
            .send({
                name: `PlanTest-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });
        expect(response.status).toBe(201);

        apiKey = response.body.apiKey;
        accountId = response.body.account.id;

    });


    afterAll(async () => {
        try {
            if (accountId) {
                await db.transaction(async (tx) => {

                    // 1. Delete usage requests belonging to Account A.
                    await tx.delete(usageRequests)
                        .where(eq(usageRequests.accountId, accountId));

                    // 2. Delete Account A's usage counters.
                    await tx.delete(accountUsageCounters)
                        .where(eq(accountUsageCounters.accountId, accountId));

                    // 3. Find all users belonging to Account A.
                    const accountUsers = await tx
                        .select({ id: users.id })
                        .from(users)
                        .where(eq(users.accountId, accountId));

                    // 4. Delete usage counters for those users.
                    for (const user of accountUsers) {
                        await tx.delete(userUsageCounters)
                            .where(eq(userUsageCounters.userId, user.id));
                    }

                    // 5. Delete Account A's users.
                    await tx.delete(users)
                        .where(eq(users.accountId, accountId));

                    // 6. Finally, delete Account A.
                    await tx.delete(accounts)
                        .where(eq(accounts.id, accountId));
                });
            }
        } finally {
            await client.end();
        }
    });


    it("creates a custom account plan", async () => {

        const response = await request(app)
            .post("/api/plans/account")
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                name: "Gold",
                monthlyAllowance: 30000,
                maxUnitsPerRequest: 1000,
            });
        expect(response.status).toBe(201);

        expect(response.body.plan.name).toBe("Gold");
        expect(response.body.plan.monthlyAllowance).toBe(30000);
        expect(response.body.plan.maxUnitsPerRequest).toBe(1000);

        expect(response.body.plan.ownerAccountId).toBe(accountId);
        expect(response.body.plan.isBuiltIn).toBe(false);





    });
    it("prevents another account from modifying a custom plan", async () => {
        //create user B 
        const accountResponse = await request(app)
            .post("/api/accounts")
            .send({
                name: `IsolatedTest-${randomBytes(8).toString("hex")}`,
                planName: "Starter",
            });

        expect(accountResponse.status).toBe(201);

        const accountBId = accountResponse.body.account.id;
        const accountBKey = accountResponse.body.apiKey;
        try {
            const [goldPlan] = await db
                .select({ id: accountPlans.id })
                .from(accountPlans)
                .where(eq(accountPlans.ownerAccountId, accountId))
                .limit(1);

            expect(goldPlan).toBeDefined();

            // Account B tries to modify Account A's Gold plan.
            const response = await request(app)
                .patch(`/api/plans/account/${goldPlan!.id}`)
                .set("Authorization", `ApiKey ${accountBKey}`)
                .send({
                    name: "StolenGold",
                    monthlyAllowance: 999999,
                    maxUnitsPerRequest: 5000,
                });

            expect(response.status).toBe(404);
            expect(response.body.error).toBe(
                "Custom account plan not found"
            );

            // Verify Gold was not modified.
            const [unchangedPlan] = await db
                .select()
                .from(accountPlans)
                .where(eq(accountPlans.id, goldPlan!.id))
                .limit(1);

            expect(unchangedPlan?.name).toBe("Gold");
            expect(unchangedPlan?.monthlyAllowance).toBe(30000);

        } finally {
            // Delete Account B.
            await db.delete(accounts)
                .where(eq(accounts.id, accountBId));
        }
    });

    it("allows an account to update its own custom plan", async () => {
        // Find Account A's Gold plan.
        const [goldPlan] = await db
            .select({ id: accountPlans.id })
            .from(accountPlans)
            .where(eq(accountPlans.ownerAccountId, accountId))
            .limit(1);

        expect(goldPlan).toBeDefined();

        // Account A updates its own plan.
        const response = await request(app)
            .patch(`/api/plans/account/${goldPlan!.id}`)
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                name: "Gold Plus",
                monthlyAllowance: 50000,
                maxUnitsPerRequest: 2000,
            });

        expect(response.status).toBe(200);

        expect(response.body.plan.name).toBe("Gold Plus");
        expect(response.body.plan.monthlyAllowance).toBe(50000);
        expect(response.body.plan.maxUnitsPerRequest).toBe(2000);
        expect(response.body.plan.ownerAccountId).toBe(accountId);

        // Verify PostgreSQL stored the changes.
        const [updatedPlan] = await db
            .select()
            .from(accountPlans)
            .where(eq(accountPlans.id, goldPlan!.id))
            .limit(1);

        expect(updatedPlan?.name).toBe("Gold Plus");
        expect(updatedPlan?.monthlyAllowance).toBe(50000);
    });

    it("creates a custom user plan", async () => {
        // Account A creates a custom user plan.
        const response = await request(app)
            .post("/api/plans/user")
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                name: "Student",
                monthlyAllowance: 5000,
                maxUnitsPerRequest: 500,
            });

        // Verify that the plan was created.
        expect(response.status).toBe(201);

        // Verify the plan's properties.
        expect(response.body.plan.name).toBe("Student");
        expect(response.body.plan.monthlyAllowance).toBe(5000);
        expect(response.body.plan.maxUnitsPerRequest).toBe(500);

        // Verify ownership and plan type.
        expect(response.body.plan.ownerAccountId).toBe(accountId);
        expect(response.body.plan.isBuiltIn).toBe(false);
    });

    it("assigns a custom user plan to a user", async () => {

        // Find Account A's Student plan.
        const [studentPlan] = await db.select()
            .from(userPlans)
            .where(
                and(
                    eq(userPlans.ownerAccountId, accountId),
                    eq(userPlans.name, "Student")
                )
            )
            .limit(1);

        expect(studentPlan).toBeDefined();

        // Create a user belonging to Account A.
        const userResponse = await request(app)
            .post("/api/users")
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                name: `StudentUser-${randomBytes(8).toString("hex")}`,
                planName: "Basic",
            });

        expect(userResponse.status).toBe(201);

        const userId = userResponse.body.user.id;

        // Assign the Student plan.
        const response = await request(app)
            .patch(`/api/users/${userId}/plan`)
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                planId: studentPlan!.id,
            });


        expect(response.status).toBe(200);

        // Check whether the user's plan was updated.
        const [updatedUser] = await db.select()
            .from(users)
            .where(eq(users.id, userId))
            .limit(1);

        expect(updatedUser?.userPlanId).toBe(studentPlan!.id);
    });

    it("enforces the limits of an assigned custom user plan", async () => {
        // Find Account A's Student plan.
        const [studentPlan] = await db
            .select()
            .from(userPlans)
            .where(
                and(
                    eq(userPlans.ownerAccountId, accountId),
                    eq(userPlans.name, "Student")
                )
            )
            .limit(1);

        expect(studentPlan).toBeDefined();

        // Create a new Basic user.
        const userResponse = await request(app)
            .post("/api/users")
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                name: `QuotaStudent-${randomBytes(8).toString("hex")}`,
                planName: "Basic",
            });

        expect(userResponse.status).toBe(201);

        const userId = userResponse.body.user.id;

        // Assign the custom Student plan.
        const assignment = await request(app)
            .patch(`/api/users/${userId}/plan`)
            .set("Authorization", `ApiKey ${apiKey}`)
            .send({
                planId: studentPlan!.id,
            });

        expect(assignment.status).toBe(200);

        // 500 units should be allowed.
        const accepted = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", randomBytes(16).toString("hex"))
            .send({
                userId,
                units: 500,
            });

        expect(accepted.status).toBe(200);
        expect(accepted.body.allowed).toBe(true);

        // 501 units should be rejected.
        const rejected = await request(app)
            .post("/api/usage")
            .set("Authorization", `ApiKey ${apiKey}`)
            .set("Idempotency-Key", randomBytes(16).toString("hex"))
            .send({
                userId,
                units: 501,
            });

        expect(rejected.status).toBe(200);
        expect(rejected.body.allowed).toBe(false);
        expect(rejected.body.reason).toBe(
            "user_max_units_per_request_exceeded"
        );
    });







});