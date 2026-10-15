import { db } from "./db/index.js";
import { accountPlans, userPlans, accounts, users } from "./db/schema.js";
import { and, eq, isNull, or } from "drizzle-orm";

export async function createCustomAccountPlan(
    AccountId: string,
    name: string,
    monthlyAllowance: number,
    maxUnitsPerRequest: number,
) {
    if (!name.trim()) {
        throw new Error("Plan name cannot be empty");
    }
    if (
        !Number.isSafeInteger(monthlyAllowance) ||
        !Number.isSafeInteger(maxUnitsPerRequest) ||
        monthlyAllowance <= 0 ||
        maxUnitsPerRequest <= 0 ||
        monthlyAllowance > 2147483647 ||
        maxUnitsPerRequest > 2147483647
    ) {
        throw new Error("Plan limits must be positive 32-bit integers");
    }
    const [plan] = await db.insert(accountPlans).values({
        name: name.trim(),
        monthlyAllowance,
        maxUnitsPerRequest,
        ownerAccountId: AccountId,
        isBuiltIn: false,
    }).returning();
    if (!plan) {
        throw new Error("Failed to create custom account plan");
    }
    return plan;

}

//user
export async function createCustomUserPlan(
    AccountId: string,
    name: string,
    monthlyAllowance: number,
    maxUnitsPerRequest: number,


) {
    if (!name.trim()) {
        throw new Error("Plan name cannot be empty");
    }
    if (
        !Number.isSafeInteger(monthlyAllowance) ||
        !Number.isSafeInteger(maxUnitsPerRequest) ||
        monthlyAllowance <= 0 ||
        maxUnitsPerRequest <= 0 ||
        monthlyAllowance > 2147483647 ||
        maxUnitsPerRequest > 2147483647
    ) {
        throw new Error("Plan limits must be positive 32-bit integers");
    }
    const [plan] = await db.insert(userPlans).values({
        name: name.trim(),
        monthlyAllowance,
        maxUnitsPerRequest,
        ownerAccountId: AccountId,
        isBuiltIn: false,
    }).returning();
    if (!plan) {
        throw new Error("Failed to create custom account plan");
    }
    return plan;

}

export async function listAvailablePlans(accountId: string) {

    const availableAccountPlans = await db
        .select()
        .from(accountPlans)
        .where(
            or(
                and(
                    eq(accountPlans.isBuiltIn, true),
                    isNull(accountPlans.ownerAccountId)
                ),
                and(
                    eq(accountPlans.isBuiltIn, false),
                    eq(accountPlans.ownerAccountId, accountId)
                )
            )
        );
    /*
    WHERE
(is_built_in = true AND owner_account_id IS NULL)
OR
(is_built_in = false AND owner_account_id = 'CURRENT_ACCOUNT_ID')
*/

    const availableUserPlans = await db
        .select()
        .from(userPlans)
        .where(
            or(
                and(
                    eq(userPlans.isBuiltIn, true),
                    isNull(userPlans.ownerAccountId)
                ),
                and(
                    eq(userPlans.isBuiltIn, false),
                    eq(userPlans.ownerAccountId, accountId)
                )
            )
        );

    return {
        accountPlans: availableAccountPlans,
        userPlans: availableUserPlans,
    };
}
export async function updateCustomAccountPlan(
    accountId: string,
    planId: string,
    name: string,
    monthlyAllowance: number,
    maxUnitsPerRequest: number
) {
    if (!name.trim()) {
        throw new Error("Plan name cannot be empty");
    }

    if (
        !Number.isSafeInteger(monthlyAllowance) ||
        !Number.isSafeInteger(maxUnitsPerRequest) ||
        monthlyAllowance <= 0 ||
        maxUnitsPerRequest <= 0 ||
        monthlyAllowance > 2147483647 ||
        maxUnitsPerRequest > 2147483647
    ) {
        throw new Error("Plan limits must be positive 32-bit integers");
    }

    const [updatedPlan] = await db
        .update(accountPlans)
        .set({
            name: name.trim(),
            monthlyAllowance,
            maxUnitsPerRequest,
        })
        .where(
            and(
                eq(accountPlans.id, planId),//Selects the specific plan
                eq(accountPlans.ownerAccountId, accountId), //Ensures the authenticated account owns it
                eq(accountPlans.isBuiltIn, false) //constume plan not build in 
            )
        )
        .returning();

    return updatedPlan ?? null;//If no plan matches the ownership conditions, Drizzle returns an empty array
}
export async function updateCustomUserPlan(
    accountId: string,
    planId: string,
    name: string,
    monthlyAllowance: number,
    maxUnitsPerRequest: number
) {
    if (!name.trim()) {
        throw new Error("Plan name cannot be empty");
    }

    if (
        !Number.isSafeInteger(monthlyAllowance) ||
        !Number.isSafeInteger(maxUnitsPerRequest) ||
        monthlyAllowance <= 0 ||
        maxUnitsPerRequest <= 0 ||
        monthlyAllowance > 2147483647 ||
        maxUnitsPerRequest > 2147483647
    ) {
        throw new Error("Plan limits must be positive 32-bit integers");
    }

    const [updatedPlan] = await db
        .update(userPlans)
        .set({
            name: name.trim(),
            monthlyAllowance,
            maxUnitsPerRequest,
        })
        .where(
            and(
                eq(userPlans.id, planId),//Selects the specific plan
                eq(userPlans.ownerAccountId, accountId), //Ensures the authenticated account owns it
                eq(userPlans.isBuiltIn, false) //constume plan not build in 
            )
        )
        .returning();

    return updatedPlan ?? null;//If no plan matches the ownership conditions, Drizzle returns an empty array
}

//assign plan to an acount 
export async function assignAccountPlan(
    accountId: string,
    planId: string,

) {

    return await db.transaction(async (tx) => {

        // Lock the account to coordinate with usage requests.
        const [account] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.id, accountId))
            .for("update")
            .limit(1);

        if (!account) {
            return null;
        }

        // Find a plan that this account is allowed to use.
        const [plan] = await tx
            .select()
            .from(accountPlans)
            .where(
                and(
                    eq(accountPlans.id, planId),
                    or(
                        and(
                            eq(accountPlans.isBuiltIn, true),
                            isNull(accountPlans.ownerAccountId)
                        ),
                        and(
                            eq(accountPlans.isBuiltIn, false),
                            eq(accountPlans.ownerAccountId, accountId)
                        )
                    )
                )
            )
            .limit(1);

        if (!plan) {
            return null;
        }

        // Change the account's assigned plan.
        const [updatedAccount] = await tx
            .update(accounts)
            .set({
                accountPlanId: plan.id,
            })
            .where(eq(accounts.id, accountId))
            .returning({
                id: accounts.id,
                name: accounts.name,
                accountPlanId: accounts.accountPlanId,
            });

        return {
            account: updatedAccount,
            plan,
        };
    });
}

export async function assignUserPlan(
    accountId: string,
    userId: string,
    planId: string
) {
    return await db.transaction(async (tx) => {

        // 1. Lock the account to coordinate with usage requests.
        const [account] = await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(eq(accounts.id, accountId))
            .for("update")
            .limit(1);

        if (!account) {
            return null;
        }

        // 2. Verify that the user belongs to this account.
        const [user] = await tx
            .select({ id: users.id })
            .from(users)
            .where(
                and(
                    eq(users.id, userId),
                    eq(users.accountId, accountId)
                )
            )
            .limit(1);

        if (!user) {
            return null;
        }

        // 3. Verify that the requested plan is accessible.
        const [plan] = await tx
            .select()
            .from(userPlans)
            .where(
                and(
                    eq(userPlans.id, planId),
                    or(
                        and(
                            eq(userPlans.isBuiltIn, true),
                            isNull(userPlans.ownerAccountId)
                        ),
                        and(
                            eq(userPlans.isBuiltIn, false),
                            eq(userPlans.ownerAccountId, accountId)
                        )
                    )
                )
            )
            .limit(1);

        if (!plan) {
            return null;
        }

        // 4. Assign the new plan to the user.
        const [updatedUser] = await tx
            .update(users)
            .set({
                userPlanId: plan.id,
            })
            .where(
                and(
                    eq(users.id, userId),
                    eq(users.accountId, accountId)
                )
            )
            .returning({
                id: users.id,
                name: users.name,
                accountId: users.accountId,
                userPlanId: users.userPlanId,
            });

        return {
            user: updatedUser,
            plan,
        };
    });
}
