import { and, eq } from "drizzle-orm";
import { db } from "./db/index.js";
import {
    accounts,
    accountPlans,
    accountUsageCounters,
    userUsageCounters,
    users,
    userPlans,
} from "./db/schema.js";


export async function getAccountUsage(
    accountId: string,
    month?: string
) {
    // Default to the current UTC calendar month.
    const targetMonth =
        month ?? `${new Date().toISOString().slice(0, 7)}-01`;

    // Find the account and its assigned plan.
    const [account] = await db
        .select({
            accountId: accounts.id,
            accountName: accounts.name,
            planName: accountPlans.name,
            monthlyAllowance: accountPlans.monthlyAllowance,
            maxUnitsPerRequest: accountPlans.maxUnitsPerRequest,
        })
        .from(accounts)
        .innerJoin(
            accountPlans,
            eq(accounts.accountPlanId, accountPlans.id)
        )
        .where(eq(accounts.id, accountId))
        .limit(1);

    if (!account) {
        return null;
    }

    // Find the usage counter for the requested month.
    const [counter] = await db
        .select({
            usedUnits: accountUsageCounters.usedUnits,
        })
        .from(accountUsageCounters)
        .where(
            and(
                eq(accountUsageCounters.accountId, accountId),
                eq(accountUsageCounters.month, targetMonth)
            )
        )
        .limit(1);

    const usedUnits = counter?.usedUnits ?? 0;

    const remainingUnits = Math.max(0, account.monthlyAllowance - usedUnits
    );

    return {
        accountId: account.accountId,
        accountName: account.accountName,
        month: targetMonth,
        plan: {
            name: account.planName,
            monthlyAllowance: account.monthlyAllowance,
            maxUnitsPerRequest: account.maxUnitsPerRequest,
        },
        usage: {
            usedUnits,
            remainingUnits,
        },
    };
}
export async function getUserUsage(
    accountId: string,
    userId: string,
    month?: string
) {
    const targetMonth =
        month ?? `${new Date().toISOString().slice(0, 7)}-01`;

    const [user] = await db
        .select({
            userId: users.id,
            userName: users.name,
            planName: userPlans.name,
            monthlyAllowance: userPlans.monthlyAllowance,
            maxUnitsPerRequest: userPlans.maxUnitsPerRequest,
        })
        .from(users)
        .innerJoin(
            userPlans,
            eq(users.userPlanId, userPlans.id)
        )
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

    const [counter] = await db
        .select({
            usedUnits: userUsageCounters.usedUnits,
        })
        .from(userUsageCounters)
        .where(
            and(
                eq(userUsageCounters.userId, userId),
                eq(userUsageCounters.month, targetMonth)
            )
        )
        .limit(1);

    const usedUnits = counter?.usedUnits ?? 0;

    return {
        userId: user.userId,
        userName: user.userName,
        month: targetMonth,
        plan: {
            name: user.planName,
            monthlyAllowance: user.monthlyAllowance,
            maxUnitsPerRequest: user.maxUnitsPerRequest,
        },
        usage: {
            usedUnits,
            remainingUnits: Math.max(
                0,
                user.monthlyAllowance - usedUnits
            ),
        },
    };
}
export async function getAccountUsageHistory(
    accountId: string,
    month?: string,

) {



}