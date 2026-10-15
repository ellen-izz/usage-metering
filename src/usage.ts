
import { and, eq, gte, lt, desc, count } from "drizzle-orm";
import { db } from "./db/index.js";

import {
    accounts, accountPlans, accountUsageCounters, userUsageCounters, users, userPlans, usageRequests,
} from "./db/schema.js";


// ACCOUNT USAGE REPORTING
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

    const remainingUnits = Math.max(
        0,
        account.monthlyAllowance - usedUnits
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


// USER USAGE REPORTING

export async function getUserUsage(
    accountId: string,
    userId: string,
    month?: string
) {
    // Default to the current UTC calendar month.
    const targetMonth =
        month ?? `${new Date().toISOString().slice(0, 7)}-01`;

    // Find the user and verify account ownership.
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

    // Find the user's counter for the requested month.
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


// ACCOUNT USAGE HISTORY
export async function getAccountUsageHistory(
    accountId: string,
    month: string,
    limit: number = 10,
    offset: number = 0
) {
    // Convert YYYY-MM into UTC month boundaries.
    const startDate = new Date(
        `${month}-01T00:00:00.000Z`
    );

    const endDate = new Date(startDate);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);

    // Filter by authenticated account and UTC month.
    const conditions = and(
        eq(usageRequests.accountId, accountId),
        gte(usageRequests.createdAt, startDate),
        lt(usageRequests.createdAt, endDate)
    );

    // Retrieve requests, newest first.
    const requests = await db
        .select({
            id: usageRequests.id,
            userId: usageRequests.userId,
            unitsRequested: usageRequests.unitsRequested,
            status: usageRequests.status,
            decisionReason: usageRequests.decisionReason,
            createdAt: usageRequests.createdAt,
        })
        .from(usageRequests)
        .where(conditions)
        .orderBy(
            desc(usageRequests.createdAt),
            desc(usageRequests.id)
        )
        .limit(limit)
        .offset(offset);

    // Count all matching requests for pagination.
    const [totalResult] = await db
        .select({
            total: count(),
        })
        .from(usageRequests)
        .where(conditions);

    return {
        month,
        total: totalResult?.total ?? 0,
        limit,
        offset,
        requests,
    };
}


//  USER USAGE HISTORY
export async function getUserUsageHistory(
    accountId: string,
    userId: string,
    month: string,
    limit: number = 10,
    offset: number = 0
) {
    // Verify the user belongs to the authenticated account.
    const [user] = await db
        .select({
            id: users.id,
        })
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

    // Calculate UTC month boundaries.
    const startDate = new Date(
        `${month}-01T00:00:00.000Z`
    );

    const endDate = new Date(startDate);
    endDate.setUTCMonth(endDate.getUTCMonth() + 1);

    // Filter by authenticated account, user, and month.
    const conditions = and(
        eq(usageRequests.accountId, accountId),
        eq(usageRequests.userId, userId),
        gte(usageRequests.createdAt, startDate),
        lt(usageRequests.createdAt, endDate)
    );

    // Retrieve the user's requests, newest first.
    const requests = await db
        .select({
            id: usageRequests.id,
            unitsRequested: usageRequests.unitsRequested,
            status: usageRequests.status,
            decisionReason: usageRequests.decisionReason,
            createdAt: usageRequests.createdAt,
        })
        .from(usageRequests)
        .where(conditions)
        .orderBy(
            desc(usageRequests.createdAt),
            desc(usageRequests.id)
        )
        .limit(limit)
        .offset(offset);

    // Count all matching user requests.
    const [totalResult] = await db
        .select({
            total: count(),
        })
        .from(usageRequests)
        .where(conditions);

    return {
        userId,
        month,
        total: totalResult?.total ?? 0,
        limit,
        offset,
        requests,
    };
}
