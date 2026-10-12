
import { Router } from "express";
import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import { db } from "./db/index.js";
import { accounts, accountPlans, users, userPlans, accountUsageCounters, userUsageCounters, usageRequests } from "./db/schema.js";
import { authenticateAccount } from "./auth.js";


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
router.get("/account", authenticateAccount, (_req, res) => {
    res.status(200).json({
        accountId: res.locals.accountId,
    });
});

const createUsageSchema = z.object({
    userId: z.string().uuid(),
    units: z.number().int().positive(),//units
});
//creates the user post
router.post("/usage", authenticateAccount, async (req, res) => {
    const parsed = createUsageSchema.safeParse(req.body);

    if (!parsed.success) {
        res.status(400).json({
            error: "Invalid usage Request",
            details: parsed.error.issues,
        });
        return;
    }

    const accountId = res.locals.accountId as string;
    const { userId, units } = parsed.data;
    const idempotencyKey = req.get("Idempotency-Key")?.trim();
    if (!idempotencyKey || idempotencyKey.length > 200) {

        res.status(400).json({
            error: "A valid Idempotency-Key header is required"
        });
        return

    }
    try {
        const result = await db.transaction(async (tx) => {
            const [account] = await tx.select({
                id: accounts.id,
                accountPlanId: accounts.accountPlanId
            }).from(accounts).where(eq(accounts.id, accountId)).for("update").limit(1);
            if (!account) {
                return {
                    statusCode: 404,
                    body: { error: "Account not found" },
                };
            }
            const [existing] = await tx.select()
                .from(usageRequests)
                .where(
                    and(
                        eq(usageRequests.accountId, accountId),
                        eq(usageRequests.idempotencyKey, idempotencyKey),
                    ),
                )
                .limit(1);

            if (existing) {
                if (
                    existing.userId !== userId ||
                    existing.unitsRequested !== units
                ) {
                    return {
                        statusCode: 409,
                        body: {
                            error: "Idempotency key was already used for a different request",
                        },
                    };

                }

                return {
                    statusCode: 200,
                    body: {
                        allowed: existing.status === "accepted",
                        requestId: existing.id,
                        unitsRequested: existing.unitsRequested,
                        reason: existing.decisionReason,
                        duplicate: true,
                    },
                };
            }
            const [user] = await tx
                .select({
                    id: users.id,
                    userPlanId: users.userPlanId,
                })
                .from(users)
                .where(
                    and(
                        eq(users.id, userId),
                        eq(users.accountId, accountId),
                    ),
                )
                .limit(1);

            if (!user) {
                return {
                    statusCode: 404,
                    body: { error: "User not found in this account" },
                };
            }


            const [accountPlan] = await tx
                .select()
                .from(accountPlans)
                .where(eq(accountPlans.id, account.accountPlanId))
                .limit(1);

            const [userPlan] = await tx
                .select()
                .from(userPlans)
                .where(eq(userPlans.id, user.userPlanId))
                .limit(1);

            if (!accountPlan || !userPlan) {
                throw new Error("Account plan or user plan is missing");
            }

            // Use the first day of the current UTC calendar month.
            const month = `${new Date().toISOString().slice(0, 7)}-01`;

            // Create this month's counters if they don't exist yet.
            await tx
                .insert(accountUsageCounters)
                .values({ accountId, month })
                .onConflictDoNothing();

            await tx
                .insert(userUsageCounters)
                .values({ userId, month })
                .onConflictDoNothing();

            // Read the counters while locking their rows.
            const [accountCounter] = await tx
                .select()
                .from(accountUsageCounters)
                .where(
                    and(
                        eq(accountUsageCounters.accountId, accountId),
                        eq(accountUsageCounters.month, month),
                    ),
                )
                .for("update")
                .limit(1);

            const [userCounter] = await tx
                .select()
                .from(userUsageCounters)
                .where(
                    and(
                        eq(userUsageCounters.userId, userId),
                        eq(userUsageCounters.month, month),
                    ),
                )
                .for("update")
                .limit(1);

            if (!accountCounter || !userCounter) {
                throw new Error("Usage counters could not be created");
            }

            // Decide whether the request is allowed.
            let reason: string | null = null;

            if (
                units > accountPlan.maxUnitsPerRequest ||
                units > userPlan.maxUnitsPerRequest
            ) {
                reason = "max_units_per_request_exceeded";
            } else if (
                accountCounter.usedUnits + units >
                accountPlan.monthlyAllowance
            ) {
                reason = "account_monthly_quota_exceeded";
            } else if (
                userCounter.usedUnits + units >
                userPlan.monthlyAllowance
            ) {
                reason = "user_monthly_quota_exceeded";
            }

            const allowed = reason === null;

            // Record both accepted and rejected decisions.
            const [request] = await tx
                .insert(usageRequests)
                .values({
                    accountId,
                    userId,
                    idempotencyKey,
                    unitsRequested: units,
                    status: allowed ? "accepted" : "rejected",
                    decisionReason: reason,
                })
                .returning({ id: usageRequests.id });

            if (!request) {
                throw new Error("Usage request could not be recorded");
            }

            // Only accepted requests consume units.
            if (allowed) {
                await tx
                    .update(accountUsageCounters)
                    .set({
                        usedUnits: accountCounter.usedUnits + units,
                    })
                    .where(eq(accountUsageCounters.id, accountCounter.id));

                await tx
                    .update(userUsageCounters)
                    .set({
                        usedUnits: userCounter.usedUnits + units,
                    })
                    .where(eq(userUsageCounters.id, userCounter.id));
            }

            return {
                statusCode: 200,
                body: {
                    allowed,
                    requestId: request.id,
                    unitsRequested: units,
                    reason,
                    usage: {
                        account: {
                            usedUnits:
                                accountCounter.usedUnits + (allowed ? units : 0),
                            monthlyAllowance: accountPlan.monthlyAllowance,
                        },
                        user: {
                            usedUnits:
                                userCounter.usedUnits + (allowed ? units : 0),
                            monthlyAllowance: userPlan.monthlyAllowance,
                        },
                    },
                    duplicate: false,
                },
            };
        });

        res.status(result.statusCode).json(result.body);
    } catch (error: unknown) {
        console.error("Failed to process usage:", error);
        res.status(500).json({ error: "Internal server error" });
    }
});
