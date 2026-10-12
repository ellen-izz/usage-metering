
import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db } from "./db/index.js";
import { accounts, accountPlans, users, userPlans } from "./db/schema.js";

export const router = Router(); //creates a place to organize API endpoints

const createAccountSchema = z.object({
    name: z.string().trim().min(1).max(100),
    planName: z.enum(["Starter", "Pro"]),
});
//creates the account and returns its details and API key.
router.post("/accounts", async (req, res) => {
    const parsed = createAccountSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "Invalid account data",
            details: parsed.error.issues,
        });
        return;
    }

    try {
        const [plan] = await db.select().from(accountPlans)
            .where(eq(accountPlans.name, parsed.data.planName))
            .limit(1);

        if (!plan) {
            res.status(400).json({ error: "Plan not found" });
            return;
        }

        const apiKey = randomBytes(32).toString("hex");
        const apiKeyHash = createHash("sha256").update(apiKey).digest("hex");

        const [account] = await db
            .insert(accounts)
            .values({
                name: parsed.data.name,
                accountPlanId: plan.id,
                apiKeyHash,
            })
            .returning({
                id: accounts.id,
                name: accounts.name,
                accountPlanId: accounts.accountPlanId,
            });

        if (!account) {
            res.status(500).json({ error: "Account creation failed" });
            return;
        }

        res.status(201).json({
            account,
            apiKey,
            message: "Save this API key now; it will not be returned again.",
        });
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "23505"
        ) {
            res.status(409).json({ error: "An account with this name already exists" });
            return;
        }

        console.error("Failed to create account:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
const createUserSchema = z.object({
    accountId: z.string().uuid(),
    name: z.string().trim().min(1).max(100),
    planName: z.enum(["Basic", "Premium"]),
});
//creates the user post
router.post("/users", async (req, res) => {
    const parsed = createUserSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "Invalid user data",
            details: parsed.error.issues,
        });
        return;
    }

    try {
        const [account] = await db.select({ id: accounts.id }).from(accounts)
            .where(eq(accounts.id, parsed.data.accountId))
            .limit(1);

        if (!account) {
            res.status(400).json({ error: "account not found" });
            return;
        }



        const [plan] = await db.select().from(userPlans)
            .where(eq(userPlans.name, parsed.data.planName)).limit(1);



        if (!plan) {
            res.status(404).json({ error: "Users plan Not Found!" });
            return;
        }
        const [user] = await db.insert(users).values({
            accountId: account.id,
            name: parsed.data.name,
            userPlanId: plan.id,
        })
            .returning({
                id: users.id,
                accountId: users.accountId,
                name: users.name,
                userPlanId: users.userPlanId,
            });

        res.status(201).json({ user });
    } catch (error: unknown) {
        console.error("Failed to create user:", error);
        res.status(500).json({ error: "Internal server error" });
    }


});
