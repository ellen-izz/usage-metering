
import { db, client } from "./index.js";
import { accountPlans, userPlans } from "./schema.js";

async function main() {
    await db
        .insert(accountPlans)
        .values([
            {
                name: "Starter",
                monthlyAllowance: 10000,
                maxUnitsPerRequest: 1000,
                isBuiltIn: true,
            },
            {
                name: "Pro",
                monthlyAllowance: 100000,
                maxUnitsPerRequest: 10000,
                isBuiltIn: true,
            },
        ])
        .onConflictDoNothing();

    await db
        .insert(userPlans)
        .values([
            {
                name: "Basic",
                monthlyAllowance: 1000,
                maxUnitsPerRequest: 100,
            },
            {
                name: "Premium",
                monthlyAllowance: 10000,
                maxUnitsPerRequest: 1000,
            },
        ])
        .onConflictDoNothing();

    console.log("Plans inserted successfully");
}

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await client.end();
    });
