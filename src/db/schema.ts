
import {
    pgTable, timestamp, uuid, text, integer, boolean, date, unique,
} from "drizzle-orm/pg-core";

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

    monthlyAllowance: integer("monthly_allowance").notNull(),

    maxUnitsPerRequest: integer("max_units_per_request").notNull(),

    isBuiltIn: boolean("is_built_in").notNull().default(true),




});


export const userPlans = pgTable("user_plans", {
    id: uuid("id").primaryKey().defaultRandom(),

    name: text("name").notNull().unique(),

    monthlyAllowance: integer("monthly_allowance").notNull(),

    maxUnitsPerRequest: integer("max_units_per_request").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
});



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
