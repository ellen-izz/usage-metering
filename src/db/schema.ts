
import { sql } from "drizzle-orm"
import {
    pgTable, timestamp, uuid, text, integer, boolean, date, unique, uniqueIndex, check,
} from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
export const accounts = pgTable("accounts", {
    id: uuid("id").primaryKey().defaultRandom(),

    name: text("name").notNull().unique(),

    apiKeyHash: text("api_key_hash").notNull().unique(),

    accountPlanId: uuid("account_plan_id").notNull().references(() => accountPlans.id),

    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),

    updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow()
        .$onUpdate(() => new Date()),
});

// every user belongs to an account
export const users = pgTable("users", {
    id: uuid("id").primaryKey().defaultRandom(),

    accountId: uuid("account_id").notNull()
        .references(() => accounts.id, { onDelete: "cascade" }),

    userPlanId: uuid("user_plan_id")
        .notNull()
        .references(() => userPlans.id),

    name: text("name").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});
export const accountPlans = pgTable("account_plans", {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    name: text("name").notNull(),
    //We need uniqueness within an account, not across all accounts.

    monthlyAllowance: integer("monthly_allowance").notNull(),

    maxUnitsPerRequest: integer("max_units_per_request").notNull(),

    ownerAccountId: uuid("owner_account_id")
        .references(
            (): AnyPgColumn => accounts.id,
            { onDelete: "cascade" }
        ),//preventing circular type-inference errors between 
    //accounts and accountPlans without changing the database relationship.
    isBuiltIn: boolean("is_built_in").notNull().default(true),
},
    (table) => [
        uniqueIndex("account_plan_owner_name_unique")
            .on(table.ownerAccountId, table.name)
            .where(sql`${table.ownerAccountId} IS NOT NULL`),

        uniqueIndex("account_plan_builtin_name_unique")
            .on(table.name)
            .where(sql`${table.isBuiltIn} = true`),

        check(
            "account_plan_owner_check",
            sql`(${table.isBuiltIn} = true AND ${table.ownerAccountId} IS NULL)
                OR
                (${table.isBuiltIn} = false AND ${table.ownerAccountId} IS NOT NULL)`
        ),

        check(
            "account_plan_limits_check",
            sql`${table.monthlyAllowance} > 0 AND ${table.maxUnitsPerRequest} > 0`
        ),
    ],



);


export const userPlans = pgTable("user_plans", {
    id: uuid("id").primaryKey().defaultRandom(),

    name: text("name").notNull(),

    monthlyAllowance: integer("monthly_allowance").notNull(),

    maxUnitsPerRequest: integer("max_units_per_request").notNull(),
    ownerAccountId: uuid("owner_account_id")
        .references(
            (): AnyPgColumn => accounts.id,
            { onDelete: "cascade" }
        ),
    isBuiltIn: boolean("is_built_in").notNull().default(true),


    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
},
    (table) => [
        uniqueIndex("user_plan_owner_name_unique")
            .on(table.ownerAccountId, table.name)
            .where(sql`${table.ownerAccountId} IS NOT NULL`),

        uniqueIndex("user_plan_builtin_name_unique")
            .on(table.name)
            .where(sql`${table.isBuiltIn} = true`),

        check(
            "user_plan_owner_check",
            sql`(${table.isBuiltIn} = true AND ${table.ownerAccountId} IS NULL)
                OR
                (${table.isBuiltIn} = false AND ${table.ownerAccountId} IS NOT NULL)`
        ),

        check(
            "user_plan_limits_check",
            sql`${table.monthlyAllowance} > 0 AND ${table.maxUnitsPerRequest} > 0`
        ),
    ],
);

// Account usage counters: one counter per account per month
export const accountUsageCounters = pgTable(
    "account_usage_counters",
    {
        id: uuid("id").primaryKey().defaultRandom(),

        accountId: uuid("account_id")
            .notNull()
            .references(() => accounts.id, { onDelete: "cascade" }),

        month: date("month").notNull(),

        usedUnits: integer("used_units").notNull().default(0),
    },
    (table) => [
        unique("account_month_unique").on(table.accountId, table.month),
    ],
);

// User usage counters: one counter per user per month
export const userUsageCounters = pgTable(
    "user_usage_counters",
    {
        id: uuid("id").primaryKey().defaultRandom(),

        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),

        month: date("month").notNull(),

        usedUnits: integer("used_units").notNull().default(0),
    },
    (table) => [
        unique("user_month_unique").on(table.userId, table.month),
    ],
);

//  Usage requests: keep a record of accepted and rejected requests
export const usageRequests = pgTable(
    "usage_requests",
    {
        id: uuid("id").primaryKey().defaultRandom(),

        accountId: uuid("account_id")
            .notNull()
            .references(() => accounts.id),

        userId: uuid("user_id")
            .notNull()
            .references(() => users.id),

        idempotencyKey: text("idempotency_key").notNull(),

        unitsRequested: integer("units_requested").notNull(),

        status: text("status").notNull(),

        decisionReason: text("decision_reason"),

        createdAt: timestamp("created_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (table) => [
        unique("account_idempotency_unique").on(
            table.accountId,
            table.idempotencyKey,
        ),
    ],
);
